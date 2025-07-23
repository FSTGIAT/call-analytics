#!/bin/bash

# Kafka Health Check Script for Call Analytics AI Platform
# Monitors Kafka cluster health, consumer lag, and processing metrics

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
KAFKA_CONTAINER="${KAFKA_CONTAINER:-call-analytics-kafka}"
KAFKA_BROKER="${KAFKA_BROKERS:-kafka:9092}"
CHECK_INTERVAL="${CHECK_INTERVAL:-30}"
LAG_THRESHOLD="${LAG_THRESHOLD:-1000}"
ALERT_EMAIL="${ALERT_EMAIL:-}"

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

# Check if Kafka broker is responsive
check_broker_health() {
    log "Checking Kafka broker health..."
    
    if docker exec "$KAFKA_CONTAINER" kafka-broker-api-versions --bootstrap-server localhost:9092 &>/dev/null; then
        success "Kafka broker is healthy"
        return 0
    else
        error "Kafka broker is not responding"
        return 1
    fi
}

# Check Zookeeper health
check_zookeeper_health() {
    log "Checking Zookeeper health..."
    
    local zk_container="${ZOOKEEPER_CONTAINER:-call-analytics-zookeeper}"
    
    if docker exec "$zk_container" zkServer.sh status &>/dev/null; then
        success "Zookeeper is healthy"
        return 0
    else
        error "Zookeeper is not healthy"
        return 1
    fi
}

# List all topics
list_topics() {
    log "Available topics:"
    if ! docker exec "$KAFKA_CONTAINER" kafka-topics --bootstrap-server localhost:9092 --list; then
        error "Failed to list topics"
        return 1
    fi
    return 0
}

