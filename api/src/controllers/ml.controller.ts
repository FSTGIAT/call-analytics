import { Response } from 'express';
import Joi from 'joi';
import { AuthenticatedRequest } from '../middleware/customer-isolation.middleware';
import { logger } from '../utils/logger';
import { mlService } from '../services/ml.service';
import { oracleService } from '../services/oracle.service';

// Validation schemas
export const processCallSchema = Joi.object({
  callData: Joi.object({
    callId: Joi.string().required(),
    subscriberId: Joi.string().required(),
    transcriptionText: Joi.string().required(),
    language: Joi.string().default('he'),
    callDate: Joi.string().isoDate(),
    durationSeconds: Joi.number().integer().min(0),
    agentId: Joi.string(),
    callType: Joi.string()
  }).required(),
  options: Joi.object({
    enableEmbeddings: Joi.boolean().default(true),
    enableLLM: Joi.boolean().default(true),
    enableVectorStorage: Joi.boolean().default(true),
    timeout: Joi.number().integer().min(1000).max(300000)
  })
});

export const batchProcessSchema = Joi.object({
  callsData: Joi.array().items(Joi.object({
    callId: Joi.string().required(),
    subscriberId: Joi.string().required(),
    transcriptionText: Joi.string().required(),
    language: Joi.string().default('he'),
    callDate: Joi.string().isoDate(),
    durationSeconds: Joi.number().integer().min(0),
    agentId: Joi.string(),
    callType: Joi.string()
  })).min(1).max(50).required(),
  options: Joi.object({
    enableEmbeddings: Joi.boolean().default(true),
    enableLLM: Joi.boolean().default(true),
    enableVectorStorage: Joi.boolean().default(true)
  })
});

export const summarizeSchema = Joi.object({
  transcription: Joi.string().required(),
  language: Joi.string().default('hebrew'),
  preferLocal: Joi.boolean().default(true)
});

