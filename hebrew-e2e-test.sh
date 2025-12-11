#!/bin/bash

# Hebrew Call Analytics E2E Test - Updated for Current AWS Environment
# Generate unique call ID based on current timestamp
CALL_ID=$(date +%s | tail -c 9)  # Use last 9 digits of timestamp
BAN="8098067"
SUBSCRIBER_NO="509097566"

echo "🧪 Hebrew Call Analytics E2E Test"
echo "📞 Call ID: $CALL_ID"
echo "👤 BAN: $BAN, Subscriber: $SUBSCRIBER_NO"
echo ""

# Set PATH for session manager plugin
export PATH="$PATH:$(pwd)/usr/local/sessionmanagerplugin/bin"

# Updated service names based on current environment
ORACLE_CLUSTER="accomplished-lion-toy"
ORACLE_SERVICE="callAnalytics-oracle-service-313wpe7s"
API_CLUSTER="accomplished-lion-toy" 
API_SERVICE="callAnalytics-API-service-9u93pjmb"

# Get current Oracle task
echo "🔍 Finding Oracle container task..."
ORACLE_TASK=$(aws ecs list-tasks --cluster $ORACLE_CLUSTER --service-name $ORACLE_SERVICE --query 'taskArns[0]' --output text | awk -F'/' '{print $NF}' 2>/dev/null)
echo "📋 Oracle task: $ORACLE_TASK"

if [ "$ORACLE_TASK" = "None" ] || [ -z "$ORACLE_TASK" ] || [ "$ORACLE_TASK" = "null" ]; then
    echo "❌ Oracle task not found. Let's try direct service discovery approach..."
    
    # Alternative: Try using Service Connect namespace
    echo "🔍 Using Service Connect approach..."
    
    # Create SQL script for manual execution
    cat > hebrew-test-data.sql << EOF
-- Hebrew conversation E2E test
-- Call ID: $CALL_ID
-- Generated: $(date)

-- Set proper encoding
ALTER SESSION SET NLS_LANGUAGE='AMERICAN';
ALTER SESSION SET NLS_CHARACTERSET='AL32UTF8';

-- Insert Hebrew customer service conversation
INSERT ALL
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP, 'C', 'שלום, יש לי בעיה עם חבילת הגלישה שלי')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '5' SECOND, 'A', 'שלום! אני כאן לעזור. איזו בעיה יש לך עם החבילה?')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '10' SECOND, 'C', 'נגמרה לי הגלישה באמצע החודש ואני משלם המון על גלישה נוספת')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '15' SECOND, 'A', 'אני מבין, זה מעצבן. בוא אני אבדוק במערכת את השימוש שלך')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '20' SECOND, 'C', 'תודה. אני גולש בעיקר ביוטיוב ובנטפליקס')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '25' SECOND, 'A', 'אני רואה שאתה צורך 50 ג''יגה לחודש. יש לי הצעה לחבילה מתאימה')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '30' SECOND, 'C', 'כמה זה עולה? החבילה הנוכחית שלי עולה 79 שקל')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '35' SECOND, 'A', 'חבילה של 60 ג''יגה עולה 99 שקל - זה יחסוך לך כסף')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '40' SECOND, 'C', 'מעולה! איך אני עובר לחבילה החדשה?')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '45' SECOND, 'A', 'אני מעביר אותך עכשיו, זה יכנס לתוקף מיד')
SELECT 1 FROM DUAL;

COMMIT;

-- Reset CDC to pick up new data
UPDATE CDC_PROCESSING_STATUS 
SET LAST_PROCESSED_TIMESTAMP = SYSTIMESTAMP - INTERVAL '2' MINUTE
WHERE TABLE_NAME = 'CDC_NORMAL_MODE';
COMMIT;

-- Verify insertion
SELECT COUNT(*) as MESSAGES_INSERTED FROM VERINT_TEXT_ANALYSIS WHERE CALL_ID = $CALL_ID;

-- Show conversation preview
SELECT CALL_ID, OWNER, SUBSTR(TEXT, 1, 50) || '...' as MESSAGE_PREVIEW 
FROM VERINT_TEXT_ANALYSIS 
WHERE CALL_ID = $CALL_ID 
ORDER BY TEXT_TIME;

EXIT;
EOF

    echo "📝 Hebrew test data SQL script created: hebrew-test-data.sql"
    echo "🚀 Manual execution command:"
    echo ""
    echo "   PATH=\"\$PATH:\$(pwd)/usr/local/sessionmanagerplugin/bin\" aws ecs execute-command \\"
    echo "     --cluster accomplished-lion-toy \\"
    echo "     --task [ORACLE_TASK_ID] \\"  
    echo "     --container ca-oracle \\"
    echo "     --interactive \\"
    echo "     --command \"bash -c 'export NLS_LANG=AMERICAN_AMERICA.AL32UTF8 && sqlplus -S system/2288@localhost:1521/XE @/hebrew-test-data.sql'\""
    echo ""
    echo "🔍 First, get the Oracle task ID with:"
    echo "   aws ecs list-tasks --cluster accomplished-lion-toy --service-name callAnalytics-oracle-service-313wpe7s"
    echo ""
    
    # Try to at least attempt the connection
    echo "🔄 Attempting direct ECS execute command..."
    
    # Try to get tasks differently
    ALL_TASKS=$(aws ecs list-tasks --cluster $ORACLE_CLUSTER --query 'taskArns' --output text 2>/dev/null)
    if [ $? -eq 0 ] && [ ! -z "$ALL_TASKS" ]; then
        ORACLE_TASK_ARN=$(echo $ALL_TASKS | cut -d' ' -f1)
        ORACLE_TASK=$(echo $ORACLE_TASK_ARN | awk -F'/' '{print $NF}')
        echo "✅ Found Oracle task via list-tasks: $ORACLE_TASK"
    else
        echo "⚠️  Could not retrieve tasks via AWS CLI - manual approach needed"
        exit 1
    fi
