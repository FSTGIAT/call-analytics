#!/bin/bash
# Custom entrypoint for OpenSearch with Hebrew support

set -e

echo "Starting OpenSearch with Hebrew language support..."

# Start OpenSearch in the background
/usr/share/opensearch/bin/opensearch-docker-entrypoint.sh opensearch &
OPENSEARCH_PID=$!

# Wait a bit for OpenSearch to start
sleep 30

# Initialize Hebrew templates
/usr/share/opensearch/bin/init-hebrew-templates.sh &

# Wait for OpenSearch to exit
wait $OPENSEARCH_PID