#!/bin/bash

echo "🔄 Migrating to AlephBERTGimmel Hebrew model..."

# Step 1: Delete existing Weaviate schema
echo "📦 Deleting existing Weaviate schema..."
curl -X DELETE http://localhost:8088/v1/schema/CallTranscription

# Step 2: Wait for schema deletion
sleep 2

# Step 3: The ML service will recreate the schema with new dimensions on first use
echo "✅ Schema deleted. The new schema will be created automatically with 768 dimensions."

# Step 4: Test the new model
echo "🧪 Testing Hebrew embedding generation..."
curl -X POST http://localhost:5000/embeddings/generate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "שלום עולם - בדיקת מודל AlephBERTGimmel",
    "preprocess": true
  }' | python3 -m json.tool

echo ""
echo "✅ Migration complete!"
echo ""
echo "⚠️  IMPORTANT: You need to re-index all your existing data with the new embeddings."
echo "    The vector dimensions have changed from 384 to 768."
echo ""
echo "📝 Next steps:"
echo "   1. Re-run your data ingestion scripts"
echo "   2. Or use the batch processing endpoint to re-embed existing texts"