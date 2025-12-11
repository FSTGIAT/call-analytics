// This file now proxies to SQS consumer implementation for backward compatibility
import { EventEmitter } from 'events';
import { SQSConsumerBase, ProcessingContext as SQSProcessingContext } from './sqs-consumer-base.service';
import { logger } from '../utils/logger';
import { getKafkaProducer } from './kafka-producer.service';
import { ProcessingMetric } from '../types/kafka-messages';

export interface ConsumerOptions {
    groupId: string;
    topics: string[];
    fromBeginning?: boolean;
    sessionTimeout?: number;
    heartbeatInterval?: number;
    maxPollInterval?: number;
    maxBatchSize?: number;
    autoCommit?: boolean;
    retryPolicy?: RetryPolicy;
}

export interface RetryPolicy {
    maxRetries: number;
    retryDelayMs: number;
    multiplier: number;
    maxDelayMs: number;
    enableDLQ: boolean;
}

// Kafka-style processing context for backward compatibility
export interface ProcessingContext {
    topic: string;
    partition: number;
    offset: string;
    key: string | null;
    timestamp: string;
    headers: Record<string, string>;
    retryCount: number;
    startTime: number;
}

export abstract class KafkaConsumerBase extends SQSConsumerBase {
    protected options: ConsumerOptions;
    protected isRunning: boolean = false;
    protected isPaused: boolean = false;
    protected processingCount: number = 0;
    protected metrics = {
        messagesReceived: 0,
        messagesProcessed: 0,
        messagesFailed: 0,
        messagesSucceeded: 0,
        messagesRetried: 0,
        messagesDLQ: 0,
        avgProcessingTimeMs: 0,
        lastError: undefined as string | undefined,
        lastProcessedAt: undefined as Date | undefined,
        lastProcessedOffset: undefined as string | undefined
    };

    private processingTimes: number[] = [];
    private readonly MAX_PROCESSING_TIME_SAMPLES = 1000;

    constructor(options: ConsumerOptions) {
        // Map Kafka config to SQS config
        const sqsConfig = {
            queueName: options.topics[0], // Use first topic as queue name
            maxMessages: options.maxBatchSize || 10,
            visibilityTimeout: Math.floor((options.sessionTimeout || 30000) / 1000),
            waitTimeSeconds: 20,
            pollingInterval: options.heartbeatInterval || 3000,
            maxRetries: options.retryPolicy?.maxRetries || 3
        };
        
        super(sqsConfig);
        
        this.options = {
            fromBeginning: false,
            sessionTimeout: 30000,
            heartbeatInterval: 3000,
            maxPollInterval: 300000,
            maxBatchSize: 100,
            autoCommit: false,
            retryPolicy: {
                maxRetries: 3,
                retryDelayMs: 1000,
                multiplier: 2,
                maxDelayMs: 30000,
                enableDLQ: true
            },
            ...options
        };

        logger.info('🔄 SQS consumer initialized', {
            groupId: options.groupId,
            topics: options.topics,
            queueName: sqsConfig.queueName
        });
    }

    // Override SQS processMessage to call Kafka-style processMessage
    protected async processMessage(message: any, sqsContext: SQSProcessingContext): Promise<void> {
        const startTime = Date.now();
        
        // Map SQS context to Kafka-like context
        const kafkaContext: ProcessingContext = {
            topic: sqsContext.queueName,
            partition: 0, // SQS doesn't have partitions
            offset: sqsContext.messageId,
            key: message.messageId || null,
            timestamp: new Date().toISOString(),
            headers: message.attributes || {},
            retryCount: sqsContext.approximateReceiveCount - 1,
            startTime
        };

        try {
            // Call the abstract Kafka-style processMessage
            await this.processKafkaMessage(message, kafkaContext);
            
            // Update metrics
            this.metrics.messagesProcessed++;
            this.metrics.messagesSucceeded++;
            this.metrics.lastProcessedOffset = kafkaContext.offset;
            
            // Track processing time
            const processingTime = Date.now() - startTime;
            this.updateProcessingTime(processingTime);
            
            // Send processing metric
            await this.sendProcessingMetric('success', kafkaContext, processingTime);
            
        } catch (error) {
            this.metrics.messagesFailed++;
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            
            // Check if should retry or send to DLQ
            if (kafkaContext.retryCount >= (this.options.retryPolicy?.maxRetries || 3)) {
                if (this.options.retryPolicy?.enableDLQ) {
                    await this.sendToDeadLetterQueue(message, kafkaContext, error);
                    this.metrics.messagesDLQ++;
                }
            } else {
                this.metrics.messagesRetried++;
                // Message will be retried by SQS visibility timeout
            }
            
            // Send processing metric
            const processingTime = Date.now() - startTime;
            await this.sendProcessingMetric('failure', kafkaContext, processingTime);
            
            throw error; // Re-throw to let SQS handle retry
        }
    }

