#!/bin/bash
# Script to create AWS Secrets Manager secrets for Call Analytics Platform
# Run with: AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx AWS_SESSION_TOKEN=xxx ./setup-aws-secrets.sh

set -e

echo "=== Setting up AWS Secrets Manager for Call Analytics Platform ==="

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install AWS CLI first."
    exit 1
fi

# Check if AWS credentials are set
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo "❌ AWS credentials not set. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables."
    exit 1
fi

# Set default region if not set
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-eu-west-1}

# Test AWS connection
echo "🔍 Testing AWS connection..."
aws sts get-caller-identity || {
    echo "❌ Failed to authenticate with AWS. Please check your credentials."
    exit 1
}

# 1. Oracle Database Credentials - For on-premise connection
echo "📊 Creating Oracle database secret..."
aws secretsmanager create-secret \
    --name prod/call-analytics/oracle \
    --description "On-premise Oracle database credentials" \
    --secret-string '{
        "username": "verint_analytics",
        "password": "Production_Oracle_2024!",
        "host": "your-oracle-host.company.internal",
        "port": "1521",
        "service_name": "FREEPDB1",
        "pool_min": "10",
        "pool_max": "50",
        "pool_increment": "5",
        "pool_timeout": "60"
    }' 2>/dev/null || echo "⚠️  Oracle secret already exists, updating..."

# Update if exists
aws secretsmanager update-secret \
    --secret-id prod/call-analytics/oracle \
    --secret-string '{
        "username": "verint_analytics",
        "password": "Production_Oracle_2024!",
        "host": "your-oracle-host.company.internal",
        "port": "1521",
        "service_name": "FREEPDB1",
        "pool_min": "10",
        "pool_max": "50",
        "pool_increment": "5",
        "pool_timeout": "60"
    }' || true

# 2. Redis Password
echo "🔴 Creating Redis secret..."
aws secretsmanager create-secret \
    --name prod/call-analytics/redis \
    --description "Redis cache configuration" \
    --secret-string '{
        "host": "redis",
        "port": "6379",
        "password": "Production_Redis_2024!",
        "db": "0"
    }' 2>/dev/null || echo "⚠️  Redis secret already exists, updating..."

aws secretsmanager update-secret \
    --secret-id prod/call-analytics/redis \
    --secret-string '{
        "host": "redis",
        "port": "6379",
        "password": "Production_Redis_2024!",
        "db": "0"
    }' || true

# 3. JWT and API Keys
echo "🔐 Creating JWT and API keys secret..."
aws secretsmanager create-secret \
    --name prod/call-analytics/jwt \
    --description "JWT and API authentication keys" \
    --secret-string '{
        "jwt_secret": "Production_JWT_Secret_2024_Very_Long_Random_Key_Here",
        "jwt_expiry": "24h",
        "admin_key": "call-analytics-admin-key-2025",
        "admin_username": "admin",
        "admin_password": "Production_Admin_2024!",
        "mcp_api_key": "your-mcp-api-key-here"
    }' 2>/dev/null || echo "⚠️  JWT secret already exists, updating..."

aws secretsmanager update-secret \
    --secret-id prod/call-analytics/jwt \
    --secret-string '{
        "jwt_secret": "Production_JWT_Secret_2024_Very_Long_Random_Key_Here",
        "jwt_expiry": "24h",
        "admin_key": "call-analytics-admin-key-2025",
        "admin_username": "admin",
        "admin_password": "Production_Admin_2024!",
        "mcp_api_key": "your-mcp-api-key-here"
    }' || true

# 4. ML Service Secrets (HuggingFace and other ML tokens)
echo "🤖 Creating ML service secrets..."
aws secretsmanager create-secret \
    --name prod/call-analytics/ml-service \
    --description "ML service credentials and tokens" \
    --secret-string '{
        "hf_token": "YOUR_HUGGINGFACE_TOKEN_HERE",
        "hf_endpoint_url": "https://yatwgywcy7echpom.us-east-1.aws.endpoints.huggingface.cloud",
        "hf_model_name": "meta-llama/Llama-3.1-70B-Instruct",
        "model_temperature": "0.2",
        "model_max_tokens": "400",
        "request_timeout": "40",
        "default_model": "dictalm2.0-instruct:Q4_K_M",
        "hebrew_model": "dictalm2.0-instruct:Q4_K_M"
    }' 2>/dev/null || echo "⚠️  ML service secret already exists, updating..."

aws secretsmanager update-secret \
    --secret-id prod/call-analytics/ml-service \
    --secret-string '{
        "hf_token": "YOUR_HUGGINGFACE_TOKEN_HERE",
        "hf_endpoint_url": "https://yatwgywcy7echpom.us-east-1.aws.endpoints.huggingface.cloud",
        "hf_model_name": "meta-llama/Llama-3.1-70B-Instruct",
        "model_temperature": "0.2",
        "model_max_tokens": "400",
        "request_timeout": "40",
        "default_model": "dictalm2.0-instruct:Q4_K_M",
        "hebrew_model": "dictalm2.0-instruct:Q4_K_M"
    }' || true

# 5. OpenSearch Credentials
echo "🔍 Creating OpenSearch secret..."
aws secretsmanager create-secret \
    --name prod/call-analytics/opensearch \
    --description "OpenSearch service credentials" \
    --secret-string '{
        "host": "opensearch",
        "port": "9200",
        "username": "admin",
        "password": "Production_Search_2024!",
        "url": "http://opensearch:9200"
    }' 2>/dev/null || echo "⚠️  OpenSearch secret already exists, updating..."

aws secretsmanager update-secret \
    --secret-id prod/call-analytics/opensearch \
    --secret-string '{
        "host": "opensearch",
        "port": "9200",
        "username": "admin",
        "password": "Production_Search_2024!",
        "url": "http://opensearch:9200"
    }' || true

# 6. Kafka Configuration
echo "📨 Creating Kafka secret..."
aws secretsmanager create-secret \
    --name prod/call-analytics/kafka \
    --description "Kafka messaging configuration" \
    --secret-string '{
        "brokers": "kafka:29092",
        "bootstrap_servers": "kafka:29092",
        "schema_registry": "http://schema-registry:8081"
    }' 2>/dev/null || echo "⚠️  Kafka secret already exists, updating..."

aws secretsmanager update-secret \
    --secret-id prod/call-analytics/kafka \
    --secret-string '{
        "brokers": "kafka:29092",
        "bootstrap_servers": "kafka:29092",
        "schema_registry": "http://schema-registry:8081"
    }' || true

echo ""
echo "✅ AWS Secrets Manager setup completed!"
echo ""
echo "📋 Created secrets:"
echo "   • prod/call-analytics/oracle     - Oracle database credentials"
echo "   • prod/call-analytics/redis      - Redis cache configuration"
echo "   • prod/call-analytics/jwt        - JWT and API keys"
echo "   • prod/call-analytics/ml-service - ML service tokens"
echo "   • prod/call-analytics/opensearch - OpenSearch credentials"
echo "   • prod/call-analytics/kafka      - Kafka configuration"
echo ""
echo "🔧 Next steps:"
echo "   1. Update your actual credentials in the secrets (especially HuggingFace token)"
echo "   2. Create IAM role for ECS tasks"
echo "   3. Update application code to use AWS Secrets Manager"
echo ""
echo "💡 To view a secret: aws secretsmanager get-secret-value --secret-id prod/call-analytics/oracle"