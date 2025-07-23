import { Router } from 'express';
import { kafkaMonitoringController } from '../controllers/kafka-monitoring.controller';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Kafka Monitoring Routes
 * 
 * These routes provide comprehensive monitoring and management capabilities
 * for the Kafka streaming infrastructure including producers, consumers,
 * and the complete data processing pipeline.
 */

/**
 * @route GET /kafka/health
 * @description Get comprehensive health status of all Kafka services
 * @access Public (internal monitoring)
 * @returns {Object} Health status with overall status and individual service details
 */
router.get('/health', async (req, res) => {
    logger.debug('Kafka health endpoint accessed', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    await kafkaMonitoringController.getHealthStatus(req, res);
});

/**
 * @route GET /kafka/metrics
 * @description Get detailed metrics for all Kafka services
 * @access Public (internal monitoring)
 * @returns {Object} Comprehensive metrics including producer/consumer stats and aggregated data
 */
router.get('/metrics', async (req, res) => {
    logger.debug('Kafka metrics endpoint accessed', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    await kafkaMonitoringController.getMetrics(req, res);
});

/**
 * @route GET /kafka/consumer-lag
 * @description Get consumer lag information for all topics
 * @access Public (internal monitoring)
 * @returns {Object} Consumer lag stats and processing rates
 */
router.get('/consumer-lag', async (req, res) => {
    logger.debug('Kafka consumer lag endpoint accessed', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    await kafkaMonitoringController.getConsumerLag(req, res);
});

/**
 * @route GET /kafka/errors
 * @description Get error summary and failed message statistics
 * @access Public (internal monitoring)
 * @returns {Object} Error statistics across all producers and consumers
 */
router.get('/errors', async (req, res) => {
    logger.debug('Kafka errors endpoint accessed', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    await kafkaMonitoringController.getErrorSummary(req, res);
});

/**
 * @route GET /kafka/pipeline
 * @description Get pipeline status showing message flow through all stages
 * @access Public (internal monitoring)  
 * @returns {Object} Complete pipeline status with stage-by-stage health and metrics
 */
router.get('/pipeline', async (req, res) => {
    logger.debug('Kafka pipeline status endpoint accessed', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    await kafkaMonitoringController.getPipelineStatus(req, res);
});

/**
 * @route POST /kafka/consumers/:consumerName/restart
 * @description Restart a specific consumer service
 * @access Protected (admin only)
 * @param {string} consumerName - Name of the consumer to restart
 * @returns {Object} Restart operation result
 */
router.post('/consumers/:consumerName/restart', async (req, res) => {
    logger.info('Kafka consumer restart requested', {
        consumerName: req.params.consumerName,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    await kafkaMonitoringController.restartConsumer(req, res);
});

/**
 * Health check routes for load balancers and orchestrators
 */

/**
 * @route GET /kafka/ready
 * @description Kubernetes-style readiness probe for Kafka services
 * @access Public (infrastructure)
 * @returns {Object} Simple ready/not ready status
 */
router.get('/ready', async (req, res) => {
    try {
        // Quick health check - just verify core services are responsive
        const kafkaMonitoringController = require('../controllers/kafka-monitoring.controller').kafkaMonitoringController;
        
        // Create a mock request/response for internal health check
        const mockReq = { ip: req.ip } as any;
        let healthResult: any = null;
        const mockRes = {
            status: (code: number) => ({
                json: (data: any) => {
                    healthResult = { status: code, data };
                }
            })
        } as any;

        await kafkaMonitoringController.getHealthStatus(mockReq, mockRes);
        
        const isReady = healthResult?.status === 200 && 
                        healthResult?.data?.overall !== 'unhealthy';

        res.status(isReady ? 200 : 503).json({
            ready: isReady,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Readiness probe failed', { error });
        res.status(503).json({
            ready: false,
            timestamp: new Date().toISOString(),
            error: 'Readiness check failed'
        });
    }
});

/**
 * @route GET /kafka/live
 * @description Kubernetes-style liveness probe for Kafka services
 * @access Public (infrastructure)
 * @returns {Object} Simple alive/not alive status
 */
router.get('/live', (req, res) => {
    // Liveness probe - just check if the service is running
    res.status(200).json({
        alive: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

/**
 * Development and debugging routes (only available in non-production)
 */
if (process.env.NODE_ENV !== 'production') {
    /**
     * @route GET /kafka/debug/topics
     * @description Get detailed topic information (development only)
     * @access Development only
     */
    router.get('/debug/topics', async (req, res) => {
        try {
            logger.debug('Kafka debug topics endpoint accessed', {
                ip: req.ip,
                environment: process.env.NODE_ENV
            });

            // This would require Kafka admin client to list topics
            // For now, return configured topics from environment
            const topics = {
                timestamp: new Date().toISOString(),
                configuredTopics: {
                    cdcRawChanges: process.env.KAFKA_TOPIC_CDC_RAW_CHANGES || 'cdc-raw-changes',
                    conversationAssembly: process.env.KAFKA_TOPIC_CONVERSATION_ASSEMBLY || 'conversation-assembly',
                    mlProcessingQueue: process.env.KAFKA_TOPIC_ML_PROCESSING || 'ml-processing-queue',
                    opensearchBulkIndex: process.env.KAFKA_TOPIC_OPENSEARCH_INDEX || 'opensearch-bulk-index',
                    failedRecordsDlq: process.env.KAFKA_TOPIC_FAILED_RECORDS || 'failed-records-dlq',
                    processingMetrics: 'processing-metrics'
                },
                environment: process.env.NODE_ENV,
                kafkaBrokers: process.env.KAFKA_BROKERS || 'kafka:29092'
            };

            res.status(200).json(topics);
        } catch (error) {
            logger.error('Failed to get debug topic information', { error });
            res.status(500).json({
                timestamp: new Date().toISOString(),
                error: 'Failed to get topic information',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    });

    /**
     * @route GET /kafka/debug/config
     * @description Get Kafka configuration details (development only)
     * @access Development only
     */
    router.get('/debug/config', (req, res) => {
        try {
            logger.debug('Kafka debug config endpoint accessed', {
                ip: req.ip,
                environment: process.env.NODE_ENV
            });

            const config = {
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV,
                kafka: {
                    brokers: process.env.KAFKA_BROKERS || 'kafka:29092',
                    enabled: process.env.ENABLE_KAFKA === 'true',
                    cdcEnabled: process.env.ENABLE_KAFKA_CDC === 'true',
                    consumerGroupPrefix: process.env.KAFKA_CONSUMER_GROUP_PREFIX || 'call-analytics',
                    retries: process.env.KAFKA_RETRIES || '5',
                    retryDelayMs: process.env.KAFKA_RETRY_DELAY_MS || '3000'
                },
                consumers: {
                    conversationAssembly: {
                        bufferTimeout: process.env.CONVERSATION_BUFFER_TIMEOUT || '30000',
                        maxBufferSize: process.env.MAX_CONVERSATION_BUFFER_SIZE || '1000'
                    },
                    mlProcessing: {
                        mlServiceUrl: process.env.ML_SERVICE_URL || 'http://ml-service:5000',
                        timeout: process.env.ML_PROCESSING_TIMEOUT || '120000',
                        retryAttempts: process.env.ML_RETRY_ATTEMPTS || '3'
                    },
                    opensearchIndexing: {
                        batchSize: process.env.OPENSEARCH_BATCH_SIZE || '10',
                        batchTimeout: process.env.OPENSEARCH_BATCH_TIMEOUT || '30000',
                        indexPrefix: process.env.OPENSEARCH_INDEX_PREFIX || 'call-analytics'
                    },
                    errorHandler: {
                        maxRetryAttempts: process.env.ERROR_MAX_RETRY_ATTEMPTS || '3',
                        retryDelayMs: process.env.ERROR_RETRY_DELAY_MS || '60000'
                    }
                }
            };

            res.status(200).json(config);
        } catch (error) {
            logger.error('Failed to get debug configuration', { error });
            res.status(500).json({
                timestamp: new Date().toISOString(),
                error: 'Failed to get configuration',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    });
}

/**
 * Error handling middleware for Kafka monitoring routes
 */
router.use((error: any, req: any, res: any, next: any) => {
    logger.error('Error in Kafka monitoring routes', {
        error: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method,
        ip: req.ip
    });

    res.status(500).json({
        timestamp: new Date().toISOString(),
        error: 'Internal server error in Kafka monitoring',
        path: req.path,
        method: req.method
    });
});

export default router;