import { KafkaConsumerBase, ProcessingContext } from '../kafka-consumer-base.service';
import { logger } from '../../utils/logger';
import { oracleService } from '../oracle.service';
import { getKafkaProducer } from '../kafka-producer.service';

interface FailedRecord {
    originalTopic: string;
    originalMessage: any;
    error: string;
    timestamp: string;
    processingAttempts: number;
}

interface ErrorMetrics {
    totalErrors: number;
    errorsByTopic: Map<string, number>;
    errorsByType: Map<string, number>;
    recoveredRecords: number;
    permanentFailures: number;
    lastErrorTime?: Date;
}

interface ErrorHandlingConfig {
    maxRetryAttempts: number;
    retryDelayMs: number;
    enableErrorLogging: boolean;
    enableErrorReprocessing: boolean;
    enableErrorNotifications: boolean;
    errorNotificationThreshold: number;
}

export class ErrorHandlerConsumerService extends KafkaConsumerBase {
    private config: ErrorHandlingConfig;
    private errorMetrics: ErrorMetrics;
    private reprocessingQueue = new Map<string, FailedRecord>();
    private notificationsSent = 0;

    constructor() {
        super({
            groupId: `${process.env.KAFKA_CONSUMER_GROUP_PREFIX || 'call-analytics'}-error-handler`,
            topics: [process.env.KAFKA_TOPIC_FAILED_RECORDS || 'failed-records-dlq'],
            sessionTimeout: 30000,
            heartbeatInterval: 10000,
            maxPollInterval: 300000,
            fromBeginning: true
        });

        this.config = {
            maxRetryAttempts: parseInt(process.env.ERROR_MAX_RETRY_ATTEMPTS || '3'),
            retryDelayMs: parseInt(process.env.ERROR_RETRY_DELAY_MS || '60000'), // 1 minute
            enableErrorLogging: process.env.ERROR_LOGGING !== 'false',
            enableErrorReprocessing: process.env.ERROR_REPROCESSING !== 'false',
            enableErrorNotifications: process.env.ERROR_NOTIFICATIONS === 'true',
            errorNotificationThreshold: parseInt(process.env.ERROR_NOTIFICATION_THRESHOLD || '10')
        };

        this.errorMetrics = {
            totalErrors: 0,
            errorsByTopic: new Map(),
            errorsByType: new Map(),
            recoveredRecords: 0,
            permanentFailures: 0
        };
    }

    protected async processMessage(
        message: FailedRecord, 
        context: ProcessingContext
    ): Promise<void> {
        try {
            logger.info('Processing failed record in error handler', {
                originalTopic: message.originalTopic,
                error: message.error,
                attemptNumber: message.processingAttempts,
                partition: context.partition,
                offset: context.offset
            });

            // Update error metrics
            this.updateErrorMetrics(message);

            // Log error if enabled
            if (this.config.enableErrorLogging) {
                await this.logError(message);
            }

            // Attempt reprocessing if enabled and within retry limits
            if (this.config.enableErrorReprocessing && 
                message.processingAttempts < this.config.maxRetryAttempts) {
                
                await this.attemptReprocessing(message);
            } else {
                // Mark as permanent failure
                await this.handlePermanentFailure(message);
            }

            // Send notifications if threshold reached
            if (this.config.enableErrorNotifications) {
                await this.checkAndSendNotifications();
            }

        } catch (error) {
            logger.error('Failed to process error record', {
                error,
                originalTopic: message.originalTopic,
                originalError: message.error,
                partition: context.partition,
                offset: context.offset
            });
            throw error;
        }
    }

    private updateErrorMetrics(failedRecord: FailedRecord): void {
        this.errorMetrics.totalErrors++;
        this.errorMetrics.lastErrorTime = new Date();

        // Track errors by topic
        const topicCount = this.errorMetrics.errorsByTopic.get(failedRecord.originalTopic) || 0;
        this.errorMetrics.errorsByTopic.set(failedRecord.originalTopic, topicCount + 1);

        // Track errors by type
        const errorType = this.categorizeError(failedRecord.error);
        const typeCount = this.errorMetrics.errorsByType.get(errorType) || 0;
        this.errorMetrics.errorsByType.set(errorType, typeCount + 1);
    }

