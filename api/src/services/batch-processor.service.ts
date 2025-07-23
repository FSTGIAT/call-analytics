import { logger } from '../utils/logger';
import { oracleService } from './oracle.service';
import { mcpClientService } from './mcp-client.service';
import { CustomerContext } from '../types/customer';
import axios from 'axios';

export interface BatchProcessingOptions {
  batchSize: number;
  maxConcurrency: number;
  delayBetweenBatches: number;
  processEmbeddings: boolean;
  processLLMAnalysis: boolean;
  dateRange?: {
    from: Date;
    to: Date;
  };
}

export interface BatchProcessingStats {
  totalCalls: number;
  processedCalls: number;
  failedCalls: number;
  embeddingsGenerated: number;
  llmAnalysisCompleted: number;
  startTime: Date;
  endTime?: Date;
  averageProcessingTime: number;
}

export class BatchProcessorService {
  private isRunning = false;
  private currentStats: BatchProcessingStats;
  private processingQueue: string[] = [];

  constructor() {
    this.currentStats = this.initializeStats();
  }

  private initializeStats(): BatchProcessingStats {
    return {
      totalCalls: 0,
      processedCalls: 0,
      failedCalls: 0,
      embeddingsGenerated: 0,
      llmAnalysisCompleted: 0,
      startTime: new Date(),
      averageProcessingTime: 0
    };
  }

