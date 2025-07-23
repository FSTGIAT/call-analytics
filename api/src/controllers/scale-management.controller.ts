import { Response } from 'express';
import Joi from 'joi';
import { AuthenticatedRequest } from '../middleware/customer-isolation.middleware';
import { logger } from '../utils/logger';
import { batchProcessorService } from '../services/batch-processor.service';
import { realTimeProcessorService } from '../services/real-time-processor.service';
import { vectorStorageService } from '../services/vector-storage.service';
import { cacheStrategyService } from '../services/cache-strategy.service';

// Validation schemas
export const batchProcessingSchema = Joi.object({
  batchSize: Joi.number().min(1).max(500).default(50),
  maxConcurrency: Joi.number().min(1).max(20).default(5),
  delayBetweenBatches: Joi.number().min(0).max(60000).default(2000),
  processEmbeddings: Joi.boolean().default(true),
  processLLMAnalysis: Joi.boolean().default(true),
  dateRange: Joi.object({
    from: Joi.date().iso(),
    to: Joi.date().iso()
  }).optional()
});

export const realTimeConfigSchema = Joi.object({
  enabled: Joi.boolean(),
  pollingInterval: Joi.number().min(5000).max(300000), // 5 seconds to 5 minutes
  processingDelay: Joi.number().min(0).max(3600000)    // Up to 1 hour delay
});

export class ScaleManagementController {
  // ============================================================================
  // BATCH PROCESSING ENDPOINTS
  // ============================================================================

