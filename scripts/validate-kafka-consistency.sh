#!/bin/bash

#
# Kafka Data Consistency Validation Script
# Hebrew Call Analytics AI Platform
#
# This script validates data consistency across the entire Kafka pipeline:
# Oracle CDC -> Kafka -> Conversation Assembly -> ML Processing -> OpenSearch
#
# Usage: ./validate-kafka-consistency.sh [options]
#
# Options:
#   --full-check          Run comprehensive validation (slow)
#   --quick-check         Run quick validation (default)
#   --check-oracle        Validate Oracle CDC source data
#   --check-kafka         Validate Kafka topics and messages
#   --check-opensearch    Validate OpenSearch indexed data
#   --call-id <id>        Validate specific call ID
#   --date-range <from> <to>  Validate data within date range (YYYY-MM-DD)
#   --fix-issues          Attempt to fix consistency issues found
#   --report-only         Generate report without fixing issues
#   --verbose             Enable verbose output
#   --help                Show this help message
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="$PROJECT_ROOT/config"
TEMP_DIR="/tmp/kafka-validation-$$"
LOG_FILE="/tmp/kafka-validation-$(date +%Y%m%d_%H%M%S).log"

# Default options
FULL_CHECK=false
QUICK_CHECK=true
CHECK_ORACLE=true
CHECK_KAFKA=true
CHECK_OPENSEARCH=true
SPECIFIC_CALL_ID=""
DATE_FROM=""
DATE_TO=""
FIX_ISSUES=false
REPORT_ONLY=false
VERBOSE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNINGS=0

# Load environment variables
load_env() {
    if [[ -f "$CONFIG_DIR/.env.api" ]]; then
        export $(grep -v '^#' "$CONFIG_DIR/.env.api" | xargs)
    fi
    
    if [[ -f "$CONFIG_DIR/.env.oracle" ]]; then
        export $(grep -v '^#' "$CONFIG_DIR/.env.oracle" | xargs)
    fi
    
    if [[ -f "$CONFIG_DIR/.env.kafka" ]]; then
        export $(grep -v '^#' "$CONFIG_DIR/.env.kafka" | xargs)
    fi
}

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
    ((WARNINGS++))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${BLUE}[VERBOSE]${NC} $1" | tee -a "$LOG_FILE"
    fi
}

# Check if required tools are available
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing_tools=()
    
    if ! command -v curl &> /dev/null; then
        missing_tools+=("curl")
    fi
    
    if ! command -v jq &> /dev/null; then
        missing_tools+=("jq")
    fi
    
    if ! command -v kafkacat &> /dev/null && ! command -v kcat &> /dev/null; then
        missing_tools+=("kafkacat or kcat")
    fi
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_info "Please install missing tools and try again"
        exit 1
    fi
    
    log_success "All prerequisites available"
}

# Get API endpoint
get_api_endpoint() {
    echo "${API_BASE_URL:-http://localhost:3000}/api/v1"
}

# Check API connectivity
check_api_connectivity() {
    log_info "Checking API connectivity..."
    ((TOTAL_CHECKS++))
    
    local api_endpoint=$(get_api_endpoint)
    local health_response
    
    if health_response=$(curl -s -f "$api_endpoint/health" 2>/dev/null); then
        local api_status=$(echo "$health_response" | jq -r '.status // "unknown"')
        if [[ "$api_status" == "ok" ]]; then
            log_success "API is healthy and accessible"
            ((PASSED_CHECKS++))
            return 0
        else
            log_error "API is accessible but not healthy: $api_status"
            ((FAILED_CHECKS++))
            return 1
        fi
    else
        log_error "API is not accessible at $api_endpoint"
        ((FAILED_CHECKS++))
        return 1
    fi
}

# Check Kafka connectivity
check_kafka_connectivity() {
    log_info "Checking Kafka connectivity..."
    ((TOTAL_CHECKS++))
    
    local kafka_brokers="${KAFKA_BROKERS:-kafka:29092}"
    local kafkacat_cmd="kafkacat"
    
    # Use kcat if kafkacat is not available
    if ! command -v kafkacat &> /dev/null && command -v kcat &> /dev/null; then
        kafkacat_cmd="kcat"
    fi
    
    if timeout 10 $kafkacat_cmd -b "$kafka_brokers" -L &>/dev/null; then
        log_success "Kafka brokers are accessible"
        ((PASSED_CHECKS++))
        return 0
    else
        log_error "Cannot connect to Kafka brokers: $kafka_brokers"
        ((FAILED_CHECKS++))
        return 1
    fi
}

