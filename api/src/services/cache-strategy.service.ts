import { logger } from '../utils/logger';
import { redisService } from './redis.service';
import { CustomerContext } from '../types/customer';

export interface CacheLayer {
  name: string;
  ttl: number; // Time to live in seconds
  maxSize?: number;
  enabled: boolean;
}

export interface CacheConfig {
  hotData: CacheLayer;    // Last 24h - Redis memory
  warmData: CacheLayer;   // Last 30 days - Redis with longer TTL
  coldData: CacheLayer;   // Historical - Compressed cache
}

export interface CacheKey {
  prefix: string;
  identifier: string;
  suffix?: string;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
  lastReset: Date;
}

export class CacheStrategyService {
  private config: CacheConfig;
  private metrics: Map<string, CacheMetrics> = new Map();

  constructor() {
    this.config = {
      hotData: {
        name: 'hot',
        ttl: 24 * 60 * 60, // 24 hours
        maxSize: 10000, // 10k objects
        enabled: true
      },
      warmData: {
        name: 'warm', 
        ttl: 30 * 24 * 60 * 60, // 30 days
        maxSize: 100000, // 100k objects
        enabled: true
      },
      coldData: {
        name: 'cold',
        ttl: 365 * 24 * 60 * 60, // 1 year
        enabled: true
      }
    };

    // Initialize metrics
    Object.values(this.config).forEach(layer => {
      this.metrics.set(layer.name, {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalRequests: 0,
        lastReset: new Date()
      });
    });

    logger.info('Cache Strategy Service initialized', this.config);
  }

  // ============================================================================
  // CALL TRANSCRIPTION CACHING
  // ============================================================================

  async getCachedCall(callId: string, customerContext: CustomerContext): Promise<any | null> {
    const cacheKey = this.buildCallKey(callId, customerContext.customerId);
    
    // Try hot cache first (last 24h calls)
    let result = await this.getFromHotCache(cacheKey);
    if (result !== null) {
      this.recordHit('hot');
      return result;
    }

    // Try warm cache (last 30 days)
    result = await this.getFromWarmCache(cacheKey);
    if (result !== null) {
      this.recordHit('warm');
      // Promote to hot cache if recently accessed
      await this.setInHotCache(cacheKey, result);
      return result;
    }

    // Try cold cache (historical)
    result = await this.getFromColdCache(cacheKey);
    if (result !== null) {
      this.recordHit('cold');
      return result;
    }

    // Cache miss
    this.recordMiss();
    return null;
  }

  async setCachedCall(
    callId: string, 
    customerContext: CustomerContext, 
    callData: any,
    callAge?: number
  ): Promise<void> {
    const cacheKey = this.buildCallKey(callId, customerContext.customerId);
    const ageInHours = callAge || this.calculateCallAge(callData.callDate);

    // Determine which cache layer based on call age
    if (ageInHours <= 24) {
      // Hot cache - recent calls
      await this.setInHotCache(cacheKey, callData);
      logger.debug(`Cached call ${callId} in hot cache`);
    } else if (ageInHours <= 24 * 30) {
      // Warm cache - last 30 days
      await this.setInWarmCache(cacheKey, callData);
      logger.debug(`Cached call ${callId} in warm cache`);
    } else {
      // Cold cache - historical
      await this.setInColdCache(cacheKey, callData);
      logger.debug(`Cached call ${callId} in cold cache`);
    }
  }

  // ============================================================================
  // SEARCH RESULTS CACHING
  // ============================================================================

  async getCachedSearchResults(
    query: string, 
    customerContext: CustomerContext,
    searchType: string,
    options?: any
  ): Promise<any | null> {
    const cacheKey = this.buildSearchKey(query, customerContext.customerId, searchType, options);
    
    // Search results are typically cached in warm layer (shorter TTL)
    const result = await this.getFromWarmCache(cacheKey);
    if (result !== null) {
      this.recordHit('warm');
      return result;
    }

    this.recordMiss();
    return null;
  }

  async setCachedSearchResults(
    query: string,
    customerContext: CustomerContext,
    searchType: string,
    results: any,
    options?: any
  ): Promise<void> {
    const cacheKey = this.buildSearchKey(query, customerContext.customerId, searchType, options);
    
    // Cache search results in warm cache with shorter TTL
    await this.setInWarmCache(cacheKey, results, 300); // 5 minutes for search results
    logger.debug(`Cached search results for query: ${query}`);
  }

  // ============================================================================
  // LLM ANALYSIS CACHING
  // ============================================================================

  async getCachedAnalysis(callId: string, customerContext: CustomerContext): Promise<any | null> {
    const cacheKey = this.buildAnalysisKey(callId, customerContext.customerId);
    
    // Analysis results cached in warm layer
    const result = await this.getFromWarmCache(cacheKey);
    if (result !== null) {
      this.recordHit('warm');
      return result;
    }

    this.recordMiss();
    return null;
  }

