# Vector Embedding Implementation Plan
## Hebrew Call Analytics AI Platform - AlephBERT Integration

---

## Executive Summary

This document outlines the implementation plan for integrating AlephBERT vector embeddings into the call analytics pipeline. The embeddings will enable semantic search capabilities for a frontend RAG service, allowing DictaLM to answer questions about historical call data.

**Key Decision:** Create a **dedicated SQS queue** for embeddings, separate from the summary pipeline, to enable independent scaling and fault isolation.

---

## Current Architecture Analysis

### Existing SQS Queue Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       CURRENT PIPELINE (No Embeddings)                   │
└─────────────────────────────────────────────────────────────────────────┘

1. Oracle CDC Service (Python)
   └─> Polls Oracle VERINT_TEXT_ANALYSIS table
   └─> Assembles conversation from segments
   └─> Sends to: summary-pipe-queue
       Message Type: CONVERSATION_ASSEMBLY

2. ML Service (Python) - SQS Consumer
   └─> Consumes from: summary-pipe-queue
   └─> Processes with DictaLM (Ollama)
   └─> Generates: summary, classifications, sentiment

   IF SUCCESS, sends TWO messages to summary-pipe-complete:

   ├─> Message Type: ML_PROCESSING_RESULT
   │   Purpose: Save to Oracle DICTA_CALL_SUMMARY table
   │   Consumer: Oracle CDC Service
   │   Fields: callId, summary, sentiment, classifications, confidence, etc.
   │
   └─> Message Type: opensearch_index
       Purpose: Index in OpenSearch for search
       Consumer: OpenSearch ML Results Consumer (Node.js API)
       Fields: callId, summary, sentiment, classifications, keyPoints
       ⚠️ NO EMBEDDING FIELD!

3A. Oracle CDC Service
   └─> Consumes: ML_PROCESSING_RESULT
   └─> Writes to: DICTA_CALL_SUMMARY table
   └─> Stores: summary, sentiment, classifications

3B. OpenSearch ML Results Consumer (Node.js API)
   └─> Consumes: opensearch_index
   └─> Indexes to: call-summaries index
   └─> ⚠️ Index has NO embedding field configured!
```

### Existing Queues

| Queue Name | AWS URL | Purpose | Producer | Consumer |
|------------|---------|---------|----------|----------|
| `summary-pipe-queue` | `https://sqs.eu-west-1.amazonaws.com/320708867194/summary-pipe-queue` | Outbound: CDC → ML | Oracle CDC | ML Service |
| `summary-pipe-complete` | `https://sqs.eu-west-1.amazonaws.com/320708867194/summary-pipe-complete` | Inbound: ML → CDC/OpenSearch | ML Service | CDC + OpenSearch Consumer |
| `summary-pipe-complete-dlq` | `https://sqs.eu-west-1.amazonaws.com/320708867194/summary-pipe-complete-dlq` | Dead Letter Queue | System | Manual monitoring |

### Key Finding

**Embeddings are NOT currently generated or stored anywhere in the production SQS pipeline.**

The embedding service (AlephBERT) exists and is fully functional, but:
- It's only called in the HTTP endpoint `/api/analyze-conversation` with `includeEmbedding: true`
- The SQS flow (`process_sqs_message`) never calls the embedding service
- The OpenSearch `call-summaries` index has NO vector field configured

---

## New Architecture: Dedicated Embedding Pipeline

### Proposed SQS Queue Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    NEW PIPELINE (With Embeddings)                        │
└─────────────────────────────────────────────────────────────────────────┘

1. Oracle CDC Service (Python)
   └─> [UNCHANGED]
   └─> Sends to: summary-pipe-queue

2. ML Service (Python) - SQS Consumer
   └─> Consumes from: summary-pipe-queue
   └─> Processes with DictaLM (Ollama) → Summary
   └─> NEW: Processes with AlephBERT → 768-dim embedding

   IF SUCCESS, sends THREE messages:

   ├─> To: summary-pipe-complete
   │   Type: ML_PROCESSING_RESULT
   │   [UNCHANGED - No embedding here]
   │
   ├─> To: summary-pipe-complete
   │   Type: opensearch_index
   │   [UNCHANGED - No embedding here]
   │
   └─> To: embedding-pipe-queue (NEW!)
       Type: EMBEDDING_GENERATED
       Purpose: Store embedding in OpenSearch
       Fields: callId, embedding (768 floats), summaryText, model, timestamp

