import Redis from 'ioredis';
import { logger } from '../utils/logger';

export class RedisService {
  private client: Redis;
  private isConnected = false;

  constructor() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    };

    this.client = new Redis(redisConfig);

    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis connected successfully');
    });

    this.client.on('error', (err) => {
      this.isConnected = false;
      logger.error('Redis connection error:', err);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis connection closed');
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error('Redis GET error:', error);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    try {
      if (ttl) {
        await this.client.set(key, value, 'EX', ttl);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (error) {
      logger.error('Redis SET error:', error);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error('Redis DEL error:', error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS error:', error);
      return false;
    }
  }

  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.client.hget(key, field);
    } catch (error) {
      logger.error('Redis HGET error:', error);
      return null;
    }
  }

  async hset(key: string, field: string, value: string): Promise<boolean> {
    try {
      await this.client.hset(key, field, value);
      return true;
    } catch (error) {
      logger.error('Redis HSET error:', error);
      return false;
    }
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    try {
      return await this.client.hgetall(key);
    } catch (error) {
      logger.error('Redis HGETALL error:', error);
      return null;
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, seconds);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXPIRE error:', error);
      return false;
    }
  }

  async setex(key: string, seconds: number, value: string): Promise<boolean> {
    try {
      await this.client.setex(key, seconds, value);
      return true;
    } catch (error) {
      logger.error('Redis SETEX error:', error);
      return false;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error('Redis KEYS error:', error);
      return [];
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error('Redis TTL error:', error);
      return -1;
    }
  }

  async flushdb(): Promise<boolean> {
    try {
      await this.client.flushdb();
      return true;
    } catch (error) {
      logger.error('Redis FLUSHDB error:', error);
      return false;
    }
  }

  async dbsize(): Promise<number> {
    try {
      return await this.client.dbsize();
    } catch (error) {
      logger.error('Redis DBSIZE error:', error);
      return 0;
    }
  }

  async memory_usage_pattern(): Promise<any> {
    try {
      // This is a simplified version - Redis MEMORY USAGE requires Redis 4.0+
      return { pattern: 'memory_usage_not_available' };
    } catch (error) {
      logger.error('Redis MEMORY USAGE error:', error);
      return {};
    }
  }

  async flushByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error) {
      logger.error('Redis flush by pattern error:', error);
    }
  }

  getClient(): Redis {
    return this.client;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  isReady(): boolean {
    return this.isConnected;
  }
}

export const redisService = new RedisService();