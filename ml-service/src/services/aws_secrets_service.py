"""
AWS Secrets Manager Service for ML Service
Handles secure retrieval of secrets from AWS Secrets Manager with caching and error handling
"""

import os
import json
import logging
import time
from typing import Dict, Any, Optional
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class AWSSecretsService:
    """Service for managing AWS Secrets Manager integration"""
    
    def __init__(self):
        self.client = None
        self.cache: Dict[str, Dict] = {}
        self.cache_ttl = 5 * 60  # 5 minutes cache TTL
        
        # Initialize only if in AWS environment
        if self.is_aws_environment():
            try:
                self.client = boto3.client(
                    'secretsmanager',
                    region_name=os.getenv('AWS_REGION', os.getenv('AWS_DEFAULT_REGION', 'eu-west-1'))
                )
                logger.info("AWS Secrets Manager client initialized")
            except Exception as e:
                logger.error(f"Failed to initialize AWS Secrets Manager client: {e}")
                self.client = None
        else:
            logger.info("Not in AWS environment, skipping Secrets Manager initialization")

    def is_aws_environment(self) -> bool:
        """Check if running in AWS environment"""
        return bool(
            os.getenv('AWS_EXECUTION_ENV') or
            os.getenv('AWS_LAMBDA_RUNTIME_API') or
            os.getenv('ECS_CONTAINER_METADATA_URI_V4') or
            os.getenv('AWS_REGION') or
            os.getenv('AWS_DEFAULT_REGION')
        )

    def get_secret(self, secret_id: str) -> Optional[Dict[str, Any]]:
        """
        Get secret value from AWS Secrets Manager with caching
        
        Args:
            secret_id: The secret ID/ARN to retrieve
            
        Returns:
            Dict containing the secret data, or None if not available
        """
        if not self.client:
            logger.debug(f"AWS Secrets Manager not available, skipping secret: {secret_id}")
            return None

        # Check cache first
        if secret_id in self.cache:
            cached_data = self.cache[secret_id]
            if cached_data['expiry'] > time.time():
                logger.debug(f"Retrieved secret from cache: {secret_id}")
                return cached_data['value']

        try:
            logger.info(f"Fetching secret from AWS Secrets Manager: {secret_id}")
            
            response = self.client.get_secret_value(SecretId=secret_id)
            
            if 'SecretString' not in response:
                logger.error(f"Secret {secret_id} has no SecretString value")
                return None

            secret_data = json.loads(response['SecretString'])
            
            # Cache the result
            self.cache[secret_id] = {
                'value': secret_data,
                'expiry': time.time() + self.cache_ttl
            }

            logger.info(f"Successfully retrieved and cached secret: {secret_id}")
            return secret_data

        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'DecryptionFailureException':
                logger.error(f"Decryption failed for secret {secret_id}: {e}")
            elif error_code == 'InternalServiceErrorException':
                logger.error(f"Internal service error for secret {secret_id}: {e}")
            elif error_code == 'InvalidParameterException':
                logger.error(f"Invalid parameter for secret {secret_id}: {e}")
            elif error_code == 'InvalidRequestException':
                logger.error(f"Invalid request for secret {secret_id}: {e}")
            elif error_code == 'ResourceNotFoundException':
                logger.error(f"Secret {secret_id} not found: {e}")
            else:
                logger.error(f"Unknown error retrieving secret {secret_id}: {e}")
            
            # Return cached version if available (even if expired)
            if secret_id in self.cache:
                logger.warn(f"Using expired cached version of secret: {secret_id}")
                return self.cache[secret_id]['value']
                
            return None

        except Exception as e:
            logger.error(f"Unexpected error retrieving secret {secret_id}: {e}")
            
            # Return cached version if available
            if secret_id in self.cache:
                logger.warn(f"Using cached version due to error: {secret_id}")
                return self.cache[secret_id]['value']
                
            return None

    def get_ml_config(self) -> Optional[Dict[str, Any]]:
        """Get ML service configuration from AWS Secrets Manager"""
        return self.get_secret('prod/call-analytics/ml-service')

    def get_config_value(self, env_var_name: str, secret_id: str = None, secret_key: str = None, default_value: str = None) -> str:
        """
        Get configuration value with fallback priority:
        1. Environment variable
        2. AWS Secrets Manager (if available)
        3. Default value
        4. Raise error if none available
        
        Args:
            env_var_name: Environment variable name
            secret_id: AWS secret ID (optional)
            secret_key: Key within the secret (optional)
            default_value: Default value if nothing else available
            
        Returns:
            Configuration value as string
            
        Raises:
            ValueError: If no value found and no default provided
        """
        # First try environment variable
        env_value = os.getenv(env_var_name)
        if env_value:
            return env_value

        # Try AWS Secrets Manager if in AWS environment and secret info provided
        if self.is_aws_environment() and secret_id and secret_key:
            try:
                secret_data = self.get_secret(secret_id)
                if secret_data and secret_key in secret_data:
                    return str(secret_data[secret_key])
            except Exception as e:
                logger.warn(f"Failed to get secret {secret_id}.{secret_key}, falling back to default: {e}")

        # Return default value if provided
        if default_value is not None:
            return default_value

        # Raise error if no value found
        raise ValueError(f"Configuration value not found: {env_var_name}")

    def clear_cache(self, secret_id: str = None) -> None:
        """Clear cache for specific secret or all secrets"""
        if secret_id:
            if secret_id in self.cache:
                del self.cache[secret_id]
                logger.info(f"Cleared cache for secret: {secret_id}")
        else:
            self.cache.clear()
            logger.info("Cleared all secrets cache")


# Create singleton instance
aws_secrets_service = AWSSecretsService()