  async setCachedAnalysis(
    callId: string,
    customerContext: CustomerContext,
    analysis: any
  ): Promise<void> {
    const cacheKey = this.buildAnalysisKey(callId, customerContext.customerId);
    
    // Cache analysis results in warm cache (long TTL as analysis doesn't change)
    await this.setInWarmCache(cacheKey, analysis, 7 * 24 * 60 * 60); // 7 days
    logger.debug(`Cached analysis for call ${callId}`);
  }

  // ============================================================================
  // EMBEDDING VECTORS CACHING
  // ============================================================================

  async getCachedEmbedding(textHash: string): Promise<number[] | null> {
    const cacheKey = this.buildEmbeddingKey(textHash);
    
    // Embeddings cached in cold cache (very long TTL as they don't change)
    const result = await this.getFromColdCache(cacheKey);
    if (result !== null) {
      this.recordHit('cold');
      return result;
    }

    this.recordMiss();
    return null;
  }

  async setCachedEmbedding(textHash: string, embedding: number[]): Promise<void> {
    const cacheKey = this.buildEmbeddingKey(textHash);
    
    // Cache embeddings in cold cache (very long TTL)
    await this.setInColdCache(cacheKey, embedding);
    logger.debug(`Cached embedding for text hash: ${textHash}`);
  }

  // ============================================================================
  // CUSTOMER STATS CACHING
  // ============================================================================

  async getCachedCustomerStats(customerContext: CustomerContext): Promise<any | null> {
    const cacheKey = this.buildStatsKey(customerContext.customerId);
    
    // Stats cached in hot cache with medium TTL
    const result = await this.getFromHotCache(cacheKey);
    if (result !== null) {
      this.recordHit('hot');
      return result;
    }

    this.recordMiss();
    return null;
  }

  async setCachedCustomerStats(customerContext: CustomerContext, stats: any): Promise<void> {
    const cacheKey = this.buildStatsKey(customerContext.customerId);
    
    // Cache stats in hot cache with 1 hour TTL
    await this.setInHotCache(cacheKey, stats, 60 * 60);
    logger.debug(`Cached stats for customer ${customerContext.customerId}`);
  }

  // ============================================================================
  // CACHE LAYER IMPLEMENTATIONS
  // ============================================================================

  private async getFromHotCache(key: string): Promise<any | null> {
    if (!this.config.hotData.enabled) return null;
    
    try {
      const result = await redisService.get(`hot:${key}`);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      logger.error('Hot cache read error:', error);
      return null;
    }
  }

  private async setInHotCache(key: string, data: any, customTTL?: number): Promise<void> {
    if (!this.config.hotData.enabled) return;
    
    try {
      const ttl = customTTL || this.config.hotData.ttl;
      await redisService.setex(`hot:${key}`, ttl, JSON.stringify(data));
    } catch (error) {
      logger.error('Hot cache write error:', error);
    }
  }

  private async getFromWarmCache(key: string): Promise<any | null> {
    if (!this.config.warmData.enabled) return null;
    
    try {
      const result = await redisService.get(`warm:${key}`);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      logger.error('Warm cache read error:', error);
      return null;
    }
  }

  private async setInWarmCache(key: string, data: any, customTTL?: number): Promise<void> {
    if (!this.config.warmData.enabled) return;
    
    try {
      const ttl = customTTL || this.config.warmData.ttl;
      await redisService.setex(`warm:${key}`, ttl, JSON.stringify(data));
    } catch (error) {
      logger.error('Warm cache write error:', error);
    }
  }

  private async getFromColdCache(key: string): Promise<any | null> {
    if (!this.config.coldData.enabled) return null;
    
    try {
      // Cold cache uses compression for large data
      const compressed = await redisService.get(`cold:${key}`);
      if (!compressed) return null;
      
      // Decompress and parse
      const decompressed = this.decompress(compressed);
      return JSON.parse(decompressed);
    } catch (error) {
      logger.error('Cold cache read error:', error);
      return null;
    }
  }

  private async setInColdCache(key: string, data: any): Promise<void> {
    if (!this.config.coldData.enabled) return;
    
    try {
      // Compress data for cold storage
      const serialized = JSON.stringify(data);
      const compressed = this.compress(serialized);
      
      await redisService.setex(`cold:${key}`, this.config.coldData.ttl, compressed);
    } catch (error) {
      logger.error('Cold cache write error:', error);
    }
  }

  // ============================================================================
  // CACHE KEY BUILDERS
  // ============================================================================

  private buildCallKey(callId: string, customerId: string): string {
    return `call:${customerId}:${callId}`;
  }

