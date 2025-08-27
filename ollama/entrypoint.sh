#!/bin/bash

# Start Ollama server in the background
ollama serve &

# Setup robust stuck process cleanup with cron
echo "Setting up stuck process cleanup system..."
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
else
    echo "⚠️ Cleanup script not found at /models/cleanup-stuck-processes.sh"
fi

# Run comprehensive model setup
if [ -f "/models/setup-models.sh" ]; then
    echo "Running comprehensive Hebrew models setup..."
    bash /models/setup-models.sh
else
    echo "Setup script not found, running basic model setup..."
    
    # Basic fallback setup
    while ! curl -f http://localhost:11434/api/tags >/dev/null 2>&1; do
        echo "Waiting for Ollama server to start..."
        sleep 2
    done
    
    echo "Ollama server is ready"
    
    # Pull Llama 3.1 and create alias
    if ! ollama list | grep -q "llama3.1:8b"; then
        ollama pull llama3.1:8b || echo "Failed to pull base model"
    fi
    
    if ! ollama list | grep -q "dictalm2.0-instruct:Q4_K_M"; then
        ollama cp llama3.1:8b dictalm2.0-instruct:Q4_K_M || echo "Failed to create DictaLM alias"
    fi
    
    echo "Basic setup complete"
fi

# Keep the container running
wait