    // This is the method that subclasses implement
    protected abstract processKafkaMessage(message: any, context: ProcessingContext): Promise<void>;

    // Compatibility methods
    async run(): Promise<void> {
        logger.info(`🚀 Starting SQS consumer for topics: ${this.options.topics.join(', ')}`);
        this.isRunning = true;
        await this.start();
    }

    async pause(): Promise<void> {
        logger.info('⏸️ Pausing SQS consumer');
        this.isPaused = true;
        await this.stop();
    }

    async resume(): Promise<void> {
        logger.info('▶️ Resuming SQS consumer');
        this.isPaused = false;
        await this.start();
    }

    async disconnect(): Promise<void> {
        logger.info('🛑 Disconnecting SQS consumer');
        this.isRunning = false;
        await this.stop();
    }

    async seek(topic: string, partition: number, offset: string): Promise<void> {
        logger.warn('Seek operation not supported in SQS mode', { topic, partition, offset });
    }

    async commitOffsets(): Promise<void> {
        logger.debug('✅ Offset commit not needed in SQS mode (messages deleted on success)');
    }

    // Helper methods
    private updateProcessingTime(timeMs: number): void {
        this.processingTimes.push(timeMs);
        if (this.processingTimes.length > this.MAX_PROCESSING_TIME_SAMPLES) {
            this.processingTimes.shift();
        }
        
        const sum = this.processingTimes.reduce((a, b) => a + b, 0);
        this.metrics.avgProcessingTimeMs = Math.round(sum / this.processingTimes.length);
    }

    private async sendProcessingMetric(
        status: 'success' | 'failure',
        context: ProcessingContext,
        processingTimeMs: number
    ): Promise<void> {
        try {
            const metric: ProcessingMetric = {
                type: 'processing-metric',
                timestamp: new Date().toISOString(),
                consumerGroup: this.options.groupId,
                topic: context.topic,
                partition: context.partition,
                offset: context.offset,
                stage: 'ml-processing',
                status,
                processingTimeMs,
                retryCount: context.retryCount,
                metadata: {
                    groupId: this.options.groupId
                }
            };
            
            const producer = getKafkaProducer();
            await producer.sendProcessingMetric(metric);
        } catch (error) {
            logger.warn('Failed to send processing metric', { error });
        }
    }

    private async sendToDeadLetterQueue(
        message: any,
        context: ProcessingContext,
        error: any
    ): Promise<void> {
        try {
            const producer = getKafkaProducer();
            await producer.sendToDeadLetterQueue(
                context.topic,
                {
                    ...message,
                    originalContext: context
                },
                error instanceof Error ? error.message : String(error)
            );
        } catch (dlqError) {
            logger.error('Failed to send message to DLQ', { dlqError, context });
        }
    }

    // Metrics
    getMetrics() {
        const baseMetrics = super.getMetrics();
        return {
            ...baseMetrics,
            ...this.metrics,
            groupId: this.options.groupId,
            topics: this.options.topics
        };
    }

    isHealthy(): boolean {
        return super.isHealthy() && this.isRunning && !this.isPaused;
    }
}

export default KafkaConsumerBase;