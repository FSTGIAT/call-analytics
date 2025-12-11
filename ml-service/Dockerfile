FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Hebrew language model for spaCy
RUN python -m spacy download en_core_web_sm

# Copy application files
COPY . .

# Pre-download ML models for offline deployment
RUN python download_models.py

# Create necessary directories
RUN mkdir -p /app/logs /app/models

# Expose port
EXPOSE 5000

# Run the application directly to ensure SQS consumer starts
CMD ["python", "app.py"]