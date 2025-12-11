import SQSConsumerBase, { ProcessingContext } from '../sqs-consumer-base.service';
import { openSearchService } from '../opensearch.service';
import { logger } from '../../utils/logger';

/**
 * SQS Consumer for processing ML results and indexing them to OpenSearch
 * This consumer listens for 'opensearch_index' messages from the ML service
 */
export class OpenSearchMLResultsConsumerService extends SQSConsumerBase {
    private indexName = 'call-summaries';
    private batchBuffer: any[] = [];
    private batchTimer?: NodeJS.Timeout;
    private readonly BATCH_SIZE = 10;
    private readonly BATCH_TIMEOUT = 5000; // 5 seconds

    constructor() {
        super({
            queueName: 'summary-pipe-queue', // Same queue, different message type
            maxMessages: 10,
            visibilityTimeout: 300,
            waitTimeSeconds: 20,
            pollingInterval: 2000,
            maxRetries: 3
        });

        // Initialize OpenSearch index on startup
        this.initializeIndex();
    }

    /**
     * Initialize OpenSearch index with Hebrew-optimized mappings
     */
    private async initializeIndex(): Promise<void> {
        try {
            const indexExists = await openSearchService.indexExists(this.indexName);

            if (!indexExists) {
                logger.info(`📚 Creating OpenSearch index: ${this.indexName}`);

                const indexSettings = {
                    settings: {
                        'index.number_of_shards': 2,
                        'index.number_of_replicas': 1,
                        'analysis': {
                            'analyzer': {
                                'hebrew_analyzer': {
                                    'type': 'custom',
                                    'tokenizer': 'standard',
                                    'filter': ['lowercase', 'hebrew_stop']
                                }
                            },
                            'filter': {
                                'hebrew_stop': {
                                    'type': 'stop',
                                    'stopwords': '_hebrew_'
                                }
                            }
                        }
                    },
                    mappings: {
                        properties: {
                            callId: { type: 'keyword' },
                            summary: {
                                type: 'text',
                                analyzer: 'hebrew_analyzer',
                                fields: {
                                    keyword: { type: 'keyword', ignore_above: 256 }
                                }
                            },
                            sentiment: {
                                properties: {
                                    overall: { type: 'keyword' },
                                    score: { type: 'float' }
                                }
                            },
                            classifications: { type: 'keyword' },
                            keyPoints: {
                                type: 'text',
                                analyzer: 'hebrew_analyzer'
                            },
                            actionItems: {
                                type: 'text',
                                analyzer: 'hebrew_analyzer'
                            },
                            language: { type: 'keyword' },
                            confidence: { type: 'float' },
                            processingTime: { type: 'long' },
                            timestamp: { type: 'date' },
                            indexedAt: { type: 'date' }
                        }
                    }
                };

                await openSearchService.createIndex(this.indexName, indexSettings);
                logger.info(`✅ OpenSearch index created: ${this.indexName}`);
            } else {
                logger.info(`✅ OpenSearch index already exists: ${this.indexName}`);
            }
        } catch (error) {
            logger.error('❌ Failed to initialize OpenSearch index', { error });
        }
    }

    /**
     * Process ML result messages for OpenSearch indexing
     */
    protected async processMessage(message: any, context: ProcessingContext): Promise<void> {
        try {
            // Check if this is an OpenSearch indexing message
            const messageType = message.messageType || context.attributes?.messageType;

            if (messageType !== 'opensearch_index') {
                // Not our message type, ignore it
                logger.debug(`Ignoring message type: ${messageType}`);
                return;
            }

            logger.info(`🔍 Processing OpenSearch index message for call: ${message.callId}`);

            // Add to batch buffer
            this.batchBuffer.push({
                ...message.document || message,
                indexedAt: new Date().toISOString()
            });

            // Process batch if size reached
            if (this.batchBuffer.length >= this.BATCH_SIZE) {
                await this.processBatch();
            } else {
                // Reset batch timer
                this.resetBatchTimer();
            }

        } catch (error) {
            logger.error('❌ Failed to process OpenSearch message', {
                error,
                messageId: context.messageId,
                callId: message.callId
            });
            throw error;
        }
    }

    /**
     * Reset the batch timer
     */
    private resetBatchTimer(): void {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }

        this.batchTimer = setTimeout(async () => {
            if (this.batchBuffer.length > 0) {
                await this.processBatch();
            }
        }, this.BATCH_TIMEOUT);
    }

    /**
     * Process buffered documents in batch
     */
    private async processBatch(): Promise<void> {
        if (this.batchBuffer.length === 0) {
            return;
        }

        const documents = [...this.batchBuffer];
        this.batchBuffer = [];

        try {
            logger.info(`📤 Bulk indexing ${documents.length} documents to OpenSearch`);

            // Prepare bulk operations
            const bulkOperations: any[] = [];
            for (const doc of documents) {
                bulkOperations.push({
                    index: {
                        _index: this.indexName,
                        _id: doc.callId
                    }
                });
                bulkOperations.push(doc);
            }

            // Perform bulk indexing using the correct method signature
            await openSearchService.bulkIndex(bulkOperations);
            logger.info(`✅ Successfully indexed ${documents.length} documents to OpenSearch`);

            // Emit success event
            this.emit('batch.indexed', {
                count: documents.length,
                indexName: this.indexName
            });

        } catch (error) {
            logger.error('❌ Failed to bulk index documents', { error });

            // Try to index individually as fallback
            for (const doc of documents) {
                try {
                    await openSearchService.indexDocument(this.indexName, doc.callId, doc);
                    logger.info(`✅ Individually indexed document: ${doc.callId}`);
                } catch (individualError) {
                    logger.error(`❌ Failed to index document: ${doc.callId}`, { individualError });
                }
            }
        }
    }

    /**
     * Search for similar calls using OpenSearch
     */
    async searchSimilarCalls(query: string, limit: number = 10): Promise<any[]> {
        try {
            // Create a customer context for default customer or use proper context
            const customerContext = { customerId: 'default', tenantId: 'default' };

            const searchQuery = {
                query,
                size: limit
            };

            // Use the correct search method signature
            const results = await openSearchService.search(customerContext, 'summaries', searchQuery);
            return results.results;

        } catch (error) {
            logger.error('❌ Failed to search similar calls', { error });
            return [];
        }
    }

    /**
     * Get call summary by ID
     */
    async getCallSummary(callId: string): Promise<any | null> {
        try {
            const result = await openSearchService.searchByCallId(callId);
            if (result.results && result.results.length > 0) {
                return result.results[0];
            }
            return null;
        } catch (error) {
            logger.error(`❌ Failed to get call summary: ${callId}`, { error });
            return null;
        }
    }

    /**
     * Clean up on stop
     */
    async stop(): Promise<void> {
        // Process any remaining batch
        if (this.batchBuffer.length > 0) {
            await this.processBatch();
        }

        // Clear batch timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = undefined;
        }

        await super.stop();
    }
}

// Create singleton instance
export const openSearchMLResultsConsumer = new OpenSearchMLResultsConsumerService();

export default OpenSearchMLResultsConsumerService;