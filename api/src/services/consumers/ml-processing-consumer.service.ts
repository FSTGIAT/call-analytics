import { KafkaConsumerBase, ProcessingContext } from '../kafka-consumer-base.service';
import { ConversationAssembly, MLProcessingResult } from '../../types/kafka-messages';
import { getKafkaProducer } from '../kafka-producer.service';
import { logger } from '../../utils/logger';
import axios from 'axios';

interface MLProcessingConfig {
    mlServiceUrl: string;
    timeout: number;
    retryAttempts: number;
    batchSize: number;
    hebrewDetectionThreshold: number;
}

interface MLServiceResponse {
    embedding: number[];
    sentiment: {
        overall: 'positive' | 'negative' | 'neutral' | 'mixed';
        score: number;
        distribution: {
            positive: number;
            negative: number;
            neutral: number;
        };
    };
    language: {
        detected: string;
        confidence: number;
        isHebrew: boolean;
    };
    entities?: {
        persons: string[];
        locations: string[];
        organizations: string[];
        phoneNumbers: string[];
        emails: string[];
    };
    summary?: {
        text: string;
        keyPoints: string[];
        actionItems?: string[];
    };
    topics?: {
        primary: string;
        secondary: string[];
        confidence: number;
    };
}

export class MLProcessingConsumerService extends KafkaConsumerBase {
    private config: MLProcessingConfig;
    private processingQueue = new Map<string, ConversationAssembly>();
    private processingInProgress = new Set<string>();

    constructor() {
        super({
            groupId: `${process.env.KAFKA_CONSUMER_GROUP_PREFIX || 'call-analytics'}-ml-processing`,
            topics: [process.env.KAFKA_TOPIC_CONVERSATION_ASSEMBLY || 'conversation-assembly'],
            sessionTimeout: 45000, // Longer timeout for ML processing
            heartbeatInterval: 15000,
            maxPollInterval: 600000, // 10 minutes for ML processing
            fromBeginning: true
        });

        this.config = {
            mlServiceUrl: process.env.ML_SERVICE_URL || 'http://ml-service:5000',
            timeout: parseInt(process.env.ML_PROCESSING_TIMEOUT || '120000'), // 2 minutes
            retryAttempts: parseInt(process.env.ML_RETRY_ATTEMPTS || '3'),
            batchSize: parseInt(process.env.ML_BATCH_SIZE || '5'),
            hebrewDetectionThreshold: parseFloat(process.env.HEBREW_DETECTION_THRESHOLD || '0.8')
        };
    }

    protected async processMessage(
        message: ConversationAssembly, 
        context: ProcessingContext
    ): Promise<void> {
        try {
            logger.info('Processing conversation for ML analysis', {
                callId: message.callId,
                messageCount: message.messages.length,
                duration: message.conversationMetadata.duration,
                partition: context.partition,
                offset: context.offset
            });

            // Prevent duplicate processing
            if (this.processingInProgress.has(message.callId)) {
                logger.warn('Conversation already being processed, skipping', {
                    callId: message.callId
                });
                return;
            }

            this.processingInProgress.add(message.callId);

            try {
                // Process the conversation through ML service
                const mlResult = await this.processConversationML(message);
                
                // Send to next stage
                const kafkaProducer = getKafkaProducer();
                await kafkaProducer.sendMLProcessingResult(mlResult);

                logger.info('ML processing completed successfully', {
                    callId: message.callId,
                    detectedLanguage: mlResult.language.detected,
                    sentiment: mlResult.sentiment.overall,
                    embeddingSize: mlResult.embedding.length
                });

            } finally {
                this.processingInProgress.delete(message.callId);
            }

        } catch (error) {
            this.processingInProgress.delete(message.callId);
            logger.error('Failed to process conversation for ML analysis', {
                error,
                callId: message.callId,
                partition: context.partition,
                offset: context.offset
            });
            throw error;
        }
    }

