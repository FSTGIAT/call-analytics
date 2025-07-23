import { Response } from 'express';
import Joi from 'joi';
import { AuthenticatedRequest } from '../middleware/customer-isolation.middleware';
import { oracleService } from '../services/oracle.service';
import { redisService } from '../services/redis.service';
import { CacheUtils, cacheKeys } from '../utils/cache.utils';
import { logger } from '../utils/logger';
import { mcpClientService } from '../services/mcp-client.service';
import axios from 'axios';

// Validation schemas
export const callQuerySchema = Joi.object({
  limit: Joi.number().min(1).max(1000).default(100),
  offset: Joi.number().min(0).default(0),
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso(),
  subscriberId: Joi.string(),
  language: Joi.string().valid('he', 'en', 'ar', 'ru'),
  callType: Joi.string()
});

export const summarySchema = Joi.object({
  callId: Joi.string().required(),
  summary: Joi.object({
    text: Joi.string().required(),
    keyPoints: Joi.array().items(Joi.string()),
    sentiment: Joi.string().valid('positive', 'negative', 'neutral'),
    productsMentioned: Joi.array().items(Joi.string()),
    actionItems: Joi.array().items(Joi.string())
  }).required()
});

// NEW: Call ingestion schema for AI processing
export const callIngestSchema = Joi.object({
  callId: Joi.string().required(),
  subscriberId: Joi.string().required(),
  transcriptionText: Joi.string().required(),
  language: Joi.string().valid('he', 'en', 'ar', 'ru').default('he'),
  callDate: Joi.date().iso().required(),
  durationSeconds: Joi.number().min(0),
  agentId: Joi.string(),
  callType: Joi.string().valid('support', 'sales', 'billing', 'technical').default('support'),
  metadata: Joi.object().optional()
});

// ML Service URL
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-service:5000';

export class CallsController {
  static async getTranscriptions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { limit, offset } = req.query as any;
      const customerContext = req.customerContext!;
      
      // Generate cache key
      const queryHash = CacheUtils.generateHashKey({ customerContext, limit, offset });
      const cacheKey = cacheKeys.calls.list(customerContext.customerId, queryHash);
      
      // Try to get from cache
      const cached = await CacheUtils.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      
      // Fetch from database
      const transcriptions = await oracleService.getCallTranscriptions(
        customerContext,
        limit,
        offset
      );
      
      // Cache the results
      await CacheUtils.set(cacheKey, transcriptions, 300); // 5 minutes cache
      
