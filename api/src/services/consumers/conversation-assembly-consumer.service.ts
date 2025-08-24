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
    private readonly BUFFER_TIMEOUT = 180000; // 3 minutes - allow time for CDC batch gaps
    private readonly MIN_MESSAGES_BEFORE_FLUSH = 5; // Require at least 5 messages before considering flush
    private readonly CONVERSATION_COMPLETION_TIMEOUT = 300000; // 5 minutes maximum wait
    private readonly MAX_BUFFER_SIZE = 1000;
    
    // Infinite Loop Prevention for Conversation Assembly
    private lastProcessedMessages = new Map<string, { changeType: string, offset: string, timestamp: Date }>();
    private consecutiveSameMessages = new Map<string, number>();
    private readonly MAX_CONSECUTIVE_SAME_MESSAGES = 10; // Increased threshold for batch processing
    private readonly INFINITE_LOOP_TIME_WINDOW = 30000; // 30 seconds
    private circuitBreakerTripped = false;
    
    // Auto-recovery circuit breaker settings
    private circuitBreakerTripTime: Date | null = null;
    private readonly AUTO_RECOVERY_TIMEOUT = 300000; // 5 minutes
    private recoveryCheckInterval: NodeJS.Timeout | null = null;

    constructor() {
        super({
            groupId: `${process.env.KAFKA_CONSUMER_GROUP_PREFIX || 'call-analytics'}-conversation-assembly`,
            topics: [process.env.KAFKA_TOPIC_CDC_RAW_CHANGES || 'cdc-raw-changes'],
            sessionTimeout: 30000,
            heartbeatInterval: 3000,
            maxPollInterval: 300000,
            fromBeginning: true
        });

        // Auto-reset circuit breaker on startup to prevent persistent tripped state
        logger.info('🔄 Auto-resetting circuit breaker on service restart...');
        this.resetCircuitBreaker();
        
        // Start periodic buffer flush
        this.startBufferFlush();
        
        // Start auto-recovery monitoring
        this.startAutoRecoveryCheck();
    }

    protected async processMessage(
        message: CDCChangeEvent, 
        context: ProcessingContext
    ): Promise<void> {
        try {
            // Infinite Loop Detection with Auto-Recovery Check
            if (this.circuitBreakerTripped) {
                // Check for auto-recovery before skipping
                this.checkAutoRecovery();
                if (this.circuitBreakerTripped) {
                    logger.warn('⚠️ Conversation Assembly Consumer - Circuit breaker is tripped, skipping message processing');
                    return;
                }
            }

            const messageKey = `${message.callId}-${message.changeType}`;
            
            // Check for infinite loop in message processing
            if (this.detectInfiniteMessageLoop(messageKey, message.changeType, context.offset)) {
                logger.error('🚨 INFINITE LOOP DETECTED in Conversation Assembly Consumer!', {
                    callId: message.callId,
                    changeType: message.changeType,
                    offset: context.offset,
                    consecutiveCount: this.consecutiveSameMessages.get(messageKey)
                });

                this.circuitBreakerTripped = true;
                this.circuitBreakerTripTime = new Date();
                await this.autoDisableConversationAssembly(message.callId);
                return;
            }

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
            messageId: `${callId}-${data.changeLogId}`,
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

        // Update conversation metadata - only update lastActivity if this is a real new message
        // For batch processing, don't reset timer constantly
        const timeSinceLastActivity = Date.now() - conversation.lastActivity.getTime();
        if (timeSinceLastActivity > 500) { // Only update if 500ms since last activity
            conversation.lastActivity = new Date();
        }
        
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
            const messageId = `${callId}-${data.changeLogId}`;
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
        }, 5000); // Check every 5 seconds for batch processing
    }

    private async flushStaleBuffers(): Promise<void> {
        const now = Date.now();
        const staleCallIds: string[] = [];

        // Find conversations that should be flushed using smarter criteria
        for (const [callId, conversation] of this.conversationBuffers.entries()) {
            const timeSinceLastActivity = now - conversation.lastActivity.getTime();
            const messageCount = conversation.messages.length;
            
            // More intelligent flushing criteria:
            const shouldFlush = this.shouldFlushConversation(conversation, timeSinceLastActivity);
            
            if (shouldFlush) {
                staleCallIds.push(callId);
                logger.info('Conversation ready for flush', {
                    callId,
                    messageCount,
                    timeSinceLastActivity: Math.round(timeSinceLastActivity / 1000) + 's',
                    reason: this.getFlushReason(conversation, timeSinceLastActivity)
                });
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

    private shouldFlushConversation(conversation: ConversationBuffer, timeSinceLastActivity: number): boolean {
        const messageCount = conversation.messages.length;
        
        // Never flush if we have very few messages (likely incomplete)
        if (messageCount < this.MIN_MESSAGES_BEFORE_FLUSH) {
            return false;
        }
        
        // Always flush if we've hit the maximum timeout (safety valve)
        if (timeSinceLastActivity > this.CONVERSATION_COMPLETION_TIMEOUT) {
            return true;
        }
        
        // For conversations with reasonable number of messages, use extended timeout
        if (messageCount >= 10 && timeSinceLastActivity > this.BUFFER_TIMEOUT) {
            return true;
        }
        
        // For large conversations (50+ messages), be more patient
        if (messageCount >= 50 && timeSinceLastActivity > (this.BUFFER_TIMEOUT * 1.5)) {
            return true;
        }
        
        return false;
    }
    
    private getFlushReason(conversation: ConversationBuffer, timeSinceLastActivity: number): string {
        const messageCount = conversation.messages.length;
        
        if (timeSinceLastActivity > this.CONVERSATION_COMPLETION_TIMEOUT) {
            return 'max_timeout_reached';
        }
        
        if (messageCount >= 50 && timeSinceLastActivity > (this.BUFFER_TIMEOUT * 1.5)) {
            return 'large_conversation_timeout';
        }
        
        if (messageCount >= 10 && timeSinceLastActivity > this.BUFFER_TIMEOUT) {
            return 'normal_conversation_timeout';
        }
        
        return 'insufficient_messages';
    }

    async stop(): Promise<void> {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }

        if (this.recoveryCheckInterval) {
            clearInterval(this.recoveryCheckInterval);
            this.recoveryCheckInterval = null;
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

    private detectInfiniteMessageLoop(messageKey: string, changeType: string, offset: string): boolean {
        const lastProcessed = this.lastProcessedMessages.get(messageKey);
        const currentMessage = { changeType, offset, timestamp: new Date() };
        
        // TRUE infinite loop only occurs when EXACT SAME MESSAGE (same offset) is processed repeatedly
        if (lastProcessed && 
            lastProcessed.changeType === currentMessage.changeType && 
            lastProcessed.offset === currentMessage.offset) {
            
            // Check if this exact same message is happening within the time window
            const timeDifference = currentMessage.timestamp.getTime() - lastProcessed.timestamp.getTime();
            
            if (timeDifference < this.INFINITE_LOOP_TIME_WINDOW) {
                // TRUE infinite loop: Same callId + changeType + SAME offset within time window
                const consecutiveCount = (this.consecutiveSameMessages.get(messageKey) || 0) + 1;
                this.consecutiveSameMessages.set(messageKey, consecutiveCount);
                
                if (consecutiveCount >= this.MAX_CONSECUTIVE_SAME_MESSAGES) {
                    logger.warn(`🚨 Detected ${consecutiveCount} consecutive ${changeType} operations for ${messageKey.split('-')[0]} with SAME offset ${offset} within ${timeDifference}ms - TRUE infinite loop`);
                    return true;
                }
            } else {
                // Same message but after long time gap - reset counter (legitimate reprocessing)
                this.consecutiveSameMessages.set(messageKey, 1);
            }
        } else {
            // Different message (different offset or changeType) - ALWAYS reset consecutive count
            // This is normal CDC batch processing with sequential offsets
            this.consecutiveSameMessages.set(messageKey, 1);
        }
        
        this.lastProcessedMessages.set(messageKey, currentMessage);
        return false;
    }

    private async autoDisableConversationAssembly(callId: string): Promise<void> {
        try {
            logger.error('🔥 AUTO-DISABLING Conversation Assembly Consumer due to infinite loop', { callId });
            
            // Remove the problematic conversation from buffer
            if (this.conversationBuffers.has(callId)) {
                this.conversationBuffers.delete(callId);
                logger.info('🧹 Removed problematic conversation from buffer', { callId });
            }
            
            // Clear processing history for this call
            const keysToRemove = Array.from(this.lastProcessedMessages.keys()).filter(key => key.startsWith(callId));
            keysToRemove.forEach(key => {
                this.lastProcessedMessages.delete(key);
                this.consecutiveSameMessages.delete(key);
            });
            
            logger.error('⚠️ Conversation Assembly Consumer circuit breaker activated - manual reset required');
            logger.error('🔧 To reset: restart the API service or clear Kafka consumer group offsets');
            
        } catch (error) {
            logger.error('Failed to auto-disable conversation assembly', { error, callId });
        }
    }

    resetCircuitBreaker(): void {
        this.circuitBreakerTripped = false;
        this.circuitBreakerTripTime = null;
        this.lastProcessedMessages.clear();
        this.consecutiveSameMessages.clear();
        logger.info('✅ Conversation Assembly Consumer circuit breaker reset');
    }

    private startAutoRecoveryCheck(): void {
        // Check for auto-recovery every 30 seconds
        this.recoveryCheckInterval = setInterval(() => {
            this.checkAutoRecovery();
        }, 30000);
    }

    private checkAutoRecovery(): void {
        if (!this.circuitBreakerTripped || !this.circuitBreakerTripTime) {
            return;
        }

        const timeSinceTrip = Date.now() - this.circuitBreakerTripTime.getTime();
        
        // Clean up old tracking data periodically
        this.cleanupOldTrackingData();
        
        if (timeSinceTrip >= this.AUTO_RECOVERY_TIMEOUT) {
            // Check system health before auto-recovery
            const bufferSize = this.conversationBuffers.size;
            const recentErrors = this.consecutiveSameMessages.size;
            
            // More lenient auto-recovery conditions
            if (bufferSize < 500 && recentErrors < 50) {
                logger.info('🔄 Auto-recovering circuit breaker - system appears stable', {
                    timeSinceTrip: Math.round(timeSinceTrip / 1000) + 's',
                    bufferSize,
                    recentErrors
                });
                this.resetCircuitBreaker();
            } else {
                logger.warn('⚠️ Auto-recovery delayed - system still unstable', {
                    timeSinceTrip: Math.round(timeSinceTrip / 1000) + 's',
                    bufferSize,
                    recentErrors,
                    nextCheckIn: '30s'
                });
            }
        }
    }

    private cleanupOldTrackingData(): void {
        const now = Date.now();
        const cutoffTime = now - (this.INFINITE_LOOP_TIME_WINDOW * 2); // Clean data older than 1 minute
        
        // Clean up old message tracking data
        for (const [key, data] of this.lastProcessedMessages.entries()) {
            if (data.timestamp.getTime() < cutoffTime) {
                this.lastProcessedMessages.delete(key);
                this.consecutiveSameMessages.delete(key);
            }
        }
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