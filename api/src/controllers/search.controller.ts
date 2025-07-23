import { Response } from 'express';
import Joi from 'joi';
import axios from 'axios';
import { AuthenticatedRequest } from '../middleware/customer-isolation.middleware';
import { CacheUtils, cacheKeys } from '../utils/cache.utils';
import { logger } from '../utils/logger';
import { mlService } from '../services/ml.service';
import { oracleService } from '../services/oracle.service';
import { openSearchService } from '../services/opensearch.service';
import { mcpClientService } from '../services/mcp-client.service';

// Validation schemas
export const searchSchema = Joi.object({
  query: Joi.string().min(2).required(),
  type: Joi.string().valid('semantic', 'keyword', 'hybrid').default('hybrid'),
  limit: Joi.number().min(1).max(100).default(20),
  filters: Joi.object({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
    language: Joi.string(),
    sentiment: Joi.string().valid('positive', 'negative', 'neutral'),
    hasProducts: Joi.boolean()
  })
});

export class SearchController {
  static async search(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { query, type, limit, filters } = req.body;
      const customerContext = req.customerContext!;
      
      // Generate cache key
      const queryHash = CacheUtils.generateHashKey({ query, type, filters, customerContext });
      const cacheKey = cacheKeys.search.results(customerContext.customerId, queryHash);
      
      // Try cache first
      const cached = await CacheUtils.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      
      let results: any[] = [];
      
      try {
        if (type === 'semantic' || type === 'hybrid') {
          // Use intelligent search from ML service
          const searchResult = await mlService.intelligentSearch(query, customerContext, {
            limit,
            certainty: 0.7,
            filters
          });
          
          if (searchResult.success) {
            results = searchResult.results;
          } else {
            logger.warn('ML intelligent search failed, falling back to basic search');
          }
        }
        
        if ((type === 'keyword' || type === 'hybrid') && results.length === 0) {
          // Use OpenSearch service for keyword search
          try {
            const searchQuery = {
              query,
              filters,
              size: limit
            };

            const opensearchResponse = await openSearchService.search(
              customerContext,
              'transcriptions',
              searchQuery
            );
            
            const keywordResults = opensearchResponse.results.map((result: any) => ({
              ...result,
              search_source: 'opensearch',
              score: result._score
            }));
            
            // Merge with existing results if hybrid
            if (type === 'hybrid' && results.length > 0) {
              results = mergeSearchResults(results, keywordResults);
            } else {
              results = keywordResults;
            }
          } catch (opensearchError) {
            logger.error('OpenSearch service failed:', opensearchError);
            // If all search methods fail, return empty results
            results = [];
          }
        }
        
        // Cache results
        await CacheUtils.set(cacheKey, results, 300); // 5 minutes cache
        
        res.json({
          query,
          type,
          results,
          total: results.length,
          cached: false
        });
        
      } catch (mlError) {
        logger.error('ML service search error:', mlError);
        
        // Fallback to simple database search
        try {
          // Simple fallback search using Oracle DB
          const fallbackResults = await searchInDatabase(query, customerContext, limit);
          
          res.json({
            query,
            type: 'fallback',
            results: fallbackResults,
            total: fallbackResults.length,
            warning: 'Used fallback search method'
          });
        } catch (fallbackError) {
          logger.error('Fallback search also failed:', fallbackError);
          res.status(500).json({ 
            error: 'All search methods failed',
            details: 'Please try again later'
          });
        }
      }
    } catch (error) {
      logger.error('Search controller error:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  }

  static async suggest(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { prefix } = req.query as any;
      const customerContext = req.customerContext!;
      
      if (!prefix || prefix.length < 2) {
        res.json({ suggestions: [] });
        return;
      }
      
      // Get suggestions from OpenSearch service
      const suggestions = await openSearchService.suggest(
        customerContext,
        'transcriptions',
        prefix,
        'transcriptionText'
      );
      
      res.json({ suggestions });
    } catch (error) {
      logger.error('Suggest error:', error);
      res.status(500).json({ error: 'Suggestions failed' });
    }
  }

  // NEW: Pure semantic search using vector embeddings
  static async semanticSearch(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { query, limit = 10, certainty = 0.7, filters } = req.body;
      const customerContext = req.customerContext!;

      if (!query) {
        res.status(400).json({ error: 'Query is required' });
        return;
      }

      logger.info('Performing semantic search', {
        query,
        customerId: customerContext.customerId
      });

      // Use ML service vector search
      // For admin users, don't filter by customer_id to search all data
      const isAdmin = req.user?.role === 'admin';
      const mlResponse = await axios.post(`${process.env.ML_SERVICE_URL || 'http://ml-service:5000'}/vector/search`, {
        query,
        customer_id: isAdmin ? null : customerContext.customerId,
        limit,
        certainty,
        filters
      });

      const results = mlResponse.data.results || [];

      // Enrich results with additional call metadata
      const enrichedResults = await Promise.all(
        results.map(async (result: any) => {
          try {
            // Get full call details from database
            const callDetails = await oracleService.getCallById(customerContext, result.call_id);
            return {
              ...result,
              callDetails,
              similarityScore: 1 - (result._additional?.distance || 0),
              searchType: 'semantic'
            };
          } catch (error) {
            logger.warn(`Failed to enrich result for call ${result.call_id}:`, error);
            return result;
          }
        })
      );

      res.json({
        query,
        searchType: 'semantic',
        results: enrichedResults,
        total: enrichedResults.length,
        certainty,
        processingTime: mlResponse.data.processing_time
      });

    } catch (error) {
      logger.error('Semantic search error:', error);
      res.status(500).json({ 
        error: 'Semantic search failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // NEW: Chat with call data using MCP Client
  static async chatWithCalls(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { question, context = 'all', limit = 5, use_advanced_ai = false } = req.body;
      const customerContext = req.customerContext!;

      if (!question) {
        res.status(400).json({ error: 'Question is required' });
        return;
      }

      logger.info('Starting MCP Client chat interaction with call data', {
        question,
        customerId: customerContext.customerId,
        useAdvancedAI: use_advanced_ai
      });

      // Step 1: Find relevant calls using semantic search
      // For admin users, don't filter by customer_id to search all data
      const isAdmin = req.user?.role === 'admin';
      const relevantCalls = await axios.post(`${process.env.ML_SERVICE_URL || 'http://ml-service:5000'}/vector/search`, {
        query: question,
        customer_id: isAdmin ? null : customerContext.customerId,
        limit,
        certainty: 0.6
      });

      // Step 2: Prepare context from relevant calls
      const callContext = relevantCalls.data.results.map((call: any) => ({
        callId: call.callId,
        transcription: call.transcriptionText,
        date: call.callDate,
        sentiment: call.sentiment,
        summary: call.summary
      }));

      // Step 3: Use MCP Client for intelligent chat response
      const conversationId = `chat-${customerContext.customerId}-${Date.now()}`;
      
      const llmRequest = {
        prompt: buildChatPrompt(question, callContext),
        systemPrompt: `You are an expert AI assistant analyzing customer service calls. 
        Provide insightful analysis based on the provided call transcriptions.
        
        Guidelines:
        - Always reference specific call IDs when making claims
        - Respond in the same language as the user's question
        - Focus on actionable insights for customer service improvement
        - Identify patterns, trends, and recommendations
        - Be specific and data-driven in your analysis`,
        metadata: {
          priority: use_advanced_ai ? 'high' : 'normal',
          interaction_type: 'chat',
          call_count: callContext.length,
          customerId: customerContext.customerId
        }
      };

      const aiResponse = await mcpClientService.processLLMRequest(
        llmRequest,
        customerContext,
        conversationId
      );

      // Step 4: Return structured response with MCP routing info
      res.json({
        question,
        answer: aiResponse.response,
        ai_routing: {
          service_used: aiResponse.service,
          model_used: aiResponse.model,
          processing_time: aiResponse.processingTime,
          success: aiResponse.success
        },
        relevantCalls: callContext.map(call => ({
          callId: call.callId,
          date: call.date,
          summary: call.summary || call.transcription.substring(0, 200) + '...'
        })),
        confidence: calculateConfidence(relevantCalls.data.results),
        conversation_id: conversationId,
        search_metadata: {
          total_found: relevantCalls.data.results.length,
          search_time: relevantCalls.data.processing_time
        }
      });

    } catch (error) {
      logger.error('Chat with calls error:', error);
      res.status(500).json({ 
        error: 'Chat functionality failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

function buildFilters(filters: any): any[] {
  const elasticFilters: any[] = [];
  
  if (filters.dateFrom || filters.dateTo) {
    const range: any = { callDate: {} };
    if (filters.dateFrom) range.callDate.gte = filters.dateFrom;
    if (filters.dateTo) range.callDate.lte = filters.dateTo;
    elasticFilters.push({ range });
  }
  
  if (filters.language) {
    elasticFilters.push({ term: { language: filters.language } });
  }
  
  if (filters.sentiment) {
    elasticFilters.push({ term: { sentiment: filters.sentiment } });
  }
  
  if (filters.hasProducts !== undefined) {
    elasticFilters.push({
      exists: { field: 'productsMentioned' }
    });
  }
  
  return elasticFilters;
}

function mergeSearchResults(semanticResults: any[], keywordResults: any[]): any[] {
  const merged = new Map();
  
  // Add semantic results with boosted score
  semanticResults.forEach(result => {
    merged.set(result.callId, {
      ...result,
      score: (1 - result._additional.distance) * 1.5, // Boost semantic scores
      matchType: 'semantic'
    });
  });
  
  // Add or merge keyword results
  keywordResults.forEach(result => {
    if (merged.has(result.callId)) {
      const existing = merged.get(result.callId);
      existing.score += result.score;
      existing.matchType = 'hybrid';
      existing.highlights = result.highlights;
    } else {
      merged.set(result.callId, {
        ...result,
        matchType: 'keyword'
      });
    }
  });
  
  // Sort by score and return
  return Array.from(merged.values()).sort((a, b) => b.score - a.score);
}

async function searchInDatabase(query: string, customerContext: any, limit: number): Promise<any[]> {
  try {
    // Simple text search in Oracle database
    const sql = `
      SELECT 
        CALL_ID,
        CUSTOMER_ID,
        SUBSCRIBER_ID,
        TRANSCRIPTION_TEXT,
        CALL_DATE,
        DURATION_SECONDS,
        LANGUAGE,
        CALL_TYPE
      FROM ${process.env.ORACLE_TABLE_TRANSCRIPTIONS || 'CALL_TRANSCRIPTIONS'}
      WHERE CUSTOMER_ID = :customerId
      AND LOWER(TRANSCRIPTION_TEXT) LIKE LOWER(:searchPattern)
      ORDER BY CALL_DATE DESC
      FETCH NEXT :limit ROWS ONLY
    `;

    const results = await oracleService.executeQuery(sql, {
      customerId: customerContext.customerId,
      searchPattern: `%${query}%`,
      limit
    });

    return results.map(row => ({
      callId: row.CALL_ID,
      customerId: row.CUSTOMER_ID,
      subscriberId: row.SUBSCRIBER_ID,
      transcriptionText: row.TRANSCRIPTION_TEXT,
      callDate: row.CALL_DATE,
      durationSeconds: row.DURATION_SECONDS,
      language: row.LANGUAGE,
      callType: row.CALL_TYPE,
      search_source: 'database_fallback',
      score: 1.0
    }));
  } catch (error) {
    logger.error('Database search failed:', error);
    return [];
  }
}

// Helper function to build chat prompt with call context
function buildChatPrompt(question: string, callContext: any[]): string {
  const contextText = callContext.map(call => 
    `Call ID: ${call.callId}\nDate: ${call.date}\nTranscription: ${call.transcription}\n---`
  ).join('\n\n');

  return `
Based on the following customer call transcriptions, please answer this question: "${question}"

Call Data:
${contextText}

Please provide a comprehensive answer based on the call data above. Include specific call references when making claims.
  `;
}

// Helper function to calculate confidence based on search results
function calculateConfidence(results: any[]): number {
  if (results.length === 0) return 0;
  
  const avgDistance = results.reduce((sum, result) => 
    sum + (result._additional?.distance || 1), 0) / results.length;
  
  return Math.max(0, Math.min(1, 1 - avgDistance));
}