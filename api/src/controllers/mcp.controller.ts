import { Response } from 'express';
import Joi from 'joi';
import { AuthenticatedRequest } from '../middleware/customer-isolation.middleware';
import { logger } from '../utils/logger';
import { mcpClientService, LLMRequest } from '../services/mcp-client.service';

// Validation schemas
export const llmRequestSchema = Joi.object({
  prompt: Joi.string().min(1).max(10000).required(),
  systemPrompt: Joi.string().max(2000),
  temperature: Joi.number().min(0).max(2).default(0.3),
  maxTokens: Joi.number().integer().min(1).max(8000).default(2000),
  model: Joi.string().valid('auto', 'local', 'cloud').default('auto'),
  conversationId: Joi.string().uuid(),
  metadata: Joi.object({
    priority: Joi.string().valid('low', 'normal', 'high', 'realtime').default('normal'),
    context: Joi.string(),
    language: Joi.string().default('hebrew')
  })
});

export const conversationSchema = Joi.object({
  conversationId: Joi.string().uuid().required()
});

export const configUpdateSchema = Joi.object({
  enabled: Joi.boolean(),
  timeout: Joi.number().integer().min(1000).max(60000),
  retries: Joi.number().integer().min(1).max(10),
  fallbackEnabled: Joi.boolean()
});

export class MCPController {
  static async processLLMRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { 
        prompt, 
        systemPrompt, 
        temperature, 
        maxTokens, 
        model, 
        conversationId, 
        metadata 
      } = req.body;
      
      const customerContext = req.customerContext!;

      logger.info(`Processing LLM request for customer ${customerContext.customerId}`);

      const llmRequest: LLMRequest = {
        prompt,
        systemPrompt,
        temperature,
        maxTokens,
        model,
        metadata
      };

      // Force routing if model is specified
      if (model === 'local' || model === 'cloud') {
        llmRequest.metadata = {
          ...llmRequest.metadata,
          forceRouting: model
        };
      }

      const result = await mcpClientService.processLLMRequest(
        llmRequest,
        customerContext,
        conversationId
      );

