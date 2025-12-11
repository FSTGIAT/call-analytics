import {
    SQSClient,
    SendMessageCommand,
    SendMessageBatchCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand,
    DeleteMessageBatchCommand,
    CreateQueueCommand,
    GetQueueAttributesCommand,
    SetQueueAttributesCommand,
    ListQueuesCommand,
    PurgeQueueCommand,
    MessageAttributeValue
} from '@aws-sdk/client-sqs';
import { logger } from '../utils/logger';
import { secretsService } from './secrets.service';
import { v4 as uuidv4 } from 'uuid';

interface SQSConfig {
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
}

interface QueueConfig {
    name: string;
    isFifo?: boolean;
    visibilityTimeout?: number;
    messageRetentionPeriod?: number;
    maxMessageSize?: number;
    receiveMessageWaitTime?: number;
    deadLetterQueueArn?: string;
    maxReceiveCount?: number;
}

interface SQSMessage {
    id?: string;
    body: any;
    messageAttributes?: Record<string, MessageAttributeValue>;
    delaySeconds?: number;
    messageGroupId?: string; // For FIFO queues
    messageDeduplicationId?: string; // For FIFO queues
}

export class SQSService {
    private client: SQSClient;
    private config: SQSConfig;
    private queueUrls: Map<string, string> = new Map();
    private isInitialized: boolean = false;
    private initPromise: Promise<void>;
    
    // Provided SQS Queue configuration
    private readonly SQS_QUEUE_ARN = 'arn:aws:sqs:eu-west-1:320708867194:summary-pipe-queue';
    private readonly SQS_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/320708867194/summary-pipe-queue';
    
    // All messages go to the single provided SQS queue