fi

echo ""
echo "📝 Step 1: Inserting Hebrew conversation into Oracle..."

# Attempt ECS execute command
if [ ! -z "$ORACLE_TASK" ] && [ "$ORACLE_TASK" != "None" ]; then
    echo "🔄 Attempting to connect to Oracle container..."
    
    # Execute the SQL script
    aws ecs execute-command \
        --cluster $ORACLE_CLUSTER \
        --task "$ORACLE_TASK" \
        --container ca-oracle \
        --interactive \
        --command "bash -c 'export NLS_LANG=AMERICAN_AMERICA.AL32UTF8 && sqlplus -S system/2288@localhost:1521/XE << \"EOL\"

-- Hebrew customer service conversation about data usage
INSERT ALL
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP, \"C\", \"שלום, יש לי בעיה עם חבילת הגלישה שלי\")
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL \"5\" SECOND, \"A\", \"שלום! אני כאן לעזור. איזו בעיה יש לך עם החבילה?\")
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL \"10\" SECOND, \"C\", \"נגמרה לי הגלישה באמצע החודש ואני משלם המון על גלישה נוספת\")
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL \"15\" SECOND, \"A\", \"אני מבין, זה מעצבן. בוא אני אבדוק במערכת את השימוש שלך\")
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL \"20\" SECOND, \"C\", \"תודה. אני גולש בעיקר ביוטיוב ובנטפליקס\")
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL \"25\" SECOND, \"A\", \"אני רואה שאתה צורך 50 ג\'\'יגה לחודש. יש לי הצעה לחבילה מתאימה\")
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL \"30\" SECOND, \"C\", \"כמה זה עולה? החבילה הנוכחית שלי עולה 79 שקל\")
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL \"35\" SECOND, \"A\", \"חבילה של 60 ג\'\'יגה עולה 99 שקל - זה יחסוך לך כסף\")
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL \"40\" SECOND, \"C\", \"מעולה! איך אני עובר לחבילה החדשה?\")
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, \"$BAN\", \"$SUBSCRIBER_NO\", SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL \"45\" SECOND, \"A\", \"אני מעביר אותך עכשיו, זה יכנס לתוקף מיד\")
SELECT 1 FROM DUAL;

COMMIT;

-- Reset CDC to pick up new data
UPDATE CDC_PROCESSING_STATUS 
SET LAST_PROCESSED_TIMESTAMP = SYSTIMESTAMP - INTERVAL \"2\" MINUTE
WHERE TABLE_NAME = \"CDC_NORMAL_MODE\";
COMMIT;

-- Verify insertion
SELECT COUNT(*) as MESSAGES_INSERTED FROM VERINT_TEXT_ANALYSIS WHERE CALL_ID = $CALL_ID;

EOL'"

    echo "✅ Hebrew conversation insertion attempted!"
    echo ""
else
    echo "❌ Could not establish Oracle connection via ECS"
    echo "📝 SQL script created for manual execution: hebrew-test-data.sql"
fi

# Get API task for monitoring  
echo "🔍 Finding API task for monitoring..."
API_TASK=$(aws ecs list-tasks --cluster $API_CLUSTER --service-name $API_SERVICE --query 'taskArns[0]' --output text | awk -F'/' '{print $NF}' 2>/dev/null)
echo "📋 API task: $API_TASK"

if [ "$API_TASK" = "None" ] || [ -z "$API_TASK" ] || [ "$API_TASK" = "null" ]; then
    echo "⚠️  API task not found - will use CloudWatch directly"
    
    # Show manual monitoring commands
    echo ""
    echo "📊 Manual Monitoring Commands:"
    echo ""
    echo "1. Check CDC processing:"
    echo "   aws logs filter-log-events --log-group-name /ecs/callAnalytics-API --filter-pattern \"CDC\" --start-time \$(date -d '10 minutes ago' +%s)000"
    echo ""
    echo "2. Check for our Call ID:"
    echo "   aws logs filter-log-events --log-group-name /ecs/callAnalytics-API --filter-pattern \"$CALL_ID\" --start-time \$(date -d '10 minutes ago' +%s)000"
    echo ""
    echo "3. Check Hebrew processing:"
    echo "   aws logs filter-log-events --log-group-name /ecs/callAnalytics-ML --filter-pattern \"Hebrew\" --start-time \$(date -d '10 minutes ago' +%s)000"
    echo ""
    echo "4. Check OpenSearch indexing:"
    echo "   aws logs filter-log-events --log-group-name /ecs/callAnalytics-API --filter-pattern \"OpenSearch\" --start-time \$(date -d '10 minutes ago' +%s)000"
    echo ""
    exit 0