      res.json({
        success: result.success,
        response: result.response,
        model: result.model,
        service: result.service,
        processing_time: result.processingTime,
        metadata: result.metadata,
        conversation_id: conversationId,
        error: result.error
      });
    } catch (error) {
      logger.error('MCP LLM request error:', error);
      res.status(500).json({ 
        error: 'LLM request processing failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async createConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const conversationId = req.body.conversationId || crypto.randomUUID();
      const customerContext = req.customerContext!;

      logger.info(`Creating conversation ${conversationId} for customer ${customerContext.customerId}`);

      mcpClientService.createConversation(conversationId);

      res.json({
        conversation_id: conversationId,
        created_at: new Date().toISOString(),
        customer_id: customerContext.customerId
      });
    } catch (error) {
      logger.error('Create conversation error:', error);
      res.status(500).json({ 
        error: 'Failed to create conversation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async endConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const customerContext = req.customerContext!;

      logger.info(`Ending conversation ${conversationId} for customer ${customerContext.customerId}`);

      mcpClientService.endConversation(conversationId);

      res.json({
        conversation_id: conversationId,
        ended_at: new Date().toISOString(),
        message: 'Conversation ended successfully'
      });
    } catch (error) {
      logger.error('End conversation error:', error);
      res.status(500).json({ 
        error: 'Failed to end conversation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getActiveConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const customerContext = req.customerContext!;
      const activeConversations = mcpClientService.getActiveConversations();

      // In a real implementation, you'd filter by customer context
      // For now, return all active conversations
      
      res.json({
        customer_id: customerContext.customerId,
        active_conversations: activeConversations,
        total_count: activeConversations.length
      });
    } catch (error) {
      logger.error('Get active conversations error:', error);
      res.status(500).json({ 
        error: 'Failed to get active conversations',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getRoutingStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const routingStats = mcpClientService.getRoutingStats();
      const loadBalancingMetrics = mcpClientService.getLoadBalancingMetrics();

      res.json({
        routing_statistics: routingStats,
        load_balancing_metrics: loadBalancingMetrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get routing stats error:', error);
      res.status(500).json({ 
        error: 'Failed to get routing statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async healthCheck(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const health = await mcpClientService.healthCheck();
      
      const overallHealth = health.local_llm.available || health.cloud_llm.available;
      const httpStatus = overallHealth ? 200 : 503;

      res.status(httpStatus).json({
        status: overallHealth ? 'healthy' : 'unhealthy',
        service: 'mcp-client',
        health_details: health,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('MCP health check error:', error);
      res.status(503).json({ 
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async updateConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const configUpdates = req.body;
      const currentConfig = mcpClientService.getConfig();

      logger.info('Updating MCP client configuration');

      mcpClientService.updateConfig(configUpdates);
      const newConfig = mcpClientService.getConfig();

      res.json({
        message: 'Configuration updated successfully',
        previous_config: currentConfig,
        current_config: newConfig,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Update MCP config error:', error);
      res.status(500).json({ 
        error: 'Failed to update configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const config = mcpClientService.getConfig();

      res.json({
        configuration: config,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get MCP config error:', error);
      res.status(500).json({ 
        error: 'Failed to get configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Smart routing test endpoint
  static async testRouting(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { 
        testPrompts = [
          'שלום, איך אני יכול לעזור לך?',
          'Hello, how can I help you today?',
          'מה המצב עם החשבון שלי?',
          'I need technical support for my internet connection.'
        ]
      } = req.body;

      const customerContext = req.customerContext!;
      const testResults = [];

      logger.info(`Running routing test with ${testPrompts.length} prompts`);

      for (const prompt of testPrompts) {
        const startTime = Date.now();
        
        try {
          const result = await mcpClientService.processLLMRequest(
            { prompt, metadata: { priority: 'normal' } },
            customerContext
          );

          testResults.push({
            prompt: prompt.substring(0, 50) + '...',
            success: result.success,
            service: result.service,
            model: result.model,
            response_time: result.processingTime,
            response_preview: result.response?.substring(0, 100) + '...'
          });
        } catch (testError) {
          testResults.push({
            prompt: prompt.substring(0, 50) + '...',
            success: false,
            error: testError instanceof Error ? testError.message : 'Unknown error',
            response_time: Date.now() - startTime
          });
        }
      }

      // Calculate test summary
      const summary = {
        total_tests: testResults.length,
        successful: testResults.filter(r => r.success).length,
        failed: testResults.filter(r => !r.success).length,
        avg_response_time: testResults.reduce((sum, r) => sum + (r.response_time || 0), 0) / testResults.length,
        local_routing: testResults.filter(r => r.service === 'local').length,
        cloud_routing: testResults.filter(r => r.service === 'cloud').length
      };

      res.json({
        test_summary: summary,
        test_results: testResults,
        routing_stats: mcpClientService.getRoutingStats(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Routing test error:', error);
      res.status(500).json({ 
        error: 'Routing test failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Load balancing test
  static async testLoadBalancing(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { 
        concurrentRequests = 5,
        testDuration = 30000 // 30 seconds
      } = req.body;

      const customerContext = req.customerContext!;
      
      logger.info(`Running load balancing test: ${concurrentRequests} concurrent requests for ${testDuration}ms`);

      const testPrompt = 'זהו בדיקה של מערכת איזון העומסים. אנא ענה בקצרה.';
      const startTime = Date.now();
      const results: any[] = [];

      // Create concurrent requests
      const promises = Array.from({ length: concurrentRequests }, async (_, index) => {
        const requestStartTime = Date.now();
        
        try {
          const result = await mcpClientService.processLLMRequest(
            { 
              prompt: `${testPrompt} (Request #${index + 1})`,
              metadata: { priority: 'normal', testRequest: true }
            },
            customerContext
          );

          return {
            request_id: index + 1,
            success: result.success,
            service: result.service,
            model: result.model,
            response_time: Date.now() - requestStartTime,
            processing_time: result.processingTime
          };
        } catch (error) {
          return {
            request_id: index + 1,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            response_time: Date.now() - requestStartTime
          };
        }
      });

      const testResults = await Promise.all(promises);
      const totalTestTime = Date.now() - startTime;

      // Analyze results
      const analysis = {
        test_duration: totalTestTime,
        concurrent_requests: concurrentRequests,
        successful_requests: testResults.filter(r => r.success).length,
        failed_requests: testResults.filter(r => !r.success).length,
        local_requests: testResults.filter(r => r.service === 'local').length,
        cloud_requests: testResults.filter(r => r.service === 'cloud').length,
        avg_response_time: testResults.reduce((sum, r) => sum + r.response_time, 0) / testResults.length,
        min_response_time: Math.min(...testResults.map(r => r.response_time)),
        max_response_time: Math.max(...testResults.map(r => r.response_time)),
        requests_per_second: (testResults.length / totalTestTime) * 1000
      };

      res.json({
        load_balancing_analysis: analysis,
        detailed_results: testResults,
        current_metrics: mcpClientService.getLoadBalancingMetrics(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Load balancing test error:', error);
      res.status(500).json({ 
        error: 'Load balancing test failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}