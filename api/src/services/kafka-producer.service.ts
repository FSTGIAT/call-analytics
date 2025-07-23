import { Kafka, Producer, ProducerRecord, CompressionTypes, logLevel } from 'kafkajs';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { logger } from '../utils/logger';
import { 
    KafkaMessage, 
    CDCChangeEvent, 
    ConversationAssembly, 
    MLProcessingResult,
    OpenSearchIndexRequest,
    ProcessingMetric
} from '../types/kafka-messages';

interface KafkaProducerConfig {
    brokers: string[];
    clientId: string;
    schemaRegistryUrl: string;
    compression: CompressionTypes;
    batchSize: number;
    lingerMs: number;
    maxInFlight: number;
    idempotent: boolean;
}

export class KafkaProducerService {
    private kafka: Kafka;
    private producer: Producer;
    private schemaRegistry: SchemaRegistry;
    private isConnected: boolean = false;
    private config: KafkaProducerConfig;
    private metrics: {
        messagesSent: number;
        bytesSent: number;
        errors: number;
        lastError?: string;
    } = {
        messagesSent: 0,
        bytesSent: 0,
        errors: 0
    };

    constructor() {
        this.config = {
            brokers: process.env.KAFKA_BROKERS?.split(',') || ['kafka:9092'],
            clientId: process.env.KAFKA_CLIENT_ID || 'call-analytics-api',
            schemaRegistryUrl: process.env.SCHEMA_REGISTRY_URL || 'http://schema-registry:8081',
            compression: CompressionTypes.GZIP,
            batchSize: parseInt(process.env.KAFKA_PRODUCER_BATCH_SIZE || '16384'),
            lingerMs: parseInt(process.env.KAFKA_PRODUCER_LINGER_MS || '10'),
            maxInFlight: parseInt(process.env.KAFKA_PRODUCER_MAX_IN_FLIGHT || '5'),
            idempotent: process.env.KAFKA_PRODUCER_IDEMPOTENT === 'true'
        };

        this.kafka = new Kafka({
            clientId: this.config.clientId,
            brokers: this.config.brokers,
            logLevel: this.getKafkaLogLevel(),
            connectionTimeout: 10000,
            requestTimeout: 30000,
            retry: {
                initialRetryTime: 300,
                retries: 5,
                maxRetryTime: 30000,
                multiplier: 2
            }
        });

        this.producer = this.kafka.producer({
            maxInFlightRequests: this.config.maxInFlight,
            idempotent: this.config.idempotent,
            transactionTimeout: 30000,
            allowAutoTopicCreation: false
        });

        this.schemaRegistry = new SchemaRegistry({
            host: this.config.schemaRegistryUrl
        });

        this.setupEventHandlers();
    }

    private getKafkaLogLevel(): logLevel {
        const level = process.env.KAFKA_LOG_LEVEL?.toLowerCase() || 'info';
        switch (level) {
            case 'debug': return logLevel.DEBUG;
            case 'info': return logLevel.INFO;
            case 'warn': return logLevel.WARN;
            case 'error': return logLevel.ERROR;
            default: return logLevel.INFO;
        }
    }

    private setupEventHandlers(): void {
        this.producer.on('producer.connect', () => {
            logger.info('Kafka producer connected');
            this.isConnected = true;
        });

        this.producer.on('producer.disconnect', () => {
            logger.warn('Kafka producer disconnected');
            this.isConnected = false;
        });

        this.producer.on('producer.network.request_timeout', (payload) => {
            logger.error('Kafka producer request timeout', { payload });
            this.metrics.errors++;
        });
    }

