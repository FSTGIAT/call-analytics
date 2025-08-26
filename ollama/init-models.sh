#!/bin/bash
"""
Initialize Ollama models for Hebrew Call Analytics
Optimized for DictaLM 2.0 integration
"""

set -e

echo "🚀 Initializing Ollama models..."

# Wait for Ollama server to be ready
echo "Waiting for Ollama server to be ready..."
until ollama list >/dev/null 2>&1; do
    echo "Ollama server not ready yet, waiting..."
    sleep 5
done

echo "✅ Ollama server is ready"

# Check if DictaLM model file exists
DICTALM_MODEL_FILE="/root/.ollama/models/dictalm2.0-instruct.Q4_K_M.gguf"
DICTALM_MODEL_NAME="dictalm2.0-instruct:Q4_K_M"

if [ -f "$DICTALM_MODEL_FILE" ]; then
    echo "📁 Found DictaLM model file at $DICTALM_MODEL_FILE"
    
    # Check if model is already imported in Ollama
    if ollama list | grep -q "dictalm2.0-instruct"; then
        echo "✅ DictaLM model already available in Ollama"
    else
        echo "📦 Importing DictaLM model into Ollama..."
        
        # Create Modelfile if it doesn't exist
        if [ ! -f "/scripts/Modelfile.dictalm" ]; then
            echo "Creating Modelfile for DictaLM..."
            cat > /scripts/Modelfile.dictalm << EOF
FROM $DICTALM_MODEL_FILE

# Set the temperature (lower = more focused, higher = more creative)
PARAMETER temperature 0.2

# Set the maximum number of tokens to generate
PARAMETER num_predict 400

# Hebrew-specific system prompt
SYSTEM """אתה עוזר AI מתקדם המתמחה בניתוח שיחות שירות לקוחות בעברית. 
אתה מומחה בסיווג שיחות, ניתוח רגשות, וזיהוי נושאים מרכזיים בשיחות.
ענה תמיד בעברית, אלא אם נתבקשת אחרת."""

# Stop sequences
PARAMETER stop "<|end_of_text|>"
PARAMETER stop "<|eot_id|>"

# Context window
PARAMETER num_ctx 4096

# Performance optimizations
PARAMETER num_threads 8
PARAMETER num_gpu_layers 32
EOF
        fi
        
        # Import the model with the Modelfile
        ollama create "$DICTALM_MODEL_NAME" -f /scripts/Modelfile.dictalm
        echo "✅ DictaLM model imported successfully"
    fi
else
    echo "⚠️  DictaLM model file not found. Attempting to download..."
    
    # Try to download the model
    if command -v python3 &> /dev/null; then
        python3 /scripts/download-dictalm.py
        
        # Retry import if download successful
        if [ -f "$DICTALM_MODEL_FILE" ]; then
            echo "📦 Importing downloaded DictaLM model..."
            ollama create "$DICTALM_MODEL_NAME" -f /scripts/Modelfile.dictalm
            echo "✅ DictaLM model imported successfully"
        else
            echo "❌ DictaLM download failed"
        fi
    else
        echo "❌ Python3 not available for model download"
    fi
fi

# Download Llama 3.1 as fallback if DictaLM is not available
if ! ollama list | grep -q "dictalm2.0-instruct"; then
    echo "🔄 DictaLM not available, downloading Llama 3.1 as fallback..."
    ollama pull llama3.1:8b
    echo "✅ Llama 3.1 downloaded as fallback"
fi

# Test the models
echo "🧪 Testing available models..."
for model in $(ollama list | tail -n +2 | awk '{print $1}' | grep -v "^NAME$"); do
    if [ ! -z "$model" ]; then
        echo "Testing model: $model"
        echo "שלום עולם" | ollama run "$model" --format json > /dev/null 2>&1 && echo "  ✅ $model working" || echo "  ❌ $model failed"
    fi
done

echo "🎉 Model initialization complete!"

# List all available models
echo "📋 Available models:"
ollama list