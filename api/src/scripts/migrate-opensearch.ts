import { Client } from '@opensearch-project/opensearch';
import axios from 'axios';

// Configuration
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || 'http://opensearch:9200';
// Note: Weaviate migration is disabled - data now flows through Kafka pipeline

const opensearchClient = new Client({
  node: OPENSEARCH_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function waitForOpenSearch() {
  console.log('Waiting for OpenSearch to be ready...');
  
  // Wait for OpenSearch only
  let opensearchReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      await opensearchClient.cluster.health();
      opensearchReady = true;
      break;
    } catch (error) {
      console.log(`OpenSearch not ready, retrying in 2s... (${i+1}/30)`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  if (!opensearchReady) {
    throw new Error('OpenSearch is not ready after 60 seconds');
  }
  
  console.log('OpenSearch is ready!');
}

// Weaviate data fetching is disabled - data now flows through Kafka
async function getWeaviateData() {
  console.log('⚠️  Weaviate data fetching disabled - data flows through Kafka pipeline');
  return [];
}

async function createOpenSearchIndex(indexName) {
  try {
    const exists = await opensearchClient.indices.exists({ index: indexName });
    if (exists.body) {
      console.log(`Index ${indexName} already exists`);
      return true; // Use existing index with its existing mapping
    }

    const indexConfig: any = {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        analysis: {
          analyzer: {
            hebrew_analyzer: {
              tokenizer: 'standard',
              filter: ['lowercase', 'stop']
            },
            mixed_language_analyzer: {
              tokenizer: 'standard',
              filter: ['lowercase', 'stop', 'snowball']
            }
          }
        }
      },
      mappings: {
        properties: {
          callId: { type: 'keyword' },
          customerId: { type: 'keyword' },
          subscriberId: { type: 'keyword' },
          transcriptionText: {
            type: 'text',
            analyzer: 'mixed_language_analyzer',
            fields: {
              hebrew: {
                type: 'text',
                analyzer: 'hebrew_analyzer'
              },
              raw: {
                type: 'keyword'
              }
            }
          },
          callDate: { type: 'date' },
          callType: { type: 'keyword' },
          language: { type: 'keyword' },
          sentiment: { type: 'keyword' },
          agentId: { type: 'keyword' },
          keyPoints: { type: 'text' },
          productsMentioned: { type: 'text' },
          summary: { type: 'text', analyzer: 'mixed_language_analyzer' },
          durationSeconds: { type: 'integer' },
          indexedAt: { type: 'date' }
        }
      }
    };

    await opensearchClient.indices.create({
      index: indexName,
      body: indexConfig
    });

    console.log(`Created index: ${indexName}`);
    return true;
  } catch (error) {
    console.error(`Failed to create index ${indexName}:`, error);
    return false;
  }
}

async function indexDocuments(indexName, documents) {
  try {
    if (documents.length === 0) {
      console.log('No documents to index');
      return true;
    }

    // Check for existing documents to prevent duplicates
    console.log(`Checking for existing documents in ${indexName}...`);
    const existingCount = await opensearchClient.count({ index: indexName });
    const currentCount = existingCount.body.count || 0;
    
    if (currentCount > 0) {
      console.log(`Found ${currentCount} existing documents in ${indexName}`);
      console.log(`Attempting to add ${documents.length} new documents with upsert logic`);
    }

    // Get the existing mapping to determine summary field type
    const mapping = await opensearchClient.indices.getMapping({ index: indexName });
    const summaryMapping = mapping.body[indexName]?.mappings?.properties?.summary;
    const summaryIsObject = summaryMapping?.type === 'object' || 
                           (summaryMapping && 'properties' in summaryMapping);

    const body = [];
    
    for (const doc of documents) {
      const properties = doc.properties || {};
      
      // Adapt summary field based on existing mapping
      let summaryValue;
      if (summaryIsObject) {
        // Index expects object
        summaryValue = typeof properties.summary === 'object' ? 
          properties.summary : 
          {
            main_points: properties.summary || '',
            customer_satisfaction: 'unknown',
            issue_resolved: false,
            followup_required: false
          };
      } else {
        // Index expects text
        summaryValue = typeof properties.summary === 'object' ? 
          (properties.summary.main_points || JSON.stringify(properties.summary)) : 
          (properties.summary || '');
      }
      
      // Create OpenSearch document
      const openSearchDoc = {
        callId: properties.callId || doc.id,
        customerId: properties.customerId || 'UNKNOWN',
        subscriberId: properties.subscriberId || 'UNKNOWN',
        transcriptionText: properties.transcriptionText || '',
        callDate: properties.callDate || new Date().toISOString(),
        callType: properties.callType || 'support',
        language: properties.language || 'he',
        sentiment: properties.sentiment || 'neutral',
        agentId: properties.agentId || 'unknown',
        keyPoints: Array.isArray(properties.keyPoints) ? properties.keyPoints.join(' ') : (properties.keyPoints || ''),
        productsMentioned: Array.isArray(properties.productsMentioned) ? properties.productsMentioned.join(' ') : (properties.productsMentioned || ''),
        summary: summaryValue,
        durationSeconds: properties.durationSeconds || 0,
        indexedAt: new Date().toISOString()
      };

      // Use update with upsert to prevent duplicates
      body.push({ 
        update: { 
          _index: indexName, 
          _id: doc.id,
          retry_on_conflict: 3
        } 
      });
      body.push({
        doc: openSearchDoc,
        doc_as_upsert: true
      });
    }

    if (body.length > 0) {
      const response = await opensearchClient.bulk({ body });
      
      if (response.body.errors) {
        const errors = response.body.items
          .filter((item: any) => item.update?.error)
          .map((item: any) => ({
            id: item.update._id,
            status: item.update.status,
            error: item.update.error
          }));
        console.error('Bulk upsert errors:', JSON.stringify(errors, null, 2));
      }
      
      const successful = response.body.items.filter((item: any) => !item.update?.error).length;
      const created = response.body.items.filter((item: any) => item.update?.result === 'created').length;
      const updated = response.body.items.filter((item: any) => item.update?.result === 'updated').length;
      console.log(`Processed ${successful} documents to ${indexName}: ${created} created, ${updated} updated`);
    }
    
    return true;
  } catch (error) {
    console.error('Error indexing documents:', error);
    return false;
  }
}

async function migrateData() {
  console.log('🚀 Starting OpenSearch migration...');
  console.log('⚠️  Weaviate migration disabled - data now flows through Kafka pipeline');
  
  try {
    // Wait for OpenSearch to be ready
    await waitForOpenSearch();
    
    console.log('✅ OpenSearch is ready - migration can proceed when Kafka consumers are implemented');
    
    // Create basic admin index structure for Kafka data ingestion
    console.log('🔧 Creating OpenSearch indices for Kafka pipeline...');
    const adminIndexName = 'call-analytics-admin-transcriptions';
    await createOpenSearchIndex(adminIndexName);
    
    console.log('✅ OpenSearch initialization completed - ready for Kafka data flow!');
    
    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    return false;
  }
}

// Export for use in other modules
export { migrateData };

// Run directly if called as script
if (require.main === module) {
  migrateData().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}