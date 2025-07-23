import { KafkaConsumerBase, ProcessingContext } from '../kafka-consumer-base.service';
import { CDCChangeEvent, ConversationAssembly, ConversationMessage } from '../../types/kafka-messages';
import { getKafkaProducer } from '../kafka-producer.service';
import { logger } from '../../utils/logger';
import { oracleService } from '../oracle.service';

interface ConversationBuffer {
    callId: string;
    messages: ConversationMessage[];
    lastActivity: Date;
    customerId: string;
    subscriberId: string;
    startTime: Date;
    endTime: Date;
}

export class ConversationAssemblyConsumerService extends KafkaConsumerBase {
    private conversationBuffers = new Map<string, ConversationBuffer>();
    private flushInterval: NodeJS.Timeout | null = null;
    private readonly BUFFER_TIMEOUT = 30000; // 30 seconds
    private readonly MAX_BUFFER_SIZE = 1000;

    constructor() {
        super({
            groupId: `${process.env.KAFKA_CONSUMER_GROUP_PREFIX || 'call-analytics'}-conversation-assembly`,
            topics: [process.env.KAFKA_TOPIC_CDC_RAW_CHANGES || 'cdc-raw-changes'],
            sessionTimeout: 30000,
            heartbeatInterval: 3000,
            maxPollInterval: 300000,
            fromBeginning: true
        });

        // Start periodic buffer flush
        this.startBufferFlush();
    }

    protected async processMessage(
        message: CDCChangeEvent, 
        context: ProcessingContext
    ): Promise<void> {
        try {
            logger.debug('Processing CDC change for conversation assembly', {
                callId: message.callId,
                changeType: message.changeType,
                partition: context.partition,
                offset: context.offset
            });

            // Handle different change types
            switch (message.changeType) {
                case 'INSERT':
                case 'UPDATE':
                    await this.handleMessageUpdate(message);
                    break;
                case 'DELETE':
                    await this.handleMessageDeletion(message);
                    break;
                default:
                    logger.warn('Unknown CDC change type', { 
                        changeType: message.changeType,
                        callId: message.callId 
                    });
            }

            // Check if conversation is ready for assembly
            await this.checkAndAssembleConversation(message.callId);

        } catch (error) {
            logger.error('Failed to process CDC change in conversation assembly', {
                error,
                callId: message.callId,
                changeType: message.changeType,
                partition: context.partition,
                offset: context.offset
            });
            throw error;
        }
    }

    private async handleMessageUpdate(change: CDCChangeEvent): Promise<void> {
        const { callId, data } = change;
        
        // Get or create conversation buffer
        let conversation = this.conversationBuffers.get(callId);
        if (!conversation) {
            conversation = {
                callId,
                messages: [],
                lastActivity: new Date(),
                customerId: data.ban || 'UNKNOWN',
                subscriberId: data.subscriberNo || 'UNKNOWN',
                startTime: new Date(data.callTime),
                endTime: new Date(data.callTime)
            };
            this.conversationBuffers.set(callId, conversation);
        }

        // Create conversation message
        const conversationMessage: ConversationMessage = {
            messageId: `${callId}-${data.textTime}`,
            speaker: data.owner === 'A' ? 'agent' : 'customer',
            text: data.text || '',
            timestamp: new Date(data.textTime),
            metadata: {
                originalOwner: data.owner,
                changeLogId: data.changeLogId,
                processingTimestamp: data.processingTimestamp
            }
        };

        // Check if message already exists (prevent duplicates)
        const existingIndex = conversation.messages.findIndex(
            msg => msg.messageId === conversationMessage.messageId
        );

        if (existingIndex >= 0) {
            // Update existing message
            conversation.messages[existingIndex] = conversationMessage;
            logger.debug('Updated existing message in conversation buffer', {
                callId,
                messageId: conversationMessage.messageId
            });
        } else {
            // Add new message
            conversation.messages.push(conversationMessage);
            logger.debug('Added new message to conversation buffer', {
                callId,
                messageId: conversationMessage.messageId,
                speaker: conversationMessage.speaker
            });
        }

        // Update conversation metadata
        conversation.lastActivity = new Date();
        if (conversationMessage.timestamp < conversation.startTime) {
            conversation.startTime = conversationMessage.timestamp;
        }
        if (conversationMessage.timestamp > conversation.endTime) {
            conversation.endTime = conversationMessage.timestamp;
        }

        // Sort messages by timestamp
        conversation.messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }

