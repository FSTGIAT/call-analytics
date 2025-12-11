#!/bin/bash

set -e

echo "🟢 [OPENSEARCH] Starting OpenSearch with AWS Secrets Manager integration..."

# Function to check if running in AWS environment
is_aws_environment() {
    [[ -n "${AWS_EXECUTION_ENV}" || -n "${AWS_LAMBDA_RUNTIME_API}" || -n "${ECS_CONTAINER_METADATA_URI_V4}" || -n "${AWS_REGION}" || -n "${AWS_DEFAULT_REGION}" ]]
}

# Function to get secret from AWS Secrets Manager
get_secret() {
    local secret_id=$1
    local region=${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-west-1}}
    
    echo "🟢 [OPENSEARCH] Fetching secret: $secret_id from region: $region" >&2
    aws secretsmanager get-secret-value \
        --secret-id "$secret_id" \
        --region "$region" \
        --query SecretString \
        --output text 2>/dev/null || echo "{}"
}

if is_aws_environment; then
    echo "🟢 [OPENSEARCH] AWS environment detected, loading configuration from Secrets Manager..."
    
    # Get OpenSearch configuration from secrets manager
    opensearch_secrets=$(get_secret "prod/call-analytics/opensearch")
    
    if [[ "$opensearch_secrets" != "{}" ]]; then
        echo "🟢 [OPENSEARCH] Successfully retrieved OpenSearch secrets"
        echo "🟢 [OPENSEARCH] Raw secrets JSON: $opensearch_secrets"
        
        # Validate JSON first
        if ! echo "$opensearch_secrets" | jq empty 2>/dev/null; then
            echo "🟢 [OPENSEARCH] ❌ Invalid JSON format in secrets"
            opensearch_secrets="{}"
        else
            # Export each secret as environment variable
            while IFS="=" read -r key value; do
                if [[ "$key" == OPENSEARCH_* ]]; then
                    export "$key"="$value"
                    echo "🟢 [OPENSEARCH] Set $key=$value"
                fi
            done < <(echo "$opensearch_secrets" | jq -r 'to_entries[] | select(.key | startswith("OPENSEARCH_")) | "\(.key)=\(.value)"')
        fi
        
    else
        echo "🟢 [OPENSEARCH] ⚠️ Failed to retrieve OpenSearch secrets, using fallback configuration"
        export OPENSEARCH_CLUSTER_NAME="opensearch-cluster"
        export OPENSEARCH_NODE_NAME="opensearch-node1"
        export OPENSEARCH_DISCOVERY_TYPE="single-node"
        export OPENSEARCH_BOOTSTRAP_MEMORY_LOCK="true"
        export OPENSEARCH_JAVA_OPTS="-Xms1g -Xmx3g"
        export DISABLE_INSTALL_DEMO_CONFIG="true"
        export DISABLE_SECURITY_PLUGIN="true"
    fi
    
    echo "🟢 [OPENSEARCH] Configuration loaded from AWS Secrets Manager"
else
    echo "🟢 [OPENSEARCH] Local environment detected, using environment variables..."
fi

# Set default values for any empty environment variables
export OPENSEARCH_CLUSTER_NAME=${OPENSEARCH_CLUSTER_NAME:-"opensearch-cluster"}
export OPENSEARCH_NODE_NAME=${OPENSEARCH_NODE_NAME:-"opensearch-node1"}
export OPENSEARCH_DISCOVERY_TYPE=${OPENSEARCH_DISCOVERY_TYPE:-"single-node"}
export OPENSEARCH_BOOTSTRAP_MEMORY_LOCK=${OPENSEARCH_BOOTSTRAP_MEMORY_LOCK:-"true"}
export OPENSEARCH_JAVA_OPTS=${OPENSEARCH_JAVA_OPTS:-"-Xms1g -Xmx3g"}
export DISABLE_INSTALL_DEMO_CONFIG=${DISABLE_INSTALL_DEMO_CONFIG:-"true"}
export DISABLE_SECURITY_PLUGIN=${DISABLE_SECURITY_PLUGIN:-"true"}

# Additional OpenSearch specific settings (these will be used by the OpenSearch process)
export OPENSEARCH_cluster_name=${OPENSEARCH_CLUSTER_NAME}
export OPENSEARCH_node_name=${OPENSEARCH_NODE_NAME}
export OPENSEARCH_discovery_type=${OPENSEARCH_DISCOVERY_TYPE}
export OPENSEARCH_bootstrap_memory_lock=${OPENSEARCH_BOOTSTRAP_MEMORY_LOCK}

echo "🟢 [OPENSEARCH] Starting OpenSearch with configuration:"
echo "🟢 [OPENSEARCH] - CLUSTER_NAME: $OPENSEARCH_CLUSTER_NAME"
echo "🟢 [OPENSEARCH] - NODE_NAME: $OPENSEARCH_NODE_NAME"
echo "🟢 [OPENSEARCH] - DISCOVERY_TYPE: $OPENSEARCH_DISCOVERY_TYPE"
echo "🟢 [OPENSEARCH] - JAVA_OPTS: $OPENSEARCH_JAVA_OPTS"

# Debug: Show environment variables
echo "🟢 [OPENSEARCH] All OPENSEARCH_ environment variables:"
env | grep OPENSEARCH_ | sort

# Debug: Show environment variables
echo "🟢 [OPENSEARCH] All DISABLE_ environment variables:"
env | grep DISABLE_ | sort

# Make sure we're running as the right user
echo "🟢 [OPENSEARCH] Current user: $(id)"

echo "🟢 [OPENSEARCH] Starting OpenSearch with Hebrew language support..."

# Start OpenSearch in the background
/usr/share/opensearch/opensearch-docker-entrypoint.sh &
OPENSEARCH_PID=$!

# Wait a bit for OpenSearch to start
echo "🟢 [OPENSEARCH] Waiting for OpenSearch to initialize..."
sleep 30

# Initialize Hebrew templates
echo "🟢 [OPENSEARCH] Starting Hebrew templates initialization..."
/usr/share/opensearch/bin/init-hebrew-templates.sh &

# Wait for OpenSearch to exit
echo "🟢 [OPENSEARCH] OpenSearch is running, waiting for process..."
wait $OPENSEARCH_PID