3A. Oracle CDC Service
   └─> [UNCHANGED]

3B. OpenSearch ML Results Consumer
   └─> [UNCHANGED - Initially]

3C. Embedding Consumer (NEW!)
   └─> Consumes from: embedding-pipe-queue
   └─> Updates OpenSearch document with embedding
   └─> Uses UPDATE API (document already exists from 3B)
```

### New Queue: embedding-pipe-queue

**Purpose:** Dedicated pipeline for AlephBERT embeddings

**Configuration:**
- Queue Name: `embedding-pipe-queue`
- Region: `eu-west-1`
- Account: `320708867194`
- Full URL: `https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue`
- Visibility Timeout: 60 seconds
- Message Retention: 4 days (345,600 seconds)
- Dead Letter Queue: `embedding-pipe-dlq`
- Max Receives (before DLQ): 3

**Message Format:**
```json
{
  "messageType": "EMBEDDING_GENERATED",
  "callId": "CALL_12345",
  "embedding": [0.123, -0.456, 0.789, ...],  // 768 floats
  "summaryText": "לקוח התקשר בנוגע לחיוב...",
  "dimension": 768,
  "model": "imvladikon/sentence-transformers-alephbert",
  "timestamp": "2025-11-03T10:30:00.000Z"
}
```

**Why Separate Queue?**
1. **Fault Isolation:** Embedding failures don't affect summary storage
2. **Independent Scaling:** Can scale embedding processing separately
3. **Retry Logic:** Can retry embeddings without reprocessing summaries
4. **Monitoring:** Separate metrics for embedding pipeline health
5. **Optional Processing:** Embeddings can be disabled without changing summary flow

---

## Implementation Steps

### Step 1: Create NEW SQS Queue (AWS)

**Method A: AWS Console**
1. Navigate to SQS in eu-west-1
2. Create Queue:
   - Name: `embedding-pipe-queue`
   - Type: Standard
   - Visibility timeout: 60 seconds
   - Message retention: 4 days
   - Receive message wait time: 5 seconds (enable long polling)
3. Create Dead Letter Queue:
   - Name: `embedding-pipe-dlq`
   - Configure as DLQ for main queue
   - Max receives: 3

**Method B: AWS CLI**
```bash
# Create main queue
aws sqs create-queue \
  --queue-name embedding-pipe-queue \
  --region eu-west-1 \
  --attributes VisibilityTimeout=60,MessageRetentionPeriod=345600,ReceiveMessageWaitTimeSeconds=5

# Create DLQ
aws sqs create-queue \
  --queue-name embedding-pipe-dlq \
  --region eu-west-1

# Configure DLQ
aws sqs set-queue-attributes \
  --queue-url https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue \
  --attributes '{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:eu-west-1:320708867194:embedding-pipe-dlq\",\"maxReceiveCount\":\"3\"}"
  }'
```

**IAM Permissions Required:**
- `sqs:SendMessage` (for ML service)
- `sqs:ReceiveMessage` (for embedding consumer)
- `sqs:DeleteMessage` (for embedding consumer)
- `sqs:GetQueueAttributes` (for both)

---

### Step 2: Update ML Service - Generate Embeddings

**File:** `ml-service/app.py`
**Location:** Lines 65-138 in `process_sqs_message()` function

**Current Code Structure:**
```python
async def process_sqs_message(message_data):
    # Line 39-57: Extract call data and build transcription
    call_id = message_data.get('callId', '')
    messages = message_data.get('messages', [])
    transcription_text = '\n'.join(transcription_lines)

    # Line 65-72: Call DictaLM for summarization
    result = await llm_orchestrator.summarize_call(
        transcription=transcription_text,
        call_id=call_id,
        language='hebrew',
        prefer_local=True,
        use_call_id_prompt=True,
        prompt_template='summarize_with_id'
    )

    # Line 86-103: Prepare ML result
    ml_result = {
        'callId': call_id,
        'summary': summary_data.get('summary', ''),
        'sentiment': {...},
        'classification': {...},
        # ... other fields
    }

    # Line 105-120: Send to queues
    await sqs_producer.send_ml_result(ml_result)
    await sqs_producer.send_to_opensearch_queue(ml_result)
