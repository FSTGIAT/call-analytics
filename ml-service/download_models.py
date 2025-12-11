#!/usr/bin/env python3
"""
Pre-download ML models for private network deployment.
This script downloads and caches all required models during Docker build.
"""

from sentence_transformers import SentenceTransformer
import os
import torch


def main():
    print("🚀 Pre-downloading all models for private network deployment...")
    
    # Set comprehensive cache directories
    cache_dirs = [
        '/app/cache/huggingface',
        '/app/cache/huggingface/transformers', 
        '/app/cache/huggingface/datasets',
        '/app/cache/huggingface/hub'
    ]
    
    for cache_dir in cache_dirs:
        os.makedirs(cache_dir, exist_ok=True)
        print(f"✅ Created cache directory: {cache_dir}")
    
    # Configure HuggingFace cache environment
    os.environ['HF_HOME'] = '/app/cache/huggingface'
    os.environ['TRANSFORMERS_CACHE'] = '/app/cache/huggingface/transformers'
    os.environ['HF_DATASETS_CACHE'] = '/app/cache/huggingface/datasets'
    os.environ['HF_HUB_CACHE'] = '/app/cache/huggingface/hub'
    
    # 1. Primary Hebrew Embedding Model (AlephBERT)
    print("📥 Downloading Hebrew AlephBERT model...")
    hebrew_model = SentenceTransformer(
        'imvladikon/sentence-transformers-alephbert', 
        cache_folder='/app/cache/huggingface'
    )
    print("✅ Hebrew AlephBERT model cached successfully")
    
    # 2. Test model loading with dummy text (both Hebrew and English)
    print("🧪 Testing model with Hebrew and English text...")
    test_texts = [
        'שלום עולם',  # Hebrew: Hello world
        'Hello world',  # English
        'בדיקה של מודל עברית',  # Hebrew: Testing Hebrew model
        'Testing embedding generation'  # English
    ]
    
    try:
        embeddings = hebrew_model.encode(test_texts)
        print(f"✅ Model test successful - generated {len(embeddings)} embeddings of dimension {len(embeddings[0])}")
    except Exception as e:
        print(f"❌ Model test failed: {e}")
        raise
    
    # 3. Pre-download tokenizer and all dependencies
    print("📥 Ensuring all tokenizer dependencies are cached...")
    try:
        # Force download of all tokenizer files
        tokenizer = hebrew_model.tokenizer
        if hasattr(tokenizer, 'save_pretrained'):
            tokenizer.save_pretrained('/app/cache/huggingface/tokenizer')
            print("✅ Tokenizer files cached")
        else:
            print("ℹ️ Tokenizer caching not available for this model type")
    except Exception as e:
        print(f"⚠️ Tokenizer caching warning (may not be critical): {e}")
    
    # 4. Check PyTorch and device availability
    print("🔍 Checking PyTorch and CUDA availability...")
    print(f"PyTorch version: {torch.__version__}")
    print(f"CUDA available: {torch.cuda.is_available()}")
    
    if torch.cuda.is_available():
        print(f"CUDA device count: {torch.cuda.device_count()}")
        try:
            print(f"Current CUDA device: {torch.cuda.current_device()}")
        except:
            print("CUDA device info not available (expected in build environment)")
    else:
        print("Running on CPU - will switch to GPU when deployed to ECS")
    
    print("✅ All ML models and dependencies successfully pre-cached for offline deployment!")
    print("🔒 Private network deployment ready - no runtime downloads required")


if __name__ == "__main__":
    main()