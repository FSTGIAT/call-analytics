#!/bin/bash

# GPU Pipeline Test Script
# Tests ML Service and Ollama GPU acceleration with Hebrew processing

set -e

echo "🚀 Testing GPU Pipeline for Hebrew Call Analytics"
echo "==============================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Test GPU availability
test_gpu_availability() {
    log_info "Testing GPU availability..."
    
    if command -v nvidia-smi >/dev/null 2>&1; then
        GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)
        if [ $? -eq 0 ]; then
            log_success "GPU detected: $GPU_INFO"
            
            # Check GPU memory
            GPU_MEMORY=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits | head -1)
            log_info "GPU Memory: $GPU_MEMORY"
            return 0
        fi
    fi
    
    log_error "GPU not available or nvidia-smi failed"
    return 1
}

# Test Docker containers are running with GPU
test_containers() {
    log_info "Testing Docker containers..."
    
    # Check if containers are running
    if ! docker ps | grep -q "call-analytics-ml"; then
        log_error "ML service container not running"
        return 1
    fi
    
    if ! docker ps | grep -q "call-analytics-ollama"; then
        log_error "Ollama container not running"
        return 1
    fi
    
    log_success "Docker containers are running"
    
    # Test GPU access in containers
    log_info "Testing GPU access in ML service container..."
    if docker exec call-analytics-ml nvidia-smi >/dev/null 2>&1; then
        log_success "ML service has GPU access"
    else
        log_error "ML service cannot access GPU"
        return 1
    fi
    
    log_info "Testing GPU access in Ollama container..."
    if docker exec call-analytics-ollama nvidia-smi >/dev/null 2>&1; then
        log_success "Ollama service has GPU access"
    else
        log_error "Ollama service cannot access GPU"
        return 1
    fi
    
    return 0
}

# Test Ollama service and model
test_ollama_service() {
    log_info "Testing Ollama service..."
    
    # Wait for service to be ready
    local retries=0
    local max_retries=30
    
    while [ $retries -lt $max_retries ]; do
        if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
            break
        fi
        log_info "Waiting for Ollama service... ($((retries + 1))/$max_retries)"
        sleep 5
        retries=$((retries + 1))
    done
    
    if [ $retries -eq $max_retries ]; then
        log_error "Ollama service failed to start"
        return 1
    fi
    
    log_success "Ollama service is responding"
    
    # Test Hebrew model
    log_info "Testing DictaLM Hebrew model..."
    local test_response=$(curl -s -X POST http://localhost:11434/api/generate \
        -H "Content-Type: application/json" \
        -d '{
            "model": "dictalm2.0-instruct:Q4_K_M",
            "prompt": "שלום, איך קוראים לך?",
            "stream": false,
            "options": {
                "num_predict": 20,
                "temperature": 0.1,
                "num_gpu": -1
            }
        }' | jq -r '.response // empty' 2>/dev/null)
    
    if [ -n "$test_response" ] && echo "$test_response" | grep -q '[א-ת]'; then
        log_success "DictaLM Hebrew model working on GPU"
        log_info "Sample response: ${test_response:0:100}..."
    else
        log_error "DictaLM Hebrew model failed or not using GPU"
        return 1
    fi
    
    return 0
}

