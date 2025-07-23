import { logger } from '../utils/logger';
import { oracleService } from './oracle.service';
import { batchProcessorService } from './batch-processor.service';
import { redisService } from './redis.service';
import { CustomerContext } from '../types/customer';
import { EventEmitter } from 'events';

export interface RealTimeProcessingConfig {
  enabled: boolean;
  pollingInterval: number; // milliseconds
  maxRetries: number;
  retryDelay: number;
  batchSize: number;
  processingDelay: number; // delay before processing new calls
}

export interface CallChangeEvent {
  callId: string;
  customerId: string;
  subscriberId: string;
  changeType: 'INSERT' | 'UPDATE' | 'DELETE';
  timestamp: Date;
  data?: any;
}

export class RealTimeProcessorService extends EventEmitter {
  private config: RealTimeProcessingConfig;
  private isPolling = false;
  private pollingTimer?: NodeJS.Timeout;
  private lastProcessedTimestamp: Date;
  private processingStats = {
    totalEventsProcessed: 0,
    successfulProcessing: 0,
    failedProcessing: 0,
    lastProcessingTime: new Date()
  };

  constructor() {
    super();
    this.config = {
      enabled: process.env.REALTIME_PROCESSING_ENABLED === 'true',
      pollingInterval: parseInt(process.env.REALTIME_POLLING_INTERVAL || '30000'), // 30 seconds
      maxRetries: parseInt(process.env.REALTIME_MAX_RETRIES || '3'),
      retryDelay: parseInt(process.env.REALTIME_RETRY_DELAY || '5000'),
      batchSize: parseInt(process.env.REALTIME_BATCH_SIZE || '10'),
      processingDelay: parseInt(process.env.REALTIME_PROCESSING_DELAY || '60000') // 1 minute delay
    };

    // Initialize last processed timestamp
    this.lastProcessedTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    logger.info('Real-time processor initialized', {
      enabled: this.config.enabled,
      pollingInterval: this.config.pollingInterval
    });
  }

  async startRealTimeProcessing(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Real-time processing is disabled');
      return;
    }

    if (this.isPolling) {
      logger.warn('Real-time processing is already running');
      return;
    }

    this.isPolling = true;
    logger.info('Starting real-time call processing');

    // Setup Oracle triggers for CDC
    await this.setupOracleTriggers();

    // Start polling for changes
    this.startPolling();

