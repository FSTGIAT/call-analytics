#!/bin/bash
# AWS-aware entrypoint for Call Analytics API Service

set -e

echo "🚀 Starting Call Analytics API Service (AWS Mode)"

# Function to get secret from AWS Secrets Manager
get_secret() {
    local secret_name=$1
    local json_key=${2:-""}
    
    if [[ -z "$secret_name" ]]; then
        echo ""
        return 1
    fi
    
    local secret_value
    secret_value=$(aws secretsmanager get-secret-value \
        --secret-id "$secret_name" \
        --query SecretString \
        --output text 2>/dev/null) || {
        echo ""
        return 1
    }
    
    if [[ -n "$json_key" ]]; then
        echo "$secret_value" | jq -r ".$json_key" 2>/dev/null || echo ""
    else
        echo "$secret_value"
    fi
}

# Only fetch secrets if not running with injected secrets (ECS injects them automatically)
if [[ -z "$ECS_CONTAINER_METADATA_URI_V4" ]] && command -v aws >/dev/null 2>&1; then
    echo "📡 Not running in ECS - fetching secrets from Secrets Manager..."
    
    # Test AWS connectivity
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        echo "⚠️  AWS credentials not available or expired, proceeding with environment variables"
    else
        echo "✅ AWS credentials validated"
        
        # Fetch Oracle credentials for on-premise connection
        echo "🗄️  Fetching Oracle credentials..."
        ORACLE_JSON=$(get_secret "prod/call-analytics/oracle")
        
        if [[ -n "$ORACLE_JSON" ]]; then
            export ORACLE_USER=$(echo "$ORACLE_JSON" | jq -r '.username' 2>/dev/null || echo "")
            export ORACLE_PASSWORD=$(echo "$ORACLE_JSON" | jq -r '.password' 2>/dev/null || echo "")
            export ORACLE_HOST=$(echo "$ORACLE_JSON" | jq -r '.host' 2>/dev/null || echo "")
            export ORACLE_PORT=$(echo "$ORACLE_JSON" | jq -r '.port' 2>/dev/null || echo "")
            export ORACLE_SERVICE_NAME=$(echo "$ORACLE_JSON" | jq -r '.service_name' 2>/dev/null || echo "")
            export ORACLE_POOL_MIN=$(echo "$ORACLE_JSON" | jq -r '.pool_min' 2>/dev/null || echo "10")
            export ORACLE_POOL_MAX=$(echo "$ORACLE_JSON" | jq -r '.pool_max' 2>/dev/null || echo "50")
            export ORACLE_POOL_INCREMENT=$(echo "$ORACLE_JSON" | jq -r '.pool_increment' 2>/dev/null || echo "5")
            export ORACLE_POOL_TIMEOUT=$(echo "$ORACLE_JSON" | jq -r '.pool_timeout' 2>/dev/null || echo "60")
            echo "✅ Oracle configuration loaded from AWS Secrets"
        else
            echo "⚠️  Failed to load Oracle secrets, using environment variables"
        fi
        
        # Fetch Redis configuration
        echo "🔴 Fetching Redis configuration..."
        REDIS_JSON=$(get_secret "prod/call-analytics/redis")
        
        if [[ -n "$REDIS_JSON" ]]; then
            export REDIS_HOST=$(echo "$REDIS_JSON" | jq -r '.host' 2>/dev/null || echo "redis")
            export REDIS_PORT=$(echo "$REDIS_JSON" | jq -r '.port' 2>/dev/null || echo "6379")
            export REDIS_PASSWORD=$(echo "$REDIS_JSON" | jq -r '.password' 2>/dev/null || echo "")
            export REDIS_DB=$(echo "$REDIS_JSON" | jq -r '.db' 2>/dev/null || echo "0")
            echo "✅ Redis configuration loaded from AWS Secrets"
        else
            echo "⚠️  Failed to load Redis secrets, using environment variables"
        fi
        
        # Fetch JWT and API keys
        echo "🔐 Fetching JWT and API configuration..."
        JWT_JSON=$(get_secret "prod/call-analytics/jwt")
        
        if [[ -n "$JWT_JSON" ]]; then
            export JWT_SECRET=$(echo "$JWT_JSON" | jq -r '.jwt_secret' 2>/dev/null || echo "")
            export JWT_EXPIRY=$(echo "$JWT_JSON" | jq -r '.jwt_expiry' 2>/dev/null || echo "24h")
            export ADMIN_KEY=$(echo "$JWT_JSON" | jq -r '.admin_key' 2>/dev/null || echo "")
            export ADMIN_USERNAME=$(echo "$JWT_JSON" | jq -r '.admin_username' 2>/dev/null || echo "admin")
            export ADMIN_PASSWORD=$(echo "$JWT_JSON" | jq -r '.admin_password' 2>/dev/null || echo "")
            export MCP_API_KEY=$(echo "$JWT_JSON" | jq -r '.mcp_api_key' 2>/dev/null || echo "")
            echo "✅ JWT and API configuration loaded from AWS Secrets"
        else
            echo "⚠️  Failed to load JWT secrets, using environment variables"
        fi
        
        # Fetch OpenSearch configuration
        echo "🔍 Fetching OpenSearch configuration..."
        OPENSEARCH_JSON=$(get_secret "prod/call-analytics/opensearch")
        
        if [[ -n "$OPENSEARCH_JSON" ]]; then
            export OPENSEARCH_HOST=$(echo "$OPENSEARCH_JSON" | jq -r '.host' 2>/dev/null || echo "opensearch")
            export OPENSEARCH_PORT=$(echo "$OPENSEARCH_JSON" | jq -r '.port' 2>/dev/null || echo "9200")
            export OPENSEARCH_USERNAME=$(echo "$OPENSEARCH_JSON" | jq -r '.username' 2>/dev/null || echo "admin")
            export OPENSEARCH_PASSWORD=$(echo "$OPENSEARCH_JSON" | jq -r '.password' 2>/dev/null || echo "")
            export OPENSEARCH_URL=$(echo "$OPENSEARCH_JSON" | jq -r '.url' 2>/dev/null || echo "http://opensearch:9200")
            echo "✅ OpenSearch configuration loaded from AWS Secrets"
        else
            echo "⚠️  Failed to load OpenSearch secrets, using environment variables"
        fi
        
        # Fetch Kafka configuration
        echo "📨 Fetching Kafka configuration..."
        KAFKA_JSON=$(get_secret "prod/call-analytics/kafka")
        
        if [[ -n "$KAFKA_JSON" ]]; then
            export KAFKA_BROKERS=$(echo "$KAFKA_JSON" | jq -r '.brokers' 2>/dev/null || echo "kafka:29092")
            export KAFKA_BOOTSTRAP_SERVERS=$(echo "$KAFKA_JSON" | jq -r '.bootstrap_servers' 2>/dev/null || echo "kafka:29092")
            export KAFKA_SCHEMA_REGISTRY=$(echo "$KAFKA_JSON" | jq -r '.schema_registry' 2>/dev/null || echo "http://schema-registry:8081")
            echo "✅ Kafka configuration loaded from AWS Secrets"
        else
            echo "⚠️  Failed to load Kafka secrets, using environment variables"
        fi
        
        echo "📋 All secrets loaded successfully"
    fi
else
    if [[ -n "$ECS_CONTAINER_METADATA_URI_V4" ]]; then
        echo "🐳 Running in ECS - using injected secrets"
    else
        echo "🏠 AWS CLI not available - using local environment variables"
    fi
fi

# Set production defaults
export NODE_ENV=${NODE_ENV:-production}
export PORT=${PORT:-3000}

# Oracle and UTF-8 setup
export LC_ALL=C.UTF-8
export LANG=C.UTF-8
export NLS_LANG=AMERICAN_AMERICA.AL32UTF8

# Log startup information
echo "🌍 Environment: $NODE_ENV"
echo "🚪 Port: $PORT"
echo "🗄️  Oracle Host: ${ORACLE_HOST:-'[using environment]'}"
echo "🔴 Redis Host: ${REDIS_HOST:-'[using environment]'}"
echo "🔍 OpenSearch URL: ${OPENSEARCH_URL:-'[using environment]'}"

# Execute the original command
echo "⚡ Starting application..."
exec "$@"