    private async handleMessageDeletion(change: CDCChangeEvent): Promise<void> {
        const { callId, data } = change;
        const conversation = this.conversationBuffers.get(callId);
        
        if (conversation) {
            // Remove message from buffer
            const messageId = `${callId}-${data.textTime}`;
            const messageIndex = conversation.messages.findIndex(
                msg => msg.messageId === messageId
            );

            if (messageIndex >= 0) {
                conversation.messages.splice(messageIndex, 1);
                conversation.lastActivity = new Date();
                
                logger.debug('Removed message from conversation buffer', {
                    callId,
                    messageId,
                    remainingMessages: conversation.messages.length
                });
            }
        }
    }

    private async checkAndAssembleConversation(callId: string): Promise<void> {
        const conversation = this.conversationBuffers.get(callId);
        if (!conversation || conversation.messages.length === 0) {
            return;
        }

        // Check if conversation should be assembled
        const shouldAssemble = await this.shouldAssembleConversation(conversation);
        
        if (shouldAssemble) {
            await this.assembleAndSendConversation(conversation);
            this.conversationBuffers.delete(callId);
        }
    }

    private async shouldAssembleConversation(conversation: ConversationBuffer): Promise<boolean> {
        // Assembly criteria:
        // 1. Has messages from both agent and customer
        // 2. No activity for a certain time period
        // 3. Conversation appears complete based on Oracle data

        const hasAgentMessages = conversation.messages.some(msg => msg.speaker === 'agent');
        const hasCustomerMessages = conversation.messages.some(msg => msg.speaker === 'customer');
        const timeSinceLastActivity = Date.now() - conversation.lastActivity.getTime();
        
        // Basic criteria
        if (!hasAgentMessages || !hasCustomerMessages) {
            return false;
        }

        // Time-based assembly (30 seconds of inactivity)
        if (timeSinceLastActivity > this.BUFFER_TIMEOUT) {
            return true;
        }

        // Check if we have all messages for this call from Oracle
        try {
            const oracleMessageCount = await this.getOracleMessageCount(conversation.callId);
            if (oracleMessageCount > 0 && conversation.messages.length >= oracleMessageCount) {
                return true;
            }
        } catch (error) {
            logger.warn('Failed to check Oracle message count', {
                error,
                callId: conversation.callId
            });
        }

        return false;
    }

    private async getOracleMessageCount(callId: string): Promise<number> {
        const query = `
            SELECT COUNT(*) as MESSAGE_COUNT
            FROM VERINT_TEXT_ANALYSIS
            WHERE CALL_ID = :callId
        `;
        
        const result = await oracleService.executeQuery(query, { callId });
        return result[0]?.MESSAGE_COUNT || 0;
    }