```

**NEW Code to Add (after line 103):**
```python
    # Generate embedding using AlephBERT
    embedding = None
    try:
        logger.info(f"🔄 Generating embedding for call {call_id}")

        # Use summary text for embedding (more concise than full transcription)
        text_for_embedding = summary_data.get('summary', '')
        if not text_for_embedding:
            text_for_embedding = transcription_text[:2000]  # Fallback to truncated transcription

        # Call embedding service
        embedding_result = await embedding_service.generate_batch_embeddings([text_for_embedding])

        if embedding_result and len(embedding_result) > 0:
            embedding_obj = embedding_result[0]
            embedding = embedding_obj.embedding.tolist()  # Convert to Python list

            logger.info(f"✅ Embedding generated successfully: {len(embedding)} dimensions")

            # Send to dedicated embedding queue
            await sqs_producer.send_embedding(
                call_id=call_id,
                embedding=embedding,
                summary_text=text_for_embedding,
                timestamp=datetime.utcnow().isoformat()
            )
        else:
            logger.warning(f"⚠️ Embedding service returned empty result for call {call_id}")

    except Exception as e:
        logger.error(f"❌ Failed to generate embedding for call {call_id}: {e}")
        # Continue without embedding - don't fail the entire process
```

**Important Notes:**
- Use **summary text** for embedding (not full transcription) - more relevant for RAG
- Fallback to truncated transcription if summary is empty
- Graceful error handling - embedding failures don't break summary pipeline
- Separate send to dedicated queue
- Comprehensive logging for debugging

---

### Step 3: Add SQS Producer Method for Embeddings

**File:** `ml-service/src/services/sqs_producer_service.py`
**Location:** Add after `send_to_opensearch_queue()` method (after line 177)

**Add Queue URL Constant (around line 26-30):**
```python
EMBEDDING_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue'
```

**Add New Method:**
```python
async def send_embedding(
    self,
    call_id: str,
    embedding: List[float],
    summary_text: str,
    timestamp: str
) -> bool:
    """
    Send embedding to dedicated embedding-pipe-queue

    Args:
        call_id: Call identifier
        embedding: 768-dimensional vector from AlephBERT
        summary_text: Summary text that was embedded
        timestamp: ISO format timestamp

    Returns:
        bool: True if sent successfully
    """
    try:
        if not call_id or not embedding:
            logger.warning(f"⚠️ Missing required fields for embedding: callId={call_id}, embedding_len={len(embedding) if embedding else 0}")
            return False

        # Validate embedding dimension
        if len(embedding) != 768:
            logger.error(f"❌ Invalid embedding dimension: {len(embedding)} (expected 768)")
            return False

        # Prepare message body
        message_body = {
            'messageType': 'EMBEDDING_GENERATED',
            'callId': call_id,
            'embedding': embedding,  # 768-dim float array
            'summaryText': summary_text,
            'dimension': len(embedding),
            'model': 'imvladikon/sentence-transformers-alephbert',
            'timestamp': timestamp
        }

        # Send to SQS
        response = await self.sqs_client.send_message(
            QueueUrl=EMBEDDING_QUEUE_URL,
            MessageBody=json.dumps(message_body),
            MessageAttributes={
                'MessageType': {
                    'StringValue': 'EMBEDDING_GENERATED',
                    'DataType': 'String'
                },
                'CallId': {
                    'StringValue': call_id,
                    'DataType': 'String'
                }
            }
        )

        logger.info(f"✅ Embedding sent to queue: callId={call_id}, messageId={response.get('MessageId')}")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to send embedding to queue: callId={call_id}, error={e}")
        return False
```

**Import to Add (at top of file):**
```python
from typing import List, Dict, Any
```

---

### Step 4: Create Embedding Consumer Service

**File:** NEW - `api/src/services/consumers/opensearch-embedding-consumer.service.ts`

**Full Implementation:**
```typescript
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, Message } from '@aws-sdk/client-sqs';
import { logger } from '../../utils/logger';
import { openSearchService } from '../opensearch.service';

export interface EmbeddingMessage {
  messageType: 'EMBEDDING_GENERATED';
  callId: string;
  embedding: number[];  // 768 dimensions
  summaryText: string;
  dimension: number;
  model: string;
  timestamp: string;
}

export class OpenSearchEmbeddingConsumerService {
  private sqsClient: SQSClient;
  private queueUrl: string;
  private indexName: string;
  private isRunning: boolean = false;
  private pollInterval: number = 5000; // 5 seconds

