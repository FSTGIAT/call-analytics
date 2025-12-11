import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { secretsService } from './secrets.service';

export class RedisService {
  private client: Redis;
  private isConnected = false;

  constructor() {
    this.initializeConnection();
  }

  private async initializeConnection() {
    logger.info('🔴 [REDIS] Starting Redis connection initialization...');
    
    try {
      let redisConfig;
      
      logger.info('🔴 [REDIS] Checking AWS environment...');
      const isAWS = secretsService.isAWSEnvironment();
      
      if (isAWS) {
        logger.info('🔴 [REDIS] AWS environment detected, loading from Secrets Manager...');
        const redisSecrets = await secretsService.getRedisConfig();
        
        logger.info('🔴 [REDIS] Raw secrets received:', {
          host: redisSecrets.host,
          port: redisSecrets.port,
          db: redisSecrets.db,
          hasPassword: !!redisSecrets.password
        });
        
        redisConfig = {
          host: redisSecrets.host || 'redis.callanalytics.local',
          port: parseInt(redisSecrets.port || '6379'),
          password: redisSecrets.password,
          db: parseInt(redisSecrets.db || '0'),
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 50, 2000);
            logger.info(`🔴 [REDIS] Retry attempt ${times}, delay: ${delay}ms`);
            return delay;
          }
        };
        
        logger.info('🔴 [REDIS] Final config built from secrets:', {
          host: redisConfig.host,
          port: redisConfig.port,
          db: redisConfig.db,
          hasPassword: !!redisConfig.password
        });
        
        logger.info('Redis configuration loaded from AWS Secrets Manager');
      } else {
        logger.info('🔴 [REDIS] Local environment detected, using environment variables...');
        
        const envVars = {
          REDIS_HOST: process.env.REDIS_HOST,
          REDIS_PORT: process.env.REDIS_PORT,
          REDIS_PASSWORD: process.env.REDIS_PASSWORD,
          REDIS_DB: process.env.REDIS_DB
        };
        
        logger.info('🔴 [REDIS] Environment variables found:', {
          REDIS_HOST: envVars.REDIS_HOST || 'undefined',
          REDIS_PORT: envVars.REDIS_PORT || 'undefined',
          REDIS_DB: envVars.REDIS_DB || 'undefined',
          hasPassword: !!envVars.REDIS_PASSWORD
        });
        
        redisConfig = {
          host: process.env.REDIS_HOST || 'redis',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
          db: parseInt(process.env.REDIS_DB || '0'),
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 50, 2000);
            logger.info(`🔴 [REDIS] Retry attempt ${times}, delay: ${delay}ms`);
            return delay;
          }
        };
        
        logger.info('🔴 [REDIS] Final config built from env vars:', {
          host: redisConfig.host,
          port: redisConfig.port,
          db: redisConfig.db,
          hasPassword: !!redisConfig.password
        });
        
        logger.info('Redis configuration loaded from environment variables (local mode)');
      }

      logger.info('🔴 [REDIS] Creating Redis client with final config...');
      this.client = new Redis(redisConfig);

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('🔴 [REDIS] ✅ Redis connected successfully to:', redisConfig.host + ':' + redisConfig.port);
      });

      this.client.on('error', (err: any) => {
        this.isConnected = false;
        logger.error('🔴 [REDIS] ❌ Redis connection error:', {
          error: err.message,
          code: err.code || 'unknown',
          errno: err.errno || 'unknown',
          syscall: err.syscall || 'unknown',
          hostname: err.hostname || 'unknown',
          attemptedHost: redisConfig.host,
          attemptedPort: redisConfig.port
        });
      });

      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('🔴 [REDIS] ⚠️ Redis connection closed');
      });
      
    } catch (error) {
      logger.error('🔴 [REDIS] ❌ Failed to initialize Redis connection:', error);
      
      // Fallback to basic connection without password for local development
      // In AWS, use the service discovery hostname
      const fallbackConfig = {
        host: process.env.REDIS_HOST || 'redis.callanalytics.local',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        retryStrategy: (times: number) => Math.min(times * 50, 2000)
      };
      
      logger.warn('🔴 [REDIS] Using fallback configuration:', fallbackConfig);
      this.client = new Redis(fallbackConfig);
      
      this.client.on('error', (err: any) => {
        logger.error('🔴 [REDIS] ❌ Fallback connection error:', {
          error: err.message,
          code: err.code || 'unknown',
          errno: err.errno || 'unknown',
          syscall: err.syscall || 'unknown',
          hostname: err.hostname || 'unknown',
          fallbackHost: fallbackConfig.host,
          fallbackPort: fallbackConfig.port
        });
      });
    }
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