    private async assembleAndSendConversation(conversation: ConversationBuffer): Promise<void> {
        try {
            // Create conversation assembly message
            const conversationAssembly: ConversationAssembly = {
                type: 'conversation-assembly',
                callId: conversation.callId,
                customerId: conversation.customerId,
                subscriberNo: conversation.subscriberId,
                messages: conversation.messages,
                conversationMetadata: {
                    startTime: conversation.startTime,
                    endTime: conversation.endTime,
                    duration: conversation.endTime.getTime() - conversation.startTime.getTime(),
                    messageCount: conversation.messages.length,
                    agentMessageCount: conversation.messages.filter(m => m.speaker === 'agent').length,
                    customerMessageCount: conversation.messages.filter(m => m.speaker === 'customer').length,
                    callDate: conversation.startTime,
                    participants: {
                        agent: conversation.messages
                            .filter(m => m.speaker === 'agent')
                            .map(m => m.metadata?.originalOwner)
                            .filter((owner, index, arr) => arr.indexOf(owner) === index),
                        customer: [conversation.subscriberId]
                    }
                },
                timestamp: new Date().toISOString()
            };

            // Send to conversation assembly topic
            const kafkaProducer = getKafkaProducer();
            await kafkaProducer.sendConversationAssembly(conversationAssembly);

            logger.info('Conversation assembled and sent successfully', {
                callId: conversation.callId,
                messageCount: conversation.messages.length,
                duration: conversationAssembly.conversationMetadata.duration,
                agentMessages: conversationAssembly.conversationMetadata.agentMessageCount,
                customerMessages: conversationAssembly.conversationMetadata.customerMessageCount
            });

        } catch (error) {
            logger.error('Failed to assemble and send conversation', {
                error,
                callId: conversation.callId,
                messageCount: conversation.messages.length
            });
            throw error;
        }
    }

    private startBufferFlush(): void {
        this.flushInterval = setInterval(() => {
            this.flushStaleBuffers();
        }, this.BUFFER_TIMEOUT);
    }

    private async flushStaleBuffers(): Promise<void> {
        const now = Date.now();
        const staleCallIds: string[] = [];

        // Find stale conversations
        for (const [callId, conversation] of this.conversationBuffers.entries()) {
            const timeSinceLastActivity = now - conversation.lastActivity.getTime();
            if (timeSinceLastActivity > this.BUFFER_TIMEOUT) {
                staleCallIds.push(callId);
            }
        }

        // Flush stale conversations
        for (const callId of staleCallIds) {
            const conversation = this.conversationBuffers.get(callId);
            if (conversation && conversation.messages.length > 0) {
                try {
                    await this.assembleAndSendConversation(conversation);
                    logger.info('Flushed stale conversation buffer', {
                        callId,
                        messageCount: conversation.messages.length,
                        staleDuration: now - conversation.lastActivity.getTime()
                    });
                } catch (error) {
                    logger.error('Failed to flush stale conversation buffer', {
                        error,
                        callId
                    });
                }
            }
            this.conversationBuffers.delete(callId);
        }

        // Memory management - remove empty buffers
        if (this.conversationBuffers.size > this.MAX_BUFFER_SIZE) {
            const sortedBuffers = Array.from(this.conversationBuffers.entries())
                .sort(([,a], [,b]) => a.lastActivity.getTime() - b.lastActivity.getTime());
            
            const toRemove = sortedBuffers.slice(0, this.conversationBuffers.size - this.MAX_BUFFER_SIZE);
            for (const [callId] of toRemove) {
                this.conversationBuffers.delete(callId);
            }
            
            logger.warn('Removed old conversation buffers for memory management', {
                removed: toRemove.length,
                remaining: this.conversationBuffers.size
            });
        }
    }

    async stop(): Promise<void> {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }

        // Flush remaining buffers before stopping
        await this.flushStaleBuffers();
        
        await super.stop();
    }

    getMetrics() {
        return {
            ...super.getMetrics(),
            bufferedConversations: this.conversationBuffers.size,
            bufferMemoryUsage: this.calculateBufferMemoryUsage()
        };
    }

    private calculateBufferMemoryUsage(): number {
        let totalMessages = 0;
        for (const conversation of this.conversationBuffers.values()) {
            totalMessages += conversation.messages.length;
        }
        return totalMessages;
    }
}

// Singleton instance
let conversationAssemblyConsumerInstance: ConversationAssemblyConsumerService | null = null;

export const getConversationAssemblyConsumer = (): ConversationAssemblyConsumerService => {
    if (!conversationAssemblyConsumerInstance) {
        conversationAssemblyConsumerInstance = new ConversationAssemblyConsumerService();
    }
    return conversationAssemblyConsumerInstance;
};

export default ConversationAssemblyConsumerService;