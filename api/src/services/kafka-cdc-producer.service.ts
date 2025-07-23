import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { oracleService } from './oracle.service';
import { getKafkaProducer } from './kafka-producer.service';
import { CDCChangeEvent, createCDCChangeEvent, createProcessingMetric } from '../types/kafka-messages';

interface CDCMode {
    normal: boolean;
    historical: boolean;
}

interface CDCConfig {
    pollingInterval: number;
    batchSize: number;
    normalModeLookback: number; // hours
    historicalModeDate?: string;
    enableKafka: boolean;
}

export class KafkaCDCProducerService extends EventEmitter {
    private isRunning: boolean = false;
    private pollingTimer?: NodeJS.Timeout;
    private mode: CDCMode = { normal: true, historical: false };
    private config: CDCConfig;
    private metrics = {
        changesProcessed: 0,
        batchesProcessed: 0,
        lastProcessedTime: new Date(),
        errors: 0,
        kafkaPublished: 0,
        lastError: null as string | null
    };

    constructor() {
        super();
        
        this.config = {
            pollingInterval: parseInt(process.env.CDC_POLLING_INTERVAL || '5000'),
            batchSize: parseInt(process.env.CDC_BATCH_SIZE || '100'),
            normalModeLookback: parseInt(process.env.CDC_NORMAL_LOOKBACK_HOURS || '24'),
            historicalModeDate: process.env.CDC_HISTORICAL_MODE_DATE,
            enableKafka: process.env.ENABLE_KAFKA_CDC === 'true'
        };

        // Check CDC mode from database on startup
        this.checkCDCMode();
    }