    async connect(): Promise<void> {
        try {
            logger.info('Connecting to Kafka cluster...', { 
                brokers: this.config.brokers,
                clientId: this.config.clientId 
            });

            // Add retry logic with exponential backoff
            let retries = 5;
            let delay = 1000;
            
            while (retries > 0) {
                try {
                    await this.producer.connect();
                    logger.info('Kafka producer service connected successfully');
                    return;
                } catch (connectError) {
                    retries--;
                    if (retries === 0) {
                        throw connectError;
                    }
                    
                    logger.warn(`Kafka connection failed, retrying in ${delay}ms... (${5 - retries}/5)`, { 
                        error: connectError instanceof Error ? connectError.message : String(connectError),
                        brokers: this.config.brokers
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                }
            }
        } catch (error) {
            logger.error('Failed to connect Kafka producer after retries', { 
                error,
                brokers: this.config.brokers,
                clientId: this.config.clientId
            });
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        try {
            if (this.isConnected) {
                await this.producer.disconnect();
                logger.info('Kafka producer disconnected successfully');
            }
        } catch (error) {
            logger.error('Error disconnecting Kafka producer', { error });
            throw error;
        }
    }

    async sendCDCChange(change: CDCChangeEvent): Promise<void> {
        const topic = process.env.KAFKA_TOPIC_CDC_RAW_CHANGES || 'cdc-raw-changes';
        await this.sendMessage(topic, change.callId, change);
    }

    async sendConversationAssembly(conversation: ConversationAssembly): Promise<void> {
        const topic = process.env.KAFKA_TOPIC_CONVERSATION_ASSEMBLY || 'conversation-assembly';
        await this.sendMessage(topic, conversation.callId, conversation);
    }

    async sendMLProcessingResult(result: MLProcessingResult): Promise<void> {
        const topic = process.env.KAFKA_TOPIC_ML_PROCESSING || 'ml-processing-queue';
        await this.sendMessage(topic, result.callId, result);
    }

    async sendOpenSearchIndexRequest(request: OpenSearchIndexRequest): Promise<void> {
        const topic = process.env.KAFKA_TOPIC_OPENSEARCH_INDEX || 'opensearch-bulk-index';
        await this.sendMessage(topic, request.callId, request);
    }

    async sendToDeadLetterQueue(originalTopic: string, originalMessage: any, error: string): Promise<void> {
        const dlqTopic = process.env.KAFKA_TOPIC_FAILED_RECORDS || 'failed-records-dlq';
        const dlqMessage = {
            originalTopic,
            originalMessage,
            error,
            timestamp: new Date().toISOString(),
            processingAttempts: originalMessage.processingAttempts || 0
        };
        
        await this.sendMessage(dlqTopic, `${originalTopic}-${Date.now()}`, dlqMessage);
        logger.error('Message sent to dead letter queue', { originalTopic, error });
    }

    async sendProcessingMetric(metric: ProcessingMetric): Promise<void> {
        const topic = 'processing-metrics';
        await this.sendMessage(topic, `${metric.stage}-${Date.now()}`, metric);
    }

    private async sendMessage<T extends KafkaMessage>(
        topic: string, 
        key: string, 
        message: T
    ): Promise<void> {
        try {
            if (!this.isConnected) {
                throw new Error('Kafka producer is not connected');
            }

            // Add metadata to message
            const enrichedMessage = {
                ...message,
                timestamp: message.timestamp || new Date().toISOString(),
                messageId: message.messageId || `${key}-${Date.now()}`,
                source: 'call-analytics-api',
                version: '1.0'
            };

            // Serialize message (could use schema registry for AVRO)
            let serializedValue: string;
            try {
                serializedValue = JSON.stringify(enrichedMessage);
            } catch (jsonError) {
                logger.error('Failed to serialize message to JSON', { 
                    error: jsonError, 
                    message: enrichedMessage,
                    topic,
                    key 
                });
                throw jsonError;
            }
            const messageSize = Buffer.byteLength(serializedValue, 'utf8');

            const record: ProducerRecord = {
                topic,
                messages: [{
                    key,
                    value: serializedValue,
                    // KafkaJS expects timestamp as number (milliseconds since epoch)
                    timestamp: Date.now().toString(),
                    headers: {
                        'content-type': 'application/json',
                        'encoding': 'utf-8',
                        'source': 'call-analytics-api',
                        'message-type': message.type || 'unknown'
                    }
                }]
            };

            const result = await this.producer.send(record);
            
            // Update metrics
            this.metrics.messagesSent++;
            this.metrics.bytesSent += messageSize;

            logger.debug('Message sent to Kafka', {
                topic,
                key,
                partition: result[0].partition,
                offset: result[0].baseOffset,
                messageSize
            });

        } catch (error) {
            this.metrics.errors++;
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            
            logger.error('Failed to send message to Kafka', {
                topic,
                key,
                error,
                messageType: message.type
            });
            
            throw error;
        }
    }

    async sendBatch<T extends KafkaMessage>(
        topic: string,
        messages: Array<{ key: string; message: T }>
    ): Promise<void> {
        try {
            if (!this.isConnected) {
                throw new Error('Kafka producer is not connected');
            }

            // Debug logging to identify the problematic key
            messages.forEach((msg, index) => {
                if (typeof msg.key !== 'string') {
                    logger.error(`Invalid key type at index ${index}:`, { 
                        key: msg.key, 
                        keyType: typeof msg.key,
                        messageType: msg.message?.type 
                    });
                }
            });

            const kafkaMessages = messages.map(({ key, message }) => {
                const enrichedMessage = {
                    ...message,
                    timestamp: message.timestamp || new Date().toISOString(),
                    messageId: message.messageId || `${key}-${Date.now()}`,
                    source: 'call-analytics-api',
                    version: '1.0'
                };

                return {
                    key,
                    value: JSON.stringify(enrichedMessage),
                    timestamp: Date.now().toString(),
                    headers: {
                        'content-type': 'application/json',
                        'encoding': 'utf-8',
                        'source': 'call-analytics-api',
                        'message-type': message.type || 'unknown'
                    }
                };
            });

            const record: ProducerRecord = {
                topic,
                messages: kafkaMessages
            };

            const result = await this.producer.send(record);
            
            // Update metrics
            this.metrics.messagesSent += messages.length;
            this.metrics.bytesSent += kafkaMessages.reduce((total, msg) => 
                total + Buffer.byteLength(msg.value, 'utf8'), 0
            );

            logger.info(`Batch of ${messages.length} messages sent to topic ${topic}`, {
                partitions: result.map(r => r.partition),
                offsets: result.map(r => r.baseOffset)
            });

        } catch (error) {
            this.metrics.errors++;
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            
            logger.error('Failed to send batch to Kafka', {
                topic,
                batchSize: messages.length,
                error
            });
            
            throw error;
        }
    }

    async flush(): Promise<void> {
        try {
            await this.producer.send({ topic: 'health-check', messages: [] });
            logger.debug('Kafka producer flushed');
        } catch (error) {
            logger.error('Failed to flush Kafka producer', { error });
            throw error;
        }
    }

    getMetrics(): typeof this.metrics {
        return { ...this.metrics };
    }

    isHealthy(): boolean {
        return this.isConnected;
    }

    async healthCheck(): Promise<{ status: string; metrics: typeof this.metrics }> {
        return {
            status: this.isConnected ? 'healthy' : 'unhealthy',
            metrics: this.getMetrics()
        };
    }
}

// Singleton instance
let kafkaProducerInstance: KafkaProducerService | null = null;

export const getKafkaProducer = (): KafkaProducerService => {
    if (!kafkaProducerInstance) {
        kafkaProducerInstance = new KafkaProducerService();
    }
    return kafkaProducerInstance;
};

export default KafkaProducerService;