    private categorizeError(errorMessage: string): string {
        const errorLower = errorMessage.toLowerCase();
        
        if (errorLower.includes('timeout') || errorLower.includes('connection')) {
            return 'connectivity';
        } else if (errorLower.includes('parse') || errorLower.includes('json') || errorLower.includes('invalid')) {
            return 'data_format';
        } else if (errorLower.includes('authentication') || errorLower.includes('authorization')) {
            return 'security';
        } else if (errorLower.includes('not found') || errorLower.includes('missing')) {
            return 'resource_missing';
        } else if (errorLower.includes('quota') || errorLower.includes('limit') || errorLower.includes('capacity')) {
            return 'resource_limit';
        } else {
            return 'unknown';
        }
    }

    private async logError(failedRecord: FailedRecord): Promise<void> {
        try {
            // Log to Oracle for persistent error tracking
            // Note: ERROR_LOG table uses RAW(16) for ERROR_ID to support SYS_GUID()
            // Table structure is created in realtime-cdc.service.ts
            const query = `
                INSERT INTO ERROR_LOG (
                    ERROR_ID,
                    ORIGINAL_TOPIC,
                    ERROR_MESSAGE,
                    ERROR_TYPE,
                    PROCESSING_ATTEMPTS,
                    ORIGINAL_MESSAGE,
                    ERROR_TIMESTAMP,
                    CREATED_AT
                ) VALUES (
                    SYS_GUID(),
                    :originalTopic,
                    :errorMessage,
                    :errorType,
                    :processingAttempts,
                    :originalMessage,
                    TO_TIMESTAMP(:errorTimestamp, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),
                    SYSDATE
                )
            `;

            await oracleService.executeQuery(query, {
                originalTopic: failedRecord.originalTopic,
                errorMessage: failedRecord.error.substring(0, 2000), // Limit length
                errorType: this.categorizeError(failedRecord.error),
                processingAttempts: failedRecord.processingAttempts,
                originalMessage: JSON.stringify(failedRecord.originalMessage).substring(0, 4000),
                errorTimestamp: failedRecord.timestamp
            });

            logger.debug('Error logged to Oracle database', {
                originalTopic: failedRecord.originalTopic,
                errorType: this.categorizeError(failedRecord.error)
            });

        } catch (logError) {
            logger.warn('Failed to log error to Oracle database', {
                logError,
                originalTopic: failedRecord.originalTopic
            });
            // Don't throw - logging failure shouldn't fail error handling
        }
    }

    private async attemptReprocessing(failedRecord: FailedRecord): Promise<void> {
        try {
            logger.info('Attempting to reprocess failed record', {
                originalTopic: failedRecord.originalTopic,
                attempt: failedRecord.processingAttempts + 1,
                maxAttempts: this.config.maxRetryAttempts
            });

            // Wait before retry to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));

            // Determine reprocessing strategy based on original topic
            const reprocessed = await this.reprocessByTopic(failedRecord);

            if (reprocessed) {
                this.errorMetrics.recoveredRecords++;
                logger.info('Successfully reprocessed failed record', {
                    originalTopic: failedRecord.originalTopic,
                    attempt: failedRecord.processingAttempts + 1
                });
            } else {
                // Increment attempt count and re-queue if under limit
                const updatedRecord = {
                    ...failedRecord,
                    processingAttempts: failedRecord.processingAttempts + 1,
                    timestamp: new Date().toISOString()
                };

                if (updatedRecord.processingAttempts < this.config.maxRetryAttempts) {
                    // Send back to DLQ for another attempt
                    const kafkaProducer = getKafkaProducer();
                    await kafkaProducer.sendToDeadLetterQueue(
                        failedRecord.originalTopic,
                        updatedRecord,
                        `Retry attempt ${updatedRecord.processingAttempts} failed`
                    );
                } else {
                    await this.handlePermanentFailure(updatedRecord);
                }
            }

        } catch (reprocessError) {
            logger.error('Reprocessing attempt failed', {
                reprocessError,
                originalTopic: failedRecord.originalTopic,
                attempt: failedRecord.processingAttempts + 1
            });

            // Still increment attempt count
            const updatedRecord = {
                ...failedRecord,
                processingAttempts: failedRecord.processingAttempts + 1,
                error: `${failedRecord.error}; Reprocess error: ${reprocessError}`
            };

            if (updatedRecord.processingAttempts < this.config.maxRetryAttempts) {
                const kafkaProducer = getKafkaProducer();
                await kafkaProducer.sendToDeadLetterQueue(
                    failedRecord.originalTopic,
                    updatedRecord,
                    `Reprocessing failed: ${reprocessError}`
                );
            } else {
                await this.handlePermanentFailure(updatedRecord);
            }
        }
    }

