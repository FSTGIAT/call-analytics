#!/usr/bin/env python3
"""
Download DictaLM 2.0 GGUF model from HuggingFace
Optimized for Hebrew Call Analytics AI Platform
"""
import os
import sys
from pathlib import Path

try:
    from huggingface_hub import hf_hub_download
except ImportError:
    print("huggingface-hub not installed. Model will be downloaded at runtime.")
    sys.exit(1)

def download_dictalm_model():
    """Download DictaLM 2.0 GGUF model with multiple fallback options"""
    
    model_dir = Path("/root/.ollama/models")
    model_dir.mkdir(parents=True, exist_ok=True)
    
    # Model repository and filename options (in priority order)
    repos_to_try = [
        ("dicta-il/dictalm2.0-instruct-GGUF", "dictalm2.0-instruct.Q4_K_M.gguf"),
        ("dicta-il/dictalm2.0-instruct", "dictalm2.0-instruct-q4_k_m.gguf"),
        ("dicta-il/dictalm2.0", "dictalm2.0-q4_k_m.gguf"),
        # Add more alternatives if available
    ]
    
    target_filename = "dictalm2.0-instruct.Q4_K_M.gguf"
    target_path = model_dir / target_filename
    
    # Check if model already exists
    if target_path.exists():
        file_size = target_path.stat().st_size
        print(f"Model already exists at {target_path} (size: {file_size / (1024**3):.2f}GB)")
        return True
    
    # Try each repository in order
    for repo, filename in repos_to_try:
        try:
            print(f"Attempting to download {filename} from {repo}...")
            
            # Download the model with progress tracking
            downloaded_path = hf_hub_download(
                repo_id=repo,
                filename=filename,
                local_dir=str(model_dir),
                local_dir_use_symlinks=False,
                token=os.getenv('HF_TOKEN')  # Use token if available
            )
            
            print(f"Successfully downloaded to {downloaded_path}")
            
            # Rename to expected filename if different
            final_path = model_dir / target_filename
            if Path(downloaded_path).name != target_filename and not final_path.exists():
                Path(downloaded_path).rename(final_path)
                print(f"Renamed to {final_path}")
            
            # Verify file size (DictaLM should be around 2.6GB)
            file_size = final_path.stat().st_size
            size_gb = file_size / (1024**3)
            print(f"Model size: {size_gb:.2f}GB")
            
            if size_gb < 1.0:
                print("WARNING: Model file seems too small, might be incomplete")
                return False
                
            return True
            
        except Exception as e:
            print(f"Failed to download from {repo}: {e}")
            continue
    
    # If all attempts failed, provide helpful information
    print("All download attempts failed.")
    print("You can manually download the model from:")
    for repo, _ in repos_to_try:
        print(f"  https://huggingface.co/{repo}")
    print(f"And place it in: {model_dir}")
    print("Note: You may need a HuggingFace token for some models")
    return False

def verify_model():
    """Verify the downloaded model file"""
    model_dir = Path("/root/.ollama/models")
    target_filename = "dictalm2.0-instruct.Q4_K_M.gguf"
    target_path = model_dir / target_filename
    
    if not target_path.exists():
        return False
        
    # Check file size and basic integrity
    file_size = target_path.stat().st_size
    size_gb = file_size / (1024**3)
    
    print(f"Model verification:")
    print(f"  Path: {target_path}")
    print(f"  Size: {size_gb:.2f}GB")
    print(f"  Exists: {target_path.exists()}")
    
    # Basic integrity check - GGUF files should start with specific magic bytes
    try:
        with open(target_path, 'rb') as f:
            magic = f.read(4)
            if magic == b'GGUF':
                print("  Format: Valid GGUF file")
                return True
            else:
                print("  Format: Invalid GGUF file (wrong magic bytes)")
                return False
    except Exception as e:
        print(f"  Error reading file: {e}")
        return False

if __name__ == "__main__":
    print("Starting DictaLM 2.0 model download...")
    
    # Check for HuggingFace token
    hf_token = os.getenv('HF_TOKEN')
    if hf_token:
        print("Using HuggingFace token for authentication")
    else:
        print("No HuggingFace token found - some models may not be accessible")
    
    # Download the model
    success = download_dictalm_model()
    
    if success:
        # Verify the download
        if verify_model():
            print("✅ DictaLM 2.0 model successfully downloaded and verified!")
            sys.exit(0)
        else:
            print("❌ Model verification failed")
            sys.exit(1)
    else:
        print("❌ Model download failed")
        sys.exit(1)