    constructor() {
        this.initPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            logger.info('🔄 Initializing SQS Service...');
            
            // Load configuration
            const isAWS = secretsService.isAWSEnvironment();
            
            if (isAWS) {
                logger.info('AWS environment detected, using IAM role credentials');
                this.config = {
                    region: process.env.AWS_REGION || 'eu-west-1'
                };
            } else {
                logger.info('Local environment detected, using environment variables');
                this.config = {
                    region: process.env.AWS_REGION || 'eu-west-1',
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                    sessionToken: process.env.AWS_SESSION_TOKEN
                };
            }

            // Initialize SQS client with proper retry configuration
            this.client = new SQSClient({
                region: this.config.region,
                maxAttempts: 3,
                retryMode: 'adaptive',
                ...(this.config.accessKeyId && {
                    credentials: {
                        accessKeyId: this.config.accessKeyId,
                        secretAccessKey: this.config.secretAccessKey!,
                        sessionToken: this.config.sessionToken
                    }
                })
            });

            // Use the provided queue URL for all operations
            this.queueUrls.set('default', this.SQS_QUEUE_URL);

            this.isInitialized = true;
            logger.info('✅ SQS Service initialized successfully', {
                region: this.config.region,
                defaultQueue: this.SQS_QUEUE_URL
            });

        } catch (error) {
            logger.error('❌ Failed to initialize SQS Service', { error });
            throw error;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initPromise;
        }
    }

    /**
     * Send a single message to a queue
     */
    async sendMessage(queueName: string, message: SQSMessage): Promise<string> {
        await this.ensureInitialized();
        
        try {
            const queueUrl = this.queueUrls.get(queueName) || this.SQS_QUEUE_URL;
            
            // Prepare message body
            const messageBody = typeof message.body === 'string' 
                ? message.body 
                : JSON.stringify(message.body);

            // Prepare message attributes
            const messageAttributes = this.prepareMessageAttributes(message.messageAttributes);

            const command = new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: messageBody,
                MessageAttributes: messageAttributes,
                ...(message.delaySeconds && { DelaySeconds: message.delaySeconds }),
                ...(message.messageGroupId && { MessageGroupId: message.messageGroupId }),
                ...(message.messageDeduplicationId && { 
                    MessageDeduplicationId: message.messageDeduplicationId 
                })
            });

            const response = await this.client.send(command);
            
            logger.info('✅ Message sent to SQS', {
                queueName,
                messageId: response.MessageId,
                md5: response.MD5OfMessageBody
            });

            return response.MessageId!;
            
        } catch (error) {
            logger.error('❌ Failed to send message to SQS', {
                queueName,
                error
            });
            throw error;
        }
    }

    /**
     * Send multiple messages in a batch
     */
    async sendMessageBatch(queueName: string, messages: SQSMessage[]): Promise<void> {
        await this.ensureInitialized();
        
        try {
            const queueUrl = this.queueUrls.get(queueName) || this.SQS_QUEUE_URL;
            
            // SQS allows max 10 messages per batch
            const batches = this.chunkArray(messages, 10);
            
            for (const batch of batches) {
                const entries = batch.map((message, index) => ({
                    Id: message.id || `${index}`,
                    MessageBody: typeof message.body === 'string' 
                        ? message.body 
                        : JSON.stringify(message.body),
                    MessageAttributes: this.prepareMessageAttributes(message.messageAttributes),
                    ...(message.delaySeconds && { DelaySeconds: message.delaySeconds }),
                    ...(message.messageGroupId && { MessageGroupId: message.messageGroupId }),
                    ...(message.messageDeduplicationId && { 
                        MessageDeduplicationId: message.messageDeduplicationId 
                    })
                }));

                const command = new SendMessageBatchCommand({
                    QueueUrl: queueUrl,
                    Entries: entries
                });

                const response = await this.client.send(command);
                
                if (response.Failed && response.Failed.length > 0) {
                    logger.error('Some messages failed to send', {
                        failed: response.Failed
                    });
                }
                
                logger.info(`✅ Batch of ${batch.length} messages sent to SQS`, {
                    queueName,
                    successful: response.Successful?.length || 0,
                    failed: response.Failed?.length || 0
                });
            }
            
        } catch (error) {
            logger.error('❌ Failed to send message batch to SQS', {
                queueName,
                batchSize: messages.length,
                error
            });
            throw error;
        }
    }

    /**
     * Receive messages from a queue
     */
    async receiveMessages(
        queueName: string, 
        maxMessages: number = 10,
        waitTimeSeconds: number = 20,
        visibilityTimeout: number = 30
    ): Promise<any[]> {
        await this.ensureInitialized();
        
        try {
            const queueUrl = this.queueUrls.get(queueName) || this.SQS_QUEUE_URL;
            
            const command = new ReceiveMessageCommand({
                QueueUrl: queueUrl,
                MaxNumberOfMessages: Math.min(maxMessages, 10), // SQS max is 10
                WaitTimeSeconds: waitTimeSeconds, // Long polling
                VisibilityTimeout: visibilityTimeout,
                MessageAttributeNames: ['All'],
                AttributeNames: ['All']
            });

            const response = await this.client.send(command);
            
            if (!response.Messages || response.Messages.length === 0) {
                return [];
            }

            const messages = response.Messages.map(msg => ({
                messageId: msg.MessageId,
                receiptHandle: msg.ReceiptHandle,
                body: this.parseMessageBody(msg.Body),
                attributes: msg.MessageAttributes,
                systemAttributes: msg.Attributes,
                md5: msg.MD5OfBody
            }));

            logger.debug(`Received ${messages.length} messages from queue`, {
                queueName,
                count: messages.length
            });

            return messages;
            
        } catch (error) {
            logger.error('❌ Failed to receive messages from SQS', {
                queueName,
                error
            });
            throw error;
        }
    }

    /**
     * Delete a message from the queue
     */
    async deleteMessage(queueName: string, receiptHandle: string): Promise<void> {
        await this.ensureInitialized();
        
        try {
            const queueUrl = this.queueUrls.get(queueName) || this.SQS_QUEUE_URL;
            
            const command = new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: receiptHandle
            });

            await this.client.send(command);
            
            logger.debug('Message deleted from queue', { queueName });
            
        } catch (error) {
            logger.error('❌ Failed to delete message from SQS', {
                queueName,
                error
            });
            throw error;
        }
    }

    /**
     * Delete multiple messages in a batch
     */
    async deleteMessageBatch(queueName: string, receiptHandles: string[]): Promise<void> {
        await this.ensureInitialized();
        
        try {
            const queueUrl = this.queueUrls.get(queueName) || this.SQS_QUEUE_URL;
            
            // SQS allows max 10 messages per batch
            const batches = this.chunkArray(receiptHandles, 10);
            
            for (const batch of batches) {
                const entries = batch.map((handle, index) => ({
                    Id: `${index}`,
                    ReceiptHandle: handle
                }));

                const command = new DeleteMessageBatchCommand({
                    QueueUrl: queueUrl,
                    Entries: entries
                });

                const response = await this.client.send(command);
                
                if (response.Failed && response.Failed.length > 0) {
                    logger.error('Some messages failed to delete', {
                        failed: response.Failed
                    });
                }
                
                logger.debug(`Batch of ${batch.length} messages deleted from queue`, {
                    queueName,
                    successful: response.Successful?.length || 0,
                    failed: response.Failed?.length || 0
                });
            }
            
        } catch (error) {
            logger.error('❌ Failed to delete message batch from SQS', {
                queueName,
                batchSize: receiptHandles.length,
                error
            });
            throw error;
        }
    }

    /**
     * Get queue attributes
     */
    async getQueueAttributes(queueName: string): Promise<any> {
        await this.ensureInitialized();
        
        try {
            const queueUrl = this.queueUrls.get(queueName) || this.SQS_QUEUE_URL;
            
            const command = new GetQueueAttributesCommand({
                QueueUrl: queueUrl,
                AttributeNames: ['All']
            });

            const response = await this.client.send(command);
            
            return response.Attributes;
            
        } catch (error) {
            logger.error('❌ Failed to get queue attributes', {
                queueName,
                error
            });
            throw error;
        }
    }

    /**
     * Purge all messages from a queue
     */
    async purgeQueue(queueName: string): Promise<void> {
        await this.ensureInitialized();
        
        try {
            const queueUrl = this.queueUrls.get(queueName) || this.SQS_QUEUE_URL;
            
            const command = new PurgeQueueCommand({
                QueueUrl: queueUrl
            });

            await this.client.send(command);
            
            logger.warn('⚠️ Queue purged', { queueName });
            
        } catch (error) {
            logger.error('❌ Failed to purge queue', {
                queueName,
                error
            });
            throw error;
        }
    }

    /**
     * Helper method to prepare message attributes
     */
    private prepareMessageAttributes(
        attributes?: Record<string, any>
    ): Record<string, MessageAttributeValue> | undefined {
        if (!attributes) return undefined;

        const messageAttributes: Record<string, MessageAttributeValue> = {};
        
        for (const [key, value] of Object.entries(attributes)) {
            if (typeof value === 'string') {
                messageAttributes[key] = {
                    DataType: 'String',
                    StringValue: value
                };
            } else if (typeof value === 'number') {
                messageAttributes[key] = {
                    DataType: 'Number',
                    StringValue: value.toString()
                };
            } else if (typeof value === 'boolean') {
                messageAttributes[key] = {
                    DataType: 'String',
                    StringValue: value.toString()
                };
            } else if (Buffer.isBuffer(value)) {
                messageAttributes[key] = {
                    DataType: 'Binary',
                    BinaryValue: value
                };
            }
        }

        return Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined;
    }

    /**
     * Helper method to parse message body
     */
    private parseMessageBody(body?: string): any {
        if (!body) return null;
        
        try {
            return JSON.parse(body);
        } catch {
            return body;
        }
    }

    /**
     * Helper method to chunk array
     */
    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Health check
     */
    async healthCheck(): Promise<{ status: string; queues: number }> {
        try {
            await this.ensureInitialized();
            
            // Simple health check - just verify SQS client is initialized
            if (this.client && this.isInitialized) {
                return {
                    status: 'healthy',
                    queues: 1 // We have one main queue
                };
            } else {
                throw new Error('SQS client not initialized');
            }
        } catch (error) {
            logger.error('SQS health check failed', { error });
            return {
                status: 'unhealthy',
                queues: 0
            };
        }
    }
}

// Singleton instance
let sqsServiceInstance: SQSService | null = null;

export const getSQSService = (): SQSService => {
    if (!sqsServiceInstance) {
        sqsServiceInstance = new SQSService();
    }
    return sqsServiceInstance;
};

export default SQSService;