import { logger } from '../utils/logger';
import { oracleService } from './oracle.service';
import { mcpClientService } from './mcp-client.service';
import { openSearchService } from './opensearch.service';
import { getKafkaProducer } from './kafka-producer.service';
import { ConversationAssembly, ConversationMessage } from '../types/kafka-messages';
import { EventEmitter } from 'events';
import oracledb from 'oracledb';

export interface CDCChangeRecord {
  changeId: number;
  callId: string;
  customerId: string;
  changeType: 'INSERT' | 'UPDATE' | 'DELETE';
  changeTimestamp: Date;
  ban: string;
  subscriberNo: string;
  callTime: Date;
  textTime: Date;
  owner: string;
  text: string;
}

export interface CDCProcessingResult {
  changeId: number;
  callId: string;
  success: boolean;
  processingTime: number;
  error?: string;
  results?: {
    embeddingGenerated?: boolean;
    vectorStored?: boolean;
    summaryGenerated?: boolean;
    entitiesExtracted?: boolean;
    sentimentAnalyzed?: boolean;
    openSearchIndexed?: boolean;
  };
}

export class RealtimeCDCService extends EventEmitter {
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxConcurrentProcessing: number;
  
  // Automatic Infinite Loop Prevention
  private lastProcessedCallIds = new Set<string>();
  private lastProcessingCycle: { callIds: string[], timestamp: Date } | null = null;
  private consecutiveSameCycles = 0;
  private readonly MAX_CONSECUTIVE_SAME_CYCLES = 3;
  private circuitBreakerTripped = false;

  constructor() {
    super();
    this.pollIntervalMs = parseInt(process.env.CDC_POLL_INTERVAL_MS || '2000'); // 2 seconds - faster
    this.batchSize = parseInt(process.env.CDC_BATCH_SIZE || '50'); // 50 calls per batch
    this.maxConcurrentProcessing = parseInt(process.env.CDC_MAX_CONCURRENT || '10'); // 10 concurrent
  }

  /**
   * Start the CDC monitoring service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('CDC service is already running');
      return;
    }

    logger.info('Starting Real-time CDC Service', {
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize,
      maxConcurrentProcessing: this.maxConcurrentProcessing
    });

    this.isRunning = true;
    this.processingInterval = setInterval(
      () => this.processChanges(),
      this.pollIntervalMs
    );

    this.emit('started');
  }

  /**
   * Stop the CDC monitoring service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('CDC service is not running');
      return;
    }

    logger.info('Stopping Real-time CDC Service');

    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    this.emit('stopped');
  }

  /**
   * Get CDC service status
   */
  getStatus(): {
    isRunning: boolean;
    pollIntervalMs: number;
    batchSize: number;
    maxConcurrentProcessing: number;
  } {
    return {
      isRunning: this.isRunning,
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize,
      maxConcurrentProcessing: this.maxConcurrentProcessing
    };
  }