    private async reprocessByTopic(failedRecord: FailedRecord): Promise<boolean> {
        const kafkaProducer = getKafkaProducer();

        try {
            switch (failedRecord.originalTopic) {
                case 'cdc-raw-changes':
                    // Reprocess CDC change
                    await kafkaProducer.sendCDCChange(failedRecord.originalMessage);
                    return true;

                case 'conversation-assembly':
                    // Reprocess conversation assembly
                    await kafkaProducer.sendConversationAssembly(failedRecord.originalMessage);
                    return true;

                case 'ml-processing-queue':
                    // Reprocess ML result
                    await kafkaProducer.sendMLProcessingResult(failedRecord.originalMessage);
                    return true;

                case 'opensearch-bulk-index':
                    // Reprocess OpenSearch indexing
                    await kafkaProducer.sendOpenSearchIndexRequest(failedRecord.originalMessage);
                    return true;

                case 'failed-records-dlq':
                    // PREVENT INFINITE LOOP: Don't reprocess DLQ messages back to DLQ
                    logger.warn('Skipping reprocessing of DLQ message to prevent infinite loop', {
                        originalTopic: failedRecord.originalTopic
                    });
                    return false; // Mark as permanent failure instead of reprocessing

                default:
                    logger.warn('Unknown topic for reprocessing', {
                        originalTopic: failedRecord.originalTopic
                    });
                    return false;
            }
        } catch (error) {
            logger.error('Failed to reprocess message', {
                error,
                originalTopic: failedRecord.originalTopic
            });
            return false;
        }
    }

    private async handlePermanentFailure(failedRecord: FailedRecord): Promise<void> {
        this.errorMetrics.permanentFailures++;

        logger.error('Marking record as permanent failure', {
            originalTopic: failedRecord.originalTopic,
            error: failedRecord.error,
            attempts: failedRecord.processingAttempts,
            originalMessage: JSON.stringify(failedRecord.originalMessage).substring(0, 500)
        });

        try {
            // Log permanent failure to Oracle
            const query = `
                INSERT INTO KAFKA_PERMANENT_FAILURES (
                    FAILURE_ID,
                    ORIGINAL_TOPIC,
                    ERROR_MESSAGE,
                    ERROR_TYPE,
                    TOTAL_ATTEMPTS,
                    ORIGINAL_MESSAGE,
                    FIRST_ERROR_TIMESTAMP,
                    MARKED_FAILED_AT
                ) VALUES (
                    SYS_GUID(),
                    :originalTopic,
                    :errorMessage,
                    :errorType,
                    :totalAttempts,
                    :originalMessage,
                    TO_TIMESTAMP(:firstErrorTimestamp, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),
                    SYSDATE
                )
            `;

            await oracleService.executeQuery(query, {
                originalTopic: failedRecord.originalTopic,
                errorMessage: failedRecord.error.substring(0, 2000),
                errorType: this.categorizeError(failedRecord.error),
                totalAttempts: failedRecord.processingAttempts,
                originalMessage: JSON.stringify(failedRecord.originalMessage).substring(0, 4000),
                firstErrorTimestamp: failedRecord.timestamp
            });

        } catch (logError) {
            logger.warn('Failed to log permanent failure', {
                logError,
                originalTopic: failedRecord.originalTopic
            });
        }
    }

    private async checkAndSendNotifications(): Promise<void> {
        const errorCount = this.errorMetrics.totalErrors;
        const threshold = this.config.errorNotificationThreshold;

        // Send notification every time we hit the threshold
        if (errorCount > 0 && errorCount % threshold === 0) {
            await this.sendErrorNotification();
        }
    }

