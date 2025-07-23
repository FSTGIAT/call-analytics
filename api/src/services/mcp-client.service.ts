import { logger } from '../utils/logger';
import { CustomerContext } from '../types/customer';

export interface MCPConfig {
  enabled: boolean;
  serverUrl: string;
  timeout: number;
  retries: number;
  fallbackEnabled: boolean;
}

export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  metadata?: any;
}

export interface LLMResponse {
  success: boolean;
  response?: string;
  model: string;
  service: 'local' | 'cloud';
  processingTime: number;
  metadata?: any;
  error?: string;
}

export interface ContextWindow {
  conversationId: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
  }>;
  tokenCount: number;
  maxTokens: number;
}

export interface LoadBalancingMetrics {
  localLLM: {
    available: boolean;
    queueLength: number;
    avgResponseTime: number;
    errorRate: number;
    lastHealthCheck: string;
  };
  cloudLLM: {
    available: boolean;
    quotaRemaining?: number;
    avgResponseTime: number;
    errorRate: number;
    lastHealthCheck: string;
  };
}

export class MCPClientService {
  private config: MCPConfig;
  private contextWindows: Map<string, ContextWindow> = new Map();
  private loadBalancingMetrics: LoadBalancingMetrics;
  private routingStats = {
    localRequests: 0,
    cloudRequests: 0,
    fallbackActivations: 0,
    totalRequests: 0
  };

  constructor() {
    this.config = {
      enabled: process.env.MCP_ENABLED === 'true',
      serverUrl: process.env.MCP_SERVER_URL || 'http://localhost:3001',
      timeout: parseInt(process.env.MCP_TIMEOUT || '50000'),
      retries: parseInt(process.env.MCP_RETRIES || '3'),
      fallbackEnabled: process.env.MCP_FALLBACK_ENABLED !== 'false'
    };

    this.loadBalancingMetrics = {
      localLLM: {
        available: true,
        queueLength: 0,
        avgResponseTime: 1000,
        errorRate: 0,
        lastHealthCheck: new Date().toISOString()
      },
      cloudLLM: {
        available: true,
        avgResponseTime: 2000,
        errorRate: 0,
        lastHealthCheck: new Date().toISOString()
      }
    };

    logger.info(`MCP Client Service initialized: ${this.config.enabled ? 'enabled' : 'disabled'}`);
  }

