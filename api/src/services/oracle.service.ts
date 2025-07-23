import oracledb from 'oracledb';
import { logger } from '../utils/logger';
import { CustomerContext } from '../types/customer';

export interface OracleConfig {
  user: string;
  password: string;
  connectString: string;
  poolMin: number;
  poolMax: number;
  poolIncrement: number;
  poolTimeout: number;
  privilege?: number;
}

export class OracleService {
  private pool: oracledb.Pool | null = null;
  private config: OracleConfig;

  constructor() {
    this.config = {
      user: process.env.ORACLE_USER!,
      password: process.env.ORACLE_PASSWORD!,
      connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT}/${process.env.ORACLE_SERVICE_NAME}`,
      poolMin: parseInt(process.env.ORACLE_POOL_MIN || '5'),
      poolMax: parseInt(process.env.ORACLE_POOL_MAX || '20'),
      poolIncrement: parseInt(process.env.ORACLE_POOL_INCREMENT || '5'),
      poolTimeout: parseInt(process.env.ORACLE_POOL_TIMEOUT || '60')
    };

    // Initialize Oracle client
    this.initializeOracleClient();
  }

  private initializeOracleClient(): void {
    try {
      if (process.env.ORACLE_CLIENT_DIR) {
        oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_DIR });
      }
      
      // Set Oracle configuration with UTF-8 support for Hebrew
      oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
      oracledb.autoCommit = true;
      oracledb.fetchAsString = [oracledb.CLOB];
      oracledb.poolTimeout = this.config.poolTimeout;
      
      // Force UTF-8 encoding for Hebrew text support
      process.env.NLS_LANG = 'AMERICAN_AMERICA.AL32UTF8';
      
      logger.info('Oracle client initialized with UTF-8 encoding for Hebrew support');
    } catch (error) {
      logger.error('Failed to initialize Oracle client:', error);
    }
  }

  async connect(): Promise<void> {
    try {
      this.pool = await oracledb.createPool(this.config);
      logger.info('Oracle connection pool created successfully');
      
      // Test connection
      const connection = await this.pool.getConnection();
      await connection.execute('SELECT 1 FROM DUAL');
      await connection.close();
      logger.info('Oracle connection test successful');
    } catch (error) {
      logger.error('Failed to create Oracle connection pool:', error);
      throw error;
    }
  }

  async getConnection(): Promise<oracledb.Connection> {
    if (!this.pool) {
      throw new Error('Oracle pool not initialized');
    }
    return await this.pool.getConnection();
  }

  async executeQuery<T = any>(
    sql: string,
    binds: any = {},
    options: oracledb.ExecuteOptions = {},
    customerContext?: CustomerContext
  ): Promise<T[]> {
    let connection: oracledb.Connection | null = null;
    
    try {
      connection = await this.getConnection();
      
      // Apply customer isolation if context provided
      if (customerContext) {
        sql = this.applyCustomerFilter(sql, customerContext);
      }
      
      const result = await connection.execute(sql, binds, {
        ...options,
        resultSet: false
      });
      
      return result.rows as T[];
    } catch (error) {
      logger.error('Oracle query execution error:', error);
      throw error;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          logger.error('Error closing connection:', err);
        }
      }
    }
  }

  async executeMany(
    sql: string,
    binds: any[],
    options: oracledb.ExecuteOptions = {}
  ): Promise<oracledb.Result<any>> {
    let connection: oracledb.Connection | null = null;
    
    try {
      connection = await this.getConnection();
      const result = await connection.executeMany(sql, binds, options);
      await connection.commit();
      return result as oracledb.Result<any>;
    } catch (error) {
      logger.error('Oracle executeMany error:', error);
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          logger.error('Error closing connection:', err);
        }
      }
    }
  }

  private applyCustomerFilter(sql: string, context: CustomerContext): string {
    const { customerId, subscriberIds } = context;
    
    // Add WHERE clause for customer isolation
    const customerFilter = `CUSTOMER_ID = :customerId`;
    const subscriberFilter = subscriberIds && subscriberIds.length > 0
      ? ` AND SUBSCRIBER_ID IN (${subscriberIds.map((_, i) => `:sub${i}`).join(', ')})`
      : '';
    
    const filter = customerFilter + subscriberFilter;
    
    // Simple SQL injection of WHERE clause (in production, use a proper SQL builder)
    if (sql.toLowerCase().includes('where')) {
      return sql.replace(/where/i, `WHERE ${filter} AND`);
    } else {
      return sql.replace(/from\s+(\w+)/i, `FROM $1 WHERE ${filter}`);
    }
  }

  async getCallTranscriptions(
    customerContext: CustomerContext,
    limit: number = 100,
    offset: number = 0
  ): Promise<any[]> {
    // For Verint data - get unique calls and construct full transcription
    const sql = `
      WITH call_conversations AS (
        SELECT 
          CALL_ID,
          BAN as CUSTOMER_ID,
          SUBSCRIBER_NO as SUBSCRIBER_ID,
          CALL_TIME as CALL_DATE,
          LISTAGG(
            CASE 
              WHEN OWNER = 'C' THEN 'לקוח: ' || TEXT
              WHEN OWNER = 'A' THEN 'נציג: ' || TEXT  
              ELSE TEXT
            END, 
            CHR(10)
          ) WITHIN GROUP (ORDER BY TEXT_TIME) as TRANSCRIPTION_TEXT,
          'he' as LANGUAGE,
          'VERINT' as AGENT_ID,
          'support' as CALL_TYPE,
          COUNT(*) as MESSAGE_COUNT
        FROM ${process.env.ORACLE_TABLE_TRANSCRIPTIONS || 'VERINT_TEXT_ANALYSIS'}
        WHERE BAN = :customerId
        ${customerContext.subscriberIds ? 'AND SUBSCRIBER_NO IN (:subscriberIds)' : ''}
        AND CALL_TIME > SYSDATE - 30  -- Last 30 days
        GROUP BY CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME
      )
      SELECT * FROM call_conversations
      ORDER BY CALL_DATE DESC
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
    `;

    const binds = {
      customerId: customerContext.customerId,
      subscriberIds: customerContext.subscriberIds || [],
      limit,
      offset
    };

    return await this.executeQuery(sql, binds);
  }

  async getCallSummaries(
    customerContext: CustomerContext,
    callIds: string[]
  ): Promise<any[]> {
    const sql = `
      SELECT 
        CALL_ID,
        SUMMARY_TEXT,
        KEY_POINTS,
        SENTIMENT,
        PRODUCTS_MENTIONED,
        ACTION_ITEMS,
        CREATED_AT
      FROM ${process.env.ORACLE_TABLE_SUMMARIES || 'CALL_SUMMARIES'}
      WHERE CUSTOMER_ID = :customerId
      AND CALL_ID IN (${callIds.map((_, i) => `:call${i}`).join(', ')})
    `;

    const binds: any = {
      customerId: customerContext.customerId
    };
    
    callIds.forEach((id, i) => {
      binds[`call${i}`] = id;
    });

    return await this.executeQuery(sql, binds);
  }

  async saveCallSummary(
    customerContext: CustomerContext,
    callId: string,
    summary: any
  ): Promise<void> {
    const sql = `
      INSERT INTO ${process.env.ORACLE_TABLE_SUMMARIES || 'CALL_SUMMARIES'} (
        CALL_ID,
        CUSTOMER_ID,
        SUMMARY_TEXT,
        KEY_POINTS,
        SENTIMENT,
        PRODUCTS_MENTIONED,
        ACTION_ITEMS,
        CREATED_AT
      ) VALUES (
        :callId,
        :customerId,
        :summaryText,
        :keyPoints,
        :sentiment,
        :productsMentioned,
        :actionItems,
        SYSTIMESTAMP
      )
    `;

    await this.executeQuery(sql, {
      callId,
      customerId: customerContext.customerId,
      summaryText: summary.text,
      keyPoints: JSON.stringify(summary.keyPoints),
      sentiment: summary.sentiment,
      productsMentioned: JSON.stringify(summary.productsMentioned),
      actionItems: JSON.stringify(summary.actionItems)
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.executeQuery('SELECT 1 FROM DUAL');
      return true;
    } catch (error) {
      logger.error('Oracle health check failed:', error);
      return false;
    }
  }

  // NEW: Methods for AI processing integration
  async saveProcessedCall(
    customerContext: CustomerContext,
    callData: any,
    processingResults: any
  ): Promise<void> {
    const connection = await this.getConnection();
    
    try {
      // Start transaction (Oracle connections default to autoCommit: false)
      
      // Save/update call transcription
      const transcriptionSql = `
        MERGE INTO ${process.env.ORACLE_TABLE_TRANSCRIPTIONS || 'CALL_TRANSCRIPTIONS'} t
        USING (SELECT :callId as CALL_ID FROM DUAL) s
        ON (t.CALL_ID = s.CALL_ID AND t.CUSTOMER_ID = :customerId)
        WHEN MATCHED THEN
          UPDATE SET 
            TRANSCRIPTION_TEXT = :transcriptionText,
            LANGUAGE = :language,
            CALL_TYPE = :callType,
            UPDATED_AT = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
          INSERT (
            CALL_ID, CUSTOMER_ID, SUBSCRIBER_ID, TRANSCRIPTION_TEXT,
            LANGUAGE, CALL_DATE, DURATION_SECONDS, AGENT_ID, CALL_TYPE, CREATED_AT
          ) VALUES (
            :callId, :customerId, :subscriberId, :transcriptionText,
            :language, :callDate, :durationSeconds, :agentId, :callType, SYSTIMESTAMP
          )
      `;
      
      await connection.execute(transcriptionSql, {
        callId: callData.callId,
        customerId: customerContext.customerId,
        subscriberId: callData.subscriberId,
        transcriptionText: callData.transcriptionText,
        language: callData.language,
        callDate: new Date(callData.callDate),
        durationSeconds: callData.durationSeconds,
        agentId: callData.agentId,
        callType: callData.callType
      });

      // Save summary if generated
      if (processingResults.summary_result?.success) {
        const summaryData = processingResults.summary_result.data;
        await this.saveCallSummary(customerContext, callData.callId, summaryData);
      }

      // Save AI processing metadata
      const metadataSql = `
        INSERT INTO ${process.env.ORACLE_TABLE_AI_METADATA || 'CALL_AI_METADATA'} (
          CALL_ID, CUSTOMER_ID, EMBEDDING_GENERATED, VECTOR_STORED,
          SUMMARY_GENERATED, ENTITIES_EXTRACTED, SENTIMENT_ANALYZED,
          PROCESSING_TIME, CREATED_AT
        ) VALUES (
          :callId, :customerId, :embeddingGenerated, :vectorStored,
          :summaryGenerated, :entitiesExtracted, :sentimentAnalyzed,
          :processingTime, SYSTIMESTAMP
        )
      `;

      await connection.execute(metadataSql, {
        callId: callData.callId,
        customerId: customerContext.customerId,
        embeddingGenerated: processingResults.embedding_result?.success ? 1 : 0,
        vectorStored: processingResults.vector_result?.success ? 1 : 0,
        summaryGenerated: processingResults.summary_result?.success ? 1 : 0,
        entitiesExtracted: processingResults.entity_result?.success ? 1 : 0,
        sentimentAnalyzed: processingResults.sentiment_result?.success ? 1 : 0,
        processingTime: processingResults.total_processing_time || 0
      });

      // Commit transaction
      await connection.commit();
      
      logger.info('Processed call saved successfully', {
        callId: callData.callId,
        customerId: customerContext.customerId
      });
      
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to save processed call:', error);
      throw error;
    } finally {
      await connection.close();
    }
  }

  async getCallById(customerContext: CustomerContext, callId: string): Promise<any> {
    // Get Verint call data with conversation details
    const sql = `
      WITH call_details AS (
        SELECT 
          CALL_ID,
          BAN as CUSTOMER_ID,
          SUBSCRIBER_NO as SUBSCRIBER_ID,
          CALL_TIME as CALL_DATE,
          LISTAGG(
            CASE 
              WHEN OWNER = 'C' THEN 'לקוח: ' || TEXT
              WHEN OWNER = 'A' THEN 'נציג: ' || TEXT  
              ELSE TEXT
            END, 
            CHR(10)
          ) WITHIN GROUP (ORDER BY TEXT_TIME) as TRANSCRIPTION_TEXT,
          'he' as LANGUAGE,
          'VERINT' as AGENT_ID,
          'support' as CALL_TYPE,
          COUNT(*) as MESSAGE_COUNT,
          MIN(TEXT_TIME) as FIRST_MESSAGE,
          MAX(TEXT_TIME) as LAST_MESSAGE
        FROM ${process.env.ORACLE_TABLE_TRANSCRIPTIONS || 'VERINT_TEXT_ANALYSIS'}
        WHERE CALL_ID = :callId AND BAN = :customerId
        GROUP BY CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME
      )
      SELECT 
        cd.*,
        s.SUMMARY_TEXT,
        s.KEY_POINTS,
        s.SENTIMENT,
        s.PRODUCTS_MENTIONED,
        s.ACTION_ITEMS,
        ai.EMBEDDING_GENERATED,
        ai.VECTOR_STORED,
        ai.PROCESSING_TIME
      FROM call_details cd
      LEFT JOIN ${process.env.ORACLE_TABLE_SUMMARIES || 'CALL_SUMMARIES'} s
        ON cd.CALL_ID = s.CALL_ID AND cd.CUSTOMER_ID = s.CUSTOMER_ID
      LEFT JOIN ${process.env.ORACLE_TABLE_AI_METADATA || 'CALL_AI_METADATA'} ai
        ON cd.CALL_ID = ai.CALL_ID AND cd.CUSTOMER_ID = ai.CUSTOMER_ID
    `;

    const results = await this.executeQuery(sql, {
      callId,
      customerId: customerContext.customerId
    });

    if (results.length === 0) {
      throw new Error(`Call ${callId} not found`);
    }

    const call = results[0];
    
    // Parse JSON fields
    if (call.KEY_POINTS) {
      try {
        call.keyPoints = JSON.parse(call.KEY_POINTS);
      } catch (e) {
        call.keyPoints = [];
      }
    }
    
    if (call.PRODUCTS_MENTIONED) {
      try {
        call.productsMentioned = JSON.parse(call.PRODUCTS_MENTIONED);
      } catch (e) {
        call.productsMentioned = [];
      }
    }
    
    if (call.ACTION_ITEMS) {
      try {
        call.actionItems = JSON.parse(call.ACTION_ITEMS);
      } catch (e) {
        call.actionItems = [];
      }
    }

    return call;
  }

  // NEW: Get detailed conversation flow for a specific call
  async getCallConversation(customerContext: CustomerContext, callId: string): Promise<any[]> {
    const sql = `
      SELECT 
        CALL_ID,
        BAN as CUSTOMER_ID,
        SUBSCRIBER_NO as SUBSCRIBER_ID,
        CALL_TIME,
        TEXT_TIME,
        OWNER,
        TEXT,
        CASE 
          WHEN OWNER = 'C' THEN 'customer'
          WHEN OWNER = 'A' THEN 'agent'
          ELSE 'system'
        END as SPEAKER_TYPE
      FROM ${process.env.ORACLE_TABLE_TRANSCRIPTIONS || 'VERINT_TEXT_ANALYSIS'}
      WHERE CALL_ID = :callId 
      AND BAN = :customerId
      ORDER BY TEXT_TIME ASC
    `;

    return await this.executeQuery(sql, {
      callId,
      customerId: customerContext.customerId
    });
  }

  // NEW: Get call statistics for dashboard
  async getCallStats(customerContext: CustomerContext): Promise<any> {
    const sql = `
      SELECT 
        COUNT(DISTINCT CALL_ID) as total_calls,
        COUNT(DISTINCT SUBSCRIBER_NO) as unique_subscribers,
        COUNT(*) as total_messages,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (MAX(TEXT_TIME) - MIN(TEXT_TIME))) / 60
        ), 2) as avg_duration_minutes,
        COUNT(DISTINCT TRUNC(CALL_TIME)) as active_days
      FROM ${process.env.ORACLE_TABLE_TRANSCRIPTIONS || 'VERINT_TEXT_ANALYSIS'}
      WHERE BAN = :customerId
      AND CALL_TIME > SYSDATE - 30
    `;

    const results = await this.executeQuery(sql, {
      customerId: customerContext.customerId
    });

    return results[0] || {};
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close(10);
      logger.info('Oracle connection pool closed');
    }
  }
}

export const oracleService = new OracleService();