  private buildSearchKey(query: string, customerId: string, searchType: string, options?: any): string {
    const optionsHash = options ? this.hashObject(options) : 'default';
    return `search:${customerId}:${searchType}:${this.hashString(query)}:${optionsHash}`;
  }

  private buildAnalysisKey(callId: string, customerId: string): string {
    return `analysis:${customerId}:${callId}`;
  }

  private buildEmbeddingKey(textHash: string): string {
    return `embedding:${textHash}`;
  }

  private buildStatsKey(customerId: string): string {
    return `stats:${customerId}`;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private calculateCallAge(callDate: string): number {
    const now = new Date();
    const call = new Date(callDate);
    return Math.abs(now.getTime() - call.getTime()) / (1000 * 60 * 60); // hours
  }

  private hashString(input: string): string {
    // Simple hash function for cache keys
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  private hashObject(obj: any): string {
    return this.hashString(JSON.stringify(obj));
  }

  private compress(data: string): string {
    // Simple compression (in production, use zlib or similar)
    return Buffer.from(data).toString('base64');
  }

  private decompress(data: string): string {
    // Simple decompression
    return Buffer.from(data, 'base64').toString('utf8');
  }

  private recordHit(layer: string): void {
    const metrics = this.metrics.get(layer);
    if (metrics) {
      metrics.hits++;
      metrics.totalRequests++;
      metrics.hitRate = (metrics.hits / metrics.totalRequests) * 100;
    }
  }

  private recordMiss(): void {
    this.metrics.forEach(metrics => {
      metrics.misses++;
      metrics.totalRequests++;
      metrics.hitRate = (metrics.hits / metrics.totalRequests) * 100;
    });
  }

  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================

  async invalidateCall(callId: string, customerId: string): Promise<void> {
    const callKey = this.buildCallKey(callId, customerId);
    const analysisKey = this.buildAnalysisKey(callId, customerId);
    
    // Remove from all cache layers
    await Promise.all([
      redisService.del(`hot:${callKey}`),
      redisService.del(`warm:${callKey}`),
      redisService.del(`cold:${callKey}`),
      redisService.del(`warm:${analysisKey}`)
    ]);
    
    logger.debug(`Invalidated cache for call ${callId}`);
  }

  async invalidateCustomerData(customerId: string): Promise<void> {
    // Get all keys for this customer
    const patterns = [
      `hot:*:${customerId}:*`,
      `warm:*:${customerId}:*`,
      `cold:*:${customerId}:*`
    ];

    for (const pattern of patterns) {
      const keys = await redisService.keys(pattern);
      if (keys.length > 0) {
        // Delete keys one by one to avoid spread operator issues
        for (const key of keys) {
          await redisService.del(key);
        }
      }
    }
    
    logger.info(`Invalidated all cache data for customer ${customerId}`);
  }

  async warmupCache(customerContext: CustomerContext): Promise<void> {
    // Preload frequently accessed data
    logger.info(`Starting cache warmup for customer ${customerContext.customerId}`);
    
    // This would typically load recent calls, common searches, etc.
    // Implementation depends on your specific access patterns
  }

  async getCacheMetrics(): Promise<any> {
    const allMetrics: any = {};
    
    this.metrics.forEach((metrics, layer) => {
      allMetrics[layer] = { ...metrics };
    });

    // Add Redis memory usage
    try {
      const memoryInfo = await redisService.memory_usage_pattern();
      allMetrics.redis = {
        memoryUsage: memoryInfo,
        keyCount: await redisService.dbsize()
      };
    } catch (error) {
      logger.error('Failed to get Redis metrics:', error);
    }

    return {
      layers: allMetrics,
      config: this.config,
      timestamp: new Date()
    };
  }

  async resetMetrics(): Promise<void> {
    this.metrics.forEach(metrics => {
      metrics.hits = 0;
      metrics.misses = 0;
      metrics.hitRate = 0;
      metrics.totalRequests = 0;
      metrics.lastReset = new Date();
    });
    
    logger.info('Cache metrics reset');
  }

  async cleanup(): Promise<{ expired: number; freed: number }> {
    let expired = 0;
    let freed = 0;

    try {
      // Cleanup expired keys (Redis handles this automatically, but we can force it)
      const expiredKeys = await redisService.keys('*');
      
      for (const key of expiredKeys) {
        const ttl = await redisService.ttl(key);
        if (ttl === -2) { // Key expired
          expired++;
        }
      }

      // Force cleanup of expired keys
      await redisService.flushdb();
      
      logger.info(`Cache cleanup completed: ${expired} expired keys, ${freed} bytes freed`);
    } catch (error) {
      logger.error('Cache cleanup failed:', error);
    }

    return { expired, freed };
  }
}

export const cacheStrategyService = new CacheStrategyService();