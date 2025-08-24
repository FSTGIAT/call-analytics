import { KafkaConsumerBase, ProcessingContext } from '../kafka-consumer-base.service';
import { MLProcessingResult, OpenSearchIndexRequest } from '../../types/kafka-messages';
import { getKafkaProducer } from '../kafka-producer.service';
import { openSearchService } from '../opensearch.service';
import { logger } from '../../utils/logger';

interface IndexingConfig {
    batchSize: number;
    batchTimeout: number;
    maxRetries: number;
    indexPrefix: string;
    vectorFieldName: string;
    enableBulkIndexing: boolean;
}

interface IndexingBatch {
    documents: OpenSearchIndexDocument[];
    startTime: Date;
    callIds: string[];
}

interface OpenSearchIndexDocument {
    callId: string;
    customerId: string;
    subscriberId: string;
    conversationText: string;
    embedding: number[];
    sentiment: {
        overall: string;
        score: number;
        distribution: Record<string, number>;
    };
    language: {
        detected: string;
        confidence: number;
        isHebrew: boolean;
    };
    entities: {
        persons: string[];
        locations: string[];
        organizations: string[];
        phoneNumbers: string[];
        emails: string[];
    };
    summary: {
        text: string;
        keyPoints: string[];
        actionItems?: string[];
    };
    topics: {
        primary: string;
        secondary: string[];
        confidence: number;
    };
    classifications?: {
        primary: string;
        secondary: string[];
        all: string[];
        confidence: number;
    };
    conversationMetadata: {
        messageCount: number;
        duration: number;
        startTime: Date;
        endTime: Date;
        participants: {
            agent: string[];
            customer: string[];
        };
    };
    processingMetadata: {
        mlProcessingTime: Date;
        indexingTime: Date;
        pipelineVersion: string;
    };
    indexedAt: Date;
}

export class OpenSearchIndexingConsumerService extends KafkaConsumerBase {
    private config: IndexingConfig;
    private indexingBatch: IndexingBatch | null = null;
    private batchTimeout: NodeJS.Timeout | null = null;
    protected processingCount = 0;

    constructor() {
        super({
            groupId: `${process.env.KAFKA_CONSUMER_GROUP_PREFIX || 'call-analytics'}-opensearch-indexing`,
            topics: [process.env.KAFKA_TOPIC_ML_PROCESSING || 'ml-processing-queue'],
            sessionTimeout: 30000,
            heartbeatInterval: 10000,
            maxPollInterval: 300000,
            fromBeginning: true
        });

        this.config = {
            batchSize: parseInt(process.env.OPENSEARCH_BATCH_SIZE || '10'),
            batchTimeout: parseInt(process.env.OPENSEARCH_BATCH_TIMEOUT || '30000'), // 30 seconds
            maxRetries: parseInt(process.env.OPENSEARCH_MAX_RETRIES || '3'),
            indexPrefix: process.env.OPENSEARCH_INDEX_PREFIX || 'call-analytics',
            vectorFieldName: process.env.OPENSEARCH_VECTOR_FIELD || 'embedding',
            enableBulkIndexing: process.env.OPENSEARCH_BULK_INDEXING !== 'false'
        };
    }

    protected async processMessage(
        message: MLProcessingResult, 
        context: ProcessingContext
    ): Promise<void> {
        try {
            logger.info('🔍 OpenSearch Consumer: Processing ML result', {
                callId: message.callId,
                customerId: message.customerId,
                language: message.language?.detected || 'unknown',
                sentiment: message.sentiment?.overall || 'unknown',
                partition: context.partition,
                offset: context.offset,
                messageType: typeof message,
                hasEmbedding: !!message.embedding,
                hasSummary: !!message.summary
            });

            // Create OpenSearch document
            const document = await this.createIndexDocument(message);

            // Add to batch or process immediately
            if (this.config.enableBulkIndexing) {
                await this.addToBatch(document, message.callId);
            } else {
                await this.indexSingleDocument(document, message.callId);
            }

            this.processingCount++;
            
            logger.debug('Document prepared for OpenSearch indexing', {
                callId: message.callId,
                indexName: this.getIndexName(message.customerId),
                embeddingSize: message.embedding.length,
                processingCount: this.processingCount
            });

        } catch (error) {
            logger.error('❌ OpenSearch Consumer: Failed to process ML result', {
                error: error.message,
                stack: error.stack,
                callId: message.callId,
                customerId: message.customerId,
                partition: context.partition,
                offset: context.offset
            });
            throw error;
        }
    }