  async processBatchOfCalls(
    customerContext: CustomerContext,
    options: BatchProcessingOptions = {
      batchSize: 50,
      maxConcurrency: 5,
      delayBetweenBatches: 2000,
      processEmbeddings: true,
      processLLMAnalysis: true
    }
  ): Promise<BatchProcessingStats> {
    if (this.isRunning) {
      throw new Error('Batch processing is already running');
    }

    this.isRunning = true;
    this.currentStats = this.initializeStats();

    try {
      logger.info('Starting batch processing of Verint calls', {
        customerId: customerContext.customerId,
        options
      });

      // Step 1: Get all unprocessed calls from Verint
      const unprocessedCalls = await this.getUnprocessedCalls(customerContext, options);
      this.currentStats.totalCalls = unprocessedCalls.length;

      logger.info(`Found ${unprocessedCalls.length} calls to process`);

      if (unprocessedCalls.length === 0) {
        logger.info('No unprocessed calls found');
        return this.currentStats;
      }

      // Step 2: Process calls in batches
      const batches = this.createBatches(unprocessedCalls, options.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} calls)`);

        await this.processBatch(batch, customerContext, options);

        // Delay between batches to avoid overwhelming the system
        if (i < batches.length - 1) {
          await this.delay(options.delayBetweenBatches);
        }
      }

      this.currentStats.endTime = new Date();
      this.currentStats.averageProcessingTime = 
        (this.currentStats.endTime.getTime() - this.currentStats.startTime.getTime()) 
        / this.currentStats.processedCalls;

      logger.info('Batch processing completed', this.currentStats);
      return this.currentStats;

    } catch (error) {
      logger.error('Batch processing failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  private async getUnprocessedCalls(
    customerContext: CustomerContext,
    options: BatchProcessingOptions
  ): Promise<any[]> {
    let sql = `
      WITH call_conversations AS (
        SELECT 
          v.CALL_ID,
          v.BAN as CUSTOMER_ID,
          v.SUBSCRIBER_NO as SUBSCRIBER_ID,
          v.CALL_TIME as CALL_DATE,
          LISTAGG(
            CASE 
              WHEN v.OWNER = 'C' THEN 'לקוח: ' || v.TEXT
              WHEN v.OWNER = 'A' THEN 'נציג: ' || v.TEXT  
              ELSE v.TEXT
            END, 
            CHR(10)
          ) WITHIN GROUP (ORDER BY v.TEXT_TIME) as TRANSCRIPTION_TEXT,
          'he' as LANGUAGE,
          COUNT(*) as MESSAGE_COUNT,
          MIN(v.TEXT_TIME) as FIRST_MESSAGE_TIME,
          MAX(v.TEXT_TIME) as LAST_MESSAGE_TIME
        FROM VERINT_TEXT_ANALYSIS v
        LEFT JOIN CALL_AI_METADATA ai ON v.CALL_ID = ai.CALL_ID AND v.BAN = ai.CUSTOMER_ID
        WHERE v.BAN = :customerId
        AND ai.CALL_ID IS NULL  -- Only unprocessed calls
    `;

    const binds: any = {
      customerId: customerContext.customerId
    };

    // Add date range filter if specified
    if (options.dateRange) {
      sql += ` AND v.CALL_TIME >= :dateFrom AND v.CALL_TIME <= :dateTo`;
      binds.dateFrom = options.dateRange.from;
      binds.dateTo = options.dateRange.to;
    }

    sql += `
        GROUP BY v.CALL_ID, v.BAN, v.SUBSCRIBER_NO, v.CALL_TIME
      )
      SELECT * FROM call_conversations
      ORDER BY CALL_DATE DESC
    `;

    return await oracleService.executeQuery(sql, binds);
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async processBatch(
    calls: any[],
    customerContext: CustomerContext,
    options: BatchProcessingOptions
  ): Promise<void> {
    const concurrencyLimit = options.maxConcurrency;
    const semaphore = new Array(concurrencyLimit).fill(null).map(() => Promise.resolve());
    let semaphoreIndex = 0;

    const processingPromises = calls.map(async (call) => {
      // Wait for an available slot
      await semaphore[semaphoreIndex];
      const currentIndex = semaphoreIndex;
      semaphoreIndex = (semaphoreIndex + 1) % concurrencyLimit;

      // Process the call
      semaphore[currentIndex] = this.processSingleCall(call, customerContext, options)
        .catch(error => {
          logger.error(`Failed to process call ${call.CALL_ID}:`, error);
          this.currentStats.failedCalls++;
        });

      return semaphore[currentIndex];
    });

    await Promise.all(processingPromises);
  }

  private async processSingleCall(
    call: any,
    customerContext: CustomerContext,
    options: BatchProcessingOptions
  ): Promise<void> {
    const startTime = Date.now();

    try {
      logger.debug(`Processing call ${call.CALL_ID}`);

      // Step 1: Generate embeddings if enabled
      let embeddingResult = null;
      if (options.processEmbeddings) {
        embeddingResult = await this.generateEmbedding(call);
        if (embeddingResult.success) {
          this.currentStats.embeddingsGenerated++;
        }
      }

      // Step 2: Store in vector database
      let vectorResult = null;
      if (embeddingResult?.success) {
        vectorResult = await this.storeInVectorDB(call, embeddingResult.embedding);
      }

      // Step 3: Generate LLM analysis if enabled
      let llmResult = null;
      if (options.processLLMAnalysis) {
        llmResult = await this.generateLLMAnalysis(call, customerContext);
        if (llmResult.success) {
          this.currentStats.llmAnalysisCompleted++;
        }
      }

      // Step 4: Save processing metadata to Oracle
      await this.saveProcessingMetadata(call, customerContext, {
        embeddingResult,
        vectorResult,
        llmResult,
        processingTime: Date.now() - startTime
      });

      this.currentStats.processedCalls++;
      logger.debug(`Successfully processed call ${call.CALL_ID}`);

    } catch (error) {
      logger.error(`Error processing call ${call.CALL_ID}:`, error);
      this.currentStats.failedCalls++;
      throw error;
    }
  }

  private async generateEmbedding(call: any): Promise<any> {
    try {
      const response = await axios.post(`${process.env.ML_SERVICE_URL || 'http://ml-service:5000'}/embeddings/generate`, {
        text: call.TRANSCRIPTION_TEXT,
        preprocess: true
      });

      return {
        success: true,
        embedding: response.data.embedding,
        model: response.data.model_name,
        processingTime: response.data.processing_time
      };
    } catch (error) {
      logger.error('Embedding generation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async storeInVectorDB(call: any, embedding: number[]): Promise<any> {
    try {
      const response = await axios.post(`${process.env.WEAVIATE_SCHEME || 'http'}://${process.env.WEAVIATE_HOST || 'weaviate'}:${process.env.WEAVIATE_PORT || '8080'}/v1/objects`, {
        class: 'CallTranscription',
        properties: {
          text: call.TRANSCRIPTION_TEXT,
          callId: call.CALL_ID.toString(),
          customerId: call.CUSTOMER_ID.toString(),
          subscriberId: call.SUBSCRIBER_ID,
          callDate: call.CALL_DATE,
          language: call.LANGUAGE,
          messageCount: call.MESSAGE_COUNT
        },
        vector: embedding
      });

      return {
        success: true,
        vectorId: response.data.id,
        confidence: 1.0
      };
    } catch (error) {
      logger.error('Vector storage failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async generateLLMAnalysis(call: any, customerContext: CustomerContext): Promise<any> {
    try {
      const llmRequest = {
        prompt: `נתח את השיחה הבאה בעברית:

פרטי השיחה:
- מזהה שיחה: ${call.CALL_ID}
- לקוח: ${call.CUSTOMER_ID}
- מנוי: ${call.SUBSCRIBER_ID}
- זמן: ${call.CALL_DATE}

תמליל השיחה:
${call.TRANSCRIPTION_TEXT}

ספק ניתוח מובנה:
סיכום: [סיכום השיחה]
בעיה: [הבעיה העיקרית]
פתרון: [הפתרון שהוצע]
רגש: [רגש הלקוח]
קטגוריה: [סוג הפנייה]`,
        systemPrompt: `אתה מנתח שיחות שירות לקוחות מומחה. נתח שיחות בעברית ותן תובנות עסקיות חשובות.`,
        metadata: {
          priority: 'normal',
          callId: call.CALL_ID,
          customerId: customerContext.customerId,
          batchProcessing: true
        }
      };

      const aiResponse = await mcpClientService.processLLMRequest(
        llmRequest,
        customerContext,
        `batch-${call.CALL_ID}`
      );

      return {
        success: aiResponse.success,
        analysis: aiResponse.response,
        model: aiResponse.model,
        service: aiResponse.service,
        processingTime: aiResponse.processingTime
      };
    } catch (error) {
      logger.error('LLM analysis failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async saveProcessingMetadata(
    call: any,
    customerContext: CustomerContext,
    results: any
  ): Promise<void> {
    const sql = `
      INSERT INTO CALL_AI_METADATA (
        CALL_ID, CUSTOMER_ID, EMBEDDING_GENERATED, VECTOR_STORED,
        SUMMARY_GENERATED, ENTITIES_EXTRACTED, SENTIMENT_ANALYZED,
        PROCESSING_TIME, CREATED_AT, LLM_ANALYSIS, LLM_MODEL, LLM_SERVICE
      ) VALUES (
        :callId, :customerId, :embeddingGenerated, :vectorStored,
        :summaryGenerated, 0, 1,
        :processingTime, SYSTIMESTAMP, :llmAnalysis, :llmModel, :llmService
      )
    `;

    await oracleService.executeQuery(sql, {
      callId: call.CALL_ID,
      customerId: customerContext.customerId,
      embeddingGenerated: results.embeddingResult?.success ? 1 : 0,
      vectorStored: results.vectorResult?.success ? 1 : 0,
      summaryGenerated: results.llmResult?.success ? 1 : 0,
      processingTime: results.processingTime || 0,
      llmAnalysis: results.llmResult?.analysis || null,
      llmModel: results.llmResult?.model || null,
      llmService: results.llmResult?.service || null
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public methods for monitoring
  getProcessingStats(): BatchProcessingStats {
    return { ...this.currentStats };
  }

  isProcessingRunning(): boolean {
    return this.isRunning;
  }

  // Queue management for real-time processing
  addToProcessingQueue(callId: string): void {
    if (!this.processingQueue.includes(callId)) {
      this.processingQueue.push(callId);
      logger.info(`Added call ${callId} to processing queue. Queue size: ${this.processingQueue.length}`);
    }
  }

  async processQueuedCalls(customerContext: CustomerContext): Promise<void> {
    if (this.processingQueue.length === 0) {
      return;
    }

    const callsToProcess = [...this.processingQueue];
    this.processingQueue = [];

    logger.info(`Processing ${callsToProcess.length} queued calls`);

    for (const callId of callsToProcess) {
      try {
        // Get call data
        const call = await this.getCallById(callId, customerContext);
        if (call) {
          await this.processSingleCall(call, customerContext, {
            batchSize: 1,
            maxConcurrency: 1,
            delayBetweenBatches: 0,
            processEmbeddings: true,
            processLLMAnalysis: true
          });
        }
      } catch (error) {
        logger.error(`Failed to process queued call ${callId}:`, error);
      }
    }
  }

  private async getCallById(callId: string, customerContext: CustomerContext): Promise<any> {
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
          COUNT(*) as MESSAGE_COUNT
        FROM VERINT_TEXT_ANALYSIS
        WHERE CALL_ID = :callId AND BAN = :customerId
        GROUP BY CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME
      )
      SELECT * FROM call_conversations
    `;

    const results = await oracleService.executeQuery(sql, {
      callId,
      customerId: customerContext.customerId
    });

    return results.length > 0 ? results[0] : null;
  }
}

export const batchProcessorService = new BatchProcessorService();