    private async sendErrorNotification(): Promise<void> {
        this.notificationsSent++;

        const notification = {
            type: 'error-notification',
            timestamp: new Date().toISOString(),
            metrics: {
                totalErrors: this.errorMetrics.totalErrors,
                recoveredRecords: this.errorMetrics.recoveredRecords,
                permanentFailures: this.errorMetrics.permanentFailures,
                lastErrorTime: this.errorMetrics.lastErrorTime,
                errorsByTopic: Object.fromEntries(this.errorMetrics.errorsByTopic),
                errorsByType: Object.fromEntries(this.errorMetrics.errorsByType)
            },
            notificationNumber: this.notificationsSent,
            threshold: this.config.errorNotificationThreshold
        };

        logger.warn('Error threshold reached - sending notification', notification);

        try {
            // Send to processing metrics topic for monitoring
            const kafkaProducer = getKafkaProducer();
            await kafkaProducer.sendProcessingMetric({
                type: 'processing-metric',
                consumerGroup: 'error-handler',
                topic: 'failed-records-dlq',
                partition: 0,
                offset: '0',
                status: 'failure',
                processingTimeMs: 0,
                stage: 'error-handling',
                timestamp: notification.timestamp,
                metadata: {
                    notificationType: 'error-threshold',
                    threshold: this.config.errorNotificationThreshold,
                    ...notification.metrics
                }
            });

        } catch (notificationError) {
            logger.error('Failed to send error notification', {
                notificationError,
                notification
            });
        }
    }

    async getErrorSummary(): Promise<any> {
        return {
            totalErrors: this.errorMetrics.totalErrors,
            recoveredRecords: this.errorMetrics.recoveredRecords,
            permanentFailures: this.errorMetrics.permanentFailures,
            successRate: this.errorMetrics.totalErrors > 0 ? 
                (this.errorMetrics.recoveredRecords / this.errorMetrics.totalErrors) : 1,
            errorsByTopic: Object.fromEntries(this.errorMetrics.errorsByTopic),
            errorsByType: Object.fromEntries(this.errorMetrics.errorsByType),
            lastErrorTime: this.errorMetrics.lastErrorTime,
            notificationsSent: this.notificationsSent,
            reprocessingQueueSize: this.reprocessingQueue.size,
            config: this.config
        };
    }

    async healthCheck(): Promise<{ 
        status: string; 
        metrics: any;
        processingCount: number;
        isPaused: boolean;
    }> {
        try {
            const baseHealth = await super.healthCheck();
            
            // Check if error rate is manageable (less than 50% permanent failures)
            const errorRateHealthy = this.errorMetrics.totalErrors === 0 || 
                (this.errorMetrics.permanentFailures / this.errorMetrics.totalErrors) < 0.5;
            
            return {
                ...baseHealth,
                status: baseHealth.status === 'healthy' && errorRateHealthy ? 'healthy' : 'unhealthy',
                metrics: {
                    ...baseHealth.metrics,
                    ...this.errorMetrics,
                    notificationsSent: this.notificationsSent,
                    reprocessingQueueSize: this.reprocessingQueue.size
                }
            };
        } catch (error) {
            logger.error('Error Handler Consumer health check failed', { error });
            return {
                status: 'unhealthy',
                metrics: this.errorMetrics,
                processingCount: this.processingCount,
                isPaused: this.isPaused
            };
        }
    }

    getMetrics() {
        return {
            ...super.getMetrics(),
            ...this.errorMetrics,
            notificationsSent: this.notificationsSent,
            reprocessingQueueSize: this.reprocessingQueue.size,
            config: this.config
        };
    }
}

// Singleton instance
let errorHandlerConsumerInstance: ErrorHandlerConsumerService | null = null;

export const getErrorHandlerConsumer = (): ErrorHandlerConsumerService => {
    if (!errorHandlerConsumerInstance) {
        errorHandlerConsumerInstance = new ErrorHandlerConsumerService();
    }
    return errorHandlerConsumerInstance;
};

export default ErrorHandlerConsumerService;