  constructor() {
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || 'eu-west-1'
    });
    this.queueUrl = process.env.EMBEDDING_QUEUE_URL ||
      'https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue';
    this.indexName = 'call-summaries';
  }

  /**
   * Start consuming messages from embedding queue
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('⚠️ Embedding consumer already running');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 Starting OpenSearch embedding consumer service');

    // Start polling loop
    this.pollMessages();
  }

  /**
   * Stop the consumer
   */
  async stop(): Promise<void> {
    logger.info('🛑 Stopping OpenSearch embedding consumer service');
    this.isRunning = false;
  }

  /**
   * Poll SQS queue for embedding messages
   */
  private async pollMessages(): Promise<void> {
    while (this.isRunning) {
      try {
        const command = new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 5, // Long polling
          VisibilityTimeout: 60,
          MessageAttributeNames: ['All']
        });

        const response = await this.sqsClient.send(command);

        if (response.Messages && response.Messages.length > 0) {
          logger.info(`📥 Received ${response.Messages.length} embedding messages`);

          // Process messages in parallel
          await Promise.all(
            response.Messages.map(message => this.processMessage(message))
          );
        }

      } catch (error) {
        logger.error('❌ Error polling embedding queue', { error });
      }

      // Small delay before next poll
      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }
  }

  /**
   * Process individual embedding message
   */
  private async processMessage(message: Message): Promise<void> {
    try {
      if (!message.Body) {
        logger.warn('⚠️ Received message without body');
        return;
      }

      const embeddingData: EmbeddingMessage = JSON.parse(message.Body);

      // Validate message
      if (!this.validateMessage(embeddingData)) {
        logger.error('❌ Invalid embedding message format', { embeddingData });
        await this.deleteMessage(message.ReceiptHandle!);
        return;
      }

      // Update OpenSearch document with embedding
      const success = await this.updateOpenSearchDocument(embeddingData);

      if (success) {
        // Delete message from queue
        await this.deleteMessage(message.ReceiptHandle!);
        logger.info(`✅ Processed embedding for call ${embeddingData.callId}`);
      } else {
        logger.error(`❌ Failed to update OpenSearch for call ${embeddingData.callId}`);
        // Don't delete - will be retried or go to DLQ
      }

    } catch (error) {
      logger.error('❌ Error processing embedding message', { error, message });
    }
  }

  /**
   * Validate embedding message format
   */
  private validateMessage(data: any): data is EmbeddingMessage {
    return (
      data.messageType === 'EMBEDDING_GENERATED' &&
      typeof data.callId === 'string' &&
      Array.isArray(data.embedding) &&
      data.embedding.length === 768 &&
      typeof data.summaryText === 'string'
    );
  }

  /**
   * Update OpenSearch document with embedding
   */
  private async updateOpenSearchDocument(data: EmbeddingMessage): Promise<boolean> {
    try {
      // Use UPDATE API to add embedding to existing document
      await openSearchService.updateDocument(
        this.indexName,
        data.callId,
        {
          embedding: data.embedding,
          embeddingModel: data.model,
          embeddingTimestamp: data.timestamp,
          embeddingDimension: data.dimension
        }
      );

      logger.info(`✅ Updated OpenSearch document with embedding`, {
        callId: data.callId,
        index: this.indexName,
        dimension: data.dimension
      });

      return true;

    } catch (error) {
      logger.error(`❌ Failed to update OpenSearch document`, {
        callId: data.callId,
        error
      });
      return false;
    }
  }

  /**
   * Delete message from SQS queue
   */
  private async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle
      });

      await this.sqsClient.send(command);

    } catch (error) {
      logger.error('❌ Error deleting message from queue', { error });
    }
  }
}

// Singleton instance
export const embeddingConsumerService = new OpenSearchEmbeddingConsumerService();
```

**Start Consumer in API Service:**

**File:** `api/src/index.ts`
**Add after other services start:**
```typescript
import { embeddingConsumerService } from './services/consumers/opensearch-embedding-consumer.service';

// Start embedding consumer
embeddingConsumerService.start();
```

---

### Step 5: Add OpenSearch Update Method

**File:** `api/src/services/opensearch.service.ts`
**Location:** Add new method (around line 600)

**Add Method:**
```typescript
/**
 * Update an existing document with partial fields
 */