    // Setup event listeners
    this.setupEventListeners();
  }

  async stopRealTimeProcessing(): Promise<void> {
    if (!this.isPolling) {
      return;
    }

    this.isPolling = false;
    
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }

    logger.info('Real-time call processing stopped');
  }

  private async setupOracleTriggers(): Promise<void> {
    try {
      logger.info('Setting up Oracle CDC triggers');

      // Create change log table
      const createChangeLogSQL = `
        CREATE TABLE IF NOT EXISTS VERINT_CHANGE_LOG (
          CHANGE_ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          CALL_ID NUMBER(20) NOT NULL,
          BAN NUMBER(10) NOT NULL,
          SUBSCRIBER_NO VARCHAR2(20),
          CHANGE_TYPE VARCHAR2(10) NOT NULL,
          CHANGE_TIMESTAMP TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PROCESSED NUMBER(1) DEFAULT 0,
          RETRY_COUNT NUMBER(2) DEFAULT 0,
          ERROR_MESSAGE CLOB
        )
      `;

      await oracleService.executeQuery(createChangeLogSQL);

      // Create trigger for INSERT operations
      const createInsertTriggerSQL = `
        CREATE OR REPLACE TRIGGER TRG_VERINT_INSERT_CDC
        AFTER INSERT ON VERINT_TEXT_ANALYSIS
        FOR EACH ROW
        DECLARE
          call_complete NUMBER;
        BEGIN
          -- Check if this completes a call (has both customer and agent messages)
          SELECT COUNT(DISTINCT OWNER) INTO call_complete
          FROM VERINT_TEXT_ANALYSIS 
          WHERE CALL_ID = :NEW.CALL_ID AND BAN = :NEW.BAN;
          
          -- Only log when we have a complete conversation
          IF call_complete >= 2 THEN
            INSERT INTO VERINT_CHANGE_LOG (
              CALL_ID, BAN, SUBSCRIBER_NO, CHANGE_TYPE
            ) VALUES (
              :NEW.CALL_ID, :NEW.BAN, :NEW.SUBSCRIBER_NO, 'INSERT'
            );
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            -- Log errors but don't fail the original transaction
            NULL;
        END;
      `;

      await oracleService.executeQuery(createInsertTriggerSQL);

      // Create trigger for UPDATE operations
      const createUpdateTriggerSQL = `
        CREATE OR REPLACE TRIGGER TRG_VERINT_UPDATE_CDC
        AFTER UPDATE ON VERINT_TEXT_ANALYSIS
        FOR EACH ROW
        BEGIN
          INSERT INTO VERINT_CHANGE_LOG (
            CALL_ID, BAN, SUBSCRIBER_NO, CHANGE_TYPE
          ) VALUES (
            :NEW.CALL_ID, :NEW.BAN, :NEW.SUBSCRIBER_NO, 'UPDATE'
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
      `;

      await oracleService.executeQuery(createUpdateTriggerSQL);

      // Create index for performance
      const createIndexSQL = `
        CREATE INDEX IF NOT EXISTS IDX_VERINT_CHANGE_LOG_PROCESSED 
        ON VERINT_CHANGE_LOG(PROCESSED, CHANGE_TIMESTAMP)
      `;

      await oracleService.executeQuery(createIndexSQL);

      logger.info('Oracle CDC triggers setup completed');
    } catch (error) {
      logger.error('Failed to setup Oracle triggers:', error);
      throw error;
    }
  }

  private startPolling(): void {
    const poll = async () => {
      if (!this.isPolling) {
        return;
      }

      try {
        await this.pollForChanges();
      } catch (error) {
        logger.error('Polling error:', error);
      }

      // Schedule next poll
      this.pollingTimer = setTimeout(poll, this.config.pollingInterval);
    };

    // Start first poll
    poll();
  }

  private async pollForChanges(): Promise<void> {
    try {
      // Get unprocessed changes
      const changes = await this.getUnprocessedChanges();

      if (changes.length === 0) {
        logger.debug('No new changes to process');
        return;
      }

      logger.info(`Found ${changes.length} unprocessed changes`);

      // Process changes in batches
      const batches = this.createBatches(changes, this.config.batchSize);
      
      for (const batch of batches) {
        await this.processBatch(batch);
      }

      this.processingStats.lastProcessingTime = new Date();
    } catch (error) {
      logger.error('Error polling for changes:', error);
    }
  }

  private async getUnprocessedChanges(): Promise<CallChangeEvent[]> {
    const sql = `
      SELECT 
        CHANGE_ID,
        CALL_ID,
        BAN as CUSTOMER_ID,
        SUBSCRIBER_NO,
        CHANGE_TYPE,
        CHANGE_TIMESTAMP,
        RETRY_COUNT
      FROM VERINT_CHANGE_LOG
      WHERE PROCESSED = 0
      AND CHANGE_TIMESTAMP <= SYSTIMESTAMP - INTERVAL '${this.config.processingDelay / 1000}' SECOND
      AND RETRY_COUNT < :maxRetries
      ORDER BY CHANGE_TIMESTAMP ASC
      FETCH NEXT :batchSize ROWS ONLY
    `;

    const results = await oracleService.executeQuery(sql, {
      maxRetries: this.config.maxRetries,
      batchSize: this.config.batchSize * 2 // Get a bit more for batching
    });

    return results.map(row => ({
      callId: row.CALL_ID.toString(),
      customerId: row.CUSTOMER_ID.toString(),
      subscriberId: row.SUBSCRIBER_NO,
      changeType: row.CHANGE_TYPE as 'INSERT' | 'UPDATE' | 'DELETE',
      timestamp: new Date(row.CHANGE_TIMESTAMP),
      data: {
        changeId: row.CHANGE_ID,
        retryCount: row.RETRY_COUNT
      }
    }));
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async processBatch(changes: CallChangeEvent[]): Promise<void> {
    const processingPromises = changes.map(change => this.processChange(change));
    await Promise.allSettled(processingPromises);
  }

  private async processChange(change: CallChangeEvent): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.debug(`Processing change for call ${change.callId}`, change);

      // Create customer context
      const customerContext: CustomerContext = {
        customerId: change.customerId,
        subscriberIds: [change.subscriberId]
      };

      // Check if call needs processing (not already processed)
      const needsProcessing = await this.checkIfNeedsProcessing(change.callId, customerContext);
      
      if (!needsProcessing) {
        logger.debug(`Call ${change.callId} already processed, skipping`);
        await this.markChangeAsProcessed(change.data.changeId, 'Already processed');
        return;
      }

      // Add to processing queue
      batchProcessorService.addToProcessingQueue(change.callId);

      // Process immediately if it's a high-priority change
      if (change.changeType === 'INSERT') {
        await this.processCallImmediate(change.callId, customerContext);
      }

      // Mark as processed
      await this.markChangeAsProcessed(change.data.changeId);

      this.processingStats.successfulProcessing++;
      this.processingStats.totalEventsProcessed++;

      // Emit event for listeners
      this.emit('callProcessed', {
        callId: change.callId,
        customerId: change.customerId,
        processingTime: Date.now() - startTime
      });

      logger.debug(`Successfully processed change for call ${change.callId}`);

    } catch (error) {
      logger.error(`Failed to process change for call ${change.callId}:`, error);
      
      // Update retry count
      await this.incrementRetryCount(
        change.data.changeId, 
        error instanceof Error ? error.message : 'Unknown error'
      );

      this.processingStats.failedProcessing++;
      this.processingStats.totalEventsProcessed++;

      // Emit error event
      this.emit('processingError', {
        callId: change.callId,
        customerId: change.customerId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async checkIfNeedsProcessing(callId: string, customerContext: CustomerContext): Promise<boolean> {
    const sql = `
      SELECT COUNT(*) as processed_count
      FROM CALL_AI_METADATA
      WHERE CALL_ID = :callId AND CUSTOMER_ID = :customerId
    `;

    const results = await oracleService.executeQuery(sql, {
      callId,
      customerId: customerContext.customerId
    });

    return results[0]?.PROCESSED_COUNT === 0;
  }

  private async processCallImmediate(callId: string, customerContext: CustomerContext): Promise<void> {
    try {
      // Process the call immediately using batch processor
      await batchProcessorService.processQueuedCalls(customerContext);
      
      logger.info(`Immediate processing completed for call ${callId}`);
    } catch (error) {
      logger.error(`Immediate processing failed for call ${callId}:`, error);
      throw error;
    }
  }

  private async markChangeAsProcessed(changeId: number, message?: string): Promise<void> {
    const sql = `
      UPDATE VERINT_CHANGE_LOG 
      SET PROCESSED = 1, ERROR_MESSAGE = :message
      WHERE CHANGE_ID = :changeId
    `;

    await oracleService.executeQuery(sql, {
      changeId,
      message: message || null
    });
  }

  private async incrementRetryCount(changeId: number, errorMessage: string): Promise<void> {
    const sql = `
      UPDATE VERINT_CHANGE_LOG 
      SET RETRY_COUNT = RETRY_COUNT + 1, ERROR_MESSAGE = :errorMessage
      WHERE CHANGE_ID = :changeId
    `;

    await oracleService.executeQuery(sql, {
      changeId,
      errorMessage
    });
  }

  private setupEventListeners(): void {
    // Listen for Redis notifications (if using Redis for coordination)
    this.on('callProcessed', (event) => {
      logger.debug('Call processed event:', event);
      
      // Cache processing result
      redisService.setex(
        `processed:${event.callId}`,
        3600, // 1 hour TTL
        JSON.stringify({
          callId: event.callId,
          customerId: event.customerId,
          processedAt: new Date(),
          processingTime: event.processingTime
        })
      );
    });

    this.on('processingError', (event) => {
      logger.error('Processing error event:', event);
      
      // Could send alerts, notifications, etc.
    });
  }

  // Public monitoring methods
  getProcessingStats(): any {
    return {
      ...this.processingStats,
      isRunning: this.isPolling,
      config: this.config,
      uptime: Date.now() - this.processingStats.lastProcessingTime.getTime()
    };
  }

  async getChangeLogStatus(): Promise<any> {
    const sql = `
      SELECT 
        CHANGE_TYPE,
        PROCESSED,
        COUNT(*) as count,
        AVG(RETRY_COUNT) as avg_retries,
        MIN(CHANGE_TIMESTAMP) as oldest_change,
        MAX(CHANGE_TIMESTAMP) as newest_change
      FROM VERINT_CHANGE_LOG
      WHERE CHANGE_TIMESTAMP > SYSDATE - 1  -- Last 24 hours
      GROUP BY CHANGE_TYPE, PROCESSED
      ORDER BY CHANGE_TYPE, PROCESSED
    `;

    return await oracleService.executeQuery(sql);
  }

  // Manual trigger for processing specific calls
  async triggerCallProcessing(callId: string, customerId: string): Promise<void> {
    const customerContext: CustomerContext = {
      customerId,
      subscriberIds: []
    };

    batchProcessorService.addToProcessingQueue(callId);
    await batchProcessorService.processQueuedCalls(customerContext);
  }

  // Cleanup old change log entries
  async cleanupOldChanges(olderThanDays: number = 7): Promise<number> {
    const sql = `
      DELETE FROM VERINT_CHANGE_LOG
      WHERE CHANGE_TIMESTAMP < SYSDATE - :days
      AND PROCESSED = 1
    `;

    const result = await oracleService.executeQuery(sql, { days: olderThanDays });
    
    // Oracle executeQuery returns rows array, not result with rowsAffected
    const deletedCount = Array.isArray(result) ? result.length : 0;
    logger.info(`Cleaned up old change log entries: ${deletedCount} rows deleted`);
    return deletedCount;
  }
}

export const realTimeProcessorService = new RealTimeProcessorService();