#!/bin/bash

# OpenSearch ECS Check Script
# This script checks OpenSearch running in ECS

echo "======================================"
echo "🔍 OPENSEARCH ECS DATA CHECK"
echo "======================================"
echo ""

# Get the OpenSearch task details
echo "📡 Finding OpenSearch service in ECS..."
OPENSEARCH_TASK=$(aws ecs list-tasks \
    --cluster Pelephone-CallAnalytics \
    --service-name callAnalytics-opensearch-service-ism80755 \
    --desired-status RUNNING \
    --query 'taskArns[0]' \
    --output text)

if [ -z "$OPENSEARCH_TASK" ]; then
    echo "❌ No running OpenSearch task found"
    exit 1
fi

echo "✅ Found OpenSearch task: ${OPENSEARCH_TASK##*/}"

# Get container IP
OPENSEARCH_IP=$(aws ecs describe-tasks \
    --cluster Pelephone-CallAnalytics \
    --tasks $OPENSEARCH_TASK \
    --query 'tasks[0].containers[?name==`opensearch`].networkInterfaces[0].privateIpv4Address' \
    --output text)

if [ -z "$OPENSEARCH_IP" ]; then
    echo "⚠️ Could not get OpenSearch IP, trying alternative method..."
    OPENSEARCH_IP=$(aws ecs describe-tasks \
        --cluster Pelephone-CallAnalytics \
        --tasks $OPENSEARCH_TASK \
        --query 'tasks[0].attachments[0].details[?name==`privateIPv4Address`].value' \
        --output text)
fi

if [ -z "$OPENSEARCH_IP" ]; then
    echo "❌ Could not determine OpenSearch IP address"
    echo ""
    echo "Try using ECS Exec to connect directly:"
    echo "aws ecs execute-command --cluster Pelephone-CallAnalytics --task $OPENSEARCH_TASK --container opensearch --interactive --command '/bin/bash'"
    exit 1
fi

echo "✅ OpenSearch IP: $OPENSEARCH_IP"
OPENSEARCH_URL="http://${OPENSEARCH_IP}:9200"
echo "📍 OpenSearch URL: $OPENSEARCH_URL"
echo ""

# Function to run curl command
run_opensearch_query() {
    local path=$1
    local method=${2:-GET}
    local data=$3

    if [ -n "$data" ]; then
        curl -s -X $method "${OPENSEARCH_URL}${path}" -H 'Content-Type: application/json' -d "$data" 2>/dev/null
    else
        curl -s -X $method "${OPENSEARCH_URL}${path}" 2>/dev/null
    fi
}

echo "======================================"
echo "1. CLUSTER HEALTH"
echo "======================================"
run_opensearch_query "/_cluster/health?pretty" | jq '.' || echo "❌ Failed to get cluster health"

echo ""
echo "======================================"
echo "2. INDEX LIST"
echo "======================================"
run_opensearch_query "/_cat/indices?v&s=index"

echo ""
echo "======================================"
echo "3. DOCUMENT COUNTS"
echo "======================================"
for index in "call-analytics-default-summaries" "call-summaries" "call-analytics-default-transcriptions"; do
    COUNT=$(run_opensearch_query "/${index}/_count" | jq '.count' 2>/dev/null)
    if [ -n "$COUNT" ] && [ "$COUNT" != "null" ]; then
        echo "✅ ${index}: $COUNT documents"
    else
        echo "⚠️ ${index}: Not found or empty"
    fi
done

echo ""
echo "======================================"
echo "4. RECENT SUMMARIES (Last 3)"
echo "======================================"
run_opensearch_query "/call-analytics-*/_search" POST '{
  "size": 3,
  "sort": [{"timestamp": {"order": "desc", "unmapped_type": "date"}}],
  "_source": ["callId", "summary", "sentiment", "classifications", "timestamp"],
  "query": {
    "exists": {
      "field": "summary"
    }
  }
}' | jq '.hits.hits[]._source | {
  callId: .callId,
  summary: (.summary | if type == "string" then (.[0:100] + "...") else . end),
  sentiment: .sentiment,
  timestamp: .timestamp
}' 2>/dev/null || echo "❌ No summaries found"

echo ""
echo "======================================"
echo "5. EMBEDDINGS STATUS"
echo "======================================"
EMBEDDING_COUNT=$(run_opensearch_query "/call-analytics-*/_count" POST '{
  "query": {
    "exists": {
      "field": "embedding"
    }
  }
}' | jq '.count' 2>/dev/null)

if [ -n "$EMBEDDING_COUNT" ] && [ "$EMBEDDING_COUNT" != "null" ] && [ "$EMBEDDING_COUNT" -gt 0 ]; then
    echo "✅ Found $EMBEDDING_COUNT documents with embeddings"

    # Show sample embedding
    echo ""
    echo "Sample embedding document:"
    run_opensearch_query "/call-analytics-*/_search" POST '{
      "size": 1,
      "query": {
        "exists": {
          "field": "embedding"
        }
      },
      "_source": ["callId", "embeddingModel", "embeddingUpdatedAt"]
    }' | jq '.hits.hits[0]._source' 2>/dev/null
else
    echo "⚠️ No embeddings found yet"
fi

echo ""
echo "======================================"
echo "6. INDEX MAPPING CHECK"
echo "======================================"
echo "Checking for embedding field in mapping..."
MAPPING=$(run_opensearch_query "/call-analytics-default-summaries/_mapping" | jq '.["call-analytics-default-summaries"].mappings.properties.embedding.type' 2>/dev/null)

if [ "$MAPPING" == '"knn_vector"' ]; then
    echo "✅ Embedding field configured as knn_vector (ready for similarity search)"
    DIMENSION=$(run_opensearch_query "/call-analytics-default-summaries/_mapping" | jq '.["call-analytics-default-summaries"].mappings.properties.embedding.dimension' 2>/dev/null)
    echo "   Dimensions: $DIMENSION"
else
    echo "⚠️ Embedding field not configured for vector search"
fi

echo ""
echo "======================================"
echo "7. HEBREW ANALYZER TEST"
echo "======================================"
run_opensearch_query "/_analyze" POST '{
  "analyzer": "standard",
  "text": "שלום, איך אתה היום?"
}' | jq '.tokens[].token' 2>/dev/null | head -5

echo ""
echo "======================================"
echo "📊 USEFUL COMMANDS"
echo "======================================"
echo ""
echo "# Connect to OpenSearch container:"
echo "aws ecs execute-command --cluster Pelephone-CallAnalytics \\"
echo "  --task $OPENSEARCH_TASK \\"
echo "  --container opensearch --interactive --command '/bin/bash'"
echo ""
echo "# Port forward to local machine:"
echo "ssh -L 9200:${OPENSEARCH_IP}:9200 ec2-user@bastion-host"
echo ""
echo "# Check logs:"
echo "aws logs tail /ecs/callAnalytics-opensearch --follow"
echo ""
echo "# Direct query from within VPC:"
echo "curl -X GET '${OPENSEARCH_URL}/_cat/health?v'"
echo ""
echo "======================================"
echo "✅ SCRIPT COMPLETE"
echo "======================================"