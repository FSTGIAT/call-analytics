import { Kafka, Consumer, ConsumerConfig, EachMessagePayload, KafkaMessage } from 'kafkajs';
import { EventEmitter } from 'events';
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

export abstract class KafkaConsumerBase extends EventEmitter {
    protected kafka: Kafka;
    protected consumer: Consumer;
    protected options: ConsumerOptions;
    protected isRunning: boolean = false;
    protected isPaused: boolean = false;
    protected processingCount: number = 0;
    protected metrics: {
        messagesProcessed: number;
        messagesSucceeded: number;
        messagesFailed: number;
        messagesRetried: number;
        messagesDLQ: number;
        avgProcessingTimeMs: number;
        lastError?: string;
        lastProcessedOffset?: string;
    } = {
        messagesProcessed: 0,
        messagesSucceeded: 0,
        messagesFailed: 0,
        messagesRetried: 0,
        messagesDLQ: 0,
        avgProcessingTimeMs: 0
    };

    private processingTimes: number[] = [];
    private readonly MAX_PROCESSING_TIME_SAMPLES = 1000;

    constructor(options: ConsumerOptions) {
        super();
        
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

        const kafkaConfig = {
            clientId: process.env.KAFKA_CLIENT_ID || 'call-analytics-api',
            brokers: process.env.KAFKA_BROKERS?.split(',') || ['kafka:9092'],
            connectionTimeout: 10000,
            requestTimeout: 30000,
            retry: {
                initialRetryTime: 300,
                retries: 5,
                maxRetryTime: 30000,
                multiplier: 2
            }
        };

        this.kafka = new Kafka(kafkaConfig);

        const consumerConfig: ConsumerConfig = {
            groupId: this.options.groupId,
            sessionTimeout: this.options.sessionTimeout,
            heartbeatInterval: this.options.heartbeatInterval,
            maxWaitTimeInMs: 5000,
            rebalanceTimeout: 60000,
            metadataMaxAge: 300000,
            allowAutoTopicCreation: false,
            maxBytes: 10485760, // 10MB for Hebrew conversations
            retry: {
                retries: 3
            }
        };

        this.consumer = this.kafka.consumer(consumerConfig);
        this.setupEventHandlers();
    }

    /**
     * Abstract method to be implemented by derived classes
     * Processes a single message from Kafka
     */
    protected abstract processMessage(
        message: any,
        context: ProcessingContext
    ): Promise<void>;

    /**
     * Optional method to be overridden for batch processing
     */
    protected async processBatch(
        messages: Array<{ message: any; context: ProcessingContext }>
    ): Promise<void> {
        // Default implementation: process messages sequentially
        for (const { message, context } of messages) {
            await this.processMessage(message, context);
        }
    }

    /**
     * Optional method to validate message before processing
     */
    protected async validateMessage(message: any): Promise<boolean> {
        return true;
    }

    /**
     * Optional method called when consumer starts
     */
    protected async onStart(): Promise<void> {
        // Override in derived classes if needed
    }

    /**
     * Optional method called when consumer stops
     */
    protected async onStop(): Promise<void> {
        // Override in derived classes if needed
    }

    private setupEventHandlers(): void {
        this.consumer.on('consumer.connect', () => {
            logger.info(`Kafka consumer connected: ${this.options.groupId}`);
            this.emit('connected');
        });

        this.consumer.on('consumer.disconnect', () => {
            logger.warn(`Kafka consumer disconnected: ${this.options.groupId}`);
            this.emit('disconnected');
        });

        this.consumer.on('consumer.stop', () => {
            logger.info(`Kafka consumer stopped: ${this.options.groupId}`);
            this.emit('stopped');
        });

        this.consumer.on('consumer.crash', (event) => {
            logger.error(`Kafka consumer crashed: ${this.options.groupId}`, { error: event });
            this.emit('crashed', event);
        });

        this.consumer.on('consumer.rebalancing', () => {
            logger.info(`Kafka consumer rebalancing: ${this.options.groupId}`);
            this.emit('rebalancing');
        });

        this.consumer.on('consumer.group_join', (event) => {
            logger.info(`Kafka consumer joined group: ${this.options.groupId}`, { event });
            this.emit('group_joined', event);
        });
    }

