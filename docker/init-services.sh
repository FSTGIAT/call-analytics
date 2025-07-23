#!/bin/bash

echo "Initializing Call Analytics AI Platform services..."

# Create necessary directories
mkdir -p ../data/{cache,graph,oracle,vector,opensearch,ollama,models}
mkdir -p ../logs/{api,ml,frontend}

# Set permissions
chmod -R 777 ../data/opensearch
chmod -R 777 ../logs

# Initialize OpenSearch with Hebrew analyzer
echo "Configuring OpenSearch for Hebrew text analysis..."
cat > ../data/opensearch-init.json << EOF
{
  "settings": {
    "analysis": {
      "analyzer": {
        "hebrew_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "hebrew_stop", "hebrew_stemmer"]
        }
      },
      "filter": {
        "hebrew_stop": {
          "type": "stop",
          "stopwords": "_hebrew_"
        },
        "hebrew_stemmer": {
          "type": "stemmer",
          "language": "hebrew"
        }
      }
    }
  }
}
EOF

echo "Services initialization complete!"