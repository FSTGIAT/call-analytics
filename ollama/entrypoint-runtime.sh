#!/bin/bash

echo "🚀 Starting optimized Ollama with pre-loaded Hebrew DictaLM model..."

# Start Ollama server in the background
ollama serve &

# Wait for Ollama to be ready
echo "⏳ Waiting for Ollama server to start..."
until curl -f http://localhost:11434/api/tags >/dev/null 2>&1; do
    echo "Ollama server not ready yet, waiting..."
    sleep 2
done
echo "✅ Ollama server is ready"

# Verify DictaLM model is available (it should be pre-loaded)
if ollama list | grep -q "dictalm2.0-instruct:Q4_K_M"; then
    echo "✅ Pre-loaded DictaLM model is available"
else
    echo "⚠️ DictaLM model not found in pre-loaded state, attempting to create..."
    
    # Fallback: try to create from Modelfile if something went wrong
    if [ -f "/scripts/Modelfile.dictalm" ]; then
        ollama create dictalm2.0-instruct:Q4_K_M -f /scripts/Modelfile.dictalm || echo "Model creation failed"
    fi
fi

# Setup robust stuck process cleanup
if [ -f "/models/cleanup-stuck-processes.sh" ]; then
    chmod +x /models/cleanup-stuck-processes.sh
    
    # Install cron if not available (lightweight check)
    if ! which cron >/dev/null 2>&1; then
        apt-get update && apt-get install -y cron && rm -rf /var/lib/apt/lists/*
    fi
    
    # Setup cron job to run cleanup every 2 minutes
    echo "*/2 * * * * /models/cleanup-stuck-processes.sh" | crontab -
    
    # Start cron daemon
    cron
    
    echo "✅ Stuck process cleanup system active (runs every 2 minutes)"
    
    # Run initial cleanup
    /models/cleanup-stuck-processes.sh
fi

# Quick model test
echo "🧪 Testing DictaLM model..."
if echo "בדיקה" | timeout 15 ollama run dictalm2.0-instruct:Q4_K_M >/dev/null 2>&1; then
    echo "✅ DictaLM model is working correctly"
else
    echo "⚠️ DictaLM model test failed, but continuing..."
fi

# List available models
echo "📋 Available models:"
ollama list

echo "🎉 Optimized Ollama ready for production use!"
echo "💾 Docker image size optimized - no model duplication"
echo "🚀 Model pre-loaded for faster startup"

# Keep the container running
wait