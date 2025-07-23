import { logger } from '../utils/logger';
import { oracleService } from './oracle.service';
import { mcpClientService } from './mcp-client.service';
import { openSearchService } from './opensearch.service';
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

  constructor() {
    super();
    this.pollIntervalMs = parseInt(process.env.CDC_POLL_INTERVAL_MS || '5000'); // 5 seconds
    this.batchSize = parseInt(process.env.CDC_BATCH_SIZE || '10');
    this.maxConcurrentProcessing = parseInt(process.env.CDC_MAX_CONCURRENT || '3');
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

    try {
      logger.info('🔄 CDC checking for pending changes...');
      const startTime = Date.now();
      
      const pendingChanges = await this.getPendingChanges();
      const queryTime = Date.now() - startTime;
      
      logger.info(`✅ Found ${pendingChanges.length} pending changes (query took ${queryTime}ms)`);
      
      if (pendingChanges.length === 0) {
        logger.info('⏸️  No pending changes, waiting for next cycle...');
        return;
      }

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
        historicalModeEnabled = false; // Disable historical mode on error
        logger.info(`📅 Using safe fallback - Normal: ${normalModeTimestamp}, Historical disabled`);
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
        WHERE (TEXT_TIME > :normalTimestamp 
               OR (:historicalEnabled = 1 AND TEXT_TIME > :historicalTimestamp))
          AND TEXT IS NOT NULL
          AND LENGTH(TEXT) > 10
      `, { 
        normalTimestamp: normalModeTimestamp,
        historicalTimestamp: historicalModeTimestamp,
        historicalEnabled: historicalModeEnabled ? 1 : 0
      }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      
      logger.info(`🔍 Count result: ${JSON.stringify(countResult)}`);
      const totalCount = (countResult.rows?.[0] as any)?.PENDING_COUNT as number;
      logger.info(`🔍 Found ${totalCount} records for processing (normal: ${normalModeTimestamp}, historical: ${historicalModeEnabled ? historicalModeTimestamp : 'disabled'})`);

      // Get records for both normal and historical modes
      logger.info(`Querying for records - Normal after: ${normalModeTimestamp}, Historical: ${historicalModeEnabled ? `after ${historicalModeTimestamp}` : 'disabled'}`);
      
      // Get complete conversations that have both agent and customer messages
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
          WHERE (TEXT_TIME > :normalTimestamp 
                 OR (:historicalEnabled = 1 AND TEXT_TIME > :historicalTimestamp))
            AND TEXT IS NOT NULL
            AND LENGTH(TEXT) > 10
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
        historicalEnabled: historicalModeEnabled ? 1 : 0,
        limit: this.batchSize
      }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      
      logger.info(`Query returned ${result.rows?.length || 0} rows`);

      if (!result.rows || result.rows.length === 0) {
        // If historical mode was enabled but no records found, disable it
        if (historicalModeEnabled) {
          logger.info('🎯 Historical CDC completed - no more old data found, disabling historical mode');
          await this.autoDisableHistoricalMode(connection);
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
   * Automatically disable historical CDC mode when no more old data found
   */
  private async autoDisableHistoricalMode(connection: any): Promise<void> {
    try {
      await connection.execute(`
        UPDATE CDC_PROCESSING_STATUS 
        SET 
          TOTAL_PROCESSED = 0,
          LAST_UPDATED = CURRENT_TIMESTAMP
        WHERE TABLE_NAME = 'CDC_HISTORICAL_MODE'
      `);
      
      await connection.commit();
      logger.info('✅ Historical CDC mode auto-disabled - returning to normal CDC only');
      
    } catch (error) {
      logger.error('❌ Failed to auto-disable historical mode:', error);
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
        await this.markChangeProcessed(change.changeId, Date.now() - startTime);
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

      // SIMPLIFIED: Generate embedding and index directly in OpenSearch 
      logger.info(`🚀 Processing conversation ${change.callId} with OpenSearch vector indexing`);
      
      let embeddingVector: number[] | null = null;
      let sentiment = 'neutral';
      
      // Generate embedding using ML service
      try {
        const embeddingResult = await this.generateEmbedding(fullConversation);
        if (embeddingResult.success) {
          embeddingVector = embeddingResult.embedding;
          logger.info(`✅ Generated embedding for conversation ${change.callId}`);
        }
      } catch (embError) {
        logger.warn(`⚠️ Failed to generate embedding: ${embError.message}`);
      }
      
      // Simple sentiment analysis (can be enhanced later)
      if (fullConversation.includes('תודה') || fullConversation.includes('מעולה')) {
        sentiment = 'positive';
      } else if (fullConversation.includes('בעיה') || fullConversation.includes('לא עובד')) {
        sentiment = 'negative';  
      }

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

        // Index in OpenSearch with vector embeddings
        try {
          logger.info(`📄 Indexing conversation ${change.callId} in OpenSearch with vectors`);
          
          const openSearchCustomerContext = {
            customerId: change.customerId,
            tier: 'standard',
            language: 'he'
          };
          
          const transcriptionData: any = {
            callId: change.callId,
            customerId: change.customerId,
            subscriberId: change.subscriberNo,
            transcriptionText: fullConversation,
            language: 'he',
            callDate: change.callTime.toISOString().replace(/\.\d{3}Z$/, 'Z'),
            agentId: 'multi-speaker',
            callType: 'support',
            sentiment: sentiment,
            productsMentioned: [], // Can be enhanced later
            keyPoints: [] // Can be enhanced later
          };
          
          // Add embedding vector if available
          if (embeddingVector && embeddingVector.length === 768) {
            transcriptionData.embedding = embeddingVector;
            transcriptionData.embeddingModel = 'alephbert-hebrew';
            logger.info(`📊 Adding ${embeddingVector.length}D embedding vector to document`);
          }
          
          const indexSuccess = await openSearchService.indexDocument(
            openSearchCustomerContext,
            'transcriptions',
            transcriptionData
          );
          
          if (indexSuccess) {
            logger.info(`✅ OpenSearch vector indexing completed for call ${change.callId}`);
            processingResult.results!.openSearchIndexed = true;
            processingResult.results!.vectorStored = !!embeddingVector;
            processingResult.success = true; // Mark as successful
          } else {
            logger.warn(`⚠️ OpenSearch indexing failed for call ${change.callId}`);
            processingResult.results!.openSearchIndexed = false;
          }
          
        } catch (indexError) {
          logger.error(`❌ OpenSearch indexing error for call ${change.callId}:`, indexError);
          processingResult.results!.openSearchIndexed = false;
        }

        // Update AI metadata
        await this.updateAIMetadata(change.callId, change.customerId, processingResult.results!);

      // Mark change as processed
      await this.markChangeProcessed(
        change.changeId,
        processingResult.processingTime,
        processingResult.error
      );

      this.emit('change-processed', processingResult);
      return processingResult;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error(`Error processing CDC change ${change.changeId}:`, error);

      // Mark change as processed with error
      await this.markChangeProcessed(change.changeId, processingTime, errorMessage);

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
    errorMessage?: string
  ): Promise<void> {
    const connection = await oracleService.getConnection();
    
    try {
      // Update BOTH normal and historical mode timestamps
      // This ensures historical mode progresses and eventually finds no more records
      await connection.execute(`
        UPDATE CDC_PROCESSING_STATUS 
        SET 
          LAST_PROCESSED_TIMESTAMP = CURRENT_TIMESTAMP,
          LAST_CHANGE_ID = :changeId,
          TOTAL_PROCESSED = TOTAL_PROCESSED + 1,
          LAST_UPDATED = CURRENT_TIMESTAMP
        WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE')
      `, {
        changeId
      });

      // Log processing result for monitoring
      await connection.execute(`
        INSERT INTO CDC_PROCESSING_LOG (
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
}

// Singleton instance
export const realtimeCDCService = new RealtimeCDCService();