    private async createIndexDocument(mlResult: MLProcessingResult): Promise<OpenSearchIndexDocument> {
        // Use the full original conversation text instead of summary
        const conversationText = mlResult.conversationText || this.generateConversationText(mlResult);

        // Create the document structure
        const document: OpenSearchIndexDocument = {
            callId: mlResult.callId,
            customerId: mlResult.customerId,
            subscriberId: mlResult.subscriberId,
            conversationText,
            embedding: mlResult.embedding,
            sentiment: {
                overall: mlResult.sentiment.overall,
                score: mlResult.sentiment.score,
                distribution: mlResult.sentiment.distribution
            },
            language: {
                detected: mlResult.language.detected,
                confidence: mlResult.language.confidence,
                isHebrew: mlResult.language.isHebrew
            },
            entities: mlResult.entities || {
                persons: [],
                locations: [],
                organizations: [],
                phoneNumbers: [],
                emails: []
            },
            summary: mlResult.summary || {
                text: 'Summary not available',
                keyPoints: []
            },
            topics: mlResult.topics || {
                primary: 'general',
                secondary: [],
                confidence: 0.5
            },
            classifications: mlResult.classifications,
            conversationMetadata: {
                messageCount: mlResult.conversationContext.messageCount,
                duration: mlResult.conversationContext.duration,
                startTime: mlResult.conversationContext.startTime,
                endTime: mlResult.conversationContext.endTime,
                participants: mlResult.conversationContext.participants
            },
            processingMetadata: {
                mlProcessingTime: mlResult.processingMetadata.processingTime,
                indexingTime: new Date(),
                pipelineVersion: '1.0'
            },
            indexedAt: new Date()
        };

        return document;
    }

    private generateConversationText(mlResult: MLProcessingResult): string {
        // If we have summary, use it as primary text
        if (mlResult.summary?.text && mlResult.summary.text !== 'Summary not available') {
            return mlResult.summary.text;
        }

        // Fallback: generate from key points
        if (mlResult.summary?.keyPoints && mlResult.summary.keyPoints.length > 0) {
            return mlResult.summary.keyPoints.join('. ');
        }

        // Fallback: create generic description
        const duration = Math.round(mlResult.conversationContext.duration / 1000 / 60); // minutes
        const sentiment = mlResult.sentiment.overall;
        const language = mlResult.language.isHebrew ? 'עברית' : 'English';
        
        return `שיחת ${language} באורך ${duration} דקות עם גישה ${sentiment}. ` +
               `השיחה כללה ${mlResult.conversationContext.messageCount} הודעות בין הנציג והלקוח.`;
    }

    private async addToBatch(document: OpenSearchIndexDocument, callId: string): Promise<void> {
        // Initialize batch if needed
        if (!this.indexingBatch) {
            this.indexingBatch = {
                documents: [],
                startTime: new Date(),
                callIds: []
            };
            this.startBatchTimeout();
        }

        // Add document to batch
        this.indexingBatch.documents.push(document);
        this.indexingBatch.callIds.push(callId);

        // Process batch if it's full
        if (this.indexingBatch.documents.length >= this.config.batchSize) {
            await this.processBatch();
        }
    }

    private startBatchTimeout(): void {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
        }

