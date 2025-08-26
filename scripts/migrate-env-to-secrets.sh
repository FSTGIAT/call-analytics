#!/bin/bash
# Environment Variables to AWS Secrets Migration Script
# This script reads existing .env files and creates/updates AWS Secrets Manager secrets

set -e

echo "=== Migrating Environment Variables to AWS Secrets Manager ==="

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install AWS CLI first."
    exit 1
fi

# Check AWS credentials
aws sts get-caller-identity > /dev/null || {
    echo "❌ AWS credentials not configured or expired."
    echo "Please run: aws configure or set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN"
    exit 1
}

# Set default region
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}

# Function to parse .env file and return JSON
parse_env_file() {
    local file_path="$1"
    local json_output="{"
    local first=true
    
    if [[ ! -f "$file_path" ]]; then
        echo "{}"
        return
    fi
    
    while IFS='=' read -r key value || [[ -n "$key" ]]; do
        # Skip comments and empty lines
        if [[ "$key" =~ ^#.*$ ]] || [[ -z "$key" ]]; then
            continue
        fi
        
        # Remove quotes from value
        value=$(echo "$value" | sed 's/^["'"'"']//;s/["'"'"']$//')
        
        if [[ "$first" == true ]]; then
            first=false
        else
            json_output+=","
        fi
        
        json_output+="\"$key\":\"$value\""
    done < "$file_path"
    
    json_output+="}"
    echo "$json_output"
}

# Function to create or update secret
create_or_update_secret() {
    local secret_name="$1"
    local secret_data="$2"
    local description="$3"
    
    echo "📝 Processing secret: $secret_name"
    
    # Try to create secret first
    aws secretsmanager create-secret \
        --name "$secret_name" \
        --description "$description" \
        --secret-string "$secret_data" 2>/dev/null && {
        echo "✅ Created secret: $secret_name"
        return
    }
    
    # If creation failed, try to update
    aws secretsmanager update-secret \
        --secret-id "$secret_name" \
        --secret-string "$secret_data" && {
        echo "✅ Updated secret: $secret_name"
    } || {
        echo "❌ Failed to create/update secret: $secret_name"
    }
}

# Function to merge environment variables into appropriate secrets
migrate_oracle_config() {
    echo "🗄️  Migrating Oracle configuration..."
    
    # Read Oracle-related env vars from multiple sources
    local oracle_config="{"
    
    # Try to get values from environment or .env files
    local user=$(grep "ORACLE_USER=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "verint_analytics")
    local password=$(grep "ORACLE_PASSWORD=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "Production_Oracle_2024!")
    local host=$(grep "ORACLE_HOST=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "your-oracle-host.company.internal")
    local port=$(grep "ORACLE_PORT=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "1521")
    local service=$(grep "ORACLE_SERVICE_NAME=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "FREEPDB1")
    local pool_min=$(grep "ORACLE_POOL_MIN=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "10")
    local pool_max=$(grep "ORACLE_POOL_MAX=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "50")
    local pool_inc=$(grep "ORACLE_POOL_INCREMENT=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "5")
    local pool_timeout=$(grep "ORACLE_POOL_TIMEOUT=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "60")
    
    oracle_config="{\"username\":\"$user\",\"password\":\"$password\",\"host\":\"$host\",\"port\":\"$port\",\"service_name\":\"$service\",\"pool_min\":\"$pool_min\",\"pool_max\":\"$pool_max\",\"pool_increment\":\"$pool_inc\",\"pool_timeout\":\"$pool_timeout\"}"
    
    create_or_update_secret "prod/call-analytics/oracle" "$oracle_config" "Oracle database credentials for Call Analytics"
}

# Function to migrate Redis configuration
migrate_redis_config() {
    echo "🔴 Migrating Redis configuration..."
    
    local host=$(grep "REDIS_HOST=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "redis")
    local port=$(grep "REDIS_PORT=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "6379")
    local password=$(grep "REDIS_PASSWORD=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "Production_Redis_2024!")
    local db=$(grep "REDIS_DB=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "0")
    
    local redis_config="{\"host\":\"$host\",\"port\":\"$port\",\"password\":\"$password\",\"db\":\"$db\"}"
    
    create_or_update_secret "prod/call-analytics/redis" "$redis_config" "Redis cache configuration for Call Analytics"
}

# Function to migrate JWT and API keys
migrate_jwt_config() {
    echo "🔐 Migrating JWT and API configuration..."
    
    local jwt_secret=$(grep "JWT_SECRET=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "Production_JWT_Secret_2024_Very_Long_Random_Key_Here")
    local jwt_expiry=$(grep "JWT_EXPIRY=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "24h")
    local admin_key=$(grep "ADMIN_KEY=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "call-analytics-admin-key-2025")
    local admin_user=$(grep "ADMIN_USERNAME=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "admin")
    local admin_pass=$(grep "ADMIN_PASSWORD=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "Production_Admin_2024!")
    local mcp_key=$(grep "MCP_API_KEY=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "your-mcp-api-key-here")
    
    local jwt_config="{\"jwt_secret\":\"$jwt_secret\",\"jwt_expiry\":\"$jwt_expiry\",\"admin_key\":\"$admin_key\",\"admin_username\":\"$admin_user\",\"admin_password\":\"$admin_pass\",\"mcp_api_key\":\"$mcp_key\"}"
    
    create_or_update_secret "prod/call-analytics/jwt" "$jwt_config" "JWT and API authentication keys for Call Analytics"
}

# Function to migrate ML service configuration
migrate_ml_config() {
    echo "🤖 Migrating ML service configuration..."
    
    local hf_token=$(grep "HF_TOKEN=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "YOUR_HUGGINGFACE_TOKEN_HERE")
    local hf_endpoint=$(grep "HF_ENDPOINT_URL=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "https://yatwgywcy7echpom.us-east-1.aws.endpoints.huggingface.cloud")
    local hf_model=$(grep "HF_MODEL_NAME=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "meta-llama/Llama-3.1-70B-Instruct")
    local temp=$(grep "MODEL_TEMPERATURE=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "0.2")
    local tokens=$(grep "MODEL_MAX_TOKENS=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "400")
    local timeout=$(grep "REQUEST_TIMEOUT=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "40")
    local default_model=$(grep "DEFAULT_MODEL=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "dictalm2.0-instruct:Q4_K_M")
    local hebrew_model=$(grep "HEBREW_MODEL=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "dictalm2.0-instruct:Q4_K_M")
    
    local ml_config="{\"hf_token\":\"$hf_token\",\"hf_endpoint_url\":\"$hf_endpoint\",\"hf_model_name\":\"$hf_model\",\"model_temperature\":\"$temp\",\"model_max_tokens\":\"$tokens\",\"request_timeout\":\"$timeout\",\"default_model\":\"$default_model\",\"hebrew_model\":\"$hebrew_model\"}"
    
    create_or_update_secret "prod/call-analytics/ml-service" "$ml_config" "ML service credentials and configuration for Call Analytics"
}

# Function to migrate OpenSearch configuration
migrate_opensearch_config() {
    echo "🔍 Migrating OpenSearch configuration..."
    
    local host=$(grep "OPENSEARCH_HOST=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "opensearch")
    local port=$(grep "OPENSEARCH_PORT=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "9200")
    local user=$(grep "OPENSEARCH_USERNAME=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "admin")
    local password=$(grep "OPENSEARCH_PASSWORD=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "Production_Search_2024!")
    local url=$(grep "OPENSEARCH_URL=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "http://opensearch:9200")
    
    local opensearch_config="{\"host\":\"$host\",\"port\":\"$port\",\"username\":\"$user\",\"password\":\"$password\",\"url\":\"$url\"}"
    
    create_or_update_secret "prod/call-analytics/opensearch" "$opensearch_config" "OpenSearch service credentials for Call Analytics"
}

# Function to migrate Kafka configuration
migrate_kafka_config() {
    echo "📨 Migrating Kafka configuration..."
    
    local brokers=$(grep "KAFKA_BROKERS=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "kafka:29092")
    local bootstrap=$(grep "KAFKA_BOOTSTRAP_SERVERS=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "kafka:29092")
    local schema_registry=$(grep "KAFKA_SCHEMA_REGISTRY=" config/.env.* 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d '"' || echo "http://schema-registry:8081")
    
    local kafka_config="{\"brokers\":\"$brokers\",\"bootstrap_servers\":\"$bootstrap\",\"schema_registry\":\"$schema_registry\"}"
    
    create_or_update_secret "prod/call-analytics/kafka" "$kafka_config" "Kafka messaging configuration for Call Analytics"
}

# Main migration execution
echo "🚀 Starting migration process..."

# Change to project directory
cd "$(dirname "$0")/.." || {
    echo "❌ Failed to change to project directory"
    exit 1
}

echo "📂 Working directory: $(pwd)"

# Execute migrations
migrate_oracle_config
migrate_redis_config
migrate_jwt_config
migrate_ml_config
migrate_opensearch_config
migrate_kafka_config

echo ""
echo "✅ Migration completed successfully!"
echo ""
echo "📋 Created/Updated secrets:"
echo "   • prod/call-analytics/oracle     - Oracle database credentials"
echo "   • prod/call-analytics/redis      - Redis cache configuration"
echo "   • prod/call-analytics/jwt        - JWT and API keys"
echo "   • prod/call-analytics/ml-service - ML service tokens"
echo "   • prod/call-analytics/opensearch - OpenSearch credentials"
echo "   • prod/call-analytics/kafka      - Kafka configuration"
echo ""
echo "⚠️  Important: Review and update sensitive values like:"
echo "   • HuggingFace tokens"
echo "   • Production passwords"
echo "   • Oracle connection details"
echo ""
echo "💡 To view a secret: aws secretsmanager get-secret-value --secret-id prod/call-analytics/oracle"
echo "💡 To update a secret: aws secretsmanager update-secret --secret-id prod/call-analytics/oracle --secret-string '{\"key\":\"value\"}'"