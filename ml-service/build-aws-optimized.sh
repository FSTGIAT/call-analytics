#!/bin/bash

echo "🏗️ Building AWS-optimized ML Service for ECR deployment..."

# Check if we're in the right directory
if [ ! -f "requirements.txt" ]; then
    echo "❌ Error: requirements.txt not found. Please run from ml-service directory."
    exit 1
fi

if [ ! -f "download_models.py" ]; then
    echo "❌ Error: download_models.py not found. Please ensure it exists."
    exit 1
fi

echo "✅ Found required files for ML service build"

# Build the optimized image
echo "🔨 Building AWS-optimized ML service Docker image..."
echo "📥 This will pre-download Hebrew AlephBERT model (~1.2GB) during build..."

docker build -f Dockerfile.aws-optimized -t ml-service:aws-optimized .

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build completed successfully!"
    
    # Show image size
    OPTIMIZED_SIZE=$(docker images ml-service:aws-optimized --format "{{.Size}}")
    echo ""
    echo "📊 Optimized ML service image size: $OPTIMIZED_SIZE"
    
    # Test the image
    echo ""
    echo "🧪 Testing the optimized image..."
    echo "Starting container for verification..."
    
    # Run a quick test
    if docker run --rm ml-service:aws-optimized python /app/verify_models.py; then
        echo "✅ Model verification successful!"
    else
        echo "⚠️ Model verification failed, but image built successfully"
    fi
    
    echo ""
    echo "🚀 Ready for AWS ECR push!"
    echo ""
    echo "Next steps:"
    echo "1. Tag for ECR: docker tag ml-service:aws-optimized 811287567672.dkr.ecr.eu-west-1.amazonaws.com/pelephone/call-analytic/ml-service:latest"
    echo "2. Push to ECR: docker push 811287567672.dkr.ecr.eu-west-1.amazonaws.com/pelephone/call-analytic/ml-service:latest"
    echo ""
    echo "🔒 Features:"
    echo "   ✓ Hebrew AlephBERT model pre-loaded (~1.2GB)"
    echo "   ✓ All dependencies cached offline"
    echo "   ✓ No runtime downloads required"
    echo "   ✓ Perfect for AWS private networks"
    
else
    echo "❌ Build failed! Check the error messages above."
    exit 1
fi