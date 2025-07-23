import { redisService } from '../services/redis.service';
import { logger } from './logger';
import crypto from 'crypto';

export class CacheUtils {
  private static readonly DEFAULT_TTL = parseInt(process.env.CACHE_TTL || '3600');

  static generateKey(prefix: string, ...parts: string[]): string {
    return `${prefix}:${parts.join(':')}`;
  }

  static generateHashKey(data: any): string {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }

  static async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await redisService.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
      return null;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  static async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await redisService.set(key, serialized, ttl || this.DEFAULT_TTL);
    } catch (error) {
      logger.error('Cache set error:', error);
    }
  }

  static async invalidate(pattern: string): Promise<void> {
    try {
      await redisService.flushByPattern(pattern);
    } catch (error) {
      logger.error('Cache invalidation error:', error);
    }
  }

  static async remember<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }
}

export const cacheKeys = {
  calls: {
    transcription: (customerId: string, callId: string) => 
      CacheUtils.generateKey('calls', 'transcription', customerId, callId),
    summary: (customerId: string, callId: string) => 
      CacheUtils.generateKey('calls', 'summary', customerId, callId),
    list: (customerId: string, queryHash: string) => 
      CacheUtils.generateKey('calls', 'list', customerId, queryHash)
  },
  embeddings: {
    text: (textHash: string) => 
      CacheUtils.generateKey('embeddings', 'text', textHash)
  },
  search: {
    results: (customerId: string, queryHash: string) => 
      CacheUtils.generateKey('search', 'results', customerId, queryHash)
  },
  analytics: {
    dashboard: (customerId: string, period: string) => 
      CacheUtils.generateKey('analytics', 'dashboard', customerId, period),
    performance: (customerId: string, agentId: string, period: string) => 
      CacheUtils.generateKey('analytics', 'performance', customerId, agentId, period),
    trends: (customerId: string, metric: string, period: string) => 
      CacheUtils.generateKey('analytics', 'trends', customerId, metric, period),
    overview: (customerId: string, period: string) => 
      CacheUtils.generateKey('analytics', 'overview', customerId, period)
  }
};