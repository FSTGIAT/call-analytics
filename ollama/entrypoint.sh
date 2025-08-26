#!/bin/bash

# Start Ollama server in the background
ollama serve &

# Start process monitor in background (if scripts are available)
if [ -f "/scripts/monitor-processes.sh" ]; then
    echo "Starting process monitor..."
    chmod +x /scripts/monitor-processes.sh
    /scripts/monitor-processes.sh monitor &
    MONITOR_PID=$!
    echo "Process monitor started with PID: $MONITOR_PID"
else
    echo "Process monitor script not found, skipping..."
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