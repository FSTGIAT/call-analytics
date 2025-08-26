FROM ollama/ollama:latest

# Install required tools for HuggingFace integration and model management
USER root
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install huggingface-hub for automated model downloads
RUN pip3 install --break-system-packages huggingface-hub

# Create directories for models and scripts
RUN mkdir -p /root/.ollama/models /models /scripts

# Copy initialization scripts from optimized project
COPY init-models.sh /scripts/init-models.sh
COPY Modelfile.dictalm /scripts/Modelfile.dictalm  
COPY download-dictalm.py /scripts/download-dictalm.py
COPY entrypoint.sh /entrypoint.sh

# Make scripts executable
RUN chmod +x /scripts/init-models.sh /entrypoint.sh

# Download DictaLM model at build time for faster startup
RUN python3 /scripts/download-dictalm.py || echo "Model download will be attempted at runtime"

EXPOSE 11434

# Enhanced startup period for model loading
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD ollama list || exit 1

ENTRYPOINT ["/entrypoint.sh"]