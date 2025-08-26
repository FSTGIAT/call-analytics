#!/bin/bash
# AWS-aware entrypoint for Call Analytics ML Service

set -e

echo "🚀 Starting Call Analytics ML Service (AWS Mode)"

# Function to get secret from AWS Secrets Manager
get_secret() {
    local secret_name=$1
    local json_key=${2:-""}
    
    if [[ -z "$secret_name" ]]; then
        echo ""
        return 1
    fi
    
    local secret_value
    secret_value=$(aws secretsmanager get-secret-value \
        --secret-id "$secret_name" \
        --query SecretString \
        --output text 2>/dev/null) || {
        echo ""
        return 1
    }
    
    if [[ -n "$json_key" ]]; then
        echo "$secret_value" | jq -r ".$json_key" 2>/dev/null || echo ""
    else
        echo "$secret_value"
    fi
}

# Only fetch secrets if not running with injected secrets (ECS injects them automatically)
if [[ -z "$ECS_CONTAINER_METADATA_URI_V4" ]] && command -v aws >/dev/null 2>&1; then
    echo "📡 Not running in ECS - fetching secrets from Secrets Manager..."
    
    # Test AWS connectivity
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        echo "⚠️  AWS credentials not available or expired, proceeding with environment variables"
    else
        echo "✅ AWS credentials validated"
        
        # Fetch ML service configuration
        echo "🤖 Fetching ML service configuration..."
        ML_JSON=$(get_secret "prod/call-analytics/ml-service")
        
        if [[ -n "$ML_JSON" ]]; then
            export HF_TOKEN=$(echo "$ML_JSON" | jq -r '.hf_token' 2>/dev/null || echo "")
            export HF_ENDPOINT_URL=$(echo "$ML_JSON" | jq -r '.hf_endpoint_url' 2>/dev/null || echo "")
            export HF_MODEL_NAME=$(echo "$ML_JSON" | jq -r '.hf_model_name' 2>/dev/null || echo "")
            export MODEL_TEMPERATURE=$(echo "$ML_JSON" | jq -r '.model_temperature' 2>/dev/null || echo "0.2")
            export MODEL_MAX_TOKENS=$(echo "$ML_JSON" | jq -r '.model_max_tokens' 2>/dev/null || echo "400")
            export REQUEST_TIMEOUT=$(echo "$ML_JSON" | jq -r '.request_timeout' 2>/dev/null || echo "40")
            export DEFAULT_MODEL=$(echo "$ML_JSON" | jq -r '.default_model' 2>/dev/null || echo "dictalm2.0-instruct:Q4_K_M")
            export HEBREW_MODEL=$(echo "$ML_JSON" | jq -r '.hebrew_model' 2>/dev/null || echo "dictalm2.0-instruct:Q4_K_M")
            echo "✅ ML configuration loaded from AWS Secrets"
            
            # Validate HuggingFace token
            if [[ -n "$HF_TOKEN" && "$HF_TOKEN" != "YOUR_HUGGINGFACE_TOKEN_HERE" ]]; then
                echo "✅ HuggingFace token loaded successfully"
            else
                echo "⚠️  HuggingFace token appears to be placeholder or missing"
            fi
        else
            echo "⚠️  Failed to load ML secrets, using environment variables"
        fi
        
        echo "📋 ML secrets processing completed"
    fi
else
    if [[ -n "$ECS_CONTAINER_METADATA_URI_V4" ]]; then
        echo "🐳 Running in ECS - using injected secrets"
    else
        echo "🏠 AWS CLI not available - using local environment variables"
    fi
fi

# Set production defaults
export ML_SERVICE_PORT=${ML_SERVICE_PORT:-5000}
export ML_LOG_LEVEL=${ML_LOG_LEVEL:-INFO}
export FLASK_DEBUG=${FLASK_DEBUG:-false}

# CUDA optimizations
export CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0}
export CUDA_LAUNCH_BLOCKING=${CUDA_LAUNCH_BLOCKING:-0}
export CUDA_CACHE_DISABLE=${CUDA_CACHE_DISABLE:-0}
export CUDA_DEVICE_ORDER=PCI_BUS_ID

# PyTorch optimizations
export PYTORCH_CUDA_ALLOC_CONF=${PYTORCH_CUDA_ALLOC_CONF:-max_split_size_mb:512}
export OMP_NUM_THREADS=${OMP_NUM_THREADS:-4}

# HuggingFace configuration
export HF_HOME=${HF_HOME:-/app/cache/huggingface}
export TRANSFORMERS_CACHE=${TRANSFORMERS_CACHE:-/app/cache/huggingface}
export HF_DATASETS_CACHE=${HF_DATASETS_CACHE:-/app/cache/huggingface/datasets}

# Model configuration defaults
export MODEL_TEMPERATURE=${MODEL_TEMPERATURE:-0.2}
export MODEL_MAX_TOKENS=${MODEL_MAX_TOKENS:-400}
export REQUEST_TIMEOUT=${REQUEST_TIMEOUT:-40}
export OLLAMA_TIMEOUT=${OLLAMA_TIMEOUT:-40}

# Create cache directories
mkdir -p "$HF_HOME" "$TRANSFORMERS_CACHE" "$HF_DATASETS_CACHE" /app/logs

# Log startup information
echo "🌍 Environment: ${NODE_ENV:-production}"
echo "🚪 Port: $ML_SERVICE_PORT"
echo "🤖 Default Model: ${DEFAULT_MODEL:-'[not set]'}"
echo "🇮🇱 Hebrew Model: ${HEBREW_MODEL:-'[not set]'}"
echo "🔥 CUDA Device: $CUDA_VISIBLE_DEVICES"
echo "🧠 HuggingFace Cache: $HF_HOME"

# Check CUDA availability
if command -v nvidia-smi >/dev/null 2>&1; then
    echo "🎮 GPU Information:"
    nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits | head -1
else
    echo "⚠️  NVIDIA GPU tools not available"
fi

# Warm up Python imports
echo "🔥 Pre-loading Python modules..."
python -c "
import torch
print(f'PyTorch version: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'CUDA device count: {torch.cuda.device_count()}')
    print(f'Current CUDA device: {torch.cuda.current_device()}')
    print(f'CUDA device name: {torch.cuda.get_device_name()}')
" || echo "⚠️  GPU initialization check failed"

echo "⚡ Starting ML service application..."
exec "$@"