export class MLController {
  static async processCall(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { callData, options } = req.body;
      const customerContext = req.customerContext!;

      logger.info(`Processing call ${callData.callId} for customer ${customerContext.customerId}`);

      // Process through ML pipeline
      const result = await mlService.processCall(callData, customerContext, options);

      // Save summary to Oracle if LLM processing was successful
      if (result.success && result.results.llmAnalysis?.summary) {
        try {
          await oracleService.saveCallSummary(
            customerContext,
            callData.callId,
            result.results.llmAnalysis.summary
          );
          
          logger.info(`Saved summary for call ${callData.callId}`);
        } catch (saveError) {
          logger.error('Failed to save summary to Oracle:', saveError);
          // Don't fail the entire request if saving fails
        }
      }

      res.json({
        success: result.success,
        callId: result.callId,
        processingTime: result.processingTime,
        results: result.results,
        errors: result.errors,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('ML process call error:', error);
      res.status(500).json({ 
        error: 'Call processing failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async processBatch(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { callsData, options } = req.body;
      const customerContext = req.customerContext!;

      logger.info(`Processing batch of ${callsData.length} calls for customer ${customerContext.customerId}`);

      // Process through ML pipeline
      const result = await mlService.processBatch(callsData, customerContext, options);

      // Save successful summaries to Oracle
      let savedSummaries = 0;
      for (const callResult of result.batchResults) {
        if (callResult.success && callResult.results.llmAnalysis?.summary) {
          try {
            await oracleService.saveCallSummary(
              customerContext,
              callResult.callId,
              callResult.results.llmAnalysis.summary
            );
            savedSummaries++;
          } catch (saveError) {
            logger.error(`Failed to save summary for call ${callResult.callId}:`, saveError);
          }
        }
      }

      res.json({
        ...result,
        savedSummaries,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('ML batch process error:', error);
      res.status(500).json({ 
        error: 'Batch processing failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async summarizeCall(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { transcription, language, preferLocal } = req.body;
      const customerContext = req.customerContext!;

      logger.info(`Summarizing call for customer ${customerContext.customerId}`);

      const result = await mlService.summarizeCall(transcription, language, preferLocal);

      res.json(result);
    } catch (error) {
      logger.error('Call summarization error:', error);
      res.status(500).json({ 
        error: 'Call summarization failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async generateEmbedding(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { text, preprocess = true } = req.body;

      if (!text) {
        res.status(400).json({ error: 'Text is required' });
        return;
      }

      const result = await mlService.generateEmbedding(text, preprocess);
      res.json(result);
    } catch (error) {
      logger.error('Embedding generation error:', error);
      res.status(500).json({ 
        error: 'Embedding generation failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async batchGenerateEmbeddings(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { texts, preprocess = true } = req.body;

      if (!texts || !Array.isArray(texts)) {
        res.status(400).json({ error: 'Texts array is required' });
        return;
      }

      if (texts.length > 100) {
        res.status(400).json({ error: 'Maximum 100 texts per batch' });
        return;
      }

      const result = await mlService.generateBatchEmbeddings(texts, preprocess);
      res.json(result);
    } catch (error) {
      logger.error('Batch embedding generation error:', error);
      res.status(500).json({ 
        error: 'Batch embedding generation failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async semanticSearch(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { query, limit = 10, certainty = 0.7, filters } = req.body;
      const customerContext = req.customerContext!;

      if (!query) {
        res.status(400).json({ error: 'Query is required' });
        return;
      }

      const result = await mlService.semanticSearch(
        query,
        customerContext.customerId,
        { limit, certainty, filters }
      );

      res.json(result);
    } catch (error) {
      logger.error('Semantic search error:', error);
      res.status(500).json({ 
        error: 'Semantic search failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async processHebrewText(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { text } = req.body;

      if (!text) {
        res.status(400).json({ error: 'Text is required' });
        return;
      }

      const result = await mlService.processHebrewText(text);
      res.json(result);
    } catch (error) {
      logger.error('Hebrew text processing error:', error);
      res.status(500).json({ 
        error: 'Hebrew text processing failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async addToVectorDB(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { transcriptionData } = req.body;
      const customerContext = req.customerContext!;

      if (!transcriptionData) {
        res.status(400).json({ error: 'Transcription data is required' });
        return;
      }

      // Ensure customer context is included
      transcriptionData.customerId = customerContext.customerId;

      const success = await mlService.addToVectorDatabase(transcriptionData);

      res.json({
        success,
        message: success ? 'Added to vector database' : 'Failed to add to vector database'
      });
    } catch (error) {
      logger.error('Vector DB add error:', error);
      res.status(500).json({ 
        error: 'Failed to add to vector database',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async batchAddToVectorDB(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { transcriptions } = req.body;
      const customerContext = req.customerContext!;

      if (!transcriptions || !Array.isArray(transcriptions)) {
        res.status(400).json({ error: 'Transcriptions array is required' });
        return;
      }

      // Ensure customer context is included in all transcriptions
      const transcriptionsWithContext = transcriptions.map(t => ({
        ...t,
        customerId: customerContext.customerId
      }));

      const result = await mlService.batchAddToVectorDatabase(transcriptionsWithContext);
      res.json(result);
    } catch (error) {
      logger.error('Vector DB batch add error:', error);
      res.status(500).json({ 
        error: 'Failed to batch add to vector database',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getMLStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const stats = await mlService.getMLStats();
      res.json(stats);
    } catch (error) {
      logger.error('ML stats error:', error);
      res.status(500).json({ 
        error: 'Failed to get ML statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async healthCheck(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const health = await mlService.healthCheck();
      
      const httpStatus = health.status === 'healthy' ? 200 : 503;
      res.status(httpStatus).json(health);
    } catch (error) {
      logger.error('ML health check error:', error);
      res.status(503).json({ 
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async testConnection(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const isConnected = await mlService.testConnection();
      
      res.json({
        connected: isConnected,
        service: 'ml-service',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('ML connection test error:', error);
      res.status(500).json({ 
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Convenience methods
  static async quickAnalyze(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { transcription } = req.body;
      const customerContext = req.customerContext!;

      if (!transcription) {
        res.status(400).json({ error: 'Transcription is required' });
        return;
      }

      // Quick analysis: sentiment + product mentions
      const [sentiment, products] = await Promise.all([
        mlService.analyzeCallSentiment(transcription),
        mlService.extractProductMentions(transcription)
      ]);

      res.json({
        sentiment,
        productsMentioned: products,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Quick analyze error:', error);
      res.status(500).json({ 
        error: 'Quick analysis failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async findSimilarCalls(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { query, limit = 5 } = req.body;
      const customerContext = req.customerContext!;

      if (!query) {
        res.status(400).json({ error: 'Query is required' });
        return;
      }

      const similarCalls = await mlService.searchSimilarCalls(query, customerContext, limit);

      res.json({
        query,
        similarCalls,
        total: similarCalls.length
      });
    } catch (error) {
      logger.error('Find similar calls error:', error);
      res.status(500).json({ 
        error: 'Finding similar calls failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}