      res.json({
        data: transcriptions,
        pagination: {
          limit,
          offset,
          total: transcriptions.length
        }
      });
    } catch (error) {
      logger.error('Get transcriptions error:', error);
      res.status(500).json({ error: 'Failed to fetch transcriptions' });
    }
  }

  static async getTranscription(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { callId } = req.params;
      const customerContext = req.customerContext!;
      
      // Cache key
      const cacheKey = cacheKeys.calls.transcription(customerContext.customerId, callId);
      
      // Try cache first
      const cached = await CacheUtils.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      
      // Fetch from database
      const sql = `
        SELECT * FROM ${process.env.ORACLE_TABLE_TRANSCRIPTIONS || 'CALL_TRANSCRIPTIONS'}
        WHERE CALL_ID = :callId AND CUSTOMER_ID = :customerId
      `;
      
      const result = await oracleService.executeQuery(sql, {
        callId,
        customerId: customerContext.customerId
      });
      
      if (result.length === 0) {
        res.status(404).json({ error: 'Call not found' });
        return;
      }
      
      const transcription = result[0];
      
      // Cache the result
      await CacheUtils.set(cacheKey, transcription, 3600); // 1 hour cache
      
      res.json(transcription);
    } catch (error) {
      logger.error('Get transcription error:', error);
      res.status(500).json({ error: 'Failed to fetch transcription' });
    }
  }

  static async getSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { callId } = req.params;
      const customerContext = req.customerContext!;
      
      // Cache key
      const cacheKey = cacheKeys.calls.summary(customerContext.customerId, callId);
      
      // Try cache first
      const cached = await CacheUtils.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      
      // Fetch from database
      const summaries = await oracleService.getCallSummaries(customerContext, [callId]);
      
      if (summaries.length === 0) {
        res.status(404).json({ error: 'Summary not found' });
        return;
      }
      
      const summary = summaries[0];
      
      // Parse JSON fields
      if (summary.KEY_POINTS) summary.keyPoints = JSON.parse(summary.KEY_POINTS);
      if (summary.PRODUCTS_MENTIONED) summary.productsMentioned = JSON.parse(summary.PRODUCTS_MENTIONED);
      if (summary.ACTION_ITEMS) summary.actionItems = JSON.parse(summary.ACTION_ITEMS);
      
      // Cache the result
      await CacheUtils.set(cacheKey, summary, 3600); // 1 hour cache
      
      res.json(summary);
    } catch (error) {
      logger.error('Get summary error:', error);
      res.status(500).json({ error: 'Failed to fetch summary' });
    }
  }

  static async createSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { callId, summary } = req.body;
      const customerContext = req.customerContext!;
      
      // Save to database
      await oracleService.saveCallSummary(customerContext, callId, summary);
      
      // Invalidate cache
      const cacheKey = cacheKeys.calls.summary(customerContext.customerId, callId);
      await redisService.del(cacheKey);
      
      logger.info('Call summary created', {
        callId,
        customerId: customerContext.customerId
      });
      
      res.status(201).json({
        message: 'Summary created successfully',
        callId
      });
    } catch (error) {
      logger.error('Create summary error:', error);
      res.status(500).json({ error: 'Failed to create summary' });
    }
  }

  static async getCallStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const customerContext = req.customerContext!;
      
      const sql = `
        SELECT 
          COUNT(*) as total_calls,
          AVG(DURATION_SECONDS) as avg_duration,
          COUNT(DISTINCT SUBSCRIBER_ID) as unique_subscribers,
          COUNT(DISTINCT AGENT_ID) as unique_agents,
          LANGUAGE,
          CALL_TYPE
        FROM ${process.env.ORACLE_TABLE_TRANSCRIPTIONS || 'CALL_TRANSCRIPTIONS'}
        WHERE CUSTOMER_ID = :customerId
        AND CALL_DATE >= SYSDATE - 30
        GROUP BY LANGUAGE, CALL_TYPE
      `;
      
      const stats = await oracleService.executeQuery(sql, {
        customerId: customerContext.customerId
      });
      
      res.json({
        stats,
        period: 'last_30_days'
      });
    } catch (error) {
      logger.error('Get call stats error:', error);
      res.status(500).json({ error: 'Failed to fetch statistics' });
    }
  }

  // NEW AI PIPELINE INGESTION METHODS
  static async ingestCall(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const callData = req.body;
      const customerContext = req.customerContext!;
      const useAdvancedAI = req.body.use_advanced_ai || false;
      
      logger.info('Starting call ingestion through MCP Client AI router', {
        callId: callData.callId,
        customerId: customerContext.customerId,
        useAdvancedAI
      });

      // Step 1: Process embeddings and basic ML through traditional pipeline
      const mlResponse = await axios.post(`${ML_SERVICE_URL}/pipeline/process-call`, {
        call_data: callData,
        customer_context: customerContext,
        options: {
          generate_embeddings: true,
          store_vectors: true,
          extract_entities: true,
          summarize: false // Don't summarize yet - MCP Client will handle this
        }
      });

      // Step 2: Use MCP Client for intelligent AI processing (summary, insights)
      const llmRequest = {
        prompt: `Analyze this Hebrew call transcript and provide insights:
        
Call Details:
- Call ID: ${callData.callId}
- Customer: ${callData.subscriberId}
- Duration: ${callData.durationSeconds}s
- Language: ${callData.language}

Transcript:
"${callData.transcriptionText}"

Please provide:
1. Summary in Hebrew
2. Key issues identified
3. Customer sentiment
4. Recommended actions
5. Priority level`,
        systemPrompt: `You are an expert call center analyst specializing in Hebrew customer service. 
        Provide detailed analysis focusing on customer satisfaction and operational insights.`,
        metadata: {
          priority: useAdvancedAI ? 'high' : 'normal',
          callId: callData.callId,
          customerId: customerContext.customerId
        }
      };

      const aiResponse = await mcpClientService.processLLMRequest(
        llmRequest,
        customerContext,
        `call-${callData.callId}`
      );

      // Step 3: Combine results and save to database
      const combinedResults = {
        ...mlResponse.data.results,
        ai_analysis: {
          success: aiResponse.success,
          summary: aiResponse.response,
          model_used: aiResponse.model,
          service_used: aiResponse.service,
          processing_time: aiResponse.processingTime
        }
      };

      if (mlResponse.data.success) {
        // Save processed results to database
        await oracleService.saveProcessedCall(customerContext, callData, combinedResults);

        // Invalidate relevant caches
        await redisService.del(cacheKeys.calls.list(customerContext.customerId, '*'));
      }

      logger.info('Call successfully processed through MCP Client pipeline', {
        callId: callData.callId,
        mlProcessingTime: mlResponse.data.processing_time,
        aiProcessingTime: aiResponse.processingTime,
        aiService: aiResponse.service,
        aiModel: aiResponse.model
      });

      res.status(201).json({
        success: true,
        callId: callData.callId,
        processing: {
          ml_pipeline: {
            success: mlResponse.data.success,
            processing_time: mlResponse.data.processing_time,
            results: {
              embeddingGenerated: mlResponse.data.results?.embedding_result?.success || false,
              entitiesExtracted: mlResponse.data.results?.entity_result?.success || false,
              vectorStored: mlResponse.data.results?.vector_result?.success || false
            }
          },
          ai_analysis: {
            success: aiResponse.success,
            processing_time: aiResponse.processingTime,
            model_used: aiResponse.model,
            service_used: aiResponse.service,
            has_summary: !!aiResponse.response
          }
        },
        insights: {
          summary: aiResponse.response,
          ai_service_route: `${aiResponse.service} (${aiResponse.model})`
        }
      });

    } catch (error) {
      logger.error('Call ingestion error:', error);
      res.status(500).json({ 
        error: 'Failed to ingest call',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async ingestBatch(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { calls_data } = req.body;
      const customerContext = req.customerContext!;

      if (!calls_data || !Array.isArray(calls_data)) {
        res.status(400).json({ error: 'calls_data array is required' });
        return;
      }

      if (calls_data.length > 50) {
        res.status(400).json({ error: 'Maximum 50 calls per batch' });
        return;
      }

      logger.info('Starting batch call ingestion', {
        batchSize: calls_data.length,
        customerId: customerContext.customerId
      });

      // Process batch through ML pipeline
      const mlResponse = await axios.post(`${ML_SERVICE_URL}/pipeline/process-batch`, {
        calls_data,
        customer_context: customerContext,
        options: {
          generate_embeddings: true,
          store_vectors: true,
          summarize: true,
          extract_entities: true
        }
      });

      const batchResults = mlResponse.data.batch_results;
      const summary = mlResponse.data.summary;

      // Save all successful results to database
      const savedCalls = [];
      for (const result of batchResults) {
        if (result.success) {
          try {
            await oracleService.saveProcessedCall(
              customerContext, 
              calls_data.find(c => c.callId === result.call_id),
              result.results
            );
            savedCalls.push(result.call_id);
          } catch (error) {
            logger.error(`Failed to save call ${result.call_id}:`, error);
          }
        }
      }

      // Invalidate caches
      await redisService.del(cacheKeys.calls.list(customerContext.customerId, '*'));

      logger.info('Batch call ingestion completed', {
        totalCalls: calls_data.length,
        successful: summary.successful,
        saved: savedCalls.length
      });

      res.status(201).json({
        success: true,
        summary: {
          total: calls_data.length,
          successful: summary.successful,
          failed: summary.failed,
          saved: savedCalls.length,
          avgProcessingTime: summary.avg_processing_time
        },
        results: batchResults.map(r => ({
          callId: r.call_id,
          success: r.success,
          processingTime: r.processing_time,
          errors: r.errors
        }))
      });

    } catch (error) {
      logger.error('Batch ingestion error:', error);
      res.status(500).json({ 
        error: 'Failed to ingest batch',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}