  static async startBatchProcessing(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const options = req.body;
      const customerContext = req.customerContext!;

      // Check if batch processing is already running
      if (batchProcessorService.isProcessingRunning()) {
        res.status(409).json({
          error: 'Batch processing is already running',
          currentStats: batchProcessorService.getProcessingStats()
        });
        return;
      }

      logger.info('Starting batch processing', {
        customerId: customerContext.customerId,
        options
      });

      // Start batch processing (async)
      batchProcessorService.processBatchOfCalls(customerContext, options)
        .then(stats => {
          logger.info('Batch processing completed', stats);
        })
        .catch(error => {
          logger.error('Batch processing failed:', error);
        });

      res.status(202).json({
        message: 'Batch processing started',
        options,
        status: 'running'
      });

    } catch (error) {
      logger.error('Failed to start batch processing:', error);
      res.status(500).json({
        error: 'Failed to start batch processing',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getBatchProcessingStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const stats = batchProcessorService.getProcessingStats();
      const isRunning = batchProcessorService.isProcessingRunning();

      res.json({
        isRunning,
        stats,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to get batch processing status:', error);
      res.status(500).json({ error: 'Failed to get processing status' });
    }
  }

  static async stopBatchProcessing(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      // Note: Current implementation doesn't support graceful stopping
      // This would require implementing a cancellation mechanism
      
      res.status(501).json({
        message: 'Batch processing stop not implemented',
        recommendation: 'Wait for current batch to complete or restart the service'
      });

    } catch (error) {
      logger.error('Failed to stop batch processing:', error);
      res.status(500).json({ error: 'Failed to stop processing' });
    }
  }

  // ============================================================================
  // REAL-TIME PROCESSING ENDPOINTS
  // ============================================================================

  static async startRealTimeProcessing(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      await realTimeProcessorService.startRealTimeProcessing();

      res.json({
        message: 'Real-time processing started',
        status: 'running',
        config: realTimeProcessorService.getProcessingStats().config
      });

    } catch (error) {
      logger.error('Failed to start real-time processing:', error);
      res.status(500).json({
        error: 'Failed to start real-time processing',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async stopRealTimeProcessing(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      await realTimeProcessorService.stopRealTimeProcessing();

      res.json({
        message: 'Real-time processing stopped',
        status: 'stopped'
      });

    } catch (error) {
      logger.error('Failed to stop real-time processing:', error);
      res.status(500).json({
        error: 'Failed to stop real-time processing',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getRealTimeStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const stats = realTimeProcessorService.getProcessingStats();
      const changeLogStatus = await realTimeProcessorService.getChangeLogStatus();

      res.json({
        stats,
        changeLogStatus,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to get real-time status:', error);
      res.status(500).json({ error: 'Failed to get real-time status' });
    }
  }

  static async triggerCallProcessing(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { callId } = req.params;
      const customerContext = req.customerContext!;

      await realTimeProcessorService.triggerCallProcessing(callId, customerContext.customerId);

      res.json({
        message: `Processing triggered for call ${callId}`,
        callId,
        customerId: customerContext.customerId
      });

    } catch (error) {
      logger.error('Failed to trigger call processing:', error);
      res.status(500).json({
        error: 'Failed to trigger processing',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ============================================================================
  // VECTOR STORAGE MANAGEMENT
  // ============================================================================

  static async getVectorStorageStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const stats = await vectorStorageService.getStorageStats();
      const healthStatus = await vectorStorageService.healthCheck();

      res.json({
        stats,
        health: healthStatus ? 'healthy' : 'unhealthy',
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to get vector storage stats:', error);
      res.status(500).json({
        error: 'Failed to get storage stats',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async optimizeVectorIndexes(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      await vectorStorageService.optimizeIndexes();

      res.json({
        message: 'Vector index optimization started',
        status: 'optimizing',
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to optimize vector indexes:', error);
      res.status(500).json({
        error: 'Failed to optimize indexes',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async cleanupOldVectors(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { olderThanDays = 365 } = req.body;
      
      if (olderThanDays < 30) {
        res.status(400).json({
          error: 'Cannot cleanup vectors newer than 30 days for safety'
        });
        return;
      }

      const deletedCount = await vectorStorageService.cleanupOldVectors(olderThanDays);

      res.json({
        message: 'Vector cleanup completed',
        deletedCount,
        olderThanDays,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to cleanup vectors:', error);
      res.status(500).json({
        error: 'Failed to cleanup vectors',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================

  static async getCacheMetrics(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const metrics = await cacheStrategyService.getCacheMetrics();

      res.json(metrics);

    } catch (error) {
      logger.error('Failed to get cache metrics:', error);
      res.status(500).json({
        error: 'Failed to get cache metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async invalidateCustomerCache(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const customerContext = req.customerContext!;

      await cacheStrategyService.invalidateCustomerData(customerContext.customerId);

      res.json({
        message: `Cache invalidated for customer ${customerContext.customerId}`,
        customerId: customerContext.customerId,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to invalidate cache:', error);
      res.status(500).json({
        error: 'Failed to invalidate cache',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async warmupCache(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const customerContext = req.customerContext!;

      await cacheStrategyService.warmupCache(customerContext);

      res.json({
        message: `Cache warmup completed for customer ${customerContext.customerId}`,
        customerId: customerContext.customerId,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to warmup cache:', error);
      res.status(500).json({
        error: 'Failed to warmup cache',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async cleanupCache(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await cacheStrategyService.cleanup();

      res.json({
        message: 'Cache cleanup completed',
        ...result,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to cleanup cache:', error);
      res.status(500).json({
        error: 'Failed to cleanup cache',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async resetCacheMetrics(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      await cacheStrategyService.resetMetrics();

      res.json({
        message: 'Cache metrics reset',
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to reset cache metrics:', error);
      res.status(500).json({
        error: 'Failed to reset metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ============================================================================
  // COMPREHENSIVE STATUS
  // ============================================================================

  static async getSystemStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const customerContext = req.customerContext!;

      // Gather status from all systems
      const [
        batchStats,
        realTimeStats,
        vectorStats,
        cacheMetrics
      ] = await Promise.allSettled([
        Promise.resolve(batchProcessorService.getProcessingStats()),
        Promise.resolve(realTimeProcessorService.getProcessingStats()),
        vectorStorageService.getStorageStats().catch(() => ({ error: 'Unavailable' })),
        cacheStrategyService.getCacheMetrics().catch(() => ({ error: 'Unavailable' }))
      ]);

      res.json({
        customerId: customerContext.customerId,
        timestamp: new Date(),
        systems: {
          batchProcessing: {
            status: batchProcessorService.isProcessingRunning() ? 'running' : 'idle',
            stats: batchStats.status === 'fulfilled' ? batchStats.value : { error: 'Failed to get stats' }
          },
          realTimeProcessing: {
            status: realTimeStats.status === 'fulfilled' && realTimeStats.value.isRunning ? 'running' : 'stopped',
            stats: realTimeStats.status === 'fulfilled' ? realTimeStats.value : { error: 'Failed to get stats' }
          },
          vectorStorage: {
            status: vectorStats.status === 'fulfilled' ? 'healthy' : 'error',
            stats: vectorStats.status === 'fulfilled' ? vectorStats.value : { error: 'Failed to get stats' }
          },
          cache: {
            status: cacheMetrics.status === 'fulfilled' ? 'healthy' : 'error',
            metrics: cacheMetrics.status === 'fulfilled' ? cacheMetrics.value : { error: 'Failed to get metrics' }
          }
        }
      });

    } catch (error) {
      logger.error('Failed to get system status:', error);
      res.status(500).json({
        error: 'Failed to get system status',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // ============================================================================
  // MAINTENANCE OPERATIONS
  // ============================================================================

  static async performMaintenance(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { operations = ['cleanup', 'optimize', 'stats'] } = req.body;
      const results: any = {};

      logger.info('Starting maintenance operations', { operations });

      // Cleanup operations
      if (operations.includes('cleanup')) {
        try {
          const cacheCleanup = await cacheStrategyService.cleanup();
          const vectorCleanup = await vectorStorageService.cleanupOldVectors(365);
          const changeLogCleanup = await realTimeProcessorService.cleanupOldChanges(7);
          
          results.cleanup = {
            cache: cacheCleanup,
            vectors: { deletedCount: vectorCleanup },
            changeLog: { deletedCount: changeLogCleanup }
          };
        } catch (error) {
          results.cleanup = { error: error instanceof Error ? error.message : 'Cleanup failed' };
        }
      }

      // Optimization operations
      if (operations.includes('optimize')) {
        try {
          await vectorStorageService.optimizeIndexes();
          results.optimize = { 
            vectors: 'Optimization started',
            timestamp: new Date()
          };
        } catch (error) {
          results.optimize = { error: error instanceof Error ? error.message : 'Optimization failed' };
        }
      }

      // Statistics refresh
      if (operations.includes('stats')) {
        try {
          await cacheStrategyService.resetMetrics();
          results.stats = { 
            cache: 'Metrics reset',
            timestamp: new Date()
          };
        } catch (error) {
          results.stats = { error: error instanceof Error ? error.message : 'Stats refresh failed' };
        }
      }

      res.json({
        message: 'Maintenance operations completed',
        operations,
        results,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Maintenance operations failed:', error);
      res.status(500).json({
        error: 'Maintenance operations failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export default ScaleManagementController;