    private async processConversationML(conversation: ConversationAssembly): Promise<MLProcessingResult> {
        // Prepare conversation text for ML processing
        const conversationText = this.prepareConversationText(conversation);
        
        // Call ML service with retry logic
        const mlResponse = await this.callMLServiceWithRetry(conversationText, conversation.callId);

        // Create ML processing result
        const mlResult: MLProcessingResult = {
            type: 'ml-processing-result',
            callId: conversation.callId,
            customerId: conversation.customerId,
            subscriberId: conversation.subscriberNo,
            embedding: mlResponse.embedding,
            sentiment: mlResponse.sentiment,
            language: mlResponse.language,
            entities: mlResponse.entities,
            summary: mlResponse.summary,
            topics: mlResponse.topics,
            conversationContext: {
                messageCount: conversation.messages.length,
                duration: conversation.conversationMetadata.duration,
                participants: conversation.conversationMetadata.participants || {
                    agent: [],
                    customer: []
                },
                startTime: conversation.conversationMetadata.startTime,
                endTime: conversation.conversationMetadata.endTime
            },
            processingMetadata: {
                mlServiceVersion: '1.0',
                modelUsed: this.determineModel(mlResponse.language),
                processingTime: new Date(),
                confidence: this.calculateOverallConfidence(mlResponse)
            },
            timestamp: new Date().toISOString()
        };

        return mlResult;
    }

    private prepareConversationText(conversation: ConversationAssembly): string {
        // Create a formatted conversation text for ML processing
        const conversationLines = conversation.messages.map(message => {
            // Handle timestamp - convert to Date if it's a string/number
            const timestampDate = message.timestamp instanceof Date 
                ? message.timestamp 
                : new Date(message.timestamp);
            const timestamp = timestampDate.toISOString().slice(11, 19); // HH:MM:SS
            const speaker = message.speaker === 'agent' ? 'נציג' : 'לקוח'; // Hebrew labels
            return `[${timestamp}] ${speaker}: ${message.text}`;
        });

        return conversationLines.join('\n');
    }

    private async callMLServiceWithRetry(
        conversationText: string, 
        callId: string
    ): Promise<MLServiceResponse> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                logger.debug(`ML service call attempt ${attempt}/${this.config.retryAttempts}`, {
                    callId,
                    textLength: conversationText.length
                });

