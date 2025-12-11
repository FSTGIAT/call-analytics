#!/bin/bash

echo "🚀 Starting optimized Ollama with Hebrew DictaLM support..."

# Start Ollama server in the background
ollama serve &

# Wait for Ollama to be ready
echo "⏳ Waiting for Ollama server to start..."
until curl -f http://localhost:11434/api/tags >/dev/null 2>&1; do
    echo "Ollama server not ready yet, waiting..."
    sleep 2
done
echo "✅ Ollama server is ready"

# Check if DictaLM model is already available
if ollama list | grep -q "dictalm2.0-instruct:Q4_K_M"; then
    echo "✅ DictaLM model already available in Ollama"
else
    echo "📥 DictaLM model not found, downloading directly into Ollama..."
    
    # Option 1: Try to pull from Ollama registry (if available)
    if ollama pull dictalm2.0-instruct:Q4_K_M 2>/dev/null; then
        echo "✅ DictaLM model pulled from Ollama registry"
    else
        echo "📦 Registry pull failed, checking for local GGUF file..."
        
        # Option 2: Check if GGUF file exists in a mounted volume
        DICTALM_FILE="/models/dictalm2.0-instruct.Q4_K_M.gguf"
        
        if [ -f "$DICTALM_FILE" ]; then
            echo "📁 Found GGUF file in mounted volume: $DICTALM_FILE"
            
            # Create Modelfile pointing to the mounted file
            cat > /tmp/Modelfile.dictalm << EOF
FROM $DICTALM_FILE

# Optimized parameters for concise business responses
PARAMETER temperature 0.2
PARAMETER top_k 15
PARAMETER top_p 0.7
PARAMETER repeat_penalty 1.15
PARAMETER num_ctx 512
PARAMETER num_predict 150
PARAMETER frequency_penalty 0.1
PARAMETER presence_penalty 0.1
PARAMETER num_gpu 99

# Stop tokens
PARAMETER stop <|im_start|>
PARAMETER stop <|im_end|>

# Template for chat format
TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
"""

# System prompt optimized for data analysis
SYSTEM """You are a call center data analyst. Analyze the provided data to answer questions directly.

CORE INSTRUCTIONS:
- Answer exactly what is asked based on the data provided
- Hebrew questions → Hebrew responses (brief and direct)
- English questions → English responses (brief and direct)
- Use actual data from context, not generic responses
- Be specific when data is available, clear when data is missing

DATA ANALYSIS:
- Analyze the provided data to answer questions directly
- Use the most relevant data from the context for each question
- Be precise with numbers and customer identifiers from the data

RESPONSE STYLE:
- Direct and factual
- 1-2 sentences maximum
- Focus on answering the specific question
- Let the data guide your response"""
EOF
            
            # Create the model directly in Ollama's internal format
            echo "🔄 Creating DictaLM model in Ollama (this may take a few minutes)..."
            ollama create dictalm2.0-instruct:Q4_K_M -f /tmp/Modelfile.dictalm
            
            if [ $? -eq 0 ]; then
                echo "✅ DictaLM model created successfully from mounted GGUF file"
                # Clean up temporary Modelfile
                rm -f /tmp/Modelfile.dictalm
            else
                echo "❌ Failed to create DictaLM model from GGUF file"
            fi
        else
            echo "📥 No local GGUF file found, attempting HuggingFace download..."
            
            # Option 3: Download using HuggingFace (fallback)
            python3 /scripts/download-dictalm.py
            
            if [ -f "/root/.cache/dictalm2.0-instruct.Q4_K_M.gguf" ]; then
                echo "📦 Downloaded DictaLM, creating model in Ollama..."
                
                # Create Modelfile pointing to downloaded file
                cat > /tmp/Modelfile.dictalm << EOF
FROM /root/.cache/dictalm2.0-instruct.Q4_K_M.gguf
$(cat /scripts/Modelfile.dictalm | grep -v "^FROM")
EOF
                
                ollama create dictalm2.0-instruct:Q4_K_M -f /tmp/Modelfile.dictalm
                rm -f /tmp/Modelfile.dictalm
                
                # Clean up the downloaded file to save space
                rm -f /root/.cache/dictalm2.0-instruct.Q4_K_M.gguf
                
                echo "✅ DictaLM model created and temporary file cleaned up"
            else
                echo "❌ DictaLM download failed, using fallback model"
                
                # Fallback: Use a smaller model
                ollama pull llama3.1:8b
                # Create an alias for compatibility
                ollama cp llama3.1:8b dictalm2.0-instruct:Q4_K_M || echo "Alias creation failed"
            fi
        fi
    fi
fi

# Setup robust stuck process cleanup
if [ -f "/models/cleanup-stuck-processes.sh" ]; then
    chmod +x /models/cleanup-stuck-processes.sh
    
    # Install cron if not available
    which cron >/dev/null || (apt-get update && apt-get install -y cron)
    
    # Setup cron job to run cleanup every 2 minutes
    echo "*/2 * * * * /models/cleanup-stuck-processes.sh" | crontab -
    
    # Start cron daemon
    cron
    
    echo "✅ Stuck process cleanup system active (runs every 2 minutes)"
    
    # Run initial cleanup
    /models/cleanup-stuck-processes.sh
fi

# Verify model is working
echo "🧪 Testing DictaLM model..."
if echo "שלום" | timeout 30 ollama run dictalm2.0-instruct:Q4_K_M >/dev/null 2>&1; then
    echo "✅ DictaLM model is working correctly"
else
    echo "⚠️ DictaLM model test failed, but continuing..."
fi

# List available models
echo "📋 Available models:"
ollama list

echo "🎉 Optimized Ollama setup complete!"

# Keep the container running
wait