  async processLLMRequest(
    request: LLMRequest,
    customerContext: CustomerContext,
    conversationId?: string
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    this.routingStats.totalRequests++;

    try {
      // Update context window if conversation ID provided
      if (conversationId) {
        this.updateContextWindow(conversationId, 'user', request.prompt);
      }

      // Smart routing decision
      const useLocalLLM = await this.shouldUseLocalLLM(request, customerContext);
      
      if (useLocalLLM) {
        logger.debug(`Routing request to local LLM for customer ${customerContext.customerId}`);
        return await this.processWithLocalLLM(request, customerContext, conversationId);
      } else {
        logger.debug(`Routing request to cloud LLM for customer ${customerContext.customerId}`);
        return await this.processWithCloudLLM(request, customerContext, conversationId);
      }
    } catch (error) {
      logger.error('MCP request processing failed:', {
        message: error.message,
        stack: error.stack
      });
      
      // Try fallback if enabled
      if (this.config.fallbackEnabled) {
        logger.info('Attempting fallback processing');
        this.routingStats.fallbackActivations++;
        return await this.processFallback(request, customerContext, conversationId);
      }

      return {
        success: false,
        model: 'unknown',
        service: 'local',
        processingTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async shouldUseLocalLLM(
    request: LLMRequest,
    customerContext: CustomerContext
  ): Promise<boolean> {

    // Priority factors for local processing
    const localFactors = {
      // Real-time requests prefer local (lower latency)
      realTime: request.metadata?.priority === 'realtime' ? 1.5 : 1,
      
      // Customer tier (premium customers prefer local)
      customerTier: (customerContext.tier === 'premium') ? 1.3 : 1,
      
      // Request complexity (simple requests prefer local)
      complexity: (request.prompt.length < 1000) ? 1.2 : 0.8
    };

    const localScore = Object.values(localFactors).reduce((a, b) => a * b, 1);
    
    const shouldUseLocal = localScore > 0.5 && 
           this.loadBalancingMetrics.localLLM.avgResponseTime < 10000 &&
           this.loadBalancingMetrics.localLLM.errorRate < 0.5;
    
    logger.debug('Local LLM routing decision:', {
      localScore,
      factors: localFactors,
      avgResponseTime: this.loadBalancingMetrics.localLLM.avgResponseTime,
      errorRate: this.loadBalancingMetrics.localLLM.errorRate,
      shouldUseLocal
    });
    
    return shouldUseLocal;
  }

  private async processWithLocalLLM(
    request: LLMRequest,
    customerContext: CustomerContext,
    conversationId?: string
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    this.routingStats.localRequests++;

    try {
      // Get conversation context for follow-up questions
      let contextualPrompt = request.prompt;
      let contextualSystemPrompt = request.systemPrompt;
      
      if (conversationId) {
        const context = this.getContextWindow(conversationId);
        if (context && context.messages.length > 1) {
          // Get recent conversation history (last 8 exchanges max for better continuity)
          const recentMessages = context.messages.slice(-16); // 8 user + 8 assistant messages
          const conversationHistory = recentMessages
            .filter(msg => msg.role !== 'system')
            .map(msg => {
              const role = msg.role === 'user' ? 'משתמש' : 'מערכת';
              return `${role}: ${msg.content}`;
            })
            .join('\n');
          
          if (conversationHistory.length > 0) {
            // Prioritize current question and let LLM decide when to use context
            contextualSystemPrompt = `CURRENT QUESTION: ${request.prompt}

${request.systemPrompt}`;
            
            // Only add conversation history as reference, not as instruction
            if (conversationHistory.length < 1000) { // Prevent too much context
              contextualSystemPrompt += `

Available context if needed: ${conversationHistory}`;
            }

            logger.debug('Added conversation context', {
              conversationId,
              historyLength: conversationHistory.length,
              messageCount: recentMessages.length
            });
          }
        }
      }

      // Call Ollama service via ML service's generate endpoint
      const axios = (await import('axios')).default;
      const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://ml-service:5000';
      
      const requestData = {
        prompt: contextualPrompt,
        system_prompt: contextualSystemPrompt,
        prefer_local: true,
        max_tokens: request.maxTokens || 8000,
        temperature: request.temperature || 0.3
      };
      
      logger.debug('Sending request to ML service:', {
        promptLength: contextualPrompt.length,
        systemPromptLength: contextualSystemPrompt.length,
        hasPrompt: !!contextualPrompt,
        hasSystemPrompt: !!contextualSystemPrompt
      });
      
      const response = await axios.post(`${mlServiceUrl}/llm/generate`, requestData);

      const processingTime = Date.now() - startTime;
      
      logger.debug('ML Service LLM generate response:', {
        success: response.data.success,
        model: response.data.model,
        contentLength: response.data.content?.length || 0,
        hasContent: !!response.data.content,
        fullResponse: response.data
      });
      
      // Update metrics
      this.updateLocalMetrics(true, processingTime);

      // Extract the actual response content - HuggingFace returns it in 'content' field
      const actualResponse = response.data.content || response.data.response;
      
      if (!actualResponse || actualResponse.trim().length === 0) {
        logger.error('Empty or no response content from ML service', { 
          responseData: response.data,
          hasContent: !!response.data.content,
          contentLength: response.data.content?.length || 0,
          success: response.data.success 
        });
      }

      // Update context window
      if (conversationId && response.data.success && actualResponse) {
        this.updateContextWindow(conversationId, 'assistant', actualResponse);
      }

      return {
        success: response.data.success,
        response: actualResponse || 'I was unable to generate a response. Please try again.',
        model: response.data.model || 'llama-3.1-70b',
        service: 'local',
        processingTime,
        metadata: {
          service_used: response.data.service || 'huggingface',
          processing_details: response.data.metadata
        }
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateLocalMetrics(false, processingTime);
      
      logger.error('Local LLM processing failed:', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  private async processWithCloudLLM(
    request: LLMRequest,
    customerContext: CustomerContext,
    conversationId?: string
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    this.routingStats.cloudRequests++;

    try {
      // Call AWS Bedrock Claude via HTTP
      // const { bedrock_service } = await import('../../ml-service/src/services/bedrock_service');
      
      // Prepare context for Claude
      let contextualPrompt = request.prompt;
      if (conversationId) {
        const context = this.getContextWindow(conversationId);
        if (context && context.messages.length > 0) {
          const recentMessages = context.messages.slice(-5); // Last 5 messages
          const contextString = recentMessages
            .map(msg => `${msg.role}: ${msg.content}`)
            .join('\n');
          contextualPrompt = `Context:\n${contextString}\n\nCurrent request: ${request.prompt}`;
        }
      }

      // TODO: Implement bedrock service call
      const response = {
        success: true,
        response: `Mock response for: ${contextualPrompt}`,
        model: 'claude-3-sonnet-20241022',
        service: 'cloud'  as 'cloud',
        processingTime: Date.now() - startTime,
        usage: { input_tokens: 100, output_tokens: 50 }
      };

      const processingTime = Date.now() - startTime;
      
      // Update metrics
      this.updateCloudMetrics(true, processingTime);

      // Update context window
      if (conversationId && response.success) {
        this.updateContextWindow(conversationId, 'assistant', response.response || '');
      }

      return {
        success: response.success,
        response: response.response,
        model: response.model,
        service: response.service,
        processingTime: response.processingTime,
        metadata: {
          service_used: 'aws-bedrock',
          model_id: response.model,
          usage: response.usage
        }
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateCloudMetrics(false, processingTime);
      
      logger.error('Cloud LLM processing failed:', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  private async processFallback(
    request: LLMRequest,
    customerContext: CustomerContext,
    conversationId?: string
  ): Promise<LLMResponse> {
    logger.info('Executing fallback processing strategy');

    // Try cloud first if local failed
    if (this.routingStats.localRequests > this.routingStats.cloudRequests) {
      try {
        return await this.processWithCloudLLM(request, customerContext, conversationId);
      } catch (cloudError) {
        logger.error('Cloud fallback also failed:', cloudError);
      }
    }

    // Try local if cloud failed or as secondary fallback
    try {
      return await this.processWithLocalLLM(request, customerContext, conversationId);
    } catch (localError) {
      logger.error('Local fallback also failed:', localError);
    }

    // Final fallback: simple rule-based response
    return {
      success: false,
      response: 'מצטערים, השירות זמנית לא זמין. אנא נסו שוב מאוחר יותר.',
      model: 'fallback-rule-based',
      service: 'local',
      processingTime: 100,
      error: 'All LLM services unavailable'
    };
  }

  private updateContextWindow(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): void {
    const maxTokens = 8000; // Increased limit for longer conversation continuity
    
    let context = this.contextWindows.get(conversationId);
    if (!context) {
      context = {
        conversationId,
        messages: [],
        tokenCount: 0,
        maxTokens
      };
    }

    const newMessage = {
      role,
      content,
      timestamp: new Date().toISOString()
    };

    context.messages.push(newMessage);
    context.tokenCount += this.estimateTokenCount(content);

    // Truncate if exceeding token limit
    while (context.tokenCount > maxTokens && context.messages.length > 1) {
      const removedMessage = context.messages.shift();
      if (removedMessage) {
        context.tokenCount -= this.estimateTokenCount(removedMessage.content);
      }
    }

    this.contextWindows.set(conversationId, context);
    
    // Clean up old conversations (keep only last 100)
    if (this.contextWindows.size > 100) {
      const oldestKey = this.contextWindows.keys().next().value;
      this.contextWindows.delete(oldestKey);
    }
  }

  private getContextWindow(conversationId: string): ContextWindow | undefined {
    return this.contextWindows.get(conversationId);
  }

  private estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for Hebrew/English mix
    return Math.ceil(text.length / 4);
  }


  private updateLocalMetrics(success: boolean, processingTime: number): void {
    const metrics = this.loadBalancingMetrics.localLLM;
    
    // Update response time (exponential moving average)
    metrics.avgResponseTime = metrics.avgResponseTime * 0.9 + processingTime * 0.1;
    
    // Update error rate
    const errorCount = success ? 0 : 1;
    metrics.errorRate = metrics.errorRate * 0.95 + errorCount * 0.05;
    
    metrics.lastHealthCheck = new Date().toISOString();
  }

  private updateCloudMetrics(success: boolean, processingTime: number): void {
    const metrics = this.loadBalancingMetrics.cloudLLM;
    
    // Update response time (exponential moving average)
    metrics.avgResponseTime = metrics.avgResponseTime * 0.9 + processingTime * 0.1;
    
    // Update error rate
    const errorCount = success ? 0 : 1;
    metrics.errorRate = metrics.errorRate * 0.95 + errorCount * 0.05;
    
    metrics.lastHealthCheck = new Date().toISOString();
  }

  async healthCheck(): Promise<{
    mcp_enabled: boolean;
    local_llm: any;
    cloud_llm: any;
    routing_stats: any;
  }> {
    try {
      // Check local LLM health
      const { mlService } = await import('./ml.service');
      const localHealth = await mlService.healthCheck();
      
      // Update local availability
      this.loadBalancingMetrics.localLLM.available = 
        localHealth.status === 'healthy';

      // Check cloud LLM health (simplified)
      this.loadBalancingMetrics.cloudLLM.available = true; // Assume available

      return {
        mcp_enabled: this.config.enabled,
        local_llm: {
          ...this.loadBalancingMetrics.localLLM,
          health: localHealth
        },
        cloud_llm: this.loadBalancingMetrics.cloudLLM,
        routing_stats: this.routingStats
      };
    } catch (error) {
      logger.error('MCP health check failed:', {
        message: error.message,
        stack: error.stack
      });
      return {
        mcp_enabled: this.config.enabled,
        local_llm: { available: false, error: error instanceof Error ? error.message : 'Unknown' },
        cloud_llm: { available: false },
        routing_stats: this.routingStats
      };
    }
  }

  getRoutingStats(): any {
    return {
      ...this.routingStats,
      local_success_rate: this.routingStats.localRequests > 0 
        ? (1 - this.loadBalancingMetrics.localLLM.errorRate) * 100 
        : 0,
      cloud_success_rate: this.routingStats.cloudRequests > 0
        ? (1 - this.loadBalancingMetrics.cloudLLM.errorRate) * 100
        : 0,
      fallback_rate: this.routingStats.totalRequests > 0
        ? (this.routingStats.fallbackActivations / this.routingStats.totalRequests) * 100
        : 0
    };
  }

  getLoadBalancingMetrics(): LoadBalancingMetrics {
    return { ...this.loadBalancingMetrics };
  }

  // Conversation management
  createConversation(conversationId: string): void {
    if (!this.contextWindows.has(conversationId)) {
      this.contextWindows.set(conversationId, {
        conversationId,
        messages: [],
        tokenCount: 0,
        maxTokens: 8000
      });
    }
  }

  endConversation(conversationId: string): void {
    this.contextWindows.delete(conversationId);
  }

  getActiveConversations(): string[] {
    return Array.from(this.contextWindows.keys());
  }

  // Configuration management
  updateConfig(newConfig: Partial<MCPConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('MCP Client configuration updated');
  }

  getConfig(): MCPConfig {
    return { ...this.config };
  }
}

export const mcpClientService = new MCPClientService();