  /**
   * Process pending changes from CDC log
   */
  private async processChanges(): Promise<void> {
    if (!this.isRunning) {
      logger.debug('🛑 CDC not running, skipping...');
      return;
    }

    // Check if circuit breaker is tripped
    if (this.circuitBreakerTripped) {
      logger.warn('🚨 CDC Circuit Breaker TRIPPED - infinite loop detected, CDC disabled');
      await this.autoDisableCDCModes();
      return;
    }

    try {
      logger.info('🔄 CDC checking for pending changes...');
      const startTime = Date.now();
      
      const pendingChanges = await this.getPendingChanges();
      const queryTime = Date.now() - startTime;
      
      logger.info(`✅ Found ${pendingChanges.length} pending changes (query took ${queryTime}ms)`);
      
      if (pendingChanges.length === 0) {
        logger.info('⏸️  No pending changes, waiting for next cycle...');
        this.resetInfiniteLoopDetection();
        return;
      }

      // AUTOMATIC INFINITE LOOP DETECTION
      const currentCallIds = pendingChanges.map(c => c.callId).sort();
      const currentCycle = { callIds: currentCallIds, timestamp: new Date() };
      
      if (this.detectInfiniteLoop(currentCycle)) {
        logger.error('🚨 INFINITE LOOP DETECTED - Same call IDs processed repeatedly!', {
          callIds: currentCallIds,
          consecutiveSameCycles: this.consecutiveSameCycles
        });
        
        this.circuitBreakerTripped = true;
        await this.autoDisableCDCModes();
        return;
      }

      this.lastProcessingCycle = currentCycle;
      logger.info(`🚀 Processing ${pendingChanges.length} CDC changes`);

      // Process changes in batches with limited concurrency
      const processingPromises = pendingChanges.map(change => 
        this.processChange(change)
      );

      const results = await Promise.allSettled(processingPromises);
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logger.info(`CDC batch processed: ${successful} successful, ${failed} failed`);

      this.emit('batch-processed', {
        total: pendingChanges.length,
        successful,
        failed,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('❌ Error in CDC processing cycle:', error);
      this.emit('error', error);
    }
  }

  /**
   * Get pending changes from Oracle using incremental timestamp-based approach
   */
  private async getPendingChanges(): Promise<CDCChangeRecord[]> {
    logger.info('📡 Getting Oracle connection for CDC...');
    const connection = await oracleService.getConnection();
    logger.info('✅ Oracle connection established');
    
    try {
      logger.info('🔧 Ensuring CDC tracking table exists...');
      try {
        await this.ensureCDCTrackingTable(connection);
        logger.info('✅ CDC tracking table setup SUCCESS');
      } catch (trackingError) {
        logger.error('❌ TRACKING TABLE ERROR:', trackingError);
        throw trackingError;
      }

      logger.info('📅 Getting CDC mode timestamps...');
      let normalModeTimestamp: Date;
      let historicalModeTimestamp: Date;
      let normalModeEnabled: boolean = false;
      let historicalModeEnabled: boolean = false;
      
      try {
        const cdcModesResult = await connection.execute(`
          SELECT TABLE_NAME as CDC_MODE, 
                 LAST_PROCESSED_TIMESTAMP, 
                 TOTAL_PROCESSED as IS_ENABLED
          FROM CDC_PROCESSING_STATUS 
          WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE')
          ORDER BY TABLE_NAME
        `, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        logger.info(`📅 CDC modes query result: ${JSON.stringify(cdcModesResult)}`);
        logger.info(`📅 Found ${cdcModesResult.rows?.length} CDC modes`);
        
        if (!cdcModesResult.rows || cdcModesResult.rows.length === 0) {
          throw new Error('No CDC mode records found');
        }
        
        // Process each CDC mode
        for (const row of cdcModesResult.rows as any[]) {
          const mode = row.CDC_MODE;
          const timestamp = row.LAST_PROCESSED_TIMESTAMP as Date;
          const enabled = row.IS_ENABLED === 1;
          
          logger.info(`📅 Mode: ${mode}, Timestamp: ${timestamp}, Enabled: ${enabled}`);
          
          if (mode === 'CDC_NORMAL_MODE') {
            normalModeTimestamp = timestamp;
            normalModeEnabled = enabled;  // Check if normal mode is enabled
          } else if (mode === 'CDC_HISTORICAL_MODE') {
            historicalModeTimestamp = timestamp;
            historicalModeEnabled = enabled;
          }
        }
        
        if (!normalModeTimestamp) {
          throw new Error('CDC_NORMAL_MODE timestamp not found');
        }
        
        logger.info(`📅 Normal CDC: ${normalModeTimestamp}`);
        logger.info(`📅 Historical CDC: ${historicalModeTimestamp} (enabled: ${historicalModeEnabled})`);
      } catch (timestampError) {
        logger.error('❌ Failed to get CDC timestamps, using safe fallback:', timestampError);
        // For 10TB system: only process from yesterday on first run to avoid overwhelming the system
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        normalModeTimestamp = yesterday;
        historicalModeTimestamp = new Date('2025-01-01');
        normalModeEnabled = false; // Disable normal mode on error
        historicalModeEnabled = false; // Disable historical mode on error
        logger.info(`📅 Using safe fallback - Both normal and historical modes disabled due to error`);
      }

      // Test total table count first
      logger.info('📊 Checking total table contents...');
      const totalTableResult = await connection.execute(`SELECT COUNT(*) AS TOTAL_COUNT FROM VERINT_TEXT_ANALYSIS`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      logger.info(`📊 Total table result: ${JSON.stringify(totalTableResult)}`);
      const totalRecords = (totalTableResult.rows?.[0] as any)?.TOTAL_COUNT;
      logger.info(`📊 Total records in VERINT_TEXT_ANALYSIS: ${totalRecords}`);

      // Check date range in table
      const dateRangeResult = await connection.execute(`
        SELECT MIN(TEXT_TIME) AS MIN_DATE, MAX(TEXT_TIME) AS MAX_DATE FROM VERINT_TEXT_ANALYSIS WHERE TEXT IS NOT NULL
      `, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      logger.info(`📊 Date range result: ${JSON.stringify(dateRangeResult)}`);
      const minDate = (dateRangeResult.rows?.[0] as any)?.MIN_DATE;
      const maxDate = (dateRangeResult.rows?.[0] as any)?.MAX_DATE;
      logger.info(`📊 Date range in table: ${minDate} to ${maxDate}`);

      // Test count query with both modes
      logger.info('🔍 Counting records for CDC processing...');
      const countResult = await connection.execute(`
        SELECT COUNT(*) AS PENDING_COUNT FROM VERINT_TEXT_ANALYSIS 
        WHERE ((:normalEnabled = 1 AND TEXT_TIME > :normalTimestamp)
               OR (:historicalEnabled = 1 AND TEXT_TIME > :historicalTimestamp))
          AND TEXT IS NOT NULL
          AND LENGTH(TEXT) > 10
          AND TEXT_TIME <= SYSDATE + 1/1440  -- Ignore calls more than 1 minute in the future
      `, { 
        normalTimestamp: normalModeTimestamp,
        historicalTimestamp: historicalModeTimestamp,
        normalEnabled: normalModeEnabled ? 1 : 0,
        historicalEnabled: historicalModeEnabled ? 1 : 0
      }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      
      logger.info(`🔍 Count result: ${JSON.stringify(countResult)}`);
      const totalCount = (countResult.rows?.[0] as any)?.PENDING_COUNT as number;
      logger.info(`🔍 Found ${totalCount} records for processing (normal: ${normalModeEnabled ? normalModeTimestamp : 'disabled'}, historical: ${historicalModeEnabled ? historicalModeTimestamp : 'disabled'})`);

      // Get records for both normal and historical modes
      logger.info(`Querying for records - Normal: ${normalModeEnabled ? `after ${normalModeTimestamp}` : 'disabled'}, Historical: ${historicalModeEnabled ? `after ${historicalModeTimestamp}` : 'disabled'}`);
      
      // Get complete conversations that have both agent and customer messages
      // PRODUCTION OPTIMIZATION: Limit batch size to prevent system overload
      const batchLimit = Math.min(this.batchSize, 50); // Maximum 50 calls per batch
      logger.info(`📊 Using batch limit: ${batchLimit} (configured: ${this.batchSize})`);
      
      const result = await connection.execute(`
        WITH complete_calls AS (
          SELECT DISTINCT
            CALL_ID,
            BAN,
            SUBSCRIBER_NO,
            MIN(CALL_TIME) as CALL_TIME,
            MAX(TEXT_TIME) as LATEST_TEXT_TIME,
            COUNT(DISTINCT OWNER) as OWNER_TYPES,
            COUNT(*) as MESSAGE_COUNT
          FROM VERINT_TEXT_ANALYSIS
          WHERE ((:normalEnabled = 1 AND TEXT_TIME > :normalTimestamp)
                 OR (:historicalEnabled = 1 AND TEXT_TIME > :historicalTimestamp))
            AND TEXT IS NOT NULL
            AND LENGTH(TEXT) > 10
            AND TEXT_TIME <= SYSDATE + 1/1440  -- Ignore calls more than 1 minute in the future
          GROUP BY CALL_ID, BAN, SUBSCRIBER_NO
          HAVING COUNT(DISTINCT OWNER) = 2  -- Must have both 'A' and 'C'
        )
        SELECT 
          ROWNUM + (SELECT COALESCE(MAX(LAST_CHANGE_ID), 0) FROM CDC_PROCESSING_STATUS WHERE TABLE_NAME = 'CDC_NORMAL_MODE') as CHANGE_ID,
          TO_CHAR(CALL_ID) as CALL_ID,
          BAN as CUSTOMER_ID,
          'INSERT' as CHANGE_TYPE,
          LATEST_TEXT_TIME as CHANGE_TIMESTAMP,
          BAN,
          SUBSCRIBER_NO,
          CALL_TIME,
          LATEST_TEXT_TIME as TEXT_TIME_COL,
          'COMPLETE' as OWNER,
          'Complete conversation with ' || MESSAGE_COUNT || ' messages' as TEXT
        FROM complete_calls
        ORDER BY LATEST_TEXT_TIME ASC
        FETCH FIRST :limit ROWS ONLY
      `, {
        normalTimestamp: normalModeTimestamp,
        historicalTimestamp: historicalModeTimestamp,
        normalEnabled: normalModeEnabled ? 1 : 0,
        historicalEnabled: historicalModeEnabled ? 1 : 0,
        limit: batchLimit
      }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      
      logger.info(`Query returned ${result.rows?.length || 0} rows`);

      if (!result.rows || result.rows.length === 0) {
        // If historical mode was enabled but no records found, disable it and enable normal mode
        if (historicalModeEnabled) {
          logger.info('🎯 Historical CDC completed - no more old data found, switching to production mode');
          await this.autoDisableHistoricalMode(connection);
        }
        // If normal mode is disabled and no historical processing, enable normal mode
        else if (!normalModeEnabled && !historicalModeEnabled) {
          logger.info('🚀 Enabling normal CDC mode for real-time processing');
          await this.enableNormalMode(connection);
        }
        return [];
      }

      return result.rows.map((row: any) => ({
        changeId: row.CHANGE_ID,
        callId: row.CALL_ID || 'UNKNOWN',
        customerId: row.CUSTOMER_ID || 'UNKNOWN',
        changeType: row.CHANGE_TYPE as 'INSERT' | 'UPDATE' | 'DELETE',
        changeTimestamp: row.CHANGE_TIMESTAMP || new Date(),
        ban: row.BAN || 'UNKNOWN',
        subscriberNo: row.SUBSCRIBER_NO || 'UNKNOWN',
        callTime: row.CALL_TIME || new Date(),
        textTime: row.TEXT_TIME_COL || new Date(),
        owner: 'COMPLETE',  // This is now a complete conversation
        text: row.TEXT || ''
      }));

    } finally {
      await connection.close();
    }
  }

  /**
   * Ensure CDC tracking table exists for state management
   */
  private async ensureCDCTrackingTable(connection: any): Promise<void> {
    logger.info('🏗️  Starting CDC tracking table setup...');
    
    // Create CDC_PROCESSING_LOG table if it doesn't exist
    logger.info('🔍 Creating CDC_PROCESSING_LOG table if needed...');
    try {
      await connection.execute(`
        CREATE TABLE CDC_PROCESSING_LOG (
          CHANGE_ID NUMBER,
          TABLE_NAME VARCHAR2(100),
          PROCESSING_TIME_MS NUMBER,
          ERROR_MESSAGE VARCHAR2(4000),
          PROCESSED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (CHANGE_ID, TABLE_NAME)
        )
      `);
      logger.info('✅ CDC_PROCESSING_LOG table created');
    } catch (error: any) {
      if (error?.errorNum === 955) { // Table already exists
        logger.info('✅ CDC_PROCESSING_LOG table already exists');
      } else {
        logger.warn('⚠️  CDC_PROCESSING_LOG table creation warning:', error?.message);
      }
    }
    
    // Create ERROR_LOG table for error handler consumer
    // Note: Using RAW(16) for ERROR_ID to support SYS_GUID() in error-handler-consumer.service.ts
    logger.info('🔍 Creating ERROR_LOG table if needed...');
    try {
      await connection.execute(`
        CREATE TABLE ERROR_LOG (
          ERROR_ID RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
          ORIGINAL_TOPIC VARCHAR2(255),
          ERROR_MESSAGE CLOB,
          ERROR_TYPE VARCHAR2(100),
          PROCESSING_ATTEMPTS NUMBER,
          ORIGINAL_MESSAGE CLOB,
          ERROR_TIMESTAMP TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CALL_ID VARCHAR2(50),
          CREATED_AT TIMESTAMP DEFAULT SYSDATE
        )
      `);
      logger.info('✅ ERROR_LOG table created');
    } catch (error: any) {
      if (error?.errorNum === 955) { // Table already exists
        logger.info('✅ ERROR_LOG table already exists');
      } else {
        logger.warn('⚠️  ERROR_LOG table creation warning:', error?.message);
      }
    }
    
    // Create KAFKA_PERMANENT_FAILURES table if needed
    logger.info('🔍 Creating KAFKA_PERMANENT_FAILURES table if needed...');
    try {
      await connection.execute(`
        CREATE TABLE KAFKA_PERMANENT_FAILURES (
          FAILURE_ID RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
          ORIGINAL_TOPIC VARCHAR2(255),
          ERROR_MESSAGE CLOB,
          ERROR_TYPE VARCHAR2(100),
          TOTAL_ATTEMPTS NUMBER,
          ORIGINAL_MESSAGE CLOB,
          FIRST_ERROR_TIMESTAMP TIMESTAMP,
          MARKED_FAILED_AT TIMESTAMP DEFAULT SYSDATE
        )
      `);
      logger.info('✅ KAFKA_PERMANENT_FAILURES table created');
    } catch (error: any) {
      if (error?.errorNum === 955) { // Table already exists
        logger.info('✅ KAFKA_PERMANENT_FAILURES table already exists');
      } else {
        logger.warn('⚠️  KAFKA_PERMANENT_FAILURES table creation warning:', error?.message);
      }
    }
    
    // Check for CDC mode tracking records
    logger.info('🔍 Checking for existing CDC mode tracking records...');
    const checkResult = await connection.execute(`
      SELECT COUNT(*) AS RECORD_COUNT FROM CDC_PROCESSING_STATUS 
      WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE')
    `, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    
    const recordExists = (checkResult.rows![0] as any).RECORD_COUNT as number;
    logger.info(`📊 Found ${recordExists} existing CDC mode records`);
    
    if (recordExists < 2) {
      logger.info('➕ Inserting missing CDC mode tracking records...');
      
      // Insert normal mode record if missing
      await connection.execute(`
        MERGE INTO CDC_PROCESSING_STATUS dst
        USING (SELECT 'CDC_NORMAL_MODE' as TABLE_NAME FROM DUAL) src
        ON (dst.TABLE_NAME = src.TABLE_NAME)
        WHEN NOT MATCHED THEN
        INSERT (TABLE_NAME, LAST_PROCESSED_TIMESTAMP, LAST_CHANGE_ID, TOTAL_PROCESSED)
        VALUES ('CDC_NORMAL_MODE', SYSDATE - 1, 0, 0)
      `);
      
      // Insert historical mode record if missing
      await connection.execute(`
        MERGE INTO CDC_PROCESSING_STATUS dst
        USING (SELECT 'CDC_HISTORICAL_MODE' as TABLE_NAME FROM DUAL) src
        ON (dst.TABLE_NAME = src.TABLE_NAME)
        WHEN NOT MATCHED THEN
        INSERT (TABLE_NAME, LAST_PROCESSED_TIMESTAMP, LAST_CHANGE_ID, TOTAL_PROCESSED)
        VALUES ('CDC_HISTORICAL_MODE', TO_DATE('2025-01-01', 'YYYY-MM-DD'), 0, 0)
      `);
      
      await connection.commit();
      logger.info('✅ CDC mode tracking records ensured');
    } else {
      logger.info('✅ All CDC mode tracking records exist');
    }

    logger.info('✅ CDC tracking table setup completed successfully');
  }

  /**
   * Automatically disable historical CDC mode and enable normal mode for production robustness
   */
  private async autoDisableHistoricalMode(connection: any): Promise<void> {
    try {
      // Disable historical mode (completed processing old data)
      await connection.execute(`
        UPDATE CDC_PROCESSING_STATUS 
        SET 
          TOTAL_PROCESSED = 0,
          LAST_UPDATED = CURRENT_TIMESTAMP
        WHERE TABLE_NAME = 'CDC_HISTORICAL_MODE'
      `);
      
      // Enable normal mode for real-time processing (production robustness)
      await connection.execute(`
        UPDATE CDC_PROCESSING_STATUS 
        SET 
          TOTAL_PROCESSED = 1,
          LAST_PROCESSED_TIMESTAMP = CURRENT_TIMESTAMP,
          LAST_UPDATED = CURRENT_TIMESTAMP
        WHERE TABLE_NAME = 'CDC_NORMAL_MODE'
      `);
      
      await connection.commit();
      logger.info('🔄 Production mode activated: Historical CDC disabled, Normal CDC enabled for real-time processing');
      
    } catch (error) {
      logger.error('❌ Failed to switch to production mode:', error);
    }
  }

  /**
   * Enable normal CDC mode for real-time processing
   */
  private async enableNormalMode(connection: any): Promise<void> {
    try {
      await connection.execute(`
        UPDATE CDC_PROCESSING_STATUS 
        SET 
          TOTAL_PROCESSED = 1,
          LAST_PROCESSED_TIMESTAMP = CURRENT_TIMESTAMP,
          LAST_UPDATED = CURRENT_TIMESTAMP
        WHERE TABLE_NAME = 'CDC_NORMAL_MODE'
      `);
      
      await connection.commit();
      logger.info('✅ Normal CDC mode enabled for real-time processing');
      
    } catch (error) {
      logger.error('❌ Failed to enable normal mode:', error);
    }
  }

  /**
   * Build conversation messages for Kafka ConversationAssembly
   */
  private async buildConversationMessages(callId: string): Promise<ConversationMessage[]> {
    let connection;
    try {
      logger.info(`🔍 Getting Oracle connection for call ${callId}`);
      connection = await oracleService.getConnection();
      logger.info(`✅ Got Oracle connection, executing query for call ${callId}`);
      
      const result = await connection.execute(`
        SELECT 
          OWNER,
          TEXT,
          TEXT_TIME
        FROM VERINT_TEXT_ANALYSIS
        WHERE TO_CHAR(CALL_ID) = TO_CHAR(:callId)
        ORDER BY TEXT_TIME ASC
      `, { callId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

      logger.info(`✅ Query executed, found ${result.rows?.length || 0} rows for call ${callId}`);

      if (!result.rows || result.rows.length === 0) {
        logger.warn(`⚠️ No conversation messages found for call ${callId}`);
        return [];
      }

      // Convert Oracle rows to ConversationMessage format
      const messages = result.rows.map((row: any, index: number) => ({
        messageId: `${callId}-${index}`,
        speaker: row.OWNER === 'A' ? 'agent' : 'customer',
        text: row.TEXT,
        timestamp: new Date(row.TEXT_TIME),
        metadata: {
          originalOwner: row.OWNER,
          sequenceNumber: index
        }
      }));
      
      logger.info(`✅ Successfully built ${messages.length} conversation messages for call ${callId}`);
      return messages;
      
    } catch (error) {
      logger.error(`❌ Error building conversation messages for call ${callId}:`, error);
      throw error;
    } finally {
      if (connection) {
        await connection.close();
      }
    }
  }

  /**
   * Get complete conversation for a call
   */
  private async getCompleteConversation(callId: string): Promise<{ text: string, hasAgentAndCustomer: boolean }> {
    const connection = await oracleService.getConnection();
    try {
      const result = await connection.execute(`
        SELECT 
          OWNER,
          TEXT,
          TEXT_TIME
        FROM VERINT_TEXT_ANALYSIS
        WHERE TO_CHAR(CALL_ID) = TO_CHAR(:callId)
        ORDER BY TEXT_TIME ASC
      `, { callId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

      if (!result.rows || result.rows.length === 0) {
        return { text: '', hasAgentAndCustomer: false };
      }

      // Check if we have both agent and customer
      const owners = new Set(result.rows.map((row: any) => row.OWNER));
      const hasAgentAndCustomer = owners.has('A') && owners.has('C');

      // Build conversation with proper formatting
      const conversation = result.rows.map((row: any) => {
        const speaker = row.OWNER === 'A' ? 'נציג' : 'לקוח';
        return `${speaker}: ${row.TEXT}`;
      }).join('\n');

      return { text: conversation, hasAgentAndCustomer };
    } finally {
      await connection.close();
    }
  }

  /**
   * Process a single CDC change record
   */
  private async processChange(change: CDCChangeRecord): Promise<CDCProcessingResult> {
    const startTime = Date.now();
    
    try {
      logger.info(`Processing CDC change: ${change.changeType} for call ${change.callId}`);

      let processingResult: CDCProcessingResult = {
        changeId: change.changeId,
        callId: change.callId,
        success: false,
        processingTime: 0,
        results: {}
      };

      // Skip DELETE operations for now
      if (change.changeType === 'DELETE') {
        await this.markChangeProcessed(change.changeId, Date.now() - startTime, change.textTime);
        return {
          ...processingResult,
          success: true,
          processingTime: Date.now() - startTime
        };
      }

      // Get the complete conversation (we already know it has both agent and customer from the query)
      const { text: fullConversation } = await this.getCompleteConversation(change.callId);
      
      // Log that we're processing a complete conversation
      logger.info(`Processing complete conversation for call ${change.callId}`);

      // Process INSERT/UPDATE operations through ML pipeline with FULL conversation
      const callData = {
        callId: change.callId,
        customerId: change.customerId,
        subscriberId: change.subscriberNo,
        transcriptionText: fullConversation, // Full conversation with agent/customer labels
        language: 'he', // Hebrew
        callDate: change.callTime.toISOString(),
        agentId: 'multi-speaker', // Multiple speakers in conversation
        callType: 'support',
        ban: change.ban
      };

      const customerContext = {
        customerId: change.customerId,
        subscriberIds: [change.subscriberNo]
      };

      // UNIFIED PIPELINE: Send to Kafka for ML Consumer processing (classifications + embeddings + indexing)
      logger.info(`🚀 Sending conversation ${change.callId} to Kafka for ML Consumer processing`);
      
      // No direct ML processing - let the ML Consumer handle everything
      // This ensures ONE unified pipeline: CDC → Kafka → ML Consumer → Classifications → OpenSearch
      
      // Set defaults since we're not doing direct ML processing
      const embeddingVector: number[] | null = null;
      const sentiment = 'neutral';

      processingResult = {
        changeId: change.changeId,
        callId: change.callId,
        success: false, // Will be set to true after successful indexing
        processingTime: Date.now() - startTime,
        results: {
          embeddingGenerated: !!embeddingVector,
          vectorStored: false, // Will be updated after OpenSearch indexing
          summaryGenerated: false, // Skip for now - focus on search
          entitiesExtracted: false, // Skip for now - focus on search  
          sentimentAnalyzed: !!sentiment,
          openSearchIndexed: false
        }
      };

        // Unified pipeline: Direct indexing disabled - ML Consumer handles all processing
        logger.info(`📨 CDC will publish to Kafka - ML Consumer handles classifications + OpenSearch`);
        processingResult.results!.openSearchIndexed = false;
        processingResult.results!.vectorStored = false;

        // UNIFIED PIPELINE: Publish to Kafka for ML Consumer processing  
        try {
          logger.info(`📨 Publishing conversation ${change.callId} to Kafka for ML Consumer`);
          
          // Create ConversationAssembly message for ML Consumer
          logger.info(`🔍 Building conversation messages for call ${change.callId}`);
          const messages = await this.buildConversationMessages(change.callId);
          logger.info(`✅ Built ${messages.length} conversation messages`);
          
          const agentMessages = messages.filter(m => m.speaker === 'agent');
          const customerMessages = messages.filter(m => m.speaker === 'customer');
          
          const conversationAssembly: ConversationAssembly = {
            type: 'conversation-assembly',
            callId: change.callId,
            customerId: change.customerId,
            subscriberNo: change.subscriberNo,
            messages: messages,
            conversationMetadata: {
              startTime: change.callTime,
              endTime: change.textTime,
              duration: Math.round((change.textTime.getTime() - change.callTime.getTime()) / 1000),
              messageCount: messages.length,
              agentMessageCount: agentMessages.length,
              customerMessageCount: customerMessages.length,
              language: 'he',
              callDate: change.callTime,
              participants: {
                agent: ['multi-speaker'],
                customer: [change.subscriberNo]
              }
            },
            timestamp: new Date().toISOString()
          };
          
          // Send to Kafka for ML Consumer processing
          const kafkaProducer = getKafkaProducer();
          logger.info(`🚀 About to send ConversationAssembly to Kafka`, {
            callId: conversationAssembly.callId,
            messageCount: conversationAssembly.messages.length,
            topic: 'conversation-assembly'
          });
          
          await kafkaProducer.sendConversationAssembly(conversationAssembly);
          
          processingResult.success = true; // Mark as successful after Kafka publishing
          logger.info(`✅ CDC successfully published to Kafka - ML Consumer will handle classifications + OpenSearch`);
          
        } catch (kafkaError) {
          logger.error(`❌ Kafka publishing error for call ${change.callId}:`, kafkaError);
          processingResult.success = false;
        }

        // Update AI metadata - but let ML Consumer handle the heavy lifting
        // await this.updateAIMetadata(change.callId, change.customerId, processingResult.results!);

      // Mark change as processed with the conversation's latest TEXT_TIME to prevent reprocessing
      await this.markChangeProcessed(
        change.changeId,
        processingResult.processingTime,
        change.textTime,  // Use conversation's latest TEXT_TIME as new CDC timestamp
        processingResult.error
      );

      this.emit('change-processed', processingResult);
      return processingResult;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error(`Error processing CDC change ${change.changeId}:`, error);

      // Mark change as processed with error, still use conversation's TEXT_TIME to prevent reprocessing
      await this.markChangeProcessed(change.changeId, processingTime, change.textTime, errorMessage);

      const result: CDCProcessingResult = {
        changeId: change.changeId,
        callId: change.callId,
        success: false,
        processingTime,
        error: errorMessage
      };

      this.emit('change-processed', result);
      return result;
    }
  }

  /**
   * Generate embedding using ML service
   */
  private async generateEmbedding(text: string): Promise<{success: boolean, embedding?: number[], error?: string}> {
    try {
      const response = await fetch(`${process.env.ML_SERVICE_URL || 'http://ml-service:5000'}/embeddings/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model: 'hebrew', // Use Hebrew model
          normalize: true
        })
      });

      if (!response.ok) {
        throw new Error(`ML service error: ${response.status}`);
      }

      const result = await response.json() as any;
      
      if (result.embedding && Array.isArray(result.embedding) && result.embedding.length === 768) {
        return {
          success: true,
          embedding: result.embedding
        };
      } else {
        return {
          success: false,
          error: result.error || 'Invalid embedding response from ML service'
        };
      }

    } catch (error) {
      logger.error('Error generating embedding:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update AI metadata in Oracle
   */
  private async updateAIMetadata(callId: string, customerId: string, results: any): Promise<void> {
    const connection = await oracleService.getConnection();
    
    try {
      await connection.execute(
        `UPDATE CALL_AI_METADATA 
         SET 
           EMBEDDING_GENERATED = :embeddingGenerated,
           VECTOR_STORED = :vectorStored,
           SUMMARY_GENERATED = :summaryGenerated,
           ENTITIES_EXTRACTED = :entitiesExtracted,
           SENTIMENT_ANALYZED = :sentimentAnalyzed
         WHERE CALL_ID = :callId AND CUSTOMER_ID = :customerId`,
        {
          embeddingGenerated: results.embeddingGenerated ? 1 : 0,
          vectorStored: results.vectorStored ? 1 : 0,
          summaryGenerated: results.summaryGenerated ? 1 : 0,
          entitiesExtracted: results.entitiesExtracted ? 1 : 0,
          sentimentAnalyzed: results.sentimentAnalyzed ? 1 : 0,
          callId,
          customerId
        }
      );

      await connection.commit();

    } finally {
      await connection.close();
    }
  }

  /**
   * Mark change as processed in Oracle tracking table
   */
  private async markChangeProcessed(
    changeId: number,
    processingTime: number,
    conversationLatestTime?: Date,
    errorMessage?: string
  ): Promise<void> {
    const connection = await oracleService.getConnection();
    
    try {
      // Update timestamps to the LATEST TEXT_TIME of processed conversation to prevent reprocessing
      const timestampToUse = conversationLatestTime || new Date();
      
      await connection.execute(`
        UPDATE CDC_PROCESSING_STATUS 
        SET 
          LAST_PROCESSED_TIMESTAMP = :processedTime,
          LAST_CHANGE_ID = :changeId,
          TOTAL_PROCESSED = GREATEST(TOTAL_PROCESSED, 1),
          LAST_UPDATED = CURRENT_TIMESTAMP
        WHERE TABLE_NAME = 'CDC_NORMAL_MODE'
          AND TOTAL_PROCESSED = 1
      `, {
        changeId,
        processedTime: timestampToUse
      });

      // Log processing result for monitoring
      // Use MERGE to prevent ORA-00001 unique constraint violations on duplicate CHANGE_ID
      await connection.execute(`
        MERGE INTO CDC_PROCESSING_LOG USING DUAL ON (CHANGE_ID = :changeId)
        WHEN NOT MATCHED THEN INSERT (
          CHANGE_ID,
          TABLE_NAME,
          PROCESSING_TIME_MS,
          ERROR_MESSAGE,
          PROCESSED_AT
        ) VALUES (
          :changeId,
          'VERINT_TEXT_ANALYSIS',
          :processingTime,
          :errorMessage,
          CURRENT_TIMESTAMP
        )
      `, {
        changeId,
        processingTime,
        errorMessage: errorMessage || null
      });

      await connection.commit();

    } catch (error) {
      // If logging table doesn't exist, continue without it
      logger.warn('CDC logging warning:', error);
      await connection.commit();
    } finally {
      await connection.close();
    }
  }

  /**
   * Get CDC processing statistics
   */
  async getStatistics(): Promise<{
    pendingChanges: number;
    processedToday: number;
    errorRate: number;
    avgProcessingTime: number;
    totalInOracle: number;
    totalProcessed: number;
  }> {
    const connection = await oracleService.getConnection();
    
    try {
      // Get tracking table stats for normal mode
      const trackingResult = await connection.execute(`
        SELECT 
          TOTAL_PROCESSED,
          LAST_PROCESSED_TIMESTAMP,
          LAST_CHANGE_ID
        FROM CDC_PROCESSING_STATUS 
        WHERE TABLE_NAME = 'CDC_NORMAL_MODE'
      `);

      // Get total records in Oracle
      const totalResult = await connection.execute(`
        SELECT COUNT(*) as total_records
        FROM VERINT_TEXT_ANALYSIS
        WHERE TEXT IS NOT NULL AND LENGTH(TEXT) > 10
      `);

      // Get pending records (newer than last processed)
      const lastProcessed = trackingResult.rows && trackingResult.rows[0] 
        ? trackingResult.rows[0][1] as Date 
        : new Date('2025-01-01');

      const pendingResult = await connection.execute(`
        SELECT COUNT(*) as pending_count
        FROM VERINT_TEXT_ANALYSIS
        WHERE TEXT_TIME > :lastProcessed
          AND TEXT IS NOT NULL 
          AND LENGTH(TEXT) > 10
      `, { lastProcessed });

      // Get today's processing stats (if log table exists)
      let processedToday = 0;
      let errorRate = 0;
      let avgProcessingTime = 0;

      try {
        const logResult = await connection.execute(`
          SELECT 
            COUNT(*) as processed_today,
            ROUND(COUNT(CASE WHEN ERROR_MESSAGE IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as error_rate,
            ROUND(AVG(PROCESSING_TIME_MS), 2) as avg_processing_time
          FROM CDC_PROCESSING_LOG
          WHERE TRUNC(PROCESSED_AT) = TRUNC(SYSDATE)
        `);

        if (logResult.rows && logResult.rows[0]) {
          const logRow = logResult.rows[0] as any[];
          processedToday = logRow[0] || 0;
          errorRate = logRow[1] || 0;
          avgProcessingTime = logRow[2] || 0;
        }
      } catch (error) {
        // Log table doesn't exist yet - that's ok
      }

      const totalProcessed = trackingResult.rows && trackingResult.rows[0] 
        ? trackingResult.rows[0][0] as number || 0
        : 0;

      const totalInOracle = totalResult.rows![0][0] as number || 0;
      const pendingChanges = pendingResult.rows![0][0] as number || 0;

      return {
        pendingChanges,
        processedToday,
        errorRate,
        avgProcessingTime,
        totalInOracle,
        totalProcessed
      };

    } finally {
      await connection.close();
    }
  }

  /**
   * AUTOMATIC INFINITE LOOP DETECTION
   */
  private detectInfiniteLoop(currentCycle: { callIds: string[], timestamp: Date }): boolean {
    if (!this.lastProcessingCycle) {
      return false;
    }

    // Check if we're processing the exact same call IDs as last cycle
    const lastCallIds = this.lastProcessingCycle.callIds;
    const currentCallIds = currentCycle.callIds;
    
    if (this.arraysEqual(lastCallIds, currentCallIds)) {
      this.consecutiveSameCycles++;
      logger.warn(`🔄 CDC processing same call IDs (cycle ${this.consecutiveSameCycles}/${this.MAX_CONSECUTIVE_SAME_CYCLES})`, {
        callIds: currentCallIds,
        timeSinceLastCycle: Date.now() - this.lastProcessingCycle.timestamp.getTime()
      });
      
      return this.consecutiveSameCycles >= this.MAX_CONSECUTIVE_SAME_CYCLES;
    }

    // Different call IDs - reset counter
    this.consecutiveSameCycles = 0;
    return false;
  }

  private resetInfiniteLoopDetection(): void {
    this.consecutiveSameCycles = 0;
    this.lastProcessingCycle = null;
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((val, i) => val === b[i]);
  }

  /**
   * AUTOMATIC CDC DISABLE ON INFINITE LOOP
   */
  private async autoDisableCDCModes(): Promise<void> {
    try {
      logger.error('🚨 AUTO-DISABLING CDC MODES to prevent infinite loop');
      
      const connection = await oracleService.getConnection();
      try {
        // Disable both CDC modes
        await connection.execute(`
          UPDATE CDC_PROCESSING_STATUS 
          SET TOTAL_PROCESSED = 0,  -- Disable both modes
              LAST_UPDATED = CURRENT_TIMESTAMP
          WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE')
        `);
        await connection.commit();
        
        logger.info('✅ CDC modes automatically disabled due to infinite loop detection');
        
        // Stop the service
        await this.stop();
        
      } finally {
        await connection.close();
      }
      
    } catch (error) {
      logger.error('❌ Failed to auto-disable CDC modes:', error);
    }
  }

  /**
   * Reset circuit breaker (for manual recovery)
   */
  public resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    this.resetInfiniteLoopDetection();
    logger.info('🔄 CDC Circuit Breaker RESET - infinite loop protection re-enabled');
  }
}

// Singleton instance
export const realtimeCDCService = new RealtimeCDCService();