async updateDocument(
  indexName: string,
  documentId: string,
  partialDoc: Record<string, any>
): Promise<void> {
  try {
    const response = await this.client.update({
      index: indexName,
      id: documentId,
      body: {
        doc: partialDoc,
        doc_as_upsert: false  // Don't create if doesn't exist
      },
      refresh: true
    });

    logger.info(`✅ Updated document in OpenSearch`, {
      index: indexName,
      id: documentId,
      result: response.body.result
    });

  } catch (error) {
    logger.error(`❌ Failed to update OpenSearch document`, {
      index: indexName,
      id: documentId,
      error
    });
    throw error;
  }
}
```

---

### Step 6: Update OpenSearch Index Mapping

**File:** `api/src/services/consumers/opensearch-ml-results-consumer.service.ts`
**Location:** Lines 60-91 (in index creation method)

**Current Mapping:**
```typescript
mappings: {
  properties: {
    callId: { type: 'keyword' },
    summary: { type: 'text', analyzer: 'hebrew_analyzer' },
    sentiment: { properties: { overall: { type: 'keyword' }, score: { type: 'float' } } },
    classifications: { type: 'keyword' },
    keyPoints: { type: 'text', analyzer: 'hebrew_analyzer' },
    actionItems: { type: 'text', analyzer: 'hebrew_analyzer' },
    language: { type: 'keyword' },
    confidence: { type: 'float' },
    processingTime: { type: 'long' },
    timestamp: { type: 'date' },
    indexedAt: { type: 'date' }
  }
}
```

**ADD These Fields:**
```typescript
mappings: {
  properties: {
    // ... existing fields ...

    // ADD THESE:
    embedding: {
      type: 'knn_vector',
      dimension: 768,
      method: {
        name: 'hnsw',
        space_type: 'l2',
        engine: 'lucene'
      }
    },
    embeddingModel: {
      type: 'keyword'
    },
    embeddingTimestamp: {
      type: 'date'
    },
    embeddingDimension: {
      type: 'integer'
    }
  }
}
```

**Also Update Index Settings (around line 40-59):**
```typescript
settings: {
  index: {
    knn: true,  // ADD THIS: Enable k-NN plugin
    'knn.algo_param.ef_search': 512  // ADD THIS: HNSW search parameter
  },
  analysis: {
    // ... existing analyzer config ...
  }
}
```

---

## Index Migration Strategy (Preserve Existing Data)

### Problem Statement

The current `call-summaries` index has NO `embedding` field in its mapping. OpenSearch mappings are immutable - you cannot add a `knn_vector` field to an existing index.

**Options:**
1. Delete and recreate (loses data) ❌
2. Reindex to new index (preserves data) ✅

### Solution: Blue-Green Index Migration

#### Phase 1: Create New Index (call-summaries-v2)

**File:** `api/src/services/consumers/opensearch-ml-results-consumer.service.ts`

**Modify Constructor:**
```typescript
constructor() {
  // ... existing code ...

  // Use versioned index name
  this.indexName = 'call-summaries-v2';  // Changed from 'call-summaries'
}
```

**Deploy:** New documents will go to `call-summaries-v2` with embedding field configured.

---

#### Phase 2: Reindex Historical Data

**Method 1: OpenSearch Reindex API (Recommended)**

**Script:** `scripts/reindex-call-summaries.sh`
```bash
#!/bin/bash
# Reindex call-summaries to call-summaries-v2

OPENSEARCH_ENDPOINT="https://your-opensearch-endpoint.eu-west-1.es.amazonaws.com"

curl -X POST "${OPENSEARCH_ENDPOINT}/_reindex" \
  -H 'Content-Type: application/json' \
  -d '{
    "source": {
      "index": "call-summaries"
    },
    "dest": {
      "index": "call-summaries-v2"
    },
    "script": {
      "source": "ctx._source.embedding = []; ctx._source.embeddingModel = null; ctx._source.embeddingTimestamp = null; ctx._source.embeddingDimension = 0;",
      "lang": "painless"
    }
  }'
```

**What this does:**
- Copies all documents from old index to new index
- Adds empty embedding fields (`[]` for vector, `null` for metadata)
- Preserves all original fields

**Monitoring Progress:**
```bash
curl -X GET "${OPENSEARCH_ENDPOINT}/_tasks?detailed=true&actions=*reindex"
```

---

**Method 2: Manual Batch Reindex (for large datasets)**

**Script:** `scripts/batch-reindex.js`
```javascript
const { Client } = require('@opensearch-project/opensearch');

