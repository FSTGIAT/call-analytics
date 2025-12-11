#!/usr/bin/env python3
"""Verify all pre-loaded models are available offline."""

import os
import sys
from sentence_transformers import SentenceTransformer

def verify_models():
    """Verify Hebrew AlephBERT model is available offline."""
    try:
        print("🔍 Verifying pre-loaded Hebrew AlephBERT model...")
        
        # Test offline mode
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['TRANSFORMERS_OFFLINE'] = '1'
        
        # Load model from cache (should work offline)
        model = SentenceTransformer(
            'imvladikon/sentence-transformers-alephbert',
            cache_folder='/app/cache/huggingface'
        )
        
        # Test Hebrew embedding generation
        test_text = 'שלום עולם - בדיקת מודל עברית'
        embedding = model.encode([test_text])
        
        print(f"✅ Hebrew model verified - embedding dimension: {len(embedding[0])}")
        print("✅ All models ready for AWS private deployment!")
        return True
        
    except Exception as e:
        print(f"❌ Model verification failed: {e}")
        return False

if __name__ == "__main__":
    success = verify_models()
    sys.exit(0 if success else 1)