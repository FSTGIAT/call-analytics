#!/bin/bash

set -e

echo "🔄 [SCHEMA-REGISTRY] Starting Schema Registry with AWS Secrets Manager integration..."

# Function to check if running in AWS environment
is_aws_environment() {
    [[ -n "${AWS_EXECUTION_ENV}" || -n "${AWS_LAMBDA_RUNTIME_API}" || -n "${ECS_CONTAINER_METADATA_URI_V4}" || -n "${AWS_REGION}" || -n "${AWS_DEFAULT_REGION}" ]]
}

# Function to get secret from AWS Secrets Manager
get_secret() {
    local secret_id=$1
    local region=${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-west-1}}
    
    echo "🔄 [SCHEMA-REGISTRY] Fetching secret: $secret_id from region: $region" >&2
    aws secretsmanager get-secret-value \
        --secret-id "$secret_id" \
        --region "$region" \
        --query SecretString \
        --output text 2>/dev/null || echo "{}"
}

if is_aws_environment; then
    echo "🔄 [SCHEMA-REGISTRY] AWS environment detected, loading configuration from Secrets Manager..."
    
    # Get Kafka configuration from secrets manager (Schema Registry connects to Kafka)
    kafka_secrets=$(get_secret "prod/call-analytics/kafka")
    
    if [[ "$kafka_secrets" != "{}" ]]; then
        echo "🔄 [SCHEMA-REGISTRY] Successfully retrieved Kafka secrets"
        echo "🔄 [SCHEMA-REGISTRY] Raw secrets JSON: $kafka_secrets"
        
        # Validate JSON first
        if ! echo "$kafka_secrets" | jq empty 2>/dev/null; then
            echo "🔄 [SCHEMA-REGISTRY] ❌ Invalid JSON format in secrets"
            kafka_secrets="{}"
        else
            # Extract Kafka bootstrap servers for Schema Registry
            KAFKA_BOOTSTRAP_SERVERS=$(echo "$kafka_secrets" | jq -r '.bootstrap_servers' 2>/dev/null || echo "")
            if [[ -n "$KAFKA_BOOTSTRAP_SERVERS" && "$KAFKA_BOOTSTRAP_SERVERS" != "null" ]]; then
                export SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS="$KAFKA_BOOTSTRAP_SERVERS"
                echo "🔄 [SCHEMA-REGISTRY] Set KAFKA_BOOTSTRAP_SERVERS=$KAFKA_BOOTSTRAP_SERVERS"
            fi
        fi
        
    else
        echo "🔄 [SCHEMA-REGISTRY] ⚠️ Failed to retrieve Kafka secrets, using fallback configuration"
        export SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS="kafka:29092"
    fi
    
    echo "🔄 [SCHEMA-REGISTRY] Configuration loaded from AWS Secrets Manager"
else
    echo "🔄 [SCHEMA-REGISTRY] Local environment detected, using environment variables..."
fi

# Set default values for Schema Registry configuration  
export SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS=${SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS:-"kafka:29092"}
export SCHEMA_REGISTRY_HOST_NAME=${SCHEMA_REGISTRY_HOST_NAME:-"schema-registry.callanalytics.local"}
export SCHEMA_REGISTRY_LISTENERS=${SCHEMA_REGISTRY_LISTENERS:-"http://0.0.0.0:8081"}
export SCHEMA_REGISTRY_KAFKASTORE_TOPIC=${SCHEMA_REGISTRY_KAFKASTORE_TOPIC:-"_schemas"}
export SCHEMA_REGISTRY_DEBUG=${SCHEMA_REGISTRY_DEBUG:-"false"}

# VPC networking timeout configurations
export SCHEMA_REGISTRY_KAFKASTORE_CONNECTION_TIMEOUT_MS=${SCHEMA_REGISTRY_KAFKASTORE_CONNECTION_TIMEOUT_MS:-"60000"}
export SCHEMA_REGISTRY_KAFKASTORE_REQUEST_TIMEOUT_MS=${SCHEMA_REGISTRY_KAFKASTORE_REQUEST_TIMEOUT_MS:-"40000"}
export SCHEMA_REGISTRY_KAFKASTORE_RETRY_BACKOFF_MS=${SCHEMA_REGISTRY_KAFKASTORE_RETRY_BACKOFF_MS:-"500"}
export SCHEMA_REGISTRY_KAFKASTORE_TIMEOUT_MS=${SCHEMA_REGISTRY_KAFKASTORE_TIMEOUT_MS:-"10000"}
export SCHEMA_REGISTRY_KAFKASTORE_INIT_TIMEOUT_MS=${SCHEMA_REGISTRY_KAFKASTORE_INIT_TIMEOUT_MS:-"60000"}

echo "🔄 [SCHEMA-REGISTRY] Starting Schema Registry with configuration:"
echo "🔄 [SCHEMA-REGISTRY] - KAFKASTORE_BOOTSTRAP_SERVERS: $SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS"
echo "🔄 [SCHEMA-REGISTRY] - HOST_NAME: $SCHEMA_REGISTRY_HOST_NAME"
echo "🔄 [SCHEMA-REGISTRY] - LISTENERS: $SCHEMA_REGISTRY_LISTENERS"
echo "🔄 [SCHEMA-REGISTRY] - KAFKASTORE_TOPIC: $SCHEMA_REGISTRY_KAFKASTORE_TOPIC"

# Debug: Show environment variables
echo "🔄 [SCHEMA-REGISTRY] All SCHEMA_REGISTRY_ environment variables:"
env | grep SCHEMA_REGISTRY_ | sort

# Make sure we're running as the right user
echo "🔄 [SCHEMA-REGISTRY] Current user: $(id)"

echo "🔄 [SCHEMA-REGISTRY] Starting Schema Registry server..."

# Create a custom properties file with our configuration
cat > /etc/schema-registry/schema-registry-custom.properties << EOF
# Basic Schema Registry Configuration
host.name=schema-registry.callanalytics.local
listeners=http://0.0.0.0:8081

# Kafka Store Configuration  
kafkastore.bootstrap.servers=${SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS}
kafkastore.topic=${SCHEMA_REGISTRY_KAFKASTORE_TOPIC}
kafkastore.connection.timeout.ms=${SCHEMA_REGISTRY_KAFKASTORE_CONNECTION_TIMEOUT_MS}
kafkastore.request.timeout.ms=${SCHEMA_REGISTRY_KAFKASTORE_REQUEST_TIMEOUT_MS}
kafkastore.init.timeout.ms=${SCHEMA_REGISTRY_KAFKASTORE_INIT_TIMEOUT_MS}
kafkastore.timeout.ms=${SCHEMA_REGISTRY_KAFKASTORE_TIMEOUT_MS}

# Schema Registry Settings
debug=${SCHEMA_REGISTRY_DEBUG}
schema.registry.group.id=schema-registry
EOF

echo "🔄 [SCHEMA-REGISTRY] Custom configuration file created:"
cat /etc/schema-registry/schema-registry-custom.properties

# Start Schema Registry with our custom properties file
exec schema-registry-start /etc/schema-registry/schema-registry-custom.properties