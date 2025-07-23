import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { getKafkaProducer } from '../services/kafka-producer.service';
import { getKafkaCDCProducer } from '../services/kafka-cdc-producer.service';
import { getConversationAssemblyConsumer } from '../services/consumers/conversation-assembly-consumer.service';
import { getMLProcessingConsumer } from '../services/consumers/ml-processing-consumer.service';
import { getOpenSearchIndexingConsumer } from '../services/consumers/opensearch-indexing-consumer.service';
import { getErrorHandlerConsumer } from '../services/consumers/error-handler-consumer.service';
import { oracleService } from '../services/oracle.service';
import { openSearchService } from '../services/opensearch.service';

export class KafkaMonitoringController {

    /**
     * Get comprehensive health status of all Kafka services
     */
    async getHealthStatus(req: Request, res: Response): Promise<void> {
        try {
            logger.info('Kafka health status requested');

            const kafkaProducer = getKafkaProducer();
            const kafkaCDCProducer = getKafkaCDCProducer();
            const conversationConsumer = getConversationAssemblyConsumer();
            const mlConsumer = getMLProcessingConsumer();
            const opensearchConsumer = getOpenSearchIndexingConsumer();
            const errorConsumer = getErrorHandlerConsumer();

            // Collect health status from all services
            const healthStatus = {
                timestamp: new Date().toISOString(),
                overall: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
                services: {
                    kafkaProducer: {
                        status: kafkaProducer.isHealthy() ? 'healthy' : 'unhealthy',
                        connected: kafkaProducer.isHealthy(),
                        metrics: kafkaProducer.getMetrics()
                    },
                    kafkaCDCProducer: {
                        status: kafkaCDCProducer.isHealthy() ? 'healthy' : 'unhealthy',
                        running: kafkaCDCProducer.isHealthy(),
                        metrics: kafkaCDCProducer.getMetrics()
                    },
                    consumers: {
                        conversationAssembly: await conversationConsumer.healthCheck(),
                        mlProcessing: await mlConsumer.healthCheck(),
                        opensearchIndexing: await opensearchConsumer.healthCheck(),
                        errorHandler: await errorConsumer.healthCheck()
                    },
                    dependencies: {
                        oracle: {
                            status: await oracleService.healthCheck() ? 'healthy' : 'unhealthy',
                            connected: await oracleService.healthCheck()
                        },
                        opensearch: {
                            status: await openSearchService.healthCheck() ? 'healthy' : 'unhealthy',
                            connected: await openSearchService.healthCheck()
                        }
                    }
                }
            };

            // Determine overall health status
            const unhealthyServices = [];
            if (!healthStatus.services.kafkaProducer.connected) unhealthyServices.push('kafkaProducer');
            if (!healthStatus.services.kafkaCDCProducer.running) unhealthyServices.push('kafkaCDCProducer');
            if (healthStatus.services.consumers.conversationAssembly.status !== 'healthy') unhealthyServices.push('conversationAssembly');
            if (healthStatus.services.consumers.mlProcessing.status !== 'healthy') unhealthyServices.push('mlProcessing');
            if (healthStatus.services.consumers.opensearchIndexing.status !== 'healthy') unhealthyServices.push('opensearchIndexing');
            if (healthStatus.services.consumers.errorHandler.status !== 'healthy') unhealthyServices.push('errorHandler');
            if (!healthStatus.services.dependencies.oracle.connected) unhealthyServices.push('oracle');
            if (!healthStatus.services.dependencies.opensearch.connected) unhealthyServices.push('opensearch');

            if (unhealthyServices.length === 0) {
                healthStatus.overall = 'healthy';
            } else if (unhealthyServices.length <= 2) {
                healthStatus.overall = 'degraded';
            } else {
                healthStatus.overall = 'unhealthy';
            }

            const httpStatus = healthStatus.overall === 'healthy' ? 200 : 
                             healthStatus.overall === 'degraded' ? 200 : 503;

            logger.info('Kafka health status collected', {
                overall: healthStatus.overall,
                unhealthyServices: unhealthyServices.length,
                services: unhealthyServices
            });

            res.status(httpStatus).json(healthStatus);

        } catch (error) {
            logger.error('Failed to get Kafka health status', { error });
            res.status(500).json({
                timestamp: new Date().toISOString(),
                overall: 'unhealthy',
                error: 'Failed to collect health status',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get detailed metrics for all Kafka services
     */
    async getMetrics(req: Request, res: Response): Promise<void> {
        try {
            logger.info('Kafka metrics requested');

            const kafkaProducer = getKafkaProducer();
            const kafkaCDCProducer = getKafkaCDCProducer();
            const conversationConsumer = getConversationAssemblyConsumer();
            const mlConsumer = getMLProcessingConsumer();
            const opensearchConsumer = getOpenSearchIndexingConsumer();
            const errorConsumer = getErrorHandlerConsumer();

            const metrics = {
                timestamp: new Date().toISOString(),
                producer: kafkaProducer.getMetrics(),
                cdcProducer: kafkaCDCProducer.getMetrics(),
                consumers: {
                    conversationAssembly: conversationConsumer.getMetrics(),
                    mlProcessing: mlConsumer.getMetrics(),
                    opensearchIndexing: opensearchConsumer.getMetrics(),
                    errorHandler: errorConsumer.getMetrics()
                },
                aggregated: {
                    totalMessagesProduced: kafkaProducer.getMetrics().messagesSent + kafkaCDCProducer.getMetrics().kafkaPublished,
                    totalMessagesProcessed: 
                        conversationConsumer.getMetrics().messagesProcessed +
                        mlConsumer.getMetrics().messagesProcessed +
                        opensearchConsumer.getMetrics().messagesProcessed +
                        errorConsumer.getMetrics().messagesProcessed,
                    totalErrors: 
                        kafkaProducer.getMetrics().errors +
                        kafkaCDCProducer.getMetrics().errors +
                        conversationConsumer.getMetrics().messagesFailed +
                        mlConsumer.getMetrics().messagesFailed +
                        opensearchConsumer.getMetrics().messagesFailed +
                        errorConsumer.getMetrics().messagesFailed,
                    throughputMps: this.calculateThroughput([
                        conversationConsumer.getMetrics(),
                        mlConsumer.getMetrics(),
                        opensearchConsumer.getMetrics()
                    ])
                }
            };

            logger.debug('Kafka metrics collected', {
                totalProduced: metrics.aggregated.totalMessagesProduced,
                totalProcessed: metrics.aggregated.totalMessagesProcessed,
                totalErrors: metrics.aggregated.totalErrors
            });

            res.status(200).json(metrics);

        } catch (error) {
            logger.error('Failed to get Kafka metrics', { error });
            res.status(500).json({
                timestamp: new Date().toISOString(),
                error: 'Failed to collect Kafka metrics',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get consumer lag information for all topics
     */
    async getConsumerLag(req: Request, res: Response): Promise<void> {
        try {
            logger.info('Consumer lag information requested');

            const consumers = [
                { name: 'conversation-assembly', consumer: getConversationAssemblyConsumer() },
                { name: 'ml-processing', consumer: getMLProcessingConsumer() },
                { name: 'opensearch-indexing', consumer: getOpenSearchIndexingConsumer() },
                { name: 'error-handler', consumer: getErrorHandlerConsumer() }
            ];

            const lagInfo = {
                timestamp: new Date().toISOString(),
                consumers: {} as Record<string, any>
            };

            for (const { name, consumer } of consumers) {
                try {
                    const metrics = consumer.getMetrics();
                    lagInfo.consumers[name] = {
                        status: consumer.isHealthy() ? 'running' : 'stopped',
                        metrics: {
                            messagesProcessed: metrics.messagesProcessed,
                            messagesSucceeded: metrics.messagesSucceeded,
                            messagesFailed: metrics.messagesFailed,
                            processingRate: metrics.messagesProcessed > 0 ? 
                                metrics.messagesSucceeded / metrics.messagesProcessed : 0,
                            lastProcessedTime: (metrics as any).lastProcessedTime || null
                        }
                    };
                } catch (error) {
                    lagInfo.consumers[name] = {
                        status: 'error',
                        error: error instanceof Error ? error.message : String(error)
                    };
                }
            }

            logger.debug('Consumer lag info collected', {
                consumersCount: Object.keys(lagInfo.consumers).length
            });

            res.status(200).json(lagInfo);

        } catch (error) {
            logger.error('Failed to get consumer lag information', { error });
            res.status(500).json({
                timestamp: new Date().toISOString(),
                error: 'Failed to get consumer lag information',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get error summary and failed message statistics
     */
    async getErrorSummary(req: Request, res: Response): Promise<void> {
        try {
            logger.info('Error summary requested');

            const errorConsumer = getErrorHandlerConsumer();
            const errorSummary = await errorConsumer.getErrorSummary();

            const summary = {
                timestamp: new Date().toISOString(),
                errorHandling: errorSummary,
                producers: {
                    kafkaProducer: {
                        errors: getKafkaProducer().getMetrics().errors,
                        lastError: getKafkaProducer().getMetrics().lastError
                    },
                    cdcProducer: {
                        errors: getKafkaCDCProducer().getMetrics().errors,
                        lastError: getKafkaCDCProducer().getMetrics().lastError
                    }
                },
                consumers: {
                    conversationAssembly: {
                        messagesFailed: getConversationAssemblyConsumer().getMetrics().messagesFailed,
                        messagesDLQ: getConversationAssemblyConsumer().getMetrics().messagesDLQ
                    },
                    mlProcessing: {
                        messagesFailed: getMLProcessingConsumer().getMetrics().messagesFailed,
                        messagesDLQ: getMLProcessingConsumer().getMetrics().messagesDLQ
                    },
                    opensearchIndexing: {
                        messagesFailed: getOpenSearchIndexingConsumer().getMetrics().messagesFailed,
                        messagesDLQ: getOpenSearchIndexingConsumer().getMetrics().messagesDLQ
                    }
                }
            };

            logger.debug('Error summary collected', {
                totalErrors: errorSummary.totalErrors,
                permanentFailures: errorSummary.permanentFailures,
                recoveredRecords: errorSummary.recoveredRecords
            });

            res.status(200).json(summary);

        } catch (error) {
            logger.error('Failed to get error summary', { error });
            res.status(500).json({
                timestamp: new Date().toISOString(),
                error: 'Failed to get error summary',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Restart a specific consumer service
     */
    async restartConsumer(req: Request, res: Response): Promise<void> {
        try {
            const { consumerName } = req.params;
            logger.info('Consumer restart requested', { consumerName });

            let consumer;
            switch (consumerName) {
                case 'conversation-assembly':
                    consumer = getConversationAssemblyConsumer();
                    break;
                case 'ml-processing':
                    consumer = getMLProcessingConsumer();
                    break;
                case 'opensearch-indexing':
                    consumer = getOpenSearchIndexingConsumer();
                    break;
                case 'error-handler':
                    consumer = getErrorHandlerConsumer();
                    break;
                default:
                    res.status(400).json({
                        timestamp: new Date().toISOString(),
                        error: 'Invalid consumer name',
                        validConsumers: ['conversation-assembly', 'ml-processing', 'opensearch-indexing', 'error-handler']
                    });
                    return;
            }

            // Stop and restart the consumer
            await consumer.stop();
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            await consumer.start();

            logger.info('Consumer restarted successfully', { consumerName });

            res.status(200).json({
                timestamp: new Date().toISOString(),
                message: `Consumer ${consumerName} restarted successfully`,
                consumerName,
                status: 'restarted'
            });

        } catch (error) {
            logger.error('Failed to restart consumer', { 
                error, 
                consumerName: req.params.consumerName 
            });
            res.status(500).json({
                timestamp: new Date().toISOString(),
                error: 'Failed to restart consumer',
                consumerName: req.params.consumerName,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get pipeline status showing message flow through all stages
     */
    async getPipelineStatus(req: Request, res: Response): Promise<void> {
        try {
            logger.info('Pipeline status requested');

            const pipeline = {
                timestamp: new Date().toISOString(),
                stages: {
                    cdcIngestion: {
                        name: 'CDC Data Ingestion',
                        status: getKafkaCDCProducer().isHealthy() ? 'running' : 'stopped',
                        messagesSent: getKafkaCDCProducer().getMetrics().kafkaPublished,
                        errors: getKafkaCDCProducer().getMetrics().errors,
                        lastActivity: getKafkaCDCProducer().getMetrics().lastProcessedTime
                    },
                    conversationAssembly: {
                        name: 'Conversation Assembly',
                        status: getConversationAssemblyConsumer().isHealthy() ? 'running' : 'stopped',
                        messagesProcessed: getConversationAssemblyConsumer().getMetrics().messagesProcessed,
                        messagesSucceeded: getConversationAssemblyConsumer().getMetrics().messagesSucceeded,
                        messagesFailed: getConversationAssemblyConsumer().getMetrics().messagesFailed,
                        lastActivity: (getConversationAssemblyConsumer().getMetrics() as any).lastProcessedTime
                    },
                    mlProcessing: {
                        name: 'ML Analysis',
                        status: getMLProcessingConsumer().isHealthy() ? 'running' : 'stopped',
                        messagesProcessed: getMLProcessingConsumer().getMetrics().messagesProcessed,
                        messagesSucceeded: getMLProcessingConsumer().getMetrics().messagesSucceeded,
                        messagesFailed: getMLProcessingConsumer().getMetrics().messagesFailed,
                        lastActivity: (getMLProcessingConsumer().getMetrics() as any).lastProcessedTime
                    },
                    opensearchIndexing: {
                        name: 'OpenSearch Indexing',
                        status: getOpenSearchIndexingConsumer().isHealthy() ? 'running' : 'stopped',
                        messagesProcessed: getOpenSearchIndexingConsumer().getMetrics().messagesProcessed,
                        messagesSucceeded: getOpenSearchIndexingConsumer().getMetrics().messagesSucceeded,
                        messagesFailed: getOpenSearchIndexingConsumer().getMetrics().messagesFailed,
                        lastActivity: (getOpenSearchIndexingConsumer().getMetrics() as any).lastProcessedTime
                    },
                    errorHandling: {
                        name: 'Error Recovery',
                        status: getErrorHandlerConsumer().isHealthy() ? 'running' : 'stopped',
                        messagesProcessed: getErrorHandlerConsumer().getMetrics().messagesProcessed,
                        recoveredRecords: getErrorHandlerConsumer().getMetrics().recoveredRecords || 0,
                        permanentFailures: getErrorHandlerConsumer().getMetrics().permanentFailures || 0
                    }
                }
            };

            // Determine overall pipeline health
            const stageStatuses = Object.values(pipeline.stages).map(stage => stage.status);
            const runningStages = stageStatuses.filter(status => status === 'running').length;
            const totalStages = stageStatuses.length;

            const pipelineHealth = {
                ...pipeline,
                overview: {
                    totalStages,
                    runningStages,
                    stoppedStages: totalStages - runningStages,
                    healthScore: (runningStages / totalStages) * 100,
                    overallStatus: runningStages === totalStages ? 'healthy' : 
                                  runningStages >= totalStages * 0.7 ? 'degraded' : 'unhealthy'
                }
            };

            logger.debug('Pipeline status collected', {
                overallStatus: pipelineHealth.overview.overallStatus,
                healthScore: pipelineHealth.overview.healthScore,
                runningStages: runningStages,
                totalStages: totalStages
            });

            res.status(200).json(pipelineHealth);

        } catch (error) {
            logger.error('Failed to get pipeline status', { error });
            res.status(500).json({
                timestamp: new Date().toISOString(),
                error: 'Failed to get pipeline status',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Calculate throughput (messages per second) from consumer metrics
     */
    private calculateThroughput(consumerMetrics: any[]): number {
        const totalMessages = consumerMetrics.reduce((sum, metrics) => sum + (metrics.messagesProcessed || 0), 0);
        const totalUptime = process.uptime(); // Server uptime in seconds
        
        return totalUptime > 0 ? Math.round((totalMessages / totalUptime) * 100) / 100 : 0;
    }
}

export const kafkaMonitoringController = new KafkaMonitoringController();