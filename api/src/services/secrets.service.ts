import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { logger } from '../utils/logger';

/**
 * AWS Secrets Manager Service
 * Handles secure retrieval of secrets from AWS Secrets Manager with caching and error handling
 */
export class SecretsService {
  private static instance: SecretsService;
  private secretsManager: SecretsManagerClient;
  private cache: Map<string, { value: any; expiry: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

  static getInstance(): SecretsService {
    if (!this.instance) {
      this.instance = new SecretsService();
    }
    return this.instance;
  }

  private constructor() {
    this.secretsManager = new SecretsManagerClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-west-1'
    });
  }

  /**
   * Get secret value from AWS Secrets Manager with caching
   */
  async getSecret(secretId: string): Promise<any> {
    // Check cache first
    const cached = this.cache.get(secretId);
    if (cached && cached.expiry > Date.now()) {
      logger.debug(`Retrieved secret from cache: ${secretId}`);
      return cached.value;
    }

    try {
      logger.info(`Fetching secret from AWS Secrets Manager: ${secretId}`);
      
      const command = new GetSecretValueCommand({
        SecretId: secretId
      });
      const result = await this.secretsManager.send(command);

      if (!result.SecretString) {
        throw new Error(`Secret ${secretId} has no SecretString value`);
      }

      const value = JSON.parse(result.SecretString);
      
      // Cache the result
      this.cache.set(secretId, {
        value,
        expiry: Date.now() + this.CACHE_TTL
      });

      logger.info(`Successfully retrieved and cached secret: ${secretId}`);
      return value;

    } catch (error) {
      logger.error(`Failed to retrieve secret ${secretId}:`, error);
      
      // If we have a cached version (even expired), use it as fallback
      const cached = this.cache.get(secretId);
      if (cached) {
        logger.warn(`Using expired cached version of secret: ${secretId}`);
        return cached.value;
      }
      
      throw error;
    }
  }

  /**
   * Get Oracle database configuration
   */
  async getOracleConfig(): Promise<{
    username: string;
    password: string;
    host: string;
    port: string;
    service_name: string;
    pool_min: string;
    pool_max: string;
    pool_increment: string;
    pool_timeout: string;
  }> {
    return await this.getSecret('prod/call-analytics/oracle');
  }

  /**
   * Get Redis configuration
   */
  async getRedisConfig(): Promise<{
    host: string;
    port: string;
    password: string;
    db: string;
  }> {
    return await this.getSecret('prod/call-analytics/redis');
  }

  /**
   * Get JWT and API keys
   */
  async getJWTConfig(): Promise<{
    jwt_secret: string;
    jwt_expiry: string;
    admin_key: string;
    admin_username: string;
    admin_password: string;
    mcp_api_key: string;
  }> {
    return await this.getSecret('prod/call-analytics/jwt');
  }

  /**
   * Get ML service configuration
   */
  async getMLConfig(): Promise<{
    hf_token: string;
    hf_endpoint_url: string;
    hf_model_name: string;
    model_temperature: string;
    model_max_tokens: string;
    request_timeout: string;
    default_model: string;
    hebrew_model: string;
  }> {
    return await this.getSecret('prod/call-analytics/ml-service');
  }

  /**
   * Get OpenSearch configuration
   */
  async getOpenSearchConfig(): Promise<{
    host: string;
    port: string;
    username: string;
    password: string;
    url: string;
  }> {
    return await this.getSecret('prod/call-analytics/opensearch');
  }

  /**
   * Get Kafka configuration
   */
  async getKafkaConfig(): Promise<{
    brokers: string;
    bootstrap_servers: string;
    schema_registry: string;
  }> {
    return await this.getSecret('prod/call-analytics/kafka');
  }

  /**
   * Clear cache for a specific secret or all secrets
   */
  clearCache(secretId?: string): void {
    if (secretId) {
      this.cache.delete(secretId);
      logger.info(`Cleared cache for secret: ${secretId}`);
    } else {
      this.cache.clear();
      logger.info('Cleared all secrets cache');
    }
  }

  /**
   * Check if running in AWS environment (ECS, Lambda, etc.)
   */
  isAWSEnvironment(): boolean {
    return !!(
      process.env.AWS_EXECUTION_ENV ||
      process.env.AWS_LAMBDA_RUNTIME_API ||
      process.env.ECS_CONTAINER_METADATA_URI_V4 ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION
    );
  }

  /**
   * Get environment variable with fallback to AWS Secrets Manager
   * This allows backward compatibility with .env files during development
   */
  async getConfigValue(
    envVarName: string, 
    secretId?: string, 
    secretKey?: string, 
    defaultValue?: string
  ): Promise<string> {
    // First try environment variable
    const envValue = process.env[envVarName];
    if (envValue) {
      return envValue;
    }

    // If in AWS environment and secret info provided, try AWS Secrets Manager
    if (this.isAWSEnvironment() && secretId && secretKey) {
      try {
        const secret = await this.getSecret(secretId);
        if (secret[secretKey]) {
          return secret[secretKey];
        }
      } catch (error) {
        logger.warn(`Failed to get secret ${secretId}.${secretKey}, falling back to default`);
      }
    }

    // Return default value or throw error
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new Error(`Configuration value not found: ${envVarName}`);
  }
}

// Export singleton instance
export const secretsService = SecretsService.getInstance();