    private async checkCDCMode(): Promise<void> {
        try {
            // Use the existing CDC_PROCESSING_STATUS table
            const result = await oracleService.executeQuery(
                `SELECT TABLE_NAME, TOTAL_PROCESSED, LAST_PROCESSED_TIMESTAMP 
                 FROM CDC_PROCESSING_STATUS 
                 WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE')`,
                {}
            );

            if (result?.length > 0) {
                for (const row of result) {
                    const tableName = row[0];
                    const isEnabled = row[1] === 1;
                    const lastTimestamp = row[2];

                    if (tableName === 'CDC_NORMAL_MODE') {
                        this.mode.normal = true; // Normal mode is always enabled
                    } else if (tableName === 'CDC_HISTORICAL_MODE') {
                        this.mode.historical = isEnabled;
                        if (isEnabled && lastTimestamp) {
                            this.config.historicalModeDate = lastTimestamp.toISOString().split('T')[0];
                        }
                    }
                }
            }

            logger.info('Kafka CDC mode configuration', { 
                mode: this.mode, 
                historicalDate: this.config.historicalModeDate 
            });
        } catch (error) {
            logger.warn('CDC_PROCESSING_STATUS table not found, using default mode', { error: error.message });
            // Use default mode when table doesn't exist
            this.mode.normal = true;
            this.mode.historical = false;
            logger.info('Using default CDC mode configuration', { 
                mode: this.mode, 
                historicalDate: this.config.historicalModeDate 
            });
        }
    }

    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('Kafka CDC producer is already running');
            return;
        }

        if (!this.config.enableKafka) {
            logger.info('Kafka CDC producer is disabled');
            return;
        }

        try {
            logger.info('Starting Kafka CDC producer service', { config: this.config });

            // Connect to Kafka
            const kafkaProducer = getKafkaProducer();
            await kafkaProducer.connect();

            this.isRunning = true;
            this.emit('started');

            // Start polling
            await this.poll();

        } catch (error) {
            logger.error('Failed to start Kafka CDC producer', { error });
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }

    async stop(): Promise<void> {
        logger.info('Stopping Kafka CDC producer service');
        
        this.isRunning = false;
        
        if (this.pollingTimer) {
            clearTimeout(this.pollingTimer);
            this.pollingTimer = undefined;
        }

        this.emit('stopped');
        logger.info('Kafka CDC producer stopped');
    }

    private async poll(): Promise<void> {
        if (!this.isRunning) return;

        try {
            // Process both normal and historical modes if enabled
            const promises: Promise<void>[] = [];

            if (this.mode.normal) {
                promises.push(this.processNormalMode());
            }

            if (this.mode.historical) {
                promises.push(this.processHistoricalMode());
            }

            await Promise.all(promises);

        } catch (error) {
            logger.error('Error in Kafka CDC polling cycle', { error });
            this.metrics.errors++;
            this.metrics.lastError = error instanceof Error ? error.message : String(error);
            this.emit('error', error);
        } finally {
            // Schedule next poll
            if (this.isRunning) {
                this.pollingTimer = setTimeout(() => this.poll(), this.config.pollingInterval);
            }
        }
    }

    private async processNormalMode(): Promise<void> {
        try {
            const lookbackTime = new Date();
            lookbackTime.setHours(lookbackTime.getHours() - this.config.normalModeLookback);

            const changes = await this.getRecentChanges(lookbackTime);
            
            if (changes.length > 0) {
                logger.info(`Processing ${changes.length} changes in normal mode`);
                await this.publishChangesToKafka(changes, 'normal');
                await this.updateLastProcessedTimestamp('NORMAL', new Date());
            }

        } catch (error) {
            logger.error('Error processing normal mode CDC', { error });
            throw error;
        }
    }

    private async processHistoricalMode(): Promise<void> {
        try {
            if (!this.config.historicalModeDate) {
                logger.warn('Historical mode enabled but no date configured');
                return;
            }

            const historicalDate = new Date(this.config.historicalModeDate);
            const changes = await this.getHistoricalChanges(historicalDate);

            if (changes.length > 0) {
                logger.info(`Processing ${changes.length} changes in historical mode`);
                await this.publishChangesToKafka(changes, 'historical');
                
                // Update the last processed timestamp for historical mode
                const lastChange = changes[changes.length - 1];
                await this.updateLastProcessedTimestamp('HISTORICAL', lastChange.data.textTime);
            } else {
                // No more historical data, disable historical mode
                logger.info('No more historical data to process, disabling historical mode');
                await this.disableHistoricalMode();
                this.mode.historical = false;
            }

        } catch (error) {
            logger.error('Error processing historical mode CDC', { error });
            throw error;
        }
    }

    private async getRecentChanges(sinceTime: Date): Promise<CDCChangeEvent[]> {
        const query = `
            SELECT 
                cl.CHANGE_ID,
                cl.CHANGE_TYPE,
                TO_CHAR(cl.CALL_ID) as CALL_ID,
                vta.BAN,
                vta.SUBSCRIBER_NO,
                vta.OWNER,
                vta.TEXT,
                vta.TEXT_TIME,
                vta.CALL_TIME,
                cl.CHANGE_TIMESTAMP
            FROM VERINT_CHANGE_LOG cl
            JOIN VERINT_TEXT_ANALYSIS vta ON cl.CALL_ID = vta.CALL_ID
            WHERE cl.PROCESSED = 0
            AND cl.CHANGE_TIMESTAMP > :sinceTime
            ORDER BY cl.CHANGE_TIMESTAMP
            FETCH FIRST :batchSize ROWS ONLY
        `;

        const result = await oracleService.executeQuery(query, {
            sinceTime,
            batchSize: this.config.batchSize
        });

        return this.transformToChangeEvents(result || []);
    }

    private async getHistoricalChanges(sinceDate: Date): Promise<CDCChangeEvent[]> {
        const query = `
            SELECT 
                NULL as CHANGE_ID,
                'INSERT' as CHANGE_TYPE,
                TO_CHAR(CALL_ID) as CALL_ID,
                BAN,
                SUBSCRIBER_NO,
                OWNER,
                TEXT,
                TEXT_TIME,
                CALL_TIME,
                TEXT_TIME as CHANGE_TIMESTAMP
            FROM VERINT_TEXT_ANALYSIS
            WHERE TEXT_TIME > :sinceDate
            AND TEXT_TIME < :endDate
            ORDER BY TEXT_TIME
            FETCH FIRST :batchSize ROWS ONLY
        `;

        // Process historical data up to 1 day ago to avoid conflicts with normal mode
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - 1);

        const result = await oracleService.executeQuery(query, {
            sinceDate,
            endDate,
            batchSize: this.config.batchSize
        });

        return this.transformToChangeEvents(result || []);
    }

    private transformToChangeEvents(rows: any[]): CDCChangeEvent[] {
        return rows.map(row => {
            // Oracle returns objects, not arrays
            const changeId = row.CHANGE_ID;
            const changeType = row.CHANGE_TYPE;
            const callId = row.CALL_ID; // Already string from TO_CHAR in SQL
            const ban = row.BAN;
            const subscriberNo = row.SUBSCRIBER_NO;
            const owner = row.OWNER;
            const text = row.TEXT;
            const textTime = row.TEXT_TIME;
            const callTime = row.CALL_TIME;
            const changeTimestamp = row.CHANGE_TIMESTAMP;

            return createCDCChangeEvent(
                callId,
                changeType as CDCChangeEvent['changeType'],
                {
                    ban,
                    subscriberNo,
                    owner,
                    text,
                    textTime: new Date(textTime),
                    callTime: new Date(callTime),
                    changeLogId: changeId,
                    processingTimestamp: new Date()
                }
            );
        });
    }

    private async publishChangesToKafka(
        changes: CDCChangeEvent[], 
        mode: 'normal' | 'historical'
    ): Promise<void> {
        const kafkaProducer = getKafkaProducer();
        const startTime = Date.now();

        try {
            // Send changes in batches for better performance
            const batchSize = 50;
            for (let i = 0; i < changes.length; i += batchSize) {
                const batch = changes.slice(i, i + batchSize);
                
                const messages = batch.map(change => ({
                    key: String(change.callId), // Ensure key is always string for Kafka
                    message: {
                        ...change,
                        metadata: {
                            ...change.metadata,
                            cdcMode: mode,
                            processingNode: process.env.HOSTNAME || 'unknown'
                        }
                    }
                }));

                await kafkaProducer.sendBatch(
                    process.env.KAFKA_TOPIC_CDC_RAW_CHANGES || 'cdc-raw-changes',
                    messages
                );
            }

            // Mark changes as processed in Oracle (only for normal mode)
            if (mode === 'normal') {
                await this.markChangesAsProcessed(changes);
            }

            // Update metrics
            this.metrics.changesProcessed += changes.length;
            this.metrics.kafkaPublished += changes.length;
            this.metrics.batchesProcessed++;
            this.metrics.lastProcessedTime = new Date();

            // Send processing metric
            await kafkaProducer.sendProcessingMetric(
                createProcessingMetric(
                    'kafka-cdc-producer',
                    'cdc-raw-changes',
                    0, // partition will be assigned by Kafka
                    '0', // offset not known yet
                    'success',
                    Date.now() - startTime
                )
            );

            logger.info(`Published ${changes.length} CDC changes to Kafka`, { 
                mode, 
                processingTimeMs: Date.now() - startTime 
            });

        } catch (error) {
            logger.error('Failed to publish changes to Kafka', { error, changeCount: changes.length });
            throw error;
        }
    }

    private async markChangesAsProcessed(changes: CDCChangeEvent[]): Promise<void> {
        if (changes.length === 0) return;

        const changeIds = changes
            .map(c => c.data.changeLogId)
            .filter(id => id !== undefined);

        if (changeIds.length === 0) return;

        const placeholders = changeIds.map((_, i) => `:id${i}`).join(',');
        const binds = changeIds.reduce((acc, id, i) => {
            acc[`id${i}`] = id;
            return acc;
        }, {} as Record<string, any>);

        await oracleService.executeQuery(
            `UPDATE VERINT_CHANGE_LOG 
             SET PROCESSED = 1 
             WHERE CHANGE_ID IN (${placeholders})`,
            binds
        );
    }

    private async updateLastProcessedTimestamp(mode: string, timestamp: Date): Promise<void> {
        // Use the existing CDC_PROCESSING_STATUS table instead of CDC_CONFIGURATION
        const tableName = mode === 'NORMAL' ? 'CDC_NORMAL_MODE' : 'CDC_HISTORICAL_MODE';
        
        try {
            await oracleService.executeQuery(
                `UPDATE CDC_PROCESSING_STATUS 
                 SET LAST_PROCESSED_TIMESTAMP = :timestamp, LAST_UPDATED = CURRENT_TIMESTAMP
                 WHERE TABLE_NAME = :tableName`,
                { timestamp, tableName }
            );
        } catch (error) {
            // If table doesn't exist, just log and continue
            logger.warn(`Failed to update CDC timestamp for ${mode} mode`, { error: error.message });
        }
    }

    private async disableHistoricalMode(): Promise<void> {
        try {
            await oracleService.executeQuery(
                `UPDATE CDC_PROCESSING_STATUS 
                 SET TOTAL_PROCESSED = 0, LAST_UPDATED = CURRENT_TIMESTAMP 
                 WHERE TABLE_NAME = 'CDC_HISTORICAL_MODE'`
            );
        } catch (error) {
            // If table doesn't exist, just log and continue
            logger.warn('Failed to disable historical mode', { error: error.message });
        }
    }

    getMetrics() {
        return { ...this.metrics };
    }

    isHealthy(): boolean {
        return this.isRunning && this.config.enableKafka;
    }

    async healthCheck(): Promise<{
        status: string;
        metrics: typeof this.metrics;
        mode: CDCMode;
        config: CDCConfig;
    }> {
        const kafkaProducer = getKafkaProducer();
        const kafkaHealth = await kafkaProducer.healthCheck();

        return {
            status: this.isHealthy() && kafkaHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
            metrics: this.getMetrics(),
            mode: this.mode,
            config: this.config
        };
    }
}

// Singleton instance
let kafkaCDCProducerInstance: KafkaCDCProducerService | null = null;

export const getKafkaCDCProducer = (): KafkaCDCProducerService => {
    if (!kafkaCDCProducerInstance) {
        kafkaCDCProducerInstance = new KafkaCDCProducerService();
    }
    return kafkaCDCProducerInstance;
};

export default KafkaCDCProducerService;