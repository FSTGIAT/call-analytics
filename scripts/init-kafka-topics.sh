#!/bin/bash

# Kafka Topic Initialization Script for Call Analytics AI Platform
# This script creates all required Kafka topics with proper configurations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/config/kafka/topics-config.json"

# Kafka connection settings
KAFKA_BROKER="${KAFKA_BROKERS:-kafka:9092}"
KAFKA_CONTAINER="${KAFKA_CONTAINER:-call-analytics-kafka}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Wait for Kafka to be ready
wait_for_kafka() {
    log "Waiting for Kafka broker to be ready..."
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if docker exec "$KAFKA_CONTAINER" kafka-broker-api-versions --bootstrap-server localhost:9092 &>/dev/null; then
            success "Kafka broker is ready!"
            return 0
        fi
        
        attempt=$((attempt + 1))
        log "Attempt $attempt/$max_attempts - Kafka not ready yet, waiting 10 seconds..."
        sleep 10
    done
    
    error "Kafka broker failed to become ready after $max_attempts attempts"
    return 1
}

# Create a single topic
create_topic() {
    local topic_name="$1"
    local partitions="$2"
    local replication="$3"
    local configs="$4"
    local description="$5"
    
    log "Creating topic: $topic_name"
    log "  Partitions: $partitions"
    log "  Replication: $replication"
    log "  Description: $description"
    
    # Build config arguments
    local config_args=""
    if [ -n "$configs" ] && [ "$configs" != "null" ]; then
        # Split configs by comma and add --config before each
        IFS=',' read -ra CONFIG_ARRAY <<< "$configs"
        for config in "${CONFIG_ARRAY[@]}"; do
            config_args="$config_args --config $config"
        done
    fi
    
    # Check if topic already exists
    if docker exec "$KAFKA_CONTAINER" kafka-topics --bootstrap-server localhost:9092 --list | grep -q "^${topic_name}$"; then
        warning "Topic '$topic_name' already exists, skipping creation"
        return 0
    fi
    
    # Create the topic
    if docker exec "$KAFKA_CONTAINER" kafka-topics \
        --bootstrap-server localhost:9092 \
        --create \
        --topic "$topic_name" \
        --partitions "$partitions" \
        --replication-factor "$replication" \
        $config_args; then
        success "Topic '$topic_name' created successfully"
    else
        error "Failed to create topic '$topic_name'"
        return 1
    fi
}

# Parse topics configuration and create topics
create_topics_from_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        error "Configuration file not found: $CONFIG_FILE"
        return 1
    fi
    
    log "Reading topic configurations from: $CONFIG_FILE"
    
    # Extract topic names
    local topics=$(jq -r '.topics | keys[]' "$CONFIG_FILE")
    
    for topic in $topics; do
        log "Processing topic: $topic"
        
        local partitions=$(jq -r ".topics[\"$topic\"].partitions" "$CONFIG_FILE")
        local replication=$(jq -r ".topics[\"$topic\"].replication" "$CONFIG_FILE")
        local description=$(jq -r ".topics[\"$topic\"].description" "$CONFIG_FILE")
        
        # Build config string from JSON
        local configs=""
        local config_keys=$(jq -r ".topics[\"$topic\"].config | keys[]" "$CONFIG_FILE" 2>/dev/null || echo "")
        
        if [ -n "$config_keys" ]; then
            local config_array=()
            for key in $config_keys; do
                local value=$(jq -r ".topics[\"$topic\"].config[\"$key\"]" "$CONFIG_FILE")
                config_array+=("$key=$value")
            done
            configs=$(IFS=','; echo "${config_array[*]}")
        fi
        
        create_topic "$topic" "$partitions" "$replication" "$configs" "$description"
    done
}

# List all topics
list_topics() {
    log "Current Kafka topics:"
    docker exec "$KAFKA_CONTAINER" kafka-topics --bootstrap-server localhost:9092 --list
}

# Describe topics
describe_topics() {
    log "Topic descriptions:"
    local topics=$(jq -r '.topics | keys[]' "$CONFIG_FILE")
    
    for topic in $topics; do
        log "Describing topic: $topic"
        docker exec "$KAFKA_CONTAINER" kafka-topics \
            --bootstrap-server localhost:9092 \
            --describe \
            --topic "$topic" || warning "Topic '$topic' not found"
    done
}

# Main execution
main() {
    log "Starting Kafka topic initialization for Call Analytics AI Platform"
    
    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        error "jq is required but not installed. Please install jq first."
        exit 1
    fi
    
    # Check if Docker is running
    if ! docker ps &> /dev/null; then
        error "Docker is not running or not accessible"
        exit 1
    fi
    
    # Check if Kafka container exists
    if ! docker ps --format "table {{.Names}}" | grep -q "$KAFKA_CONTAINER"; then
        error "Kafka container '$KAFKA_CONTAINER' is not running"
        exit 1
    fi
    
    # Wait for Kafka to be ready
    if ! wait_for_kafka; then
        exit 1
    fi
    
    # Create topics
    if create_topics_from_config; then
        success "All topics created successfully!"
    else
        error "Some topics failed to create"
        exit 1
    fi
    
    # List current topics
    list_topics
    
    # Describe topics (optional, can be commented out for faster execution)
    if [ "${DESCRIBE_TOPICS:-false}" = "true" ]; then
        describe_topics
    fi
    
    success "Kafka topic initialization completed!"
}

# Handle script arguments
case "${1:-}" in
    "list")
        list_topics
        exit 0
        ;;
    "describe")
        describe_topics
        exit 0
        ;;
    "wait")
        wait_for_kafka
        exit $?
        ;;
    *)
        main "$@"
        ;;
esac