        this.batchTimeout = setTimeout(async () => {
            if (this.indexingBatch && this.indexingBatch.documents.length > 0) {
                await this.processBatch();
            }
        }, this.config.batchTimeout);
    }

    protected async processBatch(): Promise<void> {
        if (!this.indexingBatch || this.indexingBatch.documents.length === 0) {
            return;
        }

        const batch = this.indexingBatch;
        this.indexingBatch = null;

        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }

        try {
            logger.info('Processing OpenSearch indexing batch', {
                batchSize: batch.documents.length,
                callIds: batch.callIds,
                batchAge: Date.now() - batch.startTime.getTime()
            });

            // Group documents by customer for proper indexing
            const customerGroups = this.groupDocumentsByCustomer(batch.documents);

            // Process each customer group
            for (const [customerId, documents] of customerGroups.entries()) {
                await this.indexDocumentsBatch(customerId, documents);
            }

            // Send success notification
            await this.sendIndexingNotification(batch.callIds, 'success');

            logger.info('OpenSearch batch indexing completed successfully', {
                batchSize: batch.documents.length,
                customerCount: customerGroups.size,
                processingTime: Date.now() - batch.startTime.getTime()
            });

        } catch (error) {
            logger.error('Failed to process OpenSearch indexing batch', {
                error,
                batchSize: batch.documents.length,
                callIds: batch.callIds
            });

            // Send failure notification
            await this.sendIndexingNotification(batch.callIds, 'failed', error);
            throw error;
        }
    }

    private groupDocumentsByCustomer(documents: OpenSearchIndexDocument[]): Map<string, OpenSearchIndexDocument[]> {
        const groups = new Map<string, OpenSearchIndexDocument[]>();
        
        for (const doc of documents) {
            const customerId = doc.customerId;
            if (!groups.has(customerId)) {
                groups.set(customerId, []);
            }
            groups.get(customerId)!.push(doc);
        }

        return groups;
    }

    private async indexDocumentsBatch(customerId: string, documents: OpenSearchIndexDocument[]): Promise<void> {
        const indexName = this.getIndexName(customerId);
        
        try {
            // Ensure index exists
            await this.ensureIndexExists(indexName, customerId);

            // Prepare bulk indexing operations
            const bulkOperations = [];
            for (const doc of documents) {
                // Index operation
                bulkOperations.push({
                    index: {
                        _index: indexName,
                        _id: doc.callId
                    }
                });
                // Document data
                bulkOperations.push(doc);
            }

            // Log the bulk operations for debugging
            logger.debug('Bulk operations being sent to OpenSearch', {
                operationCount: bulkOperations.length,
                firstOperation: bulkOperations[0],
                firstDocument: bulkOperations[1]
            });

            // Execute bulk indexing
            await openSearchService.bulkIndex(bulkOperations);

            logger.info('Batch indexed successfully to OpenSearch', {
                indexName,
                customerId,
                documentCount: documents.length,
                callIds: documents.map(d => d.callId)
            });

        } catch (error) {
            logger.error('Failed to index documents batch', {
                error,
                indexName,
                customerId,
                documentCount: documents.length
            });
            throw error;
        }
    }

    private async indexSingleDocument(document: OpenSearchIndexDocument, callId: string): Promise<void> {
        const indexName = this.getIndexName(document.customerId);
        
        try {
            // Ensure index exists
            await this.ensureIndexExists(indexName, document.customerId);

            // Index single document using the new method
            await openSearchService.indexDocument(indexName, callId, document);

            // Send success notification
            await this.sendIndexingNotification([callId], 'success');

            logger.info('Document indexed successfully to OpenSearch', {
                callId,
                indexName,
                customerId: document.customerId
            });

        } catch (error) {
            logger.error('Failed to index single document', {
                error,
                callId,
                indexName,
                customerId: document.customerId
            });

            // Send failure notification
            await this.sendIndexingNotification([callId], 'failed', error);
            throw error;
        }
    }

    private getIndexName(customerId: string): string {
        return `${this.config.indexPrefix}-${customerId.toLowerCase()}-transcriptions`;
    }

    private async ensureIndexExists(indexName: string, customerId: string): Promise<void> {
        try {
            const exists = await openSearchService.indexExists(indexName);
            if (!exists) {
                // Create index with Hebrew-optimized mapping
                const indexConfig = this.createIndexMapping();
                await openSearchService.createIndex(indexName, indexConfig);
                
                logger.info('Created new OpenSearch index', {
                    indexName,
                    customerId
                });
            }
        } catch (error) {
            logger.error('Failed to ensure index exists', {
                error,
                indexName,
                customerId
            });
            throw error;
        }
    }

    private createIndexMapping(): any {
        return {
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
                    conversationText: {
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
                    [this.config.vectorFieldName]: {
                        type: 'knn_vector',
                        dimension: 768, // AlephBERT dimension
                        method: {
                            name: 'hnsw',
                            space_type: 'cosinesimil',
                            engine: 'nmslib'
                        }
                    },
                    'sentiment.overall': { type: 'keyword' },
                    'sentiment.score': { type: 'float' },
                    'language.detected': { type: 'keyword' },
                    'language.isHebrew': { type: 'boolean' },
                    'entities.persons': { type: 'keyword' },
                    'entities.locations': { type: 'keyword' },
                    'entities.organizations': { type: 'keyword' },
                    'summary.text': {
                        type: 'text',
                        analyzer: 'mixed_language_analyzer'
                    },
                    'summary.keyPoints': {
                        type: 'text',
                        analyzer: 'mixed_language_analyzer'
                    },
                    'topics.primary': { type: 'keyword' },
                    'topics.secondary': { type: 'keyword' },
                    'conversationMetadata.duration': { type: 'integer' },
                    'conversationMetadata.messageCount': { type: 'integer' },
                    'conversationMetadata.startTime': { type: 'date' },
                    'conversationMetadata.endTime': { type: 'date' },
                    indexedAt: { type: 'date' }
                }
            }
        };
    }

    private async sendIndexingNotification(
        callIds: string[], 
        status: 'success' | 'failed', 
        error?: any
    ): Promise<void> {
        try {
            const indexRequest: OpenSearchIndexRequest = {
                type: 'opensearch-index-request',
                callIds,
                indexingStatus: status,
                indexingTimestamp: new Date(),
                error: error ? String(error) : undefined,
                metadata: {
                    batchSize: callIds.length,
                    processingNode: 'opensearch-indexing-consumer',
                    indexPrefix: this.config.indexPrefix
                },
                timestamp: new Date().toISOString()
            };

            const kafkaProducer = getKafkaProducer();
            await kafkaProducer.sendOpenSearchIndexRequest(indexRequest);

        } catch (notificationError) {
            logger.warn('Failed to send indexing notification', {
                notificationError,
                callIds,
                status
            });
            // Don't throw - notification failure shouldn't fail indexing
        }
    }

    async stop(): Promise<void> {
        // Process any remaining batch before stopping
        if (this.indexingBatch && this.indexingBatch.documents.length > 0) {
            try {
                await this.processBatch();
            } catch (error) {
                logger.error('Failed to process final batch during shutdown', { error });
            }
        }

        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }

        await super.stop();
    }

    async healthCheck(): Promise<{ 
        status: string; 
        metrics: any;
        processingCount: number;
        isPaused: boolean;
    }> {
        try {
            const baseHealth = await super.healthCheck();
            
            // Test OpenSearch connectivity
            const openSearchHealthy = await openSearchService.healthCheck();
            
            return {
                ...baseHealth,
                status: baseHealth.status === 'healthy' && openSearchHealthy ? 'healthy' : 'unhealthy',
                metrics: {
                    ...baseHealth.metrics,
                    currentBatchSize: this.indexingBatch?.documents.length || 0,
                    openSearchConnected: openSearchHealthy
                }
            };
        } catch (error) {
            logger.error('OpenSearch Indexing Consumer health check failed', { error });
            return {
                status: 'unhealthy',
                metrics: {
                    currentBatchSize: this.indexingBatch?.documents.length || 0,
                    openSearchConnected: false
                },
                processingCount: this.processingCount,
                isPaused: this.isPaused
            };
        }
    }

    getMetrics() {
        return {
            ...super.getMetrics(),
            processingCount: this.processingCount,
            currentBatchSize: this.indexingBatch?.documents.length || 0,
            batchTimeout: this.config.batchTimeout,
            maxBatchSize: this.config.batchSize,
            bulkIndexingEnabled: this.config.enableBulkIndexing
        };
    }
}

// Singleton instance
let openSearchIndexingConsumerInstance: OpenSearchIndexingConsumerService | null = null;

export const getOpenSearchIndexingConsumer = (): OpenSearchIndexingConsumerService => {
    if (!openSearchIndexingConsumerInstance) {
        openSearchIndexingConsumerInstance = new OpenSearchIndexingConsumerService();
    }
    return openSearchIndexingConsumerInstance;
};

export default OpenSearchIndexingConsumerService;