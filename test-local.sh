#!/bin/bash
# Local testing script for ML service with Ollama

set -e

echo "🚀 Starting local test environment..."

# Check if Ollama container is running
if docker ps | grep -q "ollama"; then
    echo "✅ Ollama container already running"
else
    echo "🔄 Starting Ollama container..."
    docker run -d \
        --name call-analytics-ollama-test \
        --gpus all \
        -p 11434:11434 \
        -v $(pwd)/data/ollama:/root/.ollama \
        -v $(pwd)/ollama:/models \
        -e NVIDIA_VISIBLE_DEVICES=all \
        -e OLLAMA_HOST=0.0.0.0:11434 \
        ollama/ollama:latest

    echo "⏳ Waiting for Ollama to start..."
    sleep 10
fi

# Check if model is loaded
echo "🔍 Checking if DictaLM model is available..."
if curl -s http://localhost:11434/api/tags | grep -q "dictalm"; then
    echo "✅ DictaLM model already loaded"
else
    echo "🔄 Creating DictaLM model from GGUF..."
    # Create the model from GGUF file
    docker exec call-analytics-ollama-test ollama create dictalm2.0-instruct:Q4_K_M -f /models/Modelfile.dictalm || {
        echo "⚠️ Model creation failed, trying to pull..."
        # If local creation fails, the model might need manual loading
        echo "Please manually load the model:"
        echo "  docker exec -it call-analytics-ollama-test bash"
        echo "  ollama create dictalm2.0-instruct:Q4_K_M -f /models/Modelfile.dictalm"
    }
fi

# Run the ML service
echo ""
echo "🔄 Starting ML service container..."
docker run -it --rm \
    --name call-analytics-ml-test \
    --gpus all \
    -p 5000:5000 \
    -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
    -e ENABLE_SQS=false \
    -e ML_LOG_LEVEL=DEBUG \
    -e DEFAULT_MODEL=dictalm2.0-instruct:Q4_K_M \
    -e HEBREW_MODEL=dictalm2.0-instruct:Q4_K_M \
    -e MODEL_TEMPERATURE=0.5 \
    -e MODEL_MAX_TOKENS=3000 \
    -e REQUEST_TIMEOUT=60 \
    -v $(pwd)/ml-service:/app \
    -v $(pwd)/config/call-classifications.json:/app/config/call-classifications.json:ro \
    -v $(pwd)/config/prompt-templates.json:/app/config/prompt-templates.json:ro \
    --add-host=host.docker.internal:host-gateway \
    call-analytics-ml:latest

echo ""
echo "🧹 To clean up:"
echo "  docker stop call-analytics-ollama-test"
echo "  docker rm call-analytics-ollama-test"
