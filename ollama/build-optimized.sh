#!/bin/bash

echo "🏗️ Building AWS-optimized Ollama image for ECR deployment..."

# Check if GGUF model file exists
if [ ! -f "models/dictalm2.0-instruct.Q4_K_M.gguf" ]; then
    echo "❌ Error: GGUF model file not found at models/dictalm2.0-instruct.Q4_K_M.gguf"
    echo "Please ensure the DictaLM model is downloaded first"
    exit 1
fi

echo "✅ GGUF model file found ($(du -h models/dictalm2.0-instruct.Q4_K_M.gguf | cut -f1))"

# Build the optimized image
echo "🔨 Building optimized Docker image..."
docker build -f Dockerfile.aws-optimized -t ollama-dictalm:aws-optimized .

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build completed successfully!"
    
    # Show image sizes for comparison
    echo ""
    echo "📊 Image size comparison:"
    
    # Original image size (if exists)
    if docker images ollama-dictalm:latest >/dev/null 2>&1; then
        ORIGINAL_SIZE=$(docker images ollama-dictalm:latest --format "{{.Size}}")
        echo "Original image: $ORIGINAL_SIZE"
    fi
    
    # Optimized image size
    OPTIMIZED_SIZE=$(docker images ollama-dictalm:aws-optimized --format "{{.Size}}")
    echo "Optimized image: $OPTIMIZED_SIZE"
    
    echo ""
    echo "🚀 Ready for AWS ECR push!"
    echo ""
    echo "Next steps:"
    echo "1. Test locally: docker run --rm -p 11434:11434 ollama-dictalm:aws-optimized"
    echo "2. Tag for ECR: docker tag ollama-dictalm:aws-optimized [ECR_REPO]:latest"
    echo "3. Push to ECR: docker push [ECR_REPO]:latest"
    
else
    echo "❌ Build failed! Check the error messages above."
    exit 1
fi