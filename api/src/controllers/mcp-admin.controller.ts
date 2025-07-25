import { Request, Response } from 'express';
import { mcpClientService } from '../services/mcp-client.service';
import { logger } from '../utils/logger';

export class MCPAdminController {
  
  // Get current MCP routing metrics and status
  async getMetrics(req: Request, res: Response) {
    try {
      const metrics = mcpClientService.getLoadBalancingMetrics();
      const stats = mcpClientService.getRoutingStats();
      const config = mcpClientService.getConfig();
      
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        metrics,
        stats,
        config: {
          enabled: config.enabled,
          fallbackEnabled: config.fallbackEnabled,
          timeout: config.timeout
        }
      });
    } catch (error) {
      logger.error('Failed to get MCP metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve metrics'
      });
    }
  }
  
  // Reset MCP routing metrics
  async resetMetrics(req: Request, res: Response) {
    try {
      mcpClientService.resetMetrics();
      
      logger.info('MCP metrics reset via admin API');
      
      res.json({
        success: true,
        message: 'MCP routing metrics have been reset',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to reset MCP metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reset metrics'
      });
    }
  }
  
  // Force local LLM mode (bypass routing logic)
  async setForceLocal(req: Request, res: Response) {
    try {
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'enabled must be a boolean value'
        });
      }
      
      mcpClientService.forceLocalMode(enabled);
      
      logger.info(`Force local mode set to: ${enabled}`);
      
      res.json({
        success: true,
        message: `Force local mode ${enabled ? 'enabled' : 'disabled'}`,
        forceLocal: enabled,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to set force local mode:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to set force local mode'
      });
    }
  }
  
  // Health check with detailed routing information
  async getHealthDetails(req: Request, res: Response) {
    try {
      const health = await mcpClientService.healthCheck();
      
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        health,
        recommendations: this.generateRecommendations(health)
      });
    } catch (error) {
      logger.error('Failed to get MCP health details:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve health details'
      });
    }
  }
  
  private generateRecommendations(health: any): string[] {
    const recommendations: string[] = [];
    
    if (health.local_llm?.avgResponseTime > 15000) {
      recommendations.push('Consider resetting metrics - local LLM response time is high');
    }
    
    if (health.local_llm?.errorRate > 0.1) {
      recommendations.push('Local LLM error rate is elevated - check Ollama service');
    }
    
    if (health.routing_stats?.fallback_rate > 20) {
      recommendations.push('High fallback rate detected - investigate local LLM performance');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('System is operating optimally');
    }
    
    return recommendations;
  }
}

export const mcpAdminController = new MCPAdminController();