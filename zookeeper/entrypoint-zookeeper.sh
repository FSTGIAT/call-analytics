#!/bin/bash

set -e

echo "🔵 [ZOOKEEPER] Starting Zookeeper with AWS Secrets Manager integration..."

# Function to check if running in AWS environment
is_aws_environment() {
    [[ -n "${AWS_EXECUTION_ENV}" || -n "${AWS_LAMBDA_RUNTIME_API}" || -n "${ECS_CONTAINER_METADATA_URI_V4}" || -n "${AWS_REGION}" || -n "${AWS_DEFAULT_REGION}" ]]
}

# Function to get secret from AWS Secrets Manager
get_secret() {
    local secret_id=$1
    local region=${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-west-1}}
    
    echo "🔵 [ZOOKEEPER] Fetching secret: $secret_id from region: $region" >&2
    aws secretsmanager get-secret-value \
        --secret-id "$secret_id" \
        --region "$region" \
        --query SecretString \
        --output text 2>/dev/null || echo "{}"
}

if is_aws_environment; then
    echo "🔵 [ZOOKEEPER] AWS environment detected, loading configuration from Secrets Manager..."
    
    # Get Zookeeper configuration from secrets manager
    zookeeper_secrets=$(get_secret "prod/call-analytics/zookeeper")
    
    if [[ "$zookeeper_secrets" != "{}" ]]; then
        echo "🔵 [ZOOKEEPER] Successfully retrieved Zookeeper secrets"
        echo "🔵 [ZOOKEEPER] Raw secrets JSON: $zookeeper_secrets"
        
        # Validate JSON first
        if ! echo "$zookeeper_secrets" | jq empty 2>/dev/null; then
            echo "🔵 [ZOOKEEPER] ❌ Invalid JSON format in secrets"
            zookeeper_secrets="{}"
        else
            # Export each secret as environment variable
            while IFS="=" read -r key value; do
                if [[ "$key" == ZOOKEEPER_* ]]; then
                    export "$key"="$value"
                    echo "🔵 [ZOOKEEPER] Set $key=$value"
                fi
            done < <(echo "$zookeeper_secrets" | jq -r 'to_entries[] | select(.key | startswith("ZOOKEEPER_")) | "\(.key)=\(.value)"')
        fi
        
    else
        echo "🔵 [ZOOKEEPER] ⚠️ Failed to retrieve Zookeeper secrets, using fallback configuration"
        export ZOOKEEPER_CLIENT_PORT=2181
        export ZOOKEEPER_TICK_TIME=2000
        export ZOOKEEPER_SYNC_LIMIT=2
    fi
    
    echo "🔵 [ZOOKEEPER] Configuration loaded from AWS Secrets Manager"
else
    echo "🔵 [ZOOKEEPER] Local environment detected, using environment variables..."
fi

# Verify required environment variables
required_vars=("ZOOKEEPER_CLIENT_PORT")
for var in "${required_vars[@]}"; do
    if [[ -z "${!var}" ]]; then
        echo "🔵 [ZOOKEEPER] ❌ Missing required environment variable: $var"
        exit 1
    fi
    echo "🔵 [ZOOKEEPER] ✅ $var is set to ${!var}"
done

echo "🔵 [ZOOKEEPER] Starting Zookeeper with configuration:"
echo "🔵 [ZOOKEEPER] - CLIENT_PORT: $ZOOKEEPER_CLIENT_PORT"
echo "🔵 [ZOOKEEPER] - TICK_TIME: $ZOOKEEPER_TICK_TIME"
echo "🔵 [ZOOKEEPER] - SYNC_LIMIT: $ZOOKEEPER_SYNC_LIMIT"

# Set default values for any empty environment variables
export ZOOKEEPER_CLIENT_PORT=${ZOOKEEPER_CLIENT_PORT:-2181}
export ZOOKEEPER_TICK_TIME=${ZOOKEEPER_TICK_TIME:-2000}
export ZOOKEEPER_SYNC_LIMIT=${ZOOKEEPER_SYNC_LIMIT:-2}
export ZOOKEEPER_INIT_LIMIT=${ZOOKEEPER_INIT_LIMIT:-5}
export ZOOKEEPER_MAX_CLIENT_CNXNS=${ZOOKEEPER_MAX_CLIENT_CNXNS:-60}
export ZOOKEEPER_AUTOPURGE_SNAP_RETAIN_COUNT=${ZOOKEEPER_AUTOPURGE_SNAP_RETAIN_COUNT:-3}
export ZOOKEEPER_AUTOPURGE_PURGE_INTERVAL=${ZOOKEEPER_AUTOPURGE_PURGE_INTERVAL:-24}

# Debug: Show environment variables
echo "🔵 [ZOOKEEPER] All ZOOKEEPER_ environment variables:"
env | grep ZOOKEEPER_ | sort

# Ensure configuration directories exist
mkdir -p /etc/kafka

# Make sure we're running as the right user
echo "🔵 [ZOOKEEPER] Current user: $(id)"

# Generate Zookeeper configuration file manually
echo "🔵 [ZOOKEEPER] Generating zookeeper.properties configuration file..."
cat > /etc/kafka/zookeeper.properties << EOF
# Zookeeper Configuration
clientPort=${ZOOKEEPER_CLIENT_PORT}
tickTime=${ZOOKEEPER_TICK_TIME}
syncLimit=${ZOOKEEPER_SYNC_LIMIT}
initLimit=${ZOOKEEPER_INIT_LIMIT}
maxClientCnxns=${ZOOKEEPER_MAX_CLIENT_CNXNS}
autopurge.snapRetainCount=${ZOOKEEPER_AUTOPURGE_SNAP_RETAIN_COUNT}
autopurge.purgeInterval=${ZOOKEEPER_AUTOPURGE_PURGE_INTERVAL}
dataDir=/var/lib/zookeeper/data
dataLogDir=/var/lib/zookeeper/log
EOF

echo "🔵 [ZOOKEEPER] Generated configuration file:"
cat /etc/kafka/zookeeper.properties

# Ensure data directories exist
mkdir -p /var/lib/zookeeper/data /var/lib/zookeeper/log

echo "🔵 [ZOOKEEPER] Starting Zookeeper server directly with generated configuration..."

# Start Zookeeper directly with our configuration
exec /usr/bin/zookeeper-server-start /etc/kafka/zookeeper.properties