# Check consumer group lag
check_consumer_lag() {
    local group="$1"
    log "Checking consumer lag for group: $group"
    
    local lag_output
    if lag_output=$(docker exec "$KAFKA_CONTAINER" kafka-consumer-groups \
        --bootstrap-server localhost:9092 \
        --group "$group" \
        --describe 2>/dev/null); then
        
        # Parse lag information
        local max_lag=0
        local total_lag=0
        local partition_count=0
        
        while IFS= read -r line; do
            if [[ $line =~ [[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+([0-9]+) ]]; then
                local lag="${BASH_REMATCH[1]}"
                if [ "$lag" -gt "$max_lag" ]; then
                    max_lag="$lag"
                fi
                total_lag=$((total_lag + lag))
                partition_count=$((partition_count + 1))
            fi
        done <<< "$lag_output"
        
        if [ "$max_lag" -gt "$LAG_THRESHOLD" ]; then
            warning "High consumer lag detected for group '$group': max=$max_lag, total=$total_lag"
            return 1
        else
            success "Consumer group '$group' lag is acceptable: max=$max_lag, total=$total_lag"
            return 0
        fi
    else
        warning "Consumer group '$group' not found or inactive"
        return 1
    fi
}

# Check all consumer groups
check_all_consumer_groups() {
    log "Checking all consumer groups..."
    
    local groups=(
        "call-analytics-conversation-assembly"
        "call-analytics-ml-processing"
        "call-analytics-opensearch-indexing"
        "call-analytics-error-handler"
    )
    
    local issues=0
    for group in "${groups[@]}"; do
        if ! check_consumer_lag "$group"; then
            issues=$((issues + 1))
        fi
    done
    
    if [ "$issues" -eq 0 ]; then
        success "All consumer groups have acceptable lag"
    else
        warning "$issues consumer groups have issues"
    fi
    
    return $issues
}

# Check topic health (partition distribution, replication)
check_topic_health() {
    local topic="$1"
    log "Checking health of topic: $topic"
    
    local describe_output
    if describe_output=$(docker exec "$KAFKA_CONTAINER" kafka-topics \
        --bootstrap-server localhost:9092 \
        --describe \
        --topic "$topic" 2>/dev/null); then
        
        # Check for under-replicated partitions
        if echo "$describe_output" | grep -q "Isr:.*\[\]"; then
            error "Topic '$topic' has under-replicated partitions"
            return 1
        fi
        
        # Check for offline partitions
        if echo "$describe_output" | grep -q "Leader: -1"; then
            error "Topic '$topic' has offline partitions"
            return 1
        fi
        
        success "Topic '$topic' is healthy"
        return 0
    else
        error "Failed to describe topic '$topic'"
        return 1
    fi
}

# Check all topics health
check_all_topics_health() {
    log "Checking health of all topics..."
    
    local topics=(
        "cdc-raw-changes"
        "conversation-assembly"
        "ml-processing-queue"
        "opensearch-bulk-index"
        "failed-records-dlq"
        "processing-metrics"
    )
    
    local issues=0
    for topic in "${topics[@]}"; do
        if ! check_topic_health "$topic"; then
            issues=$((issues + 1))
        fi
    done
    
    if [ "$issues" -eq 0 ]; then
        success "All topics are healthy"
    else
        warning "$issues topics have issues"
    fi
    
    return $issues
}

# Get cluster information
get_cluster_info() {
    log "Gathering cluster information..."
    
    echo "=== Kafka Cluster Information ==="
    docker exec "$KAFKA_CONTAINER" kafka-broker-api-versions --bootstrap-server localhost:9092 | head -5
    
    echo -e "\n=== Active Controllers ==="
    docker exec "$KAFKA_CONTAINER" kafka-log-dirs --bootstrap-server localhost:9092 --describe --json | \
        jq -r '.brokers[0].logDirs[0].partitions | keys[]' 2>/dev/null | head -5 || echo "Unable to get controller info"
}

# Monitor continuously
monitor_continuously() {
    log "Starting continuous monitoring (interval: ${CHECK_INTERVAL}s)..."
    log "Press Ctrl+C to stop monitoring"
    
    while true; do
        echo -e "\n$(date +'%Y-%m-%d %H:%M:%S') - Running health checks..."
        
        local health_issues=0
        
        # Basic health checks
        check_broker_health || health_issues=$((health_issues + 1))
        check_zookeeper_health || health_issues=$((health_issues + 1))
        
        # Topic health
        check_all_topics_health || health_issues=$((health_issues + 1))
        
        # Consumer group lag
        check_all_consumer_groups || health_issues=$((health_issues + 1))
        
        if [ "$health_issues" -eq 0 ]; then
            echo -e "${GREEN}✓ All health checks passed${NC}"
        else
            echo -e "${RED}✗ Found $health_issues health issues${NC}"
            
            # Send alert if configured
            if [ -n "$ALERT_EMAIL" ]; then
                echo "Kafka health issues detected at $(date)" | \
                    mail -s "Kafka Health Alert - Call Analytics" "$ALERT_EMAIL" 2>/dev/null || \
                    warning "Failed to send email alert"
            fi
        fi
        
        sleep "$CHECK_INTERVAL"
    done
}

# Run single health check
run_single_check() {
    log "Running single health check..."
    
    local total_issues=0
    
    echo "=== Basic Connectivity ==="
    check_broker_health || total_issues=$((total_issues + 1))
    check_zookeeper_health || total_issues=$((total_issues + 1))
    
    echo -e "\n=== Topics ==="
    list_topics
    check_all_topics_health || total_issues=$((total_issues + 1))
    
    echo -e "\n=== Consumer Groups ==="
    check_all_consumer_groups || total_issues=$((total_issues + 1))
    
    echo -e "\n=== Cluster Info ==="
    get_cluster_info
    
    echo -e "\n=== Summary ==="
    if [ "$total_issues" -eq 0 ]; then
        success "Kafka cluster is healthy!"
        exit 0
    else
        error "Found $total_issues issues in Kafka cluster"
        exit 1
    fi
}

# Show consumer group details
show_consumer_details() {
    local group="${1:-}"
    
    if [ -z "$group" ]; then
        log "Available consumer groups:"
        docker exec "$KAFKA_CONTAINER" kafka-consumer-groups --bootstrap-server localhost:9092 --list
        return 0
    fi
    
    log "Consumer group details for: $group"
    docker exec "$KAFKA_CONTAINER" kafka-consumer-groups \
        --bootstrap-server localhost:9092 \
        --group "$group" \
        --describe
}

# Show help
show_help() {
    echo "Kafka Health Check Script for Call Analytics AI Platform"
    echo ""
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  check          Run single health check (default)"
    echo "  monitor        Run continuous monitoring"
    echo "  topics         List all topics"
    echo "  consumers      Show consumer group details"
    echo "  consumer GROUP Show specific consumer group details"
    echo "  cluster        Show cluster information"
    echo "  help           Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  KAFKA_CONTAINER     Kafka container name (default: call-analytics-kafka)"
    echo "  CHECK_INTERVAL      Monitoring interval in seconds (default: 30)"
    echo "  LAG_THRESHOLD       Consumer lag threshold (default: 1000)"
    echo "  ALERT_EMAIL         Email for alerts (optional)"
}

# Wait for Kafka to be ready
wait_for_kafka_ready() {
    log "Waiting for Kafka broker to be ready..."
    local max_attempts=60
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if check_broker_health >/dev/null 2>&1; then
            success "Kafka broker is ready!"
            return 0
        fi
        
        attempt=$((attempt + 1))
        log "Attempt $attempt/$max_attempts - Kafka not ready yet, waiting 5 seconds..."
        sleep 5
    done
    
    error "Kafka broker failed to become ready after $max_attempts attempts"
    return 1
}

# Main execution
main() {
    local command="${1:-check}"
    
    case "$command" in
        "check")
            run_single_check
            ;;
        "monitor")
            monitor_continuously
            ;;
        "topics")
            list_topics
            ;;
        "consumers")
            show_consumer_details
            ;;
        "consumer")
            show_consumer_details "$2"
            ;;
        "cluster")
            get_cluster_info
            ;;
        "wait")
            wait_for_kafka_ready
            exit $?
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

# Handle script interruption
trap 'log "Health check interrupted"; exit 130' INT TERM

# Run main function
main "$@"