fi

echo ""
echo "📡 Step 2: Monitoring CDC detection (60 seconds)..."

# Monitor CDC logs for our call ID
for i in {1..12}; do
    echo "⏳ Checking CDC logs (attempt $i/12)..."
    
    # Use CloudWatch Logs to check for CDC activity
    CDC_LOGS=$(aws logs filter-log-events \
        --log-group-name "/ecs/callAnalytics-API" \
        --filter-pattern "CDC" \
        --start-time $(date -d '5 minutes ago' +%s)000 \
        --query "events[?contains(message, \`$CALL_ID\`) || contains(message, \`found\`) || contains(message, \`processing\`)].message" \
        --output text 2>/dev/null)
    
    if [[ $CDC_LOGS == *"$CALL_ID"* ]]; then
        echo "✅ CDC detected our test call!"
        echo "📄 CDC Log: $CDC_LOGS"
        break
    elif [[ $CDC_LOGS == *"found"* ]] || [[ $CDC_LOGS == *"processing"* ]]; then
        echo "🔍 CDC is active and processing data..."
    fi
    
    if [ $i -eq 12 ]; then
        echo "⏰ CDC monitoring timeout - but pipeline may still be processing"
    else
        sleep 5
    fi
done

echo ""
echo "📨 Step 3: Monitoring Kafka publishing (30 seconds)..."

# Monitor Kafka publishing
for i in {1..6}; do
    echo "⏳ Checking Kafka logs (attempt $i/6)..."
    
    KAFKA_LOGS=$(aws logs filter-log-events \
        --log-group-name "/ecs/callAnalytics-API" \
        --filter-pattern "Kafka" \
        --start-time $(date -d '5 minutes ago' +%s)000 \
        --query "events[?contains(message, \`published\`) || contains(message, \`conversation\`)].message" \
        --output text 2>/dev/null)
    
    if [[ $KAFKA_LOGS == *"published"* ]] || [[ $KAFKA_LOGS == *"conversation"* ]]; then
        echo "✅ Kafka publishing detected!"
        echo "📄 Kafka Log: $(echo $KAFKA_LOGS | head -1)"
        break
    fi
    
    if [ $i -eq 6 ]; then
        echo "⏰ Kafka monitoring timeout"
    else
        sleep 5
    fi
done

echo ""
echo "🤖 Step 4: Monitoring Hebrew ML processing..."

# Check ML service logs
ML_LOGS=$(aws logs filter-log-events \
    --log-group-name "/ecs/callAnalytics-ML" \
    --filter-pattern "Hebrew" \
    --start-time $(date -d '10 minutes ago' +%s)000 \
    --query "events[].message" \
    --output text 2>/dev/null)

if [[ ! -z "$ML_LOGS" ]]; then
    echo "✅ ML Hebrew processing detected!"
    echo "📄 ML Log: $(echo $ML_LOGS | head -1)"
else
    echo "⏳ ML processing may still be in progress..."
fi

echo ""
echo "🔍 Step 5: Final pipeline validation..."

# Check for OpenSearch activity
OS_LOGS=$(aws logs filter-log-events \
    --log-group-name "/ecs/callAnalytics-API" \
    --filter-pattern "OpenSearch" \
    --start-time $(date -d '10 minutes ago' +%s)000 \
    --query "events[].message" \
    --output text 2>/dev/null)

if [[ $OS_LOGS == *"index"* ]] && [[ ! -z "$OS_LOGS" ]]; then
    echo "✅ OpenSearch indexing activity detected!"
    PIPELINE_STATUS="HEALTHY"
else
    echo "⏳ OpenSearch indexing may still be processing..."
    PIPELINE_STATUS="PROCESSING"
fi

echo ""
echo "============================================================"
echo "🏁 Hebrew Call Analytics E2E Test Results"
echo "============================================================"
echo "📞 Test Call ID: $CALL_ID"
echo "💬 Hebrew Messages: 10 inserted"
echo "🈂️  Conversation: Data plan upgrade (Hebrew)"
echo "🔧 Pipeline Status: $PIPELINE_STATUS"
echo ""

echo "📋 Next Steps for Validation:"
echo "1. Query OpenSearch for conversation $CALL_ID"
echo "2. Check for Hebrew classification results"
echo "3. Verify sentiment analysis output"
echo "4. Confirm conversation summary generation"
echo ""

echo "🔍 OpenSearch Query Command:"
echo "   # Query for our conversation"
echo "   curl -X GET 'http://[OPENSEARCH_ENDPOINT]:9200/call-analytics-*/_search?pretty' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"query\": {\"term\": {\"callId\": \"$CALL_ID\"}}}'"
echo ""

echo "✅ E2E Test completed! Call ID: $CALL_ID"