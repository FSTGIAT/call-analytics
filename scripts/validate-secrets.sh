#!/bin/bash
# Validate AWS Secrets Manager configuration for Call Analytics Platform

set -e

echo "=== Validating AWS Secrets Manager Configuration ==="

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install AWS CLI first."
    exit 1
fi

# Check AWS credentials
aws sts get-caller-identity > /dev/null || {
    echo "❌ AWS credentials not configured or expired."
    exit 1
}

# Set default region
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-eu-west-1}

# Function to validate secret existence and structure
validate_secret() {
    local secret_name="$1"
    local required_keys="$2"
    
    echo "🔍 Validating secret: $secret_name"
    
    # Check if secret exists
    if ! aws secretsmanager describe-secret --secret-id "$secret_name" > /dev/null 2>&1; then
        echo "❌ Secret not found: $secret_name"
        return 1
    fi
    
    # Get secret value
    local secret_value
    secret_value=$(aws secretsmanager get-secret-value --secret-id "$secret_name" --query SecretString --output text 2>/dev/null) || {
        echo "❌ Failed to retrieve secret value: $secret_name"
        return 1
    }
    
    # Validate JSON format
    echo "$secret_value" | jq . > /dev/null 2>&1 || {
        echo "❌ Invalid JSON format in secret: $secret_name"
        return 1
    }
    
    # Check required keys
    local missing_keys=()
    IFS=',' read -ra keys <<< "$required_keys"
    for key in "${keys[@]}"; do
        if ! echo "$secret_value" | jq -e ".$key" > /dev/null 2>&1; then
            missing_keys+=("$key")
        fi
    done
    
    if [[ ${#missing_keys[@]} -gt 0 ]]; then
        echo "⚠️  Missing keys in $secret_name: ${missing_keys[*]}"
        return 1
    fi
    
    echo "✅ Valid: $secret_name"
    return 0
}

# Function to check for empty or placeholder values
check_placeholder_values() {
    local secret_name="$1"
    local placeholder_patterns="$2"
    
    local secret_value
    secret_value=$(aws secretsmanager get-secret-value --secret-id "$secret_name" --query SecretString --output text 2>/dev/null) || return 1
    
    local warnings=()
    IFS=',' read -ra patterns <<< "$placeholder_patterns"
    for pattern in "${patterns[@]}"; do
        if echo "$secret_value" | jq -r '.[]' 2>/dev/null | grep -q "$pattern"; then
            warnings+=("Found placeholder value matching: $pattern")
        fi
    done
    
    if [[ ${#warnings[@]} -gt 0 ]]; then
        echo "⚠️  Potential placeholder values in $secret_name:"
        printf '   %s\n' "${warnings[@]}"
        return 1
    fi
    
    return 0
}

# Validation results
validation_results=()

echo "🚀 Starting validation..."
echo ""

# Validate Oracle configuration
echo "🗄️  Oracle Configuration"
if validate_secret "prod/call-analytics/oracle" "username,password,host,port,service_name,pool_min,pool_max,pool_increment,pool_timeout"; then
    validation_results+=("✅ Oracle config: VALID")
    check_placeholder_values "prod/call-analytics/oracle" "your-oracle-host,Production_Oracle_2024" || true
else
    validation_results+=("❌ Oracle config: INVALID")
fi
echo ""

# Validate Redis configuration
echo "🔴 Redis Configuration"
if validate_secret "prod/call-analytics/redis" "host,port,password,db"; then
    validation_results+=("✅ Redis config: VALID")
    check_placeholder_values "prod/call-analytics/redis" "Production_Redis_2024" || true
else
    validation_results+=("❌ Redis config: INVALID")
fi
echo ""

# Validate JWT configuration
echo "🔐 JWT and API Configuration"
if validate_secret "prod/call-analytics/jwt" "jwt_secret,jwt_expiry,admin_key,admin_username,admin_password,mcp_api_key"; then
    validation_results+=("✅ JWT config: VALID")
    check_placeholder_values "prod/call-analytics/jwt" "Production_JWT_Secret_2024,call-analytics-admin-key-2025,your-mcp-api-key" || true
else
    validation_results+=("❌ JWT config: INVALID")
fi
echo ""

# Validate ML service configuration
echo "🤖 ML Service Configuration"
if validate_secret "prod/call-analytics/ml-service" "hf_token,hf_endpoint_url,hf_model_name,model_temperature,model_max_tokens,request_timeout,default_model,hebrew_model"; then
    validation_results+=("✅ ML config: VALID")
    check_placeholder_values "prod/call-analytics/ml-service" "YOUR_HUGGINGFACE_TOKEN_HERE" || true
else
    validation_results+=("❌ ML config: INVALID")
fi
echo ""

# Validate OpenSearch configuration
echo "🔍 OpenSearch Configuration"
if validate_secret "prod/call-analytics/opensearch" "host,port,username,password,url"; then
    validation_results+=("✅ OpenSearch config: VALID")
    check_placeholder_values "prod/call-analytics/opensearch" "Production_Search_2024" || true
else
    validation_results+=("❌ OpenSearch config: INVALID")
fi
echo ""

# Validate Kafka configuration
echo "📨 Kafka Configuration"
if validate_secret "prod/call-analytics/kafka" "brokers,bootstrap_servers,schema_registry"; then
    validation_results+=("✅ Kafka config: VALID")
else
    validation_results+=("❌ Kafka config: INVALID")
fi
echo ""

# Check IAM permissions
echo "👤 IAM Permissions"
if aws sts get-caller-identity > /dev/null 2>&1; then
    echo "✅ AWS credentials are valid"
    validation_results+=("✅ AWS access: VALID")
    
    # Check if we can access secrets (basic test)
    if aws secretsmanager list-secrets --max-items 1 > /dev/null 2>&1; then
        echo "✅ Secrets Manager access confirmed"
    else
        echo "⚠️  Limited Secrets Manager access"
        validation_results+=("⚠️  Secrets Manager: LIMITED ACCESS")
    fi
else
    echo "❌ AWS credentials invalid"
    validation_results+=("❌ AWS access: INVALID")
fi
echo ""

# Summary
echo "📋 Validation Summary:"
echo "==================="
for result in "${validation_results[@]}"; do
    echo "   $result"
done
echo ""

# Count failures
failed_count=$(printf '%s\n' "${validation_results[@]}" | grep -c "❌" || true)
warning_count=$(printf '%s\n' "${validation_results[@]}" | grep -c "⚠️" || true)

if [[ $failed_count -eq 0 ]]; then
    if [[ $warning_count -eq 0 ]]; then
        echo "🎉 All validations passed! Your AWS Secrets Manager configuration is ready for production."
        exit 0
    else
        echo "⚠️  Validation completed with $warning_count warnings. Please review placeholder values."
        exit 0
    fi
else
    echo "💥 Validation failed with $failed_count errors and $warning_count warnings."
    echo ""
    echo "🔧 Next steps:"
    echo "   1. Run setup-aws-secrets.sh to create missing secrets"
    echo "   2. Run migrate-env-to-secrets.sh to populate from .env files"
    echo "   3. Update placeholder values with real credentials"
    echo "   4. Re-run this validation script"
    exit 1
fi