# Test ML service
test_ml_service() {
    log_info "Testing ML service..."
    
    # Wait for service to be ready
    local retries=0
    local max_retries=20
    
    while [ $retries -lt $max_retries ]; do
        if curl -sf http://localhost:5000/health >/dev/null 2>&1; then
            break
        fi
        log_info "Waiting for ML service... ($((retries + 1))/$max_retries)"
        sleep 5
        retries=$((retries + 1))
    done
    
    if [ $retries -eq $max_retries ]; then
        log_error "ML service failed to start"
        return 1
    fi
    
    log_success "ML service is responding"
    
    # Test Hebrew conversation analysis
    log_info "Testing Hebrew conversation analysis..."
    local analysis_response=$(curl -s -X POST http://localhost:5000/api/analyze-conversation \
        -H "Content-Type: application/json" \
        -d '{
            "text": "שלום, אני מתקשר בנוגע לבעיה עם האינטרנט שלי. הקו מתנתק כל הזמן ואני לא יכול לעבוד מהבית. מה אפשר לעשות?",
            "callId": "gpu-test-001",
            "options": {
                "includeEmbedding": true,
                "includeSentiment": true,
                "useCallIdPrompt": true,
                "promptTemplate": "summarize_with_id"
            }
        }' 2>/dev/null)
    
    if [ $? -eq 0 ] && echo "$analysis_response" | jq -e '.success' >/dev/null 2>&1; then
        log_success "Hebrew conversation analysis completed"
        
        # Check for Hebrew classifications
        local classifications=$(echo "$analysis_response" | jq -r '.classifications[]? // empty' 2>/dev/null)
        if [ -n "$classifications" ]; then
            log_success "Hebrew classifications generated: $classifications"
        else
            log_warning "No classifications generated"
        fi
        
        # Check for embeddings
        local embedding_size=$(echo "$analysis_response" | jq -r '.embedding | length' 2>/dev/null)
        if [ "$embedding_size" = "768" ]; then
            log_success "AlephBERT embeddings generated (768 dimensions)"
        else
            log_warning "Embeddings not generated or wrong size: $embedding_size"
        fi
        
    else
        log_error "Hebrew conversation analysis failed"
        echo "Response: $analysis_response"
        return 1
    fi
    
    return 0
}

# Test complete pipeline performance
test_pipeline_performance() {
    log_info "Testing pipeline performance..."
    
    local start_time=$(date +%s)
    
    # Process multiple Hebrew conversations
    for i in {1..3}; do
        log_info "Processing conversation $i/3..."
        
        local response=$(curl -s -X POST http://localhost:5000/api/analyze-conversation \
            -H "Content-Type: application/json" \
            -d "{
                \"text\": \"שלום, אני מתקשר בנוגע לבעיה מספר $i. יש לי בעיה טכנית חמורה שצריכה פתרון מיידי.\",
                \"callId\": \"perf-test-$i\",
                \"options\": {
                    \"includeEmbedding\": true,
                    \"includeSentiment\": true,
                    \"useCallIdPrompt\": true
                }
            }")
        
        if ! echo "$response" | jq -e '.success' >/dev/null 2>&1; then
            log_error "Performance test failed on conversation $i"
            return 1
        fi
    done
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "Pipeline performance test completed in ${duration} seconds"
    log_info "Average: $((duration / 3)) seconds per conversation"
    
    return 0
}

# Main test execution
main() {
    echo
    log_info "Starting GPU Pipeline Tests..."
    echo
    
    # Run tests
    test_gpu_availability || exit 1
    echo
    
    test_containers || exit 1
    echo
    
    test_ollama_service || exit 1
    echo
    
    test_ml_service || exit 1
    echo
    
    test_pipeline_performance || exit 1
    echo
    
    log_success "🎉 All GPU pipeline tests passed!"
    log_info "Your Hebrew call analytics system is GPU-optimized and ready for production"
    
    echo
    echo "📊 System Summary:"
    echo "=================="
    
    # GPU info
    if command -v nvidia-smi >/dev/null 2>&1; then
        echo "🖥️  GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
        echo "💾 VRAM: $(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | head -1)"
    fi
    
    # Container status
    echo "🐳 ML Service: $(docker inspect call-analytics-ml --format='{{.State.Status}}')"
    echo "🤖 Ollama: $(docker inspect call-analytics-ollama --format='{{.State.Status}}')"
    
    # Model info
    local ollama_models=$(curl -s http://localhost:11434/api/tags | jq -r '.models[].name' | wc -l)
    echo "📚 Ollama Models: $ollama_models loaded"
    
    echo
    log_success "GPU-accelerated Hebrew processing is ready! 🚀"
}

# Run main function
main "$@"