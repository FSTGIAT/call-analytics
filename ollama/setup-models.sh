#!/bin/bash

# Hebrew Models Setup Script for Call Analytics AI Platform
# This script automatically downloads and configures Hebrew language models

set -e

echo "=== Hebrew Models Setup for Call Analytics AI Platform ==="

# Configuration
OLLAMA_BASE_URL="http://localhost:11434"
REQUIRED_MODEL="dictalm2.0-instruct:Q4_K_M"
FALLBACK_MODEL="llama3.1:8b"

# Function to wait for Ollama to be ready
wait_for_ollama() {
    echo "Waiting for Ollama server to be ready..."
    max_attempts=30
    attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if curl -sf "$OLLAMA_BASE_URL/api/tags" >/dev/null 2>&1; then
            echo "Ollama server is ready!"
            return 0
        fi
        echo "Attempt $((attempt+1))/$max_attempts - Ollama not ready yet..."
        sleep 2
        attempt=$((attempt+1))
    done
    
    echo "ERROR: Ollama server failed to start after $max_attempts attempts"
    return 1
}

# Function to check if model exists
model_exists() {
    ollama list 2>/dev/null | grep -q "^$1"
}

# Function to download model with retry
download_model() {
    local model_name="$1"
    local max_retries=3
    local retry=0
    
    echo "Downloading model: $model_name"
    
    while [ $retry -lt $max_retries ]; do
        if ollama pull "$model_name"; then
            echo "Successfully downloaded: $model_name"
            return 0
        fi
        retry=$((retry+1))
        echo "Download failed, retry $retry/$max_retries..."
        sleep 5
    done
    
    echo "Failed to download $model_name after $max_retries attempts"
    return 1
}

# Main setup function
setup_models() {
    echo "Starting model setup process..."
    
    # Step 1: Download base multilingual model (Llama 3.1 with Hebrew support)
    if ! model_exists "$FALLBACK_MODEL"; then
        echo "Downloading base multilingual model..."
        if download_model "$FALLBACK_MODEL"; then
            echo "Base model downloaded successfully"
        else
            echo "WARNING: Failed to download base model"
        fi
    else
        echo "Base model already exists: $FALLBACK_MODEL"
    fi
    
    # Step 2: Try to download DictaLM from various sources
    echo "Attempting to download DictaLM Hebrew model..."
    
    DICTALM_SOURCES=(
        "dicta-il/dictalm2.0"
        "dictalm2.0"
        "dictalm"
        "dictalm:latest"
    )
    
    dictalm_downloaded=false
    for source in "${DICTALM_SOURCES[@]}"; do
        echo "Trying to download from: $source"
        if download_model "$source"; then
            # Create alias if needed
            if [[ "$source" != "$REQUIRED_MODEL" ]]; then
                echo "Creating alias: $source -> $REQUIRED_MODEL"
                ollama cp "$source" "$REQUIRED_MODEL" 2>/dev/null || true
            fi
            dictalm_downloaded=true
            break
        fi
    done
    
    # Step 3: Create DictaLM alias using base model if direct download failed
    if ! $dictalm_downloaded && ! model_exists "$REQUIRED_MODEL"; then
        echo "Direct DictaLM download failed. Creating alias using base model..."
        if model_exists "$FALLBACK_MODEL"; then
            if ollama cp "$FALLBACK_MODEL" "$REQUIRED_MODEL"; then
                echo "Successfully created DictaLM alias from base model"
            else
                echo "ERROR: Failed to create DictaLM alias"
                return 1
            fi
        else
            echo "ERROR: No base model available for alias creation"
            return 1
        fi
    fi
    
    # Step 4: Create custom Hebrew-optimized model from Modelfile
    if [ -f "/models/Modelfile.dictalm" ]; then
        echo "Creating custom Hebrew-optimized model..."
        if ollama create dictalm-hebrew -f /models/Modelfile.dictalm 2>/dev/null; then
            echo "Custom Hebrew model created successfully"
            # Optionally replace the main alias with the custom model
            ollama cp dictalm-hebrew "$REQUIRED_MODEL" 2>/dev/null || true
        else
            echo "Custom model creation skipped (Modelfile may need base model)"
        fi
    fi
    
    # Step 5: Download additional useful models
    echo "Downloading additional Hebrew-capable models..."
    
    ADDITIONAL_MODELS=(
        "llama3.1:latest"
        # "qwen2.5:7b"  # Removed - we only want DictaLM for Hebrew processing
    )
    
    for model in "${ADDITIONAL_MODELS[@]}"; do
        if ! model_exists "$model"; then
            echo "Downloading additional model: $model"
            download_model "$model" || echo "Skipping $model - download failed"
        fi
    done
}

# Function to verify setup
verify_setup() {
    echo "=== Verifying model setup ==="
    
    if ! model_exists "$REQUIRED_MODEL"; then
        echo "ERROR: Required model $REQUIRED_MODEL is not available!"
        return 1
    fi
    
    echo "✓ Required model is available: $REQUIRED_MODEL"
    
    # Test the model
    echo "Testing Hebrew text processing..."
    test_response=$(ollama run "$REQUIRED_MODEL" "שלום! איך אתה?" 2>/dev/null || echo "")
    if [[ -n "$test_response" ]]; then
        echo "✓ Model responds to Hebrew text: $test_response"
    else
        echo "⚠ Model test failed - but model exists"
    fi
    
    echo "=== Available models ==="
    ollama list
    
    return 0
}

# Main execution
main() {
    echo "Hebrew Models Setup Started: $(date)"
    
    # Wait for Ollama to be ready
    if ! wait_for_ollama; then
        echo "FATAL: Ollama server not available"
        exit 1
    fi
    
    # Setup models
    if setup_models; then
        echo "Model setup completed successfully"
    else
        echo "Model setup failed - attempting minimal setup"
        
        # Fallback: ensure at least one working model
        if model_exists "$FALLBACK_MODEL"; then
            ollama cp "$FALLBACK_MODEL" "$REQUIRED_MODEL" 2>/dev/null || true
        fi
    fi
    
    # Verify setup
    if verify_setup; then
        echo "=== Setup verification passed ==="
        echo "Hebrew Models Setup Completed Successfully: $(date)"
        exit 0
    else
        echo "=== Setup verification failed ==="
        echo "Hebrew Models Setup Failed: $(date)"
        exit 1
    fi
}

# Run main function
main "$@"