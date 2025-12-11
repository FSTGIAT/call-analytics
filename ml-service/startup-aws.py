#!/usr/bin/env python3
import os
import sys

# Enable offline mode for runtime
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

print("🚀 Starting AWS-optimized ML service in offline mode...")

try:
    # Import and start Flask app
    from app import app
    app.run(host='0.0.0.0', port=5000, debug=False)
except Exception as e:
    print(f"❌ Failed to start ML service: {e}")
    sys.exit(1)