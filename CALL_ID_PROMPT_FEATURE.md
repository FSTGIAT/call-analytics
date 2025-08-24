# Automatic Hebrew Call ID Prompt Generation Feature

## Overview
This feature automatically generates Hebrew prompts with call IDs for summarizing customer service calls. When a call is processed through the CDC → Kafka → ML pipeline, the system automatically creates prompts like: `"סכם את שיחה מספר 4959594949438224"`

## Key Components Modified

### 1. **Prompt Templates Configuration** (`config/prompt-templates.json`)
- Created comprehensive Hebrew and English prompt templates
- Key template: `"summarize_with_id": "סכם את שיחה מספר {callId}"`
- Includes system prompts, classification prompts, and sentiment analysis prompts

### 2. **ML Processing Consumer** (`api/src/services/consumers/ml-processing-consumer.service.ts`)
- Added `useCallIdPrompt: true` option (enabled by default)
- Added `promptTemplate: 'summarize_with_id'` to specify which template to use
- Ensures call ID is passed to ML service

### 3. **ML Service API** (`ml-service/app.py`)
- Updated `/api/analyze-conversation` endpoint to accept:
  - `call_id` parameter
  - `use_call_id_prompt` option
  - `prompt_template` specification
- Passes these parameters through to LLM orchestrator

### 4. **LLM Orchestrator** (`ml-service/src/services/llm_orchestrator.py`)
- Modified `summarize_call()` method to accept:
  - `call_id` parameter
  - `use_call_id_prompt` flag
  - `prompt_template` name
- Forwards all parameters to Ollama service

### 5. **Ollama Service** (`ml-service/src/services/ollama_service.py`)
- Loads prompt templates from configuration file
- Generates Hebrew prompts with call ID when enabled
- Modified prompt structure to include:
  ```
  סכם את שיחה מספר {callId}
  [conversation text]
  [structured JSON request in Hebrew]
  ```
- Ensures call ID is included in all responses
- Adds metadata about prompt usage

### 6. **Docker Compose** (`docker-compose.yml`)
- Added volume mount for `prompt-templates.json` to ML service
- Ensures templates are accessible in container

## How It Works

### 1. **CDC Captures Call**
```
Oracle DB → CDC Service → Kafka Topic (cdc-raw-changes)
```

### 2. **Conversation Assembly**
```
Kafka Consumer → Assemble messages → Include Call ID
```

### 3. **ML Processing with Auto-Prompt**
```javascript
// Consumer sends to ML service:
{
  "text": "[conversation]",
  "callId": "4959594949438224",
  "options": {
    "useCallIdPrompt": true,
    "promptTemplate": "summarize_with_id"
  }
}
```

### 4. **Hebrew Prompt Generation**
```python
# Ollama service generates:
template = "סכם את שיחה מספר {callId}"
prompt = template.format(callId="4959594949438224")
# Result: "סכם את שיחה מספר 4959594949438224"
```

### 5. **DictaLM Processing**
- Receives Hebrew prompt with call ID
- Processes conversation
- Returns structured summary including call ID

### 6. **Response Structure**
```json
{
  "success": true,
  "callId": "4959594949438224",
  "summary": {
    "callId": "4959594949438224",
    "summary": "הלקוח פנה לברר על חשבונו ושילם חוב של 250 שקלים",
    "classifications": ["תשלום חוב", "בירור מצב חשבון"],
    "sentiment": "חיובי",
    "key_points": [
      "בירור חוב של 250 שקלים",
      "תשלום מוצלח בכרטיס אשראי"
    ]
  },
  "metadata": {
    "used_call_id_prompt": true,
    "model": "dictalm2.0-instruct:Q4_K_M"
  }
}
```

## Configuration Options

### Enable/Disable Feature
```javascript
// In ML Processing Consumer
options: {
  useCallIdPrompt: true,  // Set to false to disable
  promptTemplate: 'summarize_with_id'  // Choose template
}
```

### Available Templates
- `summarize_with_id` - Basic summary with call ID
- `summarize_full` - Detailed summary with call ID
- `classify_call` - Classification-focused prompt
- `analyze_sentiment` - Sentiment analysis prompt
- `extract_action_items` - Action items extraction

## Testing

### Run Test Script
```bash
./test-call-id-prompt.sh
```

### Manual Test via API
```bash
curl -X POST http://localhost:5000/api/analyze-conversation \
  -H "Content-Type: application/json" \
  -d '{
    "text": "[Hebrew conversation text]",
    "callId": "4959594949438224",
    "options": {
      "useCallIdPrompt": true,
      "promptTemplate": "summarize_with_id"
    }
  }'
```

### Verify in Logs
```bash
# Check ML service logs
docker logs call-analytics-ml | grep "call_id"

# Check consumer logs
docker logs call-analytics-api | grep "ML Consumer"
```

## Benefits

1. **Consistency**: All summaries reference the specific call ID
2. **Traceability**: Easy to track which summary belongs to which call
3. **Hebrew Context**: Native Hebrew prompts for better DictaLM understanding
4. **Flexibility**: Multiple prompt templates for different use cases
5. **Automatic**: No manual prompt creation needed

## Future Enhancements

1. **Dynamic Templates**: Load templates from database
2. **Customer Context**: Include customer name/ID in prompt
3. **Historical Context**: Reference previous calls in prompt
4. **Multi-language**: Automatic language detection and template selection
5. **A/B Testing**: Compare different prompt strategies

## Troubleshooting

### Templates Not Loading
```bash
# Check if file is mounted
docker exec call-analytics-ml ls -la /app/config/prompt-templates.json

# Verify JSON syntax
docker exec call-analytics-ml python -c "import json; json.load(open('/app/config/prompt-templates.json'))"
```

### Call ID Not Appearing
- Ensure `callId` is passed from CDC through Kafka
- Check ML Processing Consumer logs for call ID
- Verify `useCallIdPrompt` is set to `true`

### Hebrew Encoding Issues
- Ensure all files are UTF-8 encoded
- Check Docker environment variables include UTF-8 locale
- Verify DictaLM model supports Hebrew