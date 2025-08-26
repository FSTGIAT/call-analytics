#!/bin/bash

# Ollama Health Check and Recovery Script
# Ensures Ollama is responsive and models are working

set -e

OLLAMA_URL="http://localhost:11434"
TEST_MODEL="dictalm2.0-instruct:Q4_K_M"
HEALTH_LOG="/tmp/ollama-health.log"
MAX_RESPONSE_TIME=30

log_health() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$HEALTH_LOG"
}

# Test if Ollama API is responding
test_api_connectivity() {
    log_health "Testing Ollama API connectivity..."
    
    if timeout 10 curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
        log_health "✅ Ollama API is responding"
        return 0
    else
        log_health "❌ Ollama API is not responding"
        return 1
    fi
}

# Test if DictaLM model is working
test_model_functionality() {
    log_health "Testing DictaLM model functionality..."
    
    local test_prompt="בדיקה קצרה"
    local response
    
    # Use timeout to prevent hanging
    response=$(timeout $MAX_RESPONSE_TIME curl -s -X POST "$OLLAMA_URL/api/generate" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$TEST_MODEL\", \"prompt\": \"$test_prompt\", \"stream\": false}" 2>/dev/null)
    
    if [[ $? -eq 0 && -n "$response" ]]; then
        # Check if response contains expected fields
        if echo "$response" | jq -e '.response' > /dev/null 2>&1; then
            local model_response=$(echo "$response" | jq -r '.response' | head -c 100)
            log_health "✅ DictaLM model is working - Response: '$model_response'"
            return 0
        else
            log_health "❌ DictaLM model returned invalid response: $response"
            return 1
        fi
    else
        log_health "❌ DictaLM model test failed or timed out"
        return 1
    fi
}

# Check for resource issues
check_resources() {
    log_health "Checking system resources..."
    
    local memory_usage=$(free | awk 'NR==2{printf "%.1f", $3*100/$2}')
    local disk_usage=$(df /tmp | awk 'NR==2{print $5}' | sed 's/%//')
    local runner_count=$(ps aux | grep "ollama runner" | grep -v grep | wc -l)
    
    log_health "Resources - Memory: ${memory_usage}%, Disk: ${disk_usage}%, Runners: $runner_count"
    
    # Warning thresholds
    if (( $(echo "$memory_usage > 85" | bc -l) )); then
        log_health "⚠️  High memory usage: ${memory_usage}%"
    fi
    
    if [[ $disk_usage -gt 90 ]]; then
        log_health "⚠️  High disk usage: ${disk_usage}%"
    fi
    
    if [[ $runner_count -gt 2 ]]; then
        log_health "⚠️  High number of runner processes: $runner_count"
    fi
}

# Attempt to recover from issues
attempt_recovery() {
    log_health "Attempting to recover Ollama service..."
    
    # Kill stuck processes
    log_health "Cleaning up stuck processes..."
    pkill -f "ollama runner" 2>/dev/null || true
    sleep 2
    
    # Test if recovery worked
    if test_api_connectivity && test_model_functionality; then
        log_health "✅ Recovery successful"
        return 0
    else
        log_health "❌ Recovery failed"
        return 1
    fi
}

# Main health check function
run_health_check() {
    log_health "=== Starting Ollama Health Check ==="
    
    local api_ok=false
    local model_ok=false
    
    # Check API connectivity
    if test_api_connectivity; then
        api_ok=true
        
        # Check model functionality
        if test_model_functionality; then
            model_ok=true
        fi
    fi
    
    # Check resources regardless of API status
    check_resources
    
    # Determine overall health
    if [[ "$api_ok" == true && "$model_ok" == true ]]; then
        log_health "🟢 Overall status: HEALTHY"
        return 0
    elif [[ "$api_ok" == true ]]; then
        log_health "🟡 Overall status: API OK, Model issues"
        attempt_recovery
        return $?
    else
        log_health "🔴 Overall status: UNHEALTHY"
        attempt_recovery
        return $?
    fi
}

# Run health check
run_health_check
exit_code=$?

# If running in continuous mode
if [[ "${1:-}" == "continuous" ]]; then
    while true; do
        sleep 300  # Check every 5 minutes
        run_health_check
    done
fi

exit $exit_code