const client = new Client({
  node: process.env.OPENSEARCH_ENDPOINT
});

async function batchReindex() {
  const batchSize = 1000;
  let processed = 0;

  // Scroll through old index
  let response = await client.search({
    index: 'call-summaries',
    scroll: '5m',
    size: batchSize,
    body: {
      query: { match_all: {} }
    }
  });

  while (response.body.hits.hits.length > 0) {
    const documents = response.body.hits.hits;

    // Prepare bulk index operations
    const bulkBody = documents.flatMap(doc => [
      { index: { _index: 'call-summaries-v2', _id: doc._id } },
      {
        ...doc._source,
        embedding: [],
        embeddingModel: null,
        embeddingTimestamp: null,
        embeddingDimension: 0
      }
    ]);

    // Bulk index to new index
    await client.bulk({ body: bulkBody });

    processed += documents.length;
    console.log(`Processed ${processed} documents`);

    // Get next batch
    response = await client.scroll({
      scroll_id: response.body._scroll_id,
      scroll: '5m'
    });
  }

  console.log(`✅ Reindex complete: ${processed} documents`);
}

batchReindex().catch(console.error);
```

**Run:**
```bash
node scripts/batch-reindex.js
```

---

#### Phase 3: Backfill Embeddings (Optional)

**Three Strategies:**

**Strategy A: Lazy Backfill (Recommended)**
- Only new calls get embeddings
- Old calls without embeddings will have `embedding: []`
- Frontend checks if embedding exists before vector search
- Minimal computational cost

**Strategy B: Batch Backfill**
- Create script to reprocess all summaries through AlephBERT
- Generate embeddings for historical data
- Update OpenSearch documents

**Script:** `ml-service/scripts/backfill-embeddings.py`
```python
import asyncio
from services.embedding_service import embedding_service
from services.opensearch_service import opensearch_service

async def backfill_embeddings():
    # Get all documents without embeddings
    docs = await opensearch_service.search({
        "query": {
            "bool": {
                "must_not": {
                    "exists": { "field": "embedding" }
                }
            }
        },
        "size": 10000
    })

    for doc in docs:
        call_id = doc['callId']
        summary_text = doc['summary']

        # Generate embedding
        result = await embedding_service.generate_embedding(summary_text)
        embedding = result.embedding.tolist()

        # Update OpenSearch
        await opensearch_service.update_document(
            index='call-summaries-v2',
            id=call_id,
            doc={'embedding': embedding}
        )

        print(f"✅ Backfilled {call_id}")

asyncio.run(backfill_embeddings())
```

**Strategy C: On-Demand Backfill**
- Generate embeddings when frontend queries old calls
- Cache generated embeddings
- Gradual backfill over time

---

#### Phase 4: Switch and Cleanup

**Step 1: Create Index Alias**
```bash
# Remove old alias if exists
curl -X DELETE "${OPENSEARCH_ENDPOINT}/_alias/call-summaries"

# Point alias to new index
curl -X POST "${OPENSEARCH_ENDPOINT}/_aliases" \
  -H 'Content-Type: application/json' \
  -d '{
    "actions": [
      { "add": { "index": "call-summaries-v2", "alias": "call-summaries" } }
    ]
  }'
```

**Step 2: Update Application Code**
All services now use `call-summaries` alias which points to `call-summaries-v2`.

**Step 3: Verify Data Integrity**
```bash
# Compare document counts
curl "${OPENSEARCH_ENDPOINT}/call-summaries/_count"
curl "${OPENSEARCH_ENDPOINT}/call-summaries-v2/_count"

