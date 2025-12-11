import { getSQSService, SQSService } from './sqs.service';
import { logger } from '../utils/logger';
import { 
    CDCChangeEvent, 
    ConversationAssembly, 
    MLProcessingResult,
    OpenSearchIndexRequest,
    ProcessingMetric,
    KafkaMessage
} from '../types/kafka-messages';
import { v4 as uuidv4 } from 'uuid';

export class SQSProducerService {
    private sqsService: SQSService;
    private isConnected: boolean = false;
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

    // Queue name mappings
    private readonly QUEUE_MAPPINGS = {
        'cdc-raw-changes': 'cdc-raw-changes.fifo',
        'conversation-assembly': 'conversation-assembly',
        'ml-processing-queue': 'ml-processing-queue',
        'opensearch-bulk-index': 'opensearch-bulk-index',
        'failed-records-dlq': 'failed-records-dlq',
        'processing-metrics': 'processing-metrics'
    };

    constructor() {
        this.sqsService = getSQSService();
    }

    get connected(): boolean {
        return this.isConnected;
    }

    async connect(): Promise<void> {
        try {
            logger.info('🔄 Connecting to SQS...');
            
            // Test connection by checking health
            const health = await this.sqsService.healthCheck();
            
            if (health.status === 'healthy') {
                this.isConnected = true;
                logger.info('✅ SQS producer connected successfully', {
                    queues: health.queues
                });
            } else {
                throw new Error('SQS health check failed');
            }
        } catch (error) {
            logger.error('❌ Failed to connect SQS producer', { error });
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        try {
            this.isConnected = false;
            logger.info('SQS producer disconnected');
        } catch (error) {
            logger.error('Error disconnecting SQS producer', { error });
            throw error;
        }
    }

    async sendCDCChange(change: CDCChangeEvent): Promise<void> {
        const queueName = 'cdc-raw-changes';
        await this.sendMessage(queueName, change.callId, change, true); // Use FIFO for CDC
    }

    async sendConversationAssembly(conversation: ConversationAssembly): Promise<void> {
        const queueName = 'conversation-assembly';
        await this.sendMessage(queueName, conversation.callId, conversation);
    }

    async sendMLProcessingResult(result: MLProcessingResult): Promise<void> {
        const queueName = 'ml-processing-queue';
        await this.sendMessage(queueName, result.callId, result);
    }

    async sendOpenSearchIndexRequest(request: OpenSearchIndexRequest): Promise<void> {
        const queueName = 'opensearch-bulk-index';
        await this.sendMessage(queueName, request.callId, request);
    }

    async sendToDeadLetterQueue(originalTopic: string, originalMessage: any, error: string): Promise<void> {
        const dlqMessage = {
            originalTopic,
            originalMessage,
            error,
            timestamp: new Date().toISOString(),
            processingAttempts: originalMessage.processingAttempts || 0
        };
        
        await this.sendMessage('failed-records-dlq', `${originalTopic}-${Date.now()}`, dlqMessage);
        logger.error('Message sent to dead letter queue', { originalTopic, error });
    }

    async sendProcessingMetric(metric: ProcessingMetric): Promise<void> {
        await this.sendMessage('processing-metrics', `${metric.stage}-${Date.now()}`, metric);
    }

    private async sendMessage<T extends KafkaMessage>(
        queueName: string, 
        key: string, 
        message: T,
        useFifo: boolean = false
    ): Promise<void> {
        try {
            if (!this.isConnected) {
                logger.error('❌ SQS producer not connected!');
                throw new Error('SQS producer is not connected');
            }

            // Add metadata to message
            const enrichedMessage = {
                ...message,
                timestamp: message.timestamp || new Date().toISOString(),
                messageId: message.messageId || `${key}-${Date.now()}`,
                source: 'call-analytics-api',
                version: '1.0'
            };

            const messageBody = JSON.stringify(enrichedMessage);
            const messageSize = Buffer.byteLength(messageBody, 'utf8');

            // Prepare SQS message with proper MessageAttributeValue types
            const sqsMessage = {
                body: enrichedMessage,
                messageAttributes: {
                    'content-type': {
                        DataType: 'String',
                        StringValue: 'application/json'
                    },
                    'encoding': {
                        DataType: 'String', 
                        StringValue: 'utf-8'
                    },
                    'source': {
                        DataType: 'String',
                        StringValue: 'call-analytics-api'
                    },
                    'message-type': {
                        DataType: 'String',
                        StringValue: message.type || 'unknown'
                    },
                    'original-key': {
                        DataType: 'String',
                        StringValue: key
                    }
                },
                ...(useFifo && {
                    messageGroupId: this.getMessageGroupId(queueName, message),
                    messageDeduplicationId: uuidv4()
                })
            };

            await this.sqsService.sendMessage(queueName, sqsMessage);
            
            // Update metrics
            this.metrics.messagesSent++;
            this.metrics.bytesSent += messageSize;

            logger.info('✅ Message successfully sent to SQS', {
                queueName,
                key,
                messageSize,
                messageType: message.type
            });

        } catch (error) {
            this.metrics.errors++;
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            
            logger.error('Failed to send message to SQS', {
                queueName,
                key,
                error,
                messageType: message.type
            });
            
            throw error;
        }
    }

    async sendBatch<T extends KafkaMessage>(
        queueName: string,
        messages: Array<{ key: string; message: T }>,
        useFifo: boolean = false
    ): Promise<void> {
        try {
            if (!this.isConnected) {
                throw new Error('SQS producer is not connected');
            }

            const sqsMessages = messages.map(({ key, message }) => {
                const enrichedMessage = {
                    ...message,
                    timestamp: message.timestamp || new Date().toISOString(),
                    messageId: message.messageId || `${key}-${Date.now()}`,
                    source: 'call-analytics-api',
                    version: '1.0'
                };

                return {
                    id: key,
                    body: enrichedMessage,
                    messageAttributes: {
                        'content-type': {
                            DataType: 'String',
                            StringValue: 'application/json'
                        },
                        'encoding': {
                            DataType: 'String',
                            StringValue: 'utf-8'
                        },
                        'source': {
                            DataType: 'String',
                            StringValue: 'call-analytics-api'
                        },
                        'message-type': {
                            DataType: 'String',
                            StringValue: message.type || 'unknown'
                        },
                        'original-key': {
                            DataType: 'String',
                            StringValue: key
                        }
                    },
                    ...(useFifo && {
                        messageGroupId: this.getMessageGroupId(queueName, message),
                        messageDeduplicationId: uuidv4()
                    })
                };
            });

            await this.sqsService.sendMessageBatch(queueName, sqsMessages);
            
            // Update metrics
            this.metrics.messagesSent += messages.length;
            this.metrics.bytesSent += sqsMessages.reduce((total, msg) => 
                total + Buffer.byteLength(JSON.stringify(msg.body), 'utf8'), 0
            );

            logger.info(`✅ Batch of ${messages.length} messages sent to SQS queue ${queueName}`);

        } catch (error) {
            this.metrics.errors++;
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            
            logger.error('Failed to send batch to SQS', {
                queueName,
                batchSize: messages.length,
                error
            });
            
            throw error;
        }
    }

    private getMessageGroupId(queueName: string, message: any): string {
        // Use callId or customerId as message group ID for FIFO ordering
        if ('callId' in message) {
            return message.callId;
        }
        if ('customerId' in message) {
            return message.customerId;
        }
        // Default to queue name for consistent ordering
        return queueName;
    }

    async flush(): Promise<void> {
        // SQS doesn't require explicit flushing
        logger.debug('SQS producer flushed (no-op)');
    }

    getMetrics(): typeof this.metrics {
        return { ...this.metrics };
    }

    isHealthy(): boolean {
        return this.isConnected;
    }

    async healthCheck(): Promise<{ status: string; metrics: typeof this.metrics }> {
        const sqsHealth = await this.sqsService.healthCheck();
        return {
            status: sqsHealth.status === 'healthy' && this.isConnected ? 'healthy' : 'unhealthy',
            metrics: this.getMetrics()
        };
    }
}

// Singleton instance
let sqsProducerInstance: SQSProducerService | null = null;

export const getSQSProducer = (): SQSProducerService => {
    if (!sqsProducerInstance) {
        sqsProducerInstance = new SQSProducerService();
    }
    return sqsProducerInstance;
};

// Export with same name as Kafka producer for easy replacement
export const getKafkaProducer = getSQSProducer;

export default SQSProducerService;