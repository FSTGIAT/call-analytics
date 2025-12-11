#!/bin/bash
set -e

echo "🚀 Starting Ollama service with DictaLM..."

# Start Ollama server in background
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "⏳ Waiting for Ollama server to start..."
for i in {1..30}; do
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "✅ Ollama server is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Ollama server failed to start"
        exit 1
    fi
    sleep 1
done

# Install DictaLM model if not already installed
echo "🔧 Installing DictaLM model..."
if ! ollama list | grep -q "dictalm2.0-instruct:Q4_K_M"; then
    echo "📦 Creating DictaLM model from Modelfile..."
    
    # Create model using the API directly
    curl -X POST http://localhost:11434/api/create \
        -H "Content-Type: application/json" \
        -d '{
            "name": "dictalm2.0-instruct:Q4_K_M",
            "modelfile": "FROM /root/.ollama/models/dictalm2.0-instruct.Q4_K_M.gguf\n\nTEMPLATE \"\"\"{{ if .System }}<|im_start|>system\n{{ .System }}<|im_end|>\n{{ end }}{{ if .Prompt }}<|im_start|>user\n{{ .Prompt }}<|im_end|>\n{{ end }}<|im_start|>assistant\n\"\"\"\n\nPARAMETER temperature 0.2\nPARAMETER top_k 15\nPARAMETER top_p 0.7\nPARAMETER repeat_penalty 1.15\nPARAMETER num_ctx 2048\nPARAMETER num_predict 150\nPARAMETER frequency_penalty 0.1\nPARAMETER presence_penalty 0.1\nPARAMETER num_gpu 99\n\nPARAMETER stop <|im_start|>\nPARAMETER stop <|im_end|>\n\nSYSTEM \"\"\"You are a call center data analyst. Analyze the provided data to answer questions directly.\n\nCORE INSTRUCTIONS:\n- Answer exactly what is asked based on the data provided\n- Hebrew questions → Hebrew responses (brief and direct)\n- English questions → English responses (brief and direct)\n- Use actual data from context, not generic responses\n- Be specific when data is available, clear when data is missing\n\nDATA ANALYSIS:\n- Analyze the provided data to answer questions directly\n- Use the most relevant data from the context for each question\n- Be precise with numbers and customer identifiers from the data\n\nRESPONSE STYLE:\n- Direct and factual\n- 1-2 sentences maximum\n- Focus on answering the specific question\n- Let the data guide your response\n\"\"\""
        }' \
        --connect-timeout 120 || echo "⚠️ Model creation failed, but continuing..."
        
    echo "✅ DictaLM model installation completed"
else
    echo "✅ DictaLM model already installed"
fi

# List available models for verification
echo "📋 Available models:"
ollama list

# Keep the server running
echo "🎯 Ollama server with DictaLM is ready for Hebrew and English processing"
wait $OLLAMA_PID