                const response = await axios.post(
                    `${this.config.mlServiceUrl}/api/analyze-conversation`,
                    {
                        text: conversationText,
                        callId: callId,
                        options: {
                            includeEmbedding: true,
                            includeSentiment: true,
                            includeEntities: true,
                            includeSummary: true,
                            includeTopics: true,
                            language: 'auto-detect'
                        }
                    },
                    {
                        timeout: this.config.timeout,
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        }
                    }
                );

                if (response.status === 200 && response.data) {
                    return this.validateMLResponse(response.data, callId);
                } else {
                    throw new Error(`ML service returned status ${response.status}`);
                }

            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                logger.warn(`ML service call failed (attempt ${attempt}/${this.config.retryAttempts})`, {
                    callId,
                    error: lastError.message,
                    attempt
                });

                // Wait before retry (exponential backoff)
                if (attempt < this.config.retryAttempts) {
                    const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s...
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // All retries failed
        throw new Error(`ML service failed after ${this.config.retryAttempts} attempts: ${lastError?.message}`);
    }

    private validateMLResponse(response: any, callId: string): MLServiceResponse {
        // Validate required fields
        if (!response.embedding || !Array.isArray(response.embedding)) {
            throw new Error('ML service response missing valid embedding');
        }

        if (!response.sentiment || typeof response.sentiment.overall !== 'string') {
            throw new Error('ML service response missing valid sentiment');
        }

        if (!response.language || typeof response.language.detected !== 'string') {
            throw new Error('ML service response missing valid language detection');
        }

        // Provide defaults for optional fields
        return {
            embedding: response.embedding,
            sentiment: {
                overall: response.sentiment.overall,
                score: response.sentiment.score || 0,
                distribution: response.sentiment.distribution || {
                    positive: 0.33,
                    negative: 0.33,
                    neutral: 0.34
                }
            },
            language: {
                detected: response.language.detected,
                confidence: response.language.confidence || 0.8,
                isHebrew: response.language.isHebrew || 
                          response.language.detected === 'he' ||
                          response.language.detected === 'hebrew'
            },
            entities: response.entities || {
                persons: [],
                locations: [],
                organizations: [],
                phoneNumbers: [],
                emails: []
            },
            summary: response.summary || {
                text: 'Summary not available',
                keyPoints: []
            },
            topics: response.topics || {
                primary: 'general',
                secondary: [],
                confidence: 0.5
            }
        };
    }

    private determineModel(language: { detected: string; isHebrew: boolean }): string {
        if (language.isHebrew || language.detected === 'he') {
            return 'alephbert-base';
        }
        return 'multilingual-bert';
    }

    private calculateOverallConfidence(response: MLServiceResponse): number {
        // Calculate weighted confidence score
        const languageWeight = 0.3;
        const sentimentWeight = 0.2;
        const topicsWeight = 0.2;
        const entitiesWeight = 0.3;

        let totalConfidence = 0;
        let totalWeight = 0;

        // Language confidence
        if (response.language.confidence) {
            totalConfidence += response.language.confidence * languageWeight;
            totalWeight += languageWeight;
        }

        // Topics confidence
        if (response.topics?.confidence) {
            totalConfidence += response.topics.confidence * topicsWeight;
            totalWeight += topicsWeight;
        }

        // Default confidences for other components
        totalConfidence += 0.85 * sentimentWeight; // Sentiment analysis typically reliable
        totalConfidence += 0.75 * entitiesWeight; // Entity extraction moderate confidence
        totalWeight += sentimentWeight + entitiesWeight;

        return totalWeight > 0 ? totalConfidence / totalWeight : 0.8;
    }

    async healthCheck(): Promise<{ 
        status: string; 
        metrics: any;
        processingCount: number;
        isPaused: boolean;
    }> {
        try {
            const baseHealth = await super.healthCheck();
            
            // Test ML service connectivity
            const response = await axios.get(`${this.config.mlServiceUrl}/health`, {
                timeout: 5000
            });
            
            const serviceHealthy = response.status === 200;
            
            return {
                ...baseHealth,
                status: baseHealth.status === 'healthy' && serviceHealthy ? 'healthy' : 'unhealthy',
                metrics: {
                    ...baseHealth.metrics,
                    processingQueueSize: this.processingQueue.size,
                    activeProcessing: this.processingInProgress.size,
                    mlServiceConnected: serviceHealthy
                }
            };
        } catch (error) {
            logger.error('ML Processing Consumer health check failed', { error });
            return {
                status: 'unhealthy',
                metrics: {
                    processingQueueSize: this.processingQueue.size,
                    activeProcessing: this.processingInProgress.size,
                    mlServiceConnected: false
                },
                processingCount: this.processingCount,
                isPaused: this.isPaused
            };
        }
    }

    getMetrics() {
        return {
            ...super.getMetrics(),
            processingQueueSize: this.processingQueue.size,
            activeProcessing: this.processingInProgress.size,
            mlServiceUrl: this.config.mlServiceUrl,
            mlTimeout: this.config.timeout,
            retryAttempts: this.config.retryAttempts
        };
    }
}

// Singleton instance
let mlProcessingConsumerInstance: MLProcessingConsumerService | null = null;

export const getMLProcessingConsumer = (): MLProcessingConsumerService => {
    if (!mlProcessingConsumerInstance) {
        mlProcessingConsumerInstance = new MLProcessingConsumerService();
    }
    return mlProcessingConsumerInstance;
};

export default MLProcessingConsumerService;