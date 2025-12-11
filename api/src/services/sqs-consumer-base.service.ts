import { getSQSService, SQSService } from './sqs.service';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

export interface ProcessingContext {
    messageId: string;
    receiptHandle: string;
    attributes: any;
    approximateReceiveCount: number;
    queueName: string;
}

export interface SQSConsumerConfig {
    queueName: string;
    maxMessages?: number;
    visibilityTimeout?: number;
    waitTimeSeconds?: number;
    pollingInterval?: number;
    maxRetries?: number;
}

export abstract class SQSConsumerBase extends EventEmitter {
    protected sqsService: SQSService;
    protected config: SQSConsumerConfig;
    protected isRunning: boolean = false;
    protected pollingTimer?: NodeJS.Timeout;
    protected processingCount: number = 0;
    protected metrics = {
        messagesReceived: 0,
        messagesProcessed: 0,
        messagesFailed: 0,
        lastError: undefined as string | undefined,
        lastProcessedAt: undefined as Date | undefined
    };

    constructor(config: SQSConsumerConfig) {
        super();
        this.sqsService = getSQSService();
        this.config = {
            maxMessages: 10,
            visibilityTimeout: 300, // 5 minutes default
            waitTimeSeconds: 20, // Long polling
            pollingInterval: 1000, // 1 second between polls
            maxRetries: 3,
            ...config
        };
    }

    /**
     * Start consuming messages from the queue
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn(`Consumer already running for queue: ${this.config.queueName}`);
            return;
        }

        logger.info(`🚀 Starting SQS consumer for queue: ${this.config.queueName}`, {
            config: this.config
        });

        this.isRunning = true;
        this.emit('consumer.start');

        // Start polling loop
        this.pollMessages();
    }

    /**
     * Stop consuming messages
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            logger.warn(`Consumer not running for queue: ${this.config.queueName}`);
            return;
        }

        logger.info(`⏹️ Stopping SQS consumer for queue: ${this.config.queueName}`);
        
        this.isRunning = false;
        
        if (this.pollingTimer) {
            clearTimeout(this.pollingTimer);
            this.pollingTimer = undefined;
        }

        // Wait for current processing to complete
        while (this.processingCount > 0) {
            logger.info(`Waiting for ${this.processingCount} messages to finish processing...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.emit('consumer.stop');
        logger.info(`✅ SQS consumer stopped for queue: ${this.config.queueName}`);
    }

    /**
     * Poll messages from SQS queue
     */
    private async pollMessages(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        try {
            // Receive messages from SQS
            const messages = await this.sqsService.receiveMessages(
                this.config.queueName,
                this.config.maxMessages,
                this.config.waitTimeSeconds,
                this.config.visibilityTimeout
            );

            if (messages.length > 0) {
                logger.debug(`📥 Received ${messages.length} messages from queue: ${this.config.queueName}`);
                this.metrics.messagesReceived += messages.length;

                // Process messages concurrently
                const processingPromises = messages.map(message => 
                    this.handleMessage(message)
                );

                await Promise.allSettled(processingPromises);
            }

        } catch (error) {
            logger.error(`❌ Error polling messages from queue: ${this.config.queueName}`, { error });
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            this.emit('consumer.error', error);
        }

        // Schedule next poll
        if (this.isRunning) {
            this.pollingTimer = setTimeout(() => this.pollMessages(), this.config.pollingInterval);
        }
    }

    /**
     * Handle a single message
     */
    private async handleMessage(message: any): Promise<void> {
        this.processingCount++;
        const context: ProcessingContext = {
            messageId: message.messageId,
            receiptHandle: message.receiptHandle,
            attributes: message.attributes,
            approximateReceiveCount: parseInt(message.systemAttributes?.ApproximateReceiveCount || '1'),
            queueName: this.config.queueName
        };

        try {
            logger.debug(`🔄 Processing message ${message.messageId} from queue: ${this.config.queueName}`);
            
            // Call the abstract method to process the message
            await this.processMessage(message.body, context);
            
            // Delete message from queue on successful processing
            await this.sqsService.deleteMessage(this.config.queueName, message.receiptHandle);
            
            this.metrics.messagesProcessed++;
            this.metrics.lastProcessedAt = new Date();
            
            logger.debug(`✅ Successfully processed message ${message.messageId}`);
            this.emit('message.processed', { messageId: message.messageId, context });
            
        } catch (error) {
            logger.error(`❌ Failed to process message ${message.messageId}`, { error, context });
            this.metrics.messagesFailed++;
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            
            // Check if message should be retried
            if (context.approximateReceiveCount >= (this.config.maxRetries || 3)) {
                logger.error(`Message ${message.messageId} exceeded max retries, will be moved to DLQ`, {
                    receiveCount: context.approximateReceiveCount,
                    maxRetries: this.config.maxRetries
                });
                
                // Delete the message to let it go to DLQ
                try {
                    await this.sqsService.deleteMessage(this.config.queueName, message.receiptHandle);
                } catch (deleteError) {
                    logger.error(`Failed to delete message after max retries`, { deleteError });
                }
            }
            
            this.emit('message.error', { messageId: message.messageId, error, context });
            
        } finally {
            this.processingCount--;
        }
    }

    /**
     * Abstract method to process a message - must be implemented by subclasses
     */
    protected abstract processMessage(message: any, context: ProcessingContext): Promise<void>;

    /**
     * Get consumer metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            isRunning: this.isRunning,
            processingCount: this.processingCount,
            queueName: this.config.queueName
        };
    }

    /**
     * Check if consumer is healthy
     */
    isHealthy(): boolean {
        return this.isRunning && this.processingCount < (this.config.maxMessages || 10) * 2;
    }

    /**
     * Perform health check
     */
    async healthCheck(): Promise<{ status: string; metrics: any; processingCount: number; isPaused: boolean; }> {
        const healthy = this.isHealthy();
        return {
            status: healthy ? 'healthy' : 'unhealthy',
            metrics: this.getMetrics(),
            processingCount: this.processingCount,
            isPaused: !this.isRunning
        };
    }
}


export default SQSConsumerBase;