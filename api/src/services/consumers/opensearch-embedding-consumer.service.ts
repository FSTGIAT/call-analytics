/**
 * OpenSearch Embedding Consumer Service
 * Consumes embedding messages from the embedding-pipe-queue and updates OpenSearch documents
 * Part of the 3-queue architecture for vector search capabilities
 */

import { SQSConsumerBase } from '../sqs-consumer-base.service';
import { OpenSearchService } from '../opensearch.service';
import { logger } from '../../utils/logger';

interface EmbeddingMessage {
    messageType: 'EMBEDDING_GENERATED';
    callId: string;
    embedding: number[];  // 768-dimensional vector from AlephBERT
    summaryText: string;
    model: string;
    embeddingDimensions: number;
    timestamp: string;
    source: string;
    version: string;
}

export class OpenSearchEmbeddingConsumer extends SQSConsumerBase {
    private opensearchService: OpenSearchService;
    private batchQueue: EmbeddingMessage[] = [];
    private batchTimer: NodeJS.Timeout | null = null;
    private readonly BATCH_SIZE = 10;
    private readonly BATCH_TIMEOUT_MS = 5000;  // 5 seconds
    private processedCount = 0;
    private errorCount = 0;

    constructor() {
        // Call parent constructor with proper config
        super({
            queueName: 'embedding-pipe-queue',
            maxMessages: 10,
            waitTimeSeconds: 20,
            visibilityTimeout: 30
        });

        this.opensearchService = new OpenSearchService();

        logger.info('OpenSearch Embedding Consumer initialized', {
            queueName: 'embedding-pipe-queue',
            batchSize: this.BATCH_SIZE,
            batchTimeout: this.BATCH_TIMEOUT_MS
        });
    }

    /**
     * Process a single embedding message
     */
    protected async processMessage(message: any): Promise<void> {
        try {
            // Validate message type
            if (message.messageType !== 'EMBEDDING_GENERATED') {
                logger.debug(`Skipping non-embedding message type: ${message.messageType}`);
                return;
            }

            // Validate required fields
            if (!message.callId || !message.embedding || !Array.isArray(message.embedding)) {
                logger.error('Invalid embedding message format', {
                    callId: message.callId,
                    hasEmbedding: !!message.embedding,
                    isArray: Array.isArray(message.embedding)
                });
                return;
            }

            // Validate embedding dimensions (should be 768 for AlephBERT)
            if (message.embedding.length !== 768) {
                logger.warn(`Unexpected embedding dimensions for call ${message.callId}`, {
                    expected: 768,
                    actual: message.embedding.length
                });
            }

            // Add to batch queue
            this.batchQueue.push(message as EmbeddingMessage);
            logger.debug(`Added embedding to batch queue for call ${message.callId}`, {
                queueSize: this.batchQueue.length
            });

            // Process batch if it's full
            if (this.batchQueue.length >= this.BATCH_SIZE) {
                await this.processBatch();
            } else {
                // Set timeout to process partial batch
                this.scheduleBatchProcessing();
            }

        } catch (error) {
            logger.error('Error processing embedding message', {
                error: error instanceof Error ? error.message : String(error),
                callId: message?.callId
            });
            throw error;  // Let the base class handle retry logic
        }
    }

    /**
     * Schedule batch processing after timeout
     */
    private scheduleBatchProcessing(): void {
        // Clear existing timer if any
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }

        // Set new timer
        this.batchTimer = setTimeout(async () => {
            if (this.batchQueue.length > 0) {
                await this.processBatch();
            }
        }, this.BATCH_TIMEOUT_MS);
    }

    /**
     * Process the current batch of embeddings
     */
    private async processBatch(): Promise<void> {
        // Clear timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        // Get current batch
        const batch = [...this.batchQueue];
        this.batchQueue = [];

        if (batch.length === 0) {
            return;
        }

        try {
            logger.info(`Processing batch of ${batch.length} embeddings`);

            // Prepare bulk update operations for OpenSearch
            const bulkOperations: any[] = [];

            for (const message of batch) {
                // Update operation to add embedding to existing document
                bulkOperations.push({
                    update: {
                        _index: 'call-analytics-default-summaries',  // Using summaries index
                        _id: message.callId
                    }
                });

                // The update document with embedding
                bulkOperations.push({
                    doc: {
                        embedding: message.embedding,
                        embeddingModel: message.model || 'alephbert',
                        embeddingUpdatedAt: message.timestamp
                    },
                    doc_as_upsert: false  // Don't create if doesn't exist
                });

                logger.debug(`Prepared embedding update for call ${message.callId}`, {
                    dimensions: message.embedding.length,
                    model: message.model
                });
            }

            // Execute bulk update
            await this.opensearchService.bulkIndex(bulkOperations);

            this.processedCount += batch.length;
            logger.info(`✅ Successfully indexed ${batch.length} embeddings to OpenSearch`);

        } catch (error) {
            logger.error('Failed to process embedding batch', {
                error: error instanceof Error ? error.message : String(error),
                batchSize: batch.length
            });

            // Increment error count for the entire batch
            this.errorCount += batch.length;

            throw error;  // Let the base class handle retry
        }
    }

    /**
     * Clean up resources
     */
    public async stop(): Promise<void> {
        // Process any remaining batch before stopping
        if (this.batchQueue.length > 0) {
            logger.info(`Processing final batch of ${this.batchQueue.length} embeddings before shutdown`);
            await this.processBatch();
        }

        // Clear timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        // Call parent stop
        await super.stop();
    }

    /**
     * Get consumer metrics
     */
    public getMetrics(): any {
        const baseMetrics = super.getMetrics();
        return {
            ...baseMetrics,
            processedCount: this.processedCount,
            errorCount: this.errorCount,
            currentBatchSize: this.batchQueue.length,
            batchSize: this.BATCH_SIZE,
            batchTimeout: this.BATCH_TIMEOUT_MS
        };
    }

    /**
     * Health check
     */
    public async healthCheck(): Promise<any> {
        const baseHealth = await super.healthCheck();
        const opensearchHealth = await this.opensearchService.healthCheck();

        return {
            ...baseHealth,
            opensearch: opensearchHealth,
            batchQueue: {
                size: this.batchQueue.length,
                hasPendingTimer: !!this.batchTimer
            },
            metrics: {
                processedCount: this.processedCount,
                errorCount: this.errorCount
            }
        };
    }
}

// Singleton instance
let embeddingConsumerInstance: OpenSearchEmbeddingConsumer | null = null;

export const getOpenSearchEmbeddingConsumer = (): OpenSearchEmbeddingConsumer => {
    if (!embeddingConsumerInstance) {
        embeddingConsumerInstance = new OpenSearchEmbeddingConsumer();
    }
    return embeddingConsumerInstance;
};