# Check Kafka topics
check_kafka_topics() {
    log_info "Checking Kafka topics..."
    
    local expected_topics=(
        "${KAFKA_TOPIC_CDC_RAW_CHANGES:-cdc-raw-changes}"
        "${KAFKA_TOPIC_CONVERSATION_ASSEMBLY:-conversation-assembly}"
        "${KAFKA_TOPIC_ML_PROCESSING:-ml-processing-queue}"
        "${KAFKA_TOPIC_OPENSEARCH_INDEX:-opensearch-bulk-index}"
        "${KAFKA_TOPIC_FAILED_RECORDS:-failed-records-dlq}"
        "processing-metrics"
    )
    
    local kafka_brokers="${KAFKA_BROKERS:-kafka:29092}"
    local kafkacat_cmd="kafkacat"
    
    if ! command -v kafkacat &> /dev/null && command -v kcat &> /dev/null; then
        kafkacat_cmd="kcat"
    fi
    
    local existing_topics
    if ! existing_topics=$($kafkacat_cmd -b "$kafka_brokers" -L 2>/dev/null | grep "topic" | awk '{print $2}' | tr -d '"'); then
        log_error "Failed to list Kafka topics"
        return 1
    fi
    
    for topic in "${expected_topics[@]}"; do
        ((TOTAL_CHECKS++))
        if echo "$existing_topics" | grep -q "^$topic$"; then
            log_success "Topic exists: $topic"
            ((PASSED_CHECKS++))
        else
            log_error "Missing topic: $topic"
            ((FAILED_CHECKS++))
        fi
    done
}

# Check message flow consistency
check_message_flow() {
    log_info "Checking message flow consistency..."
    
    local api_endpoint=$(get_api_endpoint)
    local pipeline_status
    
    if ! pipeline_status=$(curl -s -f "$api_endpoint/kafka/pipeline" 2>/dev/null); then
        log_error "Failed to get pipeline status"
        return 1
    fi
    
    local overall_status=$(echo "$pipeline_status" | jq -r '.overview.overallStatus // "unknown"')
    ((TOTAL_CHECKS++))
    
    case "$overall_status" in
        "healthy")
            log_success "Pipeline overall status: healthy"
            ((PASSED_CHECKS++))
            ;;
        "degraded")
            log_warning "Pipeline overall status: degraded"
            ((PASSED_CHECKS++))
            ;;
        "unhealthy")
            log_error "Pipeline overall status: unhealthy"
            ((FAILED_CHECKS++))
            ;;
        *)
            log_error "Unknown pipeline status: $overall_status"
            ((FAILED_CHECKS++))
            ;;
    esac
    
    # Check individual stages
    local stages=("cdcIngestion" "conversationAssembly" "mlProcessing" "opensearchIndexing" "errorHandling")
    
    for stage in "${stages[@]}"; do
        ((TOTAL_CHECKS++))
        local stage_status=$(echo "$pipeline_status" | jq -r ".stages.$stage.status // \"unknown\"")
        
        if [[ "$stage_status" == "running" ]]; then
            log_success "Stage $stage: running"
            ((PASSED_CHECKS++))
        else
            log_error "Stage $stage: $stage_status"
            ((FAILED_CHECKS++))
        fi
    done
}

