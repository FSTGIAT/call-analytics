#!/bin/bash

# Ollama Process Monitor and Cleanup Script
# Prevents stuck runner processes and manages resource usage

set -e

# Configuration
MAX_RUNNER_TIME=300  # 5 minutes max for any runner process
MAX_CPU_USAGE=500    # Max CPU usage for runner (500% = 5 cores)
LOG_FILE="/tmp/ollama-monitor.log"
CLEANUP_INTERVAL=60  # Check every 60 seconds

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Function to get process CPU usage
get_cpu_usage() {
    local pid=$1
    ps -p "$pid" -o %cpu --no-headers 2>/dev/null | tr -d ' ' | cut -d'.' -f1 || echo "0"
}

# Function to get process runtime in seconds  
get_process_runtime() {
    local pid=$1
    local start_time=$(ps -p "$pid" -o lstart --no-headers 2>/dev/null | xargs -I {} date -d "{}" +%s 2>/dev/null || echo "0")
    local current_time=$(date +%s)
    echo $((current_time - start_time))
}

# Function to kill stuck runner processes
cleanup_stuck_runners() {
    local killed_count=0
    
    # Find all ollama runner processes
    while IFS= read -r line; do
        if [[ -z "$line" ]]; then continue; fi
        
        local pid=$(echo "$line" | awk '{print $2}')
        local cpu_usage=$(get_cpu_usage "$pid")
        local runtime=$(get_process_runtime "$pid")
        
        # Skip if we can't get valid metrics
        if [[ "$pid" == "0" || "$cpu_usage" == "0" ]]; then continue; fi
        
        local should_kill=false
        local reason=""
        
        # Check if process has been running too long
        if [[ $runtime -gt $MAX_RUNNER_TIME ]]; then
            should_kill=true
            reason="runtime exceeded ${MAX_RUNNER_TIME}s (actual: ${runtime}s)"
        fi
        
        # Check if CPU usage is too high for too long
        if [[ ${cpu_usage} -gt $MAX_CPU_USAGE ]]; then
            should_kill=true
            reason="${reason:+$reason, }high CPU usage: ${cpu_usage}%"
        fi
        
        if [[ "$should_kill" == "true" ]]; then
            log_message "Killing stuck runner process PID $pid: $reason"
            if kill -9 "$pid" 2>/dev/null; then
                killed_count=$((killed_count + 1))
                log_message "Successfully killed process $pid"
            else
                log_message "Failed to kill process $pid (may have already exited)"
            fi
        else
            log_message "Runner process $pid OK - CPU: ${cpu_usage}%, Runtime: ${runtime}s"
        fi
        
    done < <(ps aux | grep "ollama runner" | grep -v grep)
    
    if [[ $killed_count -gt 0 ]]; then
        log_message "Cleaned up $killed_count stuck runner processes"
        # Clear any cached models after cleanup
        curl -s -X POST http://localhost:11434/api/generate -d '{"model": "dictalm2.0-instruct:Q4_K_M", "keep_alive": 0}' > /dev/null 2>&1 || true
    fi
}

# Function to check overall system health
check_system_health() {
    local total_runners=$(ps aux | grep "ollama runner" | grep -v grep | wc -l)
    local memory_usage=$(free | awk 'NR==2{printf "%.2f", $3*100/$2}')
    
    log_message "System status - Runners: $total_runners, Memory usage: ${memory_usage}%"
    
    # Alert if too many runners (indicates potential issues)
    if [[ $total_runners -gt 3 ]]; then
        log_message "WARNING: High number of runner processes ($total_runners) - investigating..."
        ps aux | grep "ollama runner" | grep -v grep | head -5 | while read line; do
            log_message "Runner: $line"
        done
    fi
}

# Main monitoring loop
monitor_processes() {
    log_message "Starting Ollama process monitor (PID: $$)"
    log_message "Config - Max runtime: ${MAX_RUNNER_TIME}s, Max CPU: ${MAX_CPU_USAGE}%, Check interval: ${CLEANUP_INTERVAL}s"
    
    while true; do
        # Check if ollama serve is running
        if ! pgrep -f "ollama serve" > /dev/null; then
            log_message "ERROR: Ollama serve process not found!"
            sleep 5
            continue
        fi
        
        # Cleanup stuck processes
        cleanup_stuck_runners
        
        # Check system health
        check_system_health
        
        # Wait before next check
        sleep $CLEANUP_INTERVAL
    done
}

# Immediate cleanup on script start
log_message "Performing initial cleanup..."
cleanup_stuck_runners

# Start monitoring if requested
if [[ "${1:-}" == "monitor" ]]; then
    monitor_processes
else
    log_message "One-time cleanup completed. Use '$0 monitor' for continuous monitoring."
fi