# Verify embedding field exists
curl "${OPENSEARCH_ENDPOINT}/call-summaries-v2/_mapping?pretty"
```

**Step 4: Delete Old Index (After Verification)**
```bash
# Backup first (optional)
# Then delete
curl -X DELETE "${OPENSEARCH_ENDPOINT}/call-summaries-old"
```

---

## Frontend RAG Use Case

### How Semantic Search Enables RAG

**User Question:** "מצא שיחות על בעיות חיוב" (Find calls about billing issues)

**Traditional Keyword Search:**
- Searches for exact words: "חיוב", "בעיות"
- Misses semantically similar terms
- Limited recall

**Semantic Search with Embeddings:**
- Converts question to 768-dim vector
- Finds calls with similar meaning
- Matches even if different words used

### Implementation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Frontend RAG Flow                                │
└─────────────────────────────────────────────────────────────────────────┘

1. User Asks Question (Hebrew)
   "מצא שיחות על בעיות חיוב"

2. Frontend → ML Service
   POST /api/embed
   Body: { text: "מצא שיחות על בעיות חיוב" }
   Response: { embedding: [0.123, -0.456, ...] }  // 768 dims

3. Frontend → API Service
   POST /api/search/semantic
   Body: {
     queryEmbedding: [...],
     limit: 10,
     minScore: 0.7
   }

4. API Service → OpenSearch
   Query: {
     knn: {
       embedding: {
         vector: queryEmbedding,
         k: 10
       }
     }
   }

5. OpenSearch Returns Similar Calls
   [
     { callId: "CALL_789", summary: "לקוח התלונן על חיוב כפול...", score: 0.92 },
     { callId: "CALL_456", summary: "בקשה לבירור חיוב...", score: 0.87 },
     ...
   ]

6. Frontend → DictaLM
   Prompt: "על סמך השיחות הבאות, ענה על השאלה:
           שיחות:
           1. לקוח התלונן על חיוב כפול...
           2. בקשה לבירור חיוב...

           שאלה: מצא שיחות על בעיות חיוב"

7. DictaLM Generates Answer
   "נמצאו 10 שיחות הקשורות לבעיות חיוב. הבעיות העיקריות:
    - חיוב כפול (5 שיחות)
    - אי הבנת החיוב (3 שיחות)
    - בקשות לתיקון (2 שיחות)"
```

### API Endpoint to Add

**File:** `api/src/routes/search.routes.ts`

**New Route:**
```typescript
router.post('/semantic', async (req, res) => {
  try {
    const { queryEmbedding, limit = 10, minScore = 0.7 } = req.body;

    // Validate embedding
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 768) {
      return res.status(400).json({
        error: 'Invalid embedding dimension'
      });
    }

    // Search OpenSearch
    const results = await embeddingConsumerService.searchSimilarCallsByEmbedding(
      queryEmbedding,
      limit,
      minScore
    );

    res.json({
      success: true,
      results,
      count: results.length
    });

  } catch (error) {
    logger.error('Semantic search failed', { error });
    res.status(500).json({ error: 'Search failed' });
  }
});
```

---

## Configuration Files to Update

### 1. ML Service Config

**File:** `ml-service/src/services/sqs_producer_service.py`
**Add:**
```python
EMBEDDING_QUEUE_URL = os.getenv(
    'EMBEDDING_QUEUE_URL',
    'https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue'
)
```

### 2. API Service Environment

**File:** `api/.env` or environment variables
**Add:**
```bash
EMBEDDING_QUEUE_URL=https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue
AWS_REGION=eu-west-1
```

### 3. Docker Compose (if using local development)

**File:** `docker-compose.yml`
**Add to ml-service:**
```yaml
ml-service:
  environment:
    - EMBEDDING_QUEUE_URL=https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue
```

**Add to api:**
```yaml
api:
  environment:
    - EMBEDDING_QUEUE_URL=https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue
```

---

## Testing Plan (Future Implementation)

### Unit Tests
- Test embedding generation in ML service
- Test SQS message format validation
- Test OpenSearch update operation

### Integration Tests
- End-to-end: Conversation → Embedding → OpenSearch
- Test Hebrew text processing
- Verify embedding dimensions

### Performance Tests
- Embedding generation latency
- OpenSearch indexing throughput
- Vector search query performance

---

## Monitoring and Observability

### Metrics to Track

**SQS Metrics:**
- `embedding-pipe-queue` message count
- Message age (detect backlog)
- DLQ message count (detect failures)

**ML Service Metrics:**
- Embedding generation success rate
- Embedding generation latency
- AlephBERT model memory usage

**OpenSearch Metrics:**
- Document update success rate
- Index size growth (with embeddings)
- Vector search query latency

**Business Metrics:**
- % of calls with embeddings
- Vector search usage frequency
- RAG query accuracy (user feedback)

### Logging Strategy

**ML Service:**
```python
logger.info(f"🔄 Generating embedding for call {call_id}")
logger.info(f"✅ Embedding generated: {len(embedding)} dimensions")
logger.error(f"❌ Failed to generate embedding: {error}")
```

**Embedding Consumer:**
```typescript
logger.info(`📥 Received ${count} embedding messages`);
logger.info(`✅ Processed embedding for call ${callId}`);
logger.error(`❌ Failed to update OpenSearch for call ${callId}`);
```

---

## Rollback Plan

### If Issues Occur After Deployment

**Step 1: Stop Embedding Processing**
- Stop embedding consumer service
- Embeddings will accumulate in queue (4-day retention)

**Step 2: Revert Code Changes**
- Revert ML service embedding generation
- Revert OpenSearch consumer changes

**Step 3: Drain or Purge Queue**
- Purge `embedding-pipe-queue` if backlog too large
- Or wait for messages to expire (4 days)

**Step 4: Keep New Index**
- `call-summaries-v2` with embedding field can stay
- Old documents have empty embeddings (harmless)
- Can re-enable when issues resolved

---

## Summary Checklist

### Infrastructure
- [ ] Create `embedding-pipe-queue` in AWS SQS
- [ ] Create `embedding-pipe-dlq` for dead letters
- [ ] Configure IAM permissions for queue access

### ML Service
- [ ] Update `app.py` to generate embeddings
- [ ] Add `send_embedding()` method to SQS producer
- [ ] Add queue URL to configuration
- [ ] Test embedding generation locally

### API Service
- [ ] Create `opensearch-embedding-consumer.service.ts`
- [ ] Add `updateDocument()` method to OpenSearch service
- [ ] Start embedding consumer in `index.ts`
- [ ] Update OpenSearch index mapping with `knn_vector`

### Index Migration
- [ ] Create `call-summaries-v2` index
- [ ] Reindex historical data from old index
- [ ] Verify document counts match
- [ ] Create index alias
- [ ] Update application to use alias
- [ ] Delete old index (optional)

### Frontend Integration
- [ ] Add semantic search API endpoint
- [ ] Implement RAG query flow
- [ ] Test with Hebrew queries

### Monitoring
- [ ] Set up SQS queue monitoring
- [ ] Track embedding generation metrics
- [ ] Monitor OpenSearch index size
- [ ] Set up alerts for failures

---

## Timeline Estimate

| Phase | Task | Estimated Time |
|-------|------|----------------|
| 1 | Create SQS queue and configure IAM | 30 min |
| 2 | Update ML service (embedding generation) | 2 hours |
| 3 | Create embedding consumer service | 3 hours |
| 4 | Update OpenSearch mapping | 1 hour |
| 5 | Index migration (reindex) | 2-4 hours (depends on data volume) |
| 6 | Testing and verification | 2 hours |
| 7 | Deploy and monitor | 1 hour |
| **Total** | **11-13 hours** | **~2 working days** |

---

## Success Criteria

- ✅ AlephBERT embeddings generated for every new call summary
- ✅ Embeddings (768 dims) stored in OpenSearch `call-summaries-v2` index
- ✅ Vector search returns semantically similar calls
- ✅ Frontend RAG service can query embeddings
- ✅ No impact on existing summary→Oracle pipeline
- ✅ < 5% failed embedding generations
- ✅ < 2 second latency for embedding generation
- ✅ Historical data preserved during migration

---

## References

### Key Files
- ML Service: `/home/roygi/call-analytics-ai-platform_aws/call-analytics/ml-service/app.py`
- SQS Producer: `/home/roygi/call-analytics-ai-platform_aws/call-analytics/ml-service/src/services/sqs_producer_service.py`
- Embedding Service: `/home/roygi/call-analytics-ai-platform_aws/call-analytics/ml-service/src/services/embedding_service.py`
- OpenSearch Consumer: `/home/roygi/call-analytics-ai-platform_aws/call-analytics/api/src/services/consumers/opensearch-ml-results-consumer.service.ts`
- OpenSearch Service: `/home/roygi/call-analytics-ai-platform_aws/call-analytics/api/src/services/opensearch.service.ts`

### Models
- **AlephBERT:** `imvladikon/sentence-transformers-alephbert`
- **DictaLM:** `dictalm2.0-instruct:Q4_K_M`
- **Embedding Dimension:** 768
- **Vector Space:** L2 (Euclidean distance)
- **Algorithm:** HNSW (Hierarchical Navigable Small World)

### AWS Resources
- **Account:** 320708867194
- **Region:** eu-west-1
- **SQS Queue:** embedding-pipe-queue
- **OpenSearch:** call-summaries-v2 index

---

**Document Version:** 1.0
**Last Updated:** 2025-11-03
**Author:** System Analysis & Planning