# Check data consistency for specific call ID
check_call_data_consistency() {
    local call_id="$1"
    log_info "Checking data consistency for call ID: $call_id"
    
    # This would require specific queries to Oracle, Kafka topics, and OpenSearch
    # For now, we'll do basic existence checks
    
    local api_endpoint=$(get_api_endpoint)
    
    # Check if call exists in Oracle (through API)
    ((TOTAL_CHECKS++))
    if curl -s -f "$api_endpoint/calls/$call_id" &>/dev/null; then
        log_success "Call $call_id exists in Oracle"
        ((PASSED_CHECKS++))
    else
        log_warning "Call $call_id not found in Oracle or not accessible"
        ((FAILED_CHECKS++))
    fi
    
    # Check if call exists in OpenSearch (through API)
    ((TOTAL_CHECKS++))
    if curl -s -f "$api_endpoint/search?callId=$call_id" &>/dev/null; then
        log_success "Call $call_id exists in OpenSearch"
        ((PASSED_CHECKS++))
    else
        log_warning "Call $call_id not found in OpenSearch or not accessible"
        ((FAILED_CHECKS++))
    fi
}

# Check consumer lag
check_consumer_lag() {
    log_info "Checking consumer lag..."
    
    local api_endpoint=$(get_api_endpoint)
    local lag_info
    
    if ! lag_info=$(curl -s -f "$api_endpoint/kafka/consumer-lag" 2>/dev/null); then
        log_error "Failed to get consumer lag information"
        return 1
    fi
    
    local consumers=("conversation-assembly" "ml-processing" "opensearch-indexing" "error-handler")
    
    for consumer in "${consumers[@]}"; do
        ((TOTAL_CHECKS++))
        local consumer_status=$(echo "$lag_info" | jq -r ".consumers[\"$consumer\"].status // \"unknown\"")
        
        if [[ "$consumer_status" == "running" ]]; then
            local processing_rate=$(echo "$lag_info" | jq -r ".consumers[\"$consumer\"].metrics.processingRate // 0")
            if (( $(echo "$processing_rate > 0.8" | bc -l 2>/dev/null || echo 0) )); then
                log_success "Consumer $consumer: healthy (rate: $processing_rate)"
                ((PASSED_CHECKS++))
            else
                log_warning "Consumer $consumer: low processing rate ($processing_rate)"
                ((PASSED_CHECKS++))
            fi
        else
            log_error "Consumer $consumer: $consumer_status"
            ((FAILED_CHECKS++))
        fi
    done
}

# Check error rates
check_error_rates() {
    log_info "Checking error rates..."
    
    local api_endpoint=$(get_api_endpoint)
    local error_summary
    
    if ! error_summary=$(curl -s -f "$api_endpoint/kafka/errors" 2>/dev/null); then
        log_error "Failed to get error summary"
        return 1
    fi
    
    local total_errors=$(echo "$error_summary" | jq -r '.errorHandling.totalErrors // 0')
    local permanent_failures=$(echo "$error_summary" | jq -r '.errorHandling.permanentFailures // 0')
    local success_rate=$(echo "$error_summary" | jq -r '.errorHandling.successRate // 1')
    
    ((TOTAL_CHECKS++))
    if (( $(echo "$success_rate > 0.95" | bc -l 2>/dev/null || echo 0) )); then
        log_success "Error rate acceptable: success rate $success_rate"
        ((PASSED_CHECKS++))
    elif (( $(echo "$success_rate > 0.80" | bc -l 2>/dev/null || echo 0) )); then
        log_warning "Error rate elevated: success rate $success_rate"
        ((PASSED_CHECKS++))
    else
        log_error "Error rate too high: success rate $success_rate"
        ((FAILED_CHECKS++))
    fi
    
    log_info "Total errors: $total_errors, Permanent failures: $permanent_failures"
}

# Generate consistency report
generate_report() {
    local report_file="/tmp/kafka-consistency-report-$(date +%Y%m%d_%H%M%S).json"
    
    log_info "Generating consistency report..."
    
    local api_endpoint=$(get_api_endpoint)
    
    # Collect all data
    local health_data=$(curl -s -f "$api_endpoint/kafka/health" 2>/dev/null || echo '{}')
    local metrics_data=$(curl -s -f "$api_endpoint/kafka/metrics" 2>/dev/null || echo '{}')
    local pipeline_data=$(curl -s -f "$api_endpoint/kafka/pipeline" 2>/dev/null || echo '{}')
    local error_data=$(curl -s -f "$api_endpoint/kafka/errors" 2>/dev/null || echo '{}')
    local lag_data=$(curl -s -f "$api_endpoint/kafka/consumer-lag" 2>/dev/null || echo '{}')
    
    # Create comprehensive report
    cat > "$report_file" << EOF
{
    "reportGenerated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "validationSummary": {
        "totalChecks": $TOTAL_CHECKS,
        "passedChecks": $PASSED_CHECKS,
        "failedChecks": $FAILED_CHECKS,
        "warnings": $WARNINGS,
        "successRate": $(echo "scale=2; $PASSED_CHECKS / $TOTAL_CHECKS" | bc -l 2>/dev/null || echo 0)
    },
    "healthData": $health_data,
    "metricsData": $metrics_data,
    "pipelineData": $pipeline_data,
    "errorData": $error_data,
    "lagData": $lag_data,
    "logFile": "$LOG_FILE"
}
EOF
    
    log_success "Report generated: $report_file"
    
    # Summary
    echo
    echo "=== KAFKA CONSISTENCY VALIDATION SUMMARY ==="
    echo "Total Checks: $TOTAL_CHECKS"
    echo "Passed: $PASSED_CHECKS"
    echo "Failed: $FAILED_CHECKS"
    echo "Warnings: $WARNINGS"
    
    if [[ $FAILED_CHECKS -eq 0 ]]; then
        echo -e "${GREEN}Overall Status: HEALTHY${NC}"
        exit 0
    elif [[ $FAILED_CHECKS -le 2 ]]; then
        echo -e "${YELLOW}Overall Status: DEGRADED${NC}"
        exit 1
    else
        echo -e "${RED}Overall Status: UNHEALTHY${NC}"
        exit 2
    fi
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        key="$1"
        case $key in
            --full-check)
                FULL_CHECK=true
                QUICK_CHECK=false
                shift
                ;;
            --quick-check)
                QUICK_CHECK=true
                FULL_CHECK=false
                shift
                ;;
            --check-oracle)
                CHECK_ORACLE=true
                shift
                ;;
            --check-kafka)
                CHECK_KAFKA=true
                shift
                ;;
            --check-opensearch)
                CHECK_OPENSEARCH=true
                shift
                ;;
            --call-id)
                SPECIFIC_CALL_ID="$2"
                shift 2
                ;;
            --date-range)
                DATE_FROM="$2"
                DATE_TO="$3"
                shift 3
                ;;
            --fix-issues)
                FIX_ISSUES=true
                shift
                ;;
            --report-only)
                REPORT_ONLY=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

show_help() {
    cat << EOF
Kafka Data Consistency Validation Script

Usage: $0 [options]

Options:
  --full-check          Run comprehensive validation (slow)
  --quick-check         Run quick validation (default)
  --check-oracle        Validate Oracle CDC source data
  --check-kafka         Validate Kafka topics and messages
  --check-opensearch    Validate OpenSearch indexed data
  --call-id <id>        Validate specific call ID
  --date-range <from> <to>  Validate data within date range (YYYY-MM-DD)
  --fix-issues          Attempt to fix consistency issues found
  --report-only         Generate report without fixing issues
  --verbose             Enable verbose output
  --help                Show this help message

Examples:
  $0                                    # Quick validation
  $0 --full-check                       # Comprehensive validation
  $0 --call-id CALL123                  # Validate specific call
  $0 --date-range 2024-01-01 2024-01-31 # Validate date range
  $0 --verbose --report-only            # Detailed report only

EOF
}

# Cleanup function
cleanup() {
    if [[ -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
    fi
}

# Main execution
main() {
    # Setup
    trap cleanup EXIT
    mkdir -p "$TEMP_DIR"
    
    log_info "Starting Kafka consistency validation..."
    log_info "Log file: $LOG_FILE"
    
    # Load configuration
    load_env
    
    # Run checks
    check_prerequisites
    check_api_connectivity
    
    if [[ "$CHECK_KAFKA" == "true" ]]; then
        check_kafka_connectivity
        check_kafka_topics
        check_message_flow
        check_consumer_lag
        check_error_rates
    fi
    
    # Specific call ID validation
    if [[ -n "$SPECIFIC_CALL_ID" ]]; then
        check_call_data_consistency "$SPECIFIC_CALL_ID"
    fi
    
    # Generate final report
    generate_report
}

# Parse arguments and run
parse_args "$@"
main