    async start(): Promise<void> {
        try {
            logger.info(`Starting Kafka consumer: ${this.options.groupId}`, {
                topics: this.options.topics
            });

            await this.consumer.connect();
            await this.consumer.subscribe({
                topics: this.options.topics,
                fromBeginning: this.options.fromBeginning
            });

            this.isRunning = true;
            await this.onStart();

            await this.consumer.run({
                eachMessage: async (payload: EachMessagePayload) => {
                    if (this.isPaused) {
                        await this.waitForResume();
                    }

                    await this.handleMessage(payload);
                }
            });

        } catch (error) {
            logger.error(`Failed to start consumer: ${this.options.groupId}`, { error });
            throw error;
        }
    }

    async stop(): Promise<void> {
        try {
            logger.info(`Stopping Kafka consumer: ${this.options.groupId}`);
            
            this.isRunning = false;
            
            // Wait for current processing to complete
            while (this.processingCount > 0) {
                logger.info(`Waiting for ${this.processingCount} messages to complete processing...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            await this.onStop();
            await this.consumer.disconnect();
            
            logger.info(`Kafka consumer stopped: ${this.options.groupId}`);
        } catch (error) {
            logger.error(`Error stopping consumer: ${this.options.groupId}`, { error });
            throw error;
        }
    }

    private async handleMessage(payload: EachMessagePayload): Promise<void> {
        const { topic, partition, message } = payload;
        const startTime = Date.now();
        this.processingCount++;

        const context: ProcessingContext = {
            topic,
            partition,
            offset: message.offset,
            key: message.key?.toString() || null,
            timestamp: message.timestamp,
            headers: this.parseHeaders(message.headers),
            retryCount: 0,
            startTime
        };

        try {
            // Parse message value
            const messageValue = this.parseMessage(message);
            
            // Validate message
            if (!await this.validateMessage(messageValue)) {
                logger.warn('Message validation failed', { 
                    topic, 
                    partition, 
                    offset: message.offset 
                });
                await this.commitOffset(payload);
                return;
            }

            // Process message with retry logic
            await this.processWithRetry(messageValue, context);

            // Commit offset after successful processing
            if (!this.options.autoCommit) {
                await this.commitOffset(payload);
            }

            // Update metrics
            this.metrics.messagesProcessed++;
            this.metrics.messagesSucceeded++;
            this.updateProcessingTime(Date.now() - startTime);

            // Send processing metric
            await this.sendProcessingMetric(context, 'success', Date.now() - startTime);

        } catch (error) {
            this.metrics.messagesFailed++;
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            
            logger.error('Failed to process message', {
                topic,
                partition,
                offset: message.offset,
                error
            });

            // Send to DLQ if enabled and max retries exceeded
            if (this.options.retryPolicy?.enableDLQ) {
                await this.sendToDeadLetterQueue(message, context, error);
            }

            // Send processing metric for failure
            await this.sendProcessingMetric(context, 'failure', Date.now() - startTime);

        } finally {
            this.processingCount--;
            this.metrics.lastProcessedOffset = message.offset;
        }
    }

    private async processWithRetry(
        message: any, 
        context: ProcessingContext
    ): Promise<void> {
        const retryPolicy = this.options.retryPolicy!;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
            try {
                context.retryCount = attempt;
                await this.processMessage(message, context);
                
                if (attempt > 0) {
                    this.metrics.messagesRetried++;
                    logger.info('Message processed successfully after retry', {
                        topic: context.topic,
                        offset: context.offset,
                        attempt
                    });
                }
                
                return; // Success
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                if (attempt < retryPolicy.maxRetries) {
                    const delay = Math.min(
                        retryPolicy.retryDelayMs * Math.pow(retryPolicy.multiplier, attempt),
                        retryPolicy.maxDelayMs
                    );
                    
                    logger.warn(`Retrying message processing in ${delay}ms`, {
                        topic: context.topic,
                        offset: context.offset,
                        attempt: attempt + 1,
                        error: lastError.message
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // Max retries exceeded
        throw lastError;
    }

    private async sendToDeadLetterQueue(
        message: KafkaMessage,
        context: ProcessingContext,
        error: any
    ): Promise<void> {
        try {
            const producer = getKafkaProducer();
            const messageValue = this.parseMessage(message);
            
            await producer.sendToDeadLetterQueue(
                context.topic,
                {
                    ...messageValue,
                    kafkaContext: {
                        partition: context.partition,
                        offset: context.offset,
                        timestamp: context.timestamp,
                        key: context.key,
                        headers: context.headers
                    },
                    processingAttempts: context.retryCount + 1
                },
                error instanceof Error ? error.message : String(error)
            );
            
            this.metrics.messagesDLQ++;
        } catch (dlqError) {
            logger.error('Failed to send message to DLQ', {
                originalError: error,
                dlqError,
                context
            });
        }
    }

    private async sendProcessingMetric(
        context: ProcessingContext,
        status: 'success' | 'failure',
        processingTimeMs: number
    ): Promise<void> {
        try {
            const producer = getKafkaProducer();
            const metric: ProcessingMetric = {
                type: 'processing-metric',
                timestamp: new Date().toISOString(),
                consumerGroup: this.options.groupId,
                topic: context.topic,
                partition: context.partition,
                offset: context.offset,
                status,
                processingTimeMs,
                retryCount: context.retryCount
            };
            
            await producer.sendProcessingMetric(metric);
        } catch (error) {
            // Don't fail message processing due to metrics
            logger.debug('Failed to send processing metric', { error });
        }
    }

    private async commitOffset(payload: EachMessagePayload): Promise<void> {
        try {
            await this.consumer.commitOffsets([{
                topic: payload.topic,
                partition: payload.partition,
                offset: (parseInt(payload.message.offset) + 1).toString()
            }]);
        } catch (error) {
            logger.error('Failed to commit offset', {
                topic: payload.topic,
                partition: payload.partition,
                offset: payload.message.offset,
                error
            });
            throw error;
        }
    }

    private parseMessage(message: KafkaMessage): any {
        try {
            const value = message.value?.toString('utf8');
            if (!value) {
                throw new Error('Empty message value');
            }
            return JSON.parse(value);
        } catch (error) {
            logger.error('Failed to parse message', { error });
            throw new Error(`Invalid message format: ${error}`);
        }
    }

    private parseHeaders(headers?: KafkaMessage['headers']): Record<string, string> {
        const result: Record<string, string> = {};
        
        if (headers) {
            Object.entries(headers).forEach(([key, value]) => {
                if (value) {
                    result[key] = value.toString('utf8');
                }
            });
        }
        
        return result;
    }

    private updateProcessingTime(timeMs: number): void {
        this.processingTimes.push(timeMs);
        
        if (this.processingTimes.length > this.MAX_PROCESSING_TIME_SAMPLES) {
            this.processingTimes.shift();
        }
        
        this.metrics.avgProcessingTimeMs = 
            this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;
    }

    private async waitForResume(): Promise<void> {
        while (this.isPaused && this.isRunning) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    pause(): void {
        this.isPaused = true;
        logger.info(`Consumer paused: ${this.options.groupId}`);
        this.emit('paused');
    }

    resume(): void {
        this.isPaused = false;
        logger.info(`Consumer resumed: ${this.options.groupId}`);
        this.emit('resumed');
    }

    getMetrics(): typeof this.metrics {
        return { ...this.metrics };
    }

    isHealthy(): boolean {
        return this.isRunning && !this.isPaused;
    }

    async healthCheck(): Promise<{ 
        status: string; 
        metrics: typeof this.metrics;
        processingCount: number;
        isPaused: boolean;
    }> {
        return {
            status: this.isHealthy() ? 'healthy' : 'unhealthy',
            metrics: this.getMetrics(),
            processingCount: this.processingCount,
            isPaused: this.isPaused
        };
    }
}

export default KafkaConsumerBase;