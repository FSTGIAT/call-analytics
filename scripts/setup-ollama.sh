#!/bin/bash

echo "🚀 Setting up Ollama with Mistral 7B model..."

# Check if running in Docker or locally
if command -v docker &> /dev/null && docker ps | grep -q call-analytics-ollama; then
    echo "📦 Detected Docker setup"
    OLLAMA_CMD="docker exec call-analytics-ollama ollama"
    API_URL="http://localhost:11434"
elif command -v ollama &> /dev/null; then
    echo "💻 Detected local Ollama installation"
    OLLAMA_CMD="ollama"
    API_URL="http://localhost:11434"
else
    echo "❌ Ollama not found. Please install Ollama first:"
    echo "   curl -fsSL https://ollama.ai/install.sh | sh"
    exit 1
fi

# Wait for Ollama service to be ready
echo "⏳ Waiting for Ollama service to start..."
max_attempts=30
attempt=1

while [ $attempt -le $max_attempts ]; do
    if curl -s $API_URL/api/tags > /dev/null 2>&1; then
        echo "✅ Ollama service is ready!"
        break
    fi
    echo -n "."
    sleep 2
    attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
    echo "❌ Ollama service failed to start after 60 seconds"
    exit 1
fi

# Check current models
echo "📋 Checking current models..."
$OLLAMA_CMD list

# Pull Mistral 7B model if not already available
echo "📥 Pulling Mistral 7B model (this may take a while)..."
if $OLLAMA_CMD list | grep -q "mistral:7b"; then
    echo "✅ Mistral 7B already available"
else
    echo "⬇️  Downloading Mistral 7B..."
    $OLLAMA_CMD pull mistral:7b
    
    if [ $? -eq 0 ]; then
        echo "✅ Mistral 7B downloaded successfully"
    else
        echo "❌ Failed to download Mistral 7B"
        exit 1
    fi
fi

# Test the model
echo "🧪 Testing Mistral 7B model..."
test_response=$($OLLAMA_CMD run mistral:7b "Hello, please respond with 'Test successful'" --verbose 2>/dev/null)

if echo "$test_response" | grep -q -i "test successful"; then
    echo "✅ Model test successful"
else
    echo "⚠️  Model test response: $test_response"
fi

# Show final status
echo "📊 Final model list:"
$OLLAMA_CMD list

# Performance tips
echo ""
echo "🎯 Performance Tips:"
echo "   • GPU: Make sure CUDA is available for better performance"
echo "   • Memory: Mistral 7B requires ~8GB RAM"
echo "   • For production: Consider using 'mistral:7b-instruct' for better instruction following"

# Test API endpoint
echo ""
echo "🌐 Testing API endpoint..."
if curl -s -X POST $API_URL/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"mistral:7b","prompt":"Say hello in Hebrew","stream":false}' | grep -q "response"; then
    echo "✅ API endpoint working correctly"
else
    echo "⚠️  API endpoint test failed"
fi

echo ""
echo "🎉 Ollama setup complete!"
echo "   • Model: Mistral 7B"
echo "   • API URL: $API_URL"
echo "   • Ready for Call Analytics processing"