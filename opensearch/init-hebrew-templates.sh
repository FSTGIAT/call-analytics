#!/bin/bash
# Initialize Hebrew templates for OpenSearch

echo "Initializing Hebrew language templates for OpenSearch..."

# Wait for OpenSearch to start
until curl -s "http://localhost:9200" > /dev/null; do
    echo "Waiting for OpenSearch to start..."
    sleep 5
done

echo "OpenSearch is up, installing Hebrew templates..."

# Install the index templates from the configuration file
if [ -f "/usr/share/opensearch/config/index-templates.json" ]; then
    
    # Extract and install call_transcriptions_template
    echo "Installing call_transcriptions_template..."
    curl -X PUT "localhost:9200/_index_template/call_transcriptions_template" \
        -H 'Content-Type: application/json' \
        -d "$(jq '.call_transcriptions_template' /usr/share/opensearch/config/index-templates.json)" \
        || echo "Failed to install call_transcriptions_template"
    
    # Extract and install call_summaries_template
    echo "Installing call_summaries_template..."
    curl -X PUT "localhost:9200/_index_template/call_summaries_template" \
        -H 'Content-Type: application/json' \
        -d "$(jq '.call_summaries_template' /usr/share/opensearch/config/index-templates.json)" \
        || echo "Failed to install call_summaries_template"
    
    echo "Hebrew templates installation completed!"
else
    echo "Template file not found at /usr/share/opensearch/config/index-templates.json"
fi

# Create a test index to verify Hebrew analysis
echo "Testing Hebrew analyzer..."
curl -X PUT "localhost:9200/hebrew-test" \
    -H 'Content-Type: application/json' \
    -d '{
        "settings": {
            "analysis": {
                "analyzer": {
                    "hebrew_analyzer": {
                        "type": "custom",
                        "tokenizer": "standard",
                        "filter": ["lowercase", "hebrew_stop"]
                    }
                },
                "filter": {
                    "hebrew_stop": {
                        "type": "stop",
                        "stopwords": ["את", "על", "של", "אל", "מן"]
                    }
                }
            }
        },
        "mappings": {
            "properties": {
                "text": {
                    "type": "text",
                    "analyzer": "hebrew_analyzer"
                }
            }
        }
    }' || echo "Failed to create Hebrew test index"

# Test the Hebrew analyzer
curl -X POST "localhost:9200/hebrew-test/_doc" \
    -H 'Content-Type: application/json' \
    -d '{
        "text": "שלום, איך אתה היום? יש לי בעיה עם האינטרנט שלי."
    }' || echo "Failed to index Hebrew test document"

echo "Hebrew initialization completed successfully!"