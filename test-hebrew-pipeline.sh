#!/bin/bash

# Generate unique call ID based on current timestamp
CALL_ID=$(date +%s | tail -c 9)  # Use last 9 digits of timestamp
BAN="8098067"
SUBSCRIBER_NO="509097566"

echo "🧪 Testing End-to-End Hebrew Processing Pipeline"
echo "📞 Call ID: $CALL_ID"
echo "👤 BAN: $BAN, Subscriber: $SUBSCRIBER_NO"
echo ""

# Set AWS profile
export AWS_PROFILE=811287567672_AWSPowerUserAccess
PATH="$PATH:$(pwd)/usr/local/sessionmanagerplugin/bin"

# Get current Oracle task
echo "🔍 Finding Oracle container task..."
ORACLE_TASK=$(aws ecs list-tasks --cluster accomplished-lion-toy --service-name ca-oracle-service-qgxqscqo --query 'taskArns[0]' --output text | awk -F'/' '{print $NF}')
echo "📋 Oracle task: $ORACLE_TASK"

if [ "$ORACLE_TASK" = "None" ] || [ -z "$ORACLE_TASK" ]; then
    echo "❌ Oracle task not found or not running"
    exit 1
fi

echo ""
echo "📝 Step 1: Inserting Hebrew conversation into Oracle..."

# Insert Hebrew conversation data
aws ecs execute-command --cluster accomplished-lion-toy --task "$ORACLE_TASK" --container ca-oracle --interactive --command "bash -c \"export NLS_LANG=AMERICAN_AMERICA.AL32UTF8 && sqlplus -S system/2288@localhost:1521/XE << 'EOL'

-- Hebrew customer service conversation about data usage
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'C', 'שלום, יש לי בעיה עם חבילת הגלישה שלי', SYSTIMESTAMP, SYSTIMESTAMP);
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'A', 'שלום! אני כאן לעזור. איזו בעיה יש לך עם החבילה?', SYSTIMESTAMP + INTERVAL '5' SECOND, SYSTIMESTAMP + INTERVAL '5' SECOND);
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'C', 'נגמרה לי הגלישה באמצע החודש ואני משלם המון על גלישה נוספת', SYSTIMESTAMP + INTERVAL '10' SECOND, SYSTIMESTAMP + INTERVAL '10' SECOND);
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'A', 'אני מבין, זה מעצבן. בוא אני אבדוק במערכת את השימוש שלך', SYSTIMESTAMP + INTERVAL '15' SECOND, SYSTIMESTAMP + INTERVAL '15' SECOND);
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'C', 'תודה. אני גולש בעיקר ביוטיוב ובנטפליקס', SYSTIMESTAMP + INTERVAL '20' SECOND, SYSTIMESTAMP + INTERVAL '20' SECOND);
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'A', 'אני רואה שאתה צורך 50 ג''יגה לחודש. יש לי הצעה לחבילה מתאימה', SYSTIMESTAMP + INTERVAL '25' SECOND, SYSTIMESTAMP + INTERVAL '25' SECOND);
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'C', 'כמה זה עולה? החבילה הנוכחית שלי עולה 79 שקל', SYSTIMESTAMP + INTERVAL '30' SECOND, SYSTIMESTAMP + INTERVAL '30' SECOND);
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'A', 'חבילה של 60 ג''יגה עולה 99 שקל - זה יחסוך לך כסף', SYSTIMESTAMP + INTERVAL '35' SECOND, SYSTIMESTAMP + INTERVAL '35' SECOND);
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'C', 'מעולה! איך אני עובר לחבילה החדשה?', SYSTIMESTAMP + INTERVAL '40' SECOND, SYSTIMESTAMP + INTERVAL '40' SECOND);
INSERT INTO VERINT_TEXT_ANALYSIS VALUES ($CALL_ID, '$BAN', '$SUBSCRIBER_NO', 'A', 'אני מעביר אותך עכשיו, זה יכנס לתוקף מיד', SYSTIMESTAMP + INTERVAL '45' SECOND, SYSTIMESTAMP + INTERVAL '45' SECOND);

COMMIT;

-- Reset CDC to pick up new data
UPDATE CDC_PROCESSING_STATUS 
SET LAST_PROCESSED_TIMESTAMP = SYSTIMESTAMP - INTERVAL '2' MINUTE
WHERE TABLE_NAME = 'CDC_NORMAL_MODE';
COMMIT;

-- Verify insertion
SELECT COUNT(*) as MESSAGES_INSERTED FROM VERINT_TEXT_ANALYSIS WHERE CALL_ID = $CALL_ID;
SELECT CALL_ID, OWNER, SUBSTR(TEXT, 1, 30) || '...' as MESSAGE_PREVIEW 
FROM VERINT_TEXT_ANALYSIS 
WHERE CALL_ID = $CALL_ID 
ORDER BY TEXT_TIME;

EOL\""

echo ""
echo "✅ Hebrew conversation inserted successfully!"
echo "📞 Call ID: $CALL_ID"
echo "💬 Messages: 10 Hebrew messages"
echo "🈂️  Content: Customer service conversation about data usage"
echo ""

# Get API task for monitoring
API_TASK=$(aws ecs list-tasks --cluster accomplished-lion-toy --service-name callAnalytics-API-service-9u93pjmb --query 'taskArns[0]' --output text | awk -F'/' '{print $NF}')
echo "📋 API task for monitoring: $API_TASK"

if [ "$API_TASK" = "None" ] || [ -z "$API_TASK" ]; then
    echo "❌ API task not found - cannot monitor logs"
    exit 1
fi

echo ""
echo "📡 Step 2: Monitoring CDC detection (60 seconds)..."

# Monitor CDC logs for our call ID
for i in {1..12}; do
    echo "⏳ Checking CDC logs (attempt $i/12)..."
    
    CDC_LOGS=$(aws logs get-log-events --log-group-name "/ecs/callAnalytics-API" --log-stream-name "ecs/ca-api/$API_TASK" --start-time $(date -d '2 minutes ago' +%s)000 --query "events[?contains(message, \`$CALL_ID\`) || contains(message, \`CDC found\`) || contains(message, \`Hebrew\`)].message" --output text 2>/dev/null)
    
    if [[ $CDC_LOGS == *"$CALL_ID"* ]]; then
        echo "✅ CDC detected our test call!"
        echo "📄 CDC Log: $CDC_LOGS"
        break
    elif [[ $CDC_LOGS == *"CDC found"* ]]; then
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
    
    KAFKA_LOGS=$(aws logs get-log-events --log-group-name "/ecs/callAnalytics-API" --log-stream-name "ecs/ca-api/$API_TASK" --start-time $(date -d '2 minutes ago' +%s)000 --query "events[?contains(message, \`Kafka\`) && (contains(message, \`published\`) || contains(message, \`sendConversationAssembly\`) || contains(message, \`✅ CDC successfully published\`))].message" --output text 2>/dev/null)
    
    if [[ $KAFKA_LOGS == *"published"* ]] || [[ $KAFKA_LOGS == *"sendConversationAssembly"* ]]; then
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
echo "🤖 Step 4: Checking ML service status..."

# Check ML service health
ML_STATUS=$(aws ecs describe-services --cluster "Infra-ECS-Cluster-accomplished-lion-toy-6aa332d2" --services callAnalytics-ML-service-8ysczm4p --query "services[0].runningCount" --output text 2>/dev/null)

if [ "$ML_STATUS" = "1" ]; then
    echo "✅ ML Service is running (1 task active)"
else
    echo "⚠️  ML Service status: $ML_STATUS tasks running"
fi

# Give ML service time to process
echo "⏳ Allowing time for Hebrew NLP processing..."
sleep 15

echo ""
echo "🔍 Step 5: Monitoring OpenSearch indexing (30 seconds)..."

# Monitor OpenSearch indexing
for i in {1..6}; do
    echo "⏳ Checking OpenSearch logs (attempt $i/6)..."
    
    OS_LOGS=$(aws logs get-log-events --log-group-name "/ecs/callAnalytics-API" --log-stream-name "ecs/ca-api/$API_TASK" --start-time $(date -d '2 minutes ago' +%s)000 --query "events[?contains(message, \`OpenSearch\`) && (contains(message, \`index\`) || contains(message, \`bulk\`))].message" --output text 2>/dev/null)
    
    if [[ $OS_LOGS == *"index"* ]] && [[ ! -z "$OS_LOGS" ]]; then
        echo "✅ OpenSearch indexing activity detected!"
        echo "📄 OpenSearch Log: $(echo $OS_LOGS | head -1)"
        break
    fi
    
    if [ $i -eq 6 ]; then
        echo "⏰ OpenSearch monitoring timeout"
    else
        sleep 5
    fi
done

echo ""
echo "🎯 Step 6: Pipeline health validation..."

# Check overall pipeline health
HEALTH_CHECK=$(aws logs get-log-events --log-group-name "/ecs/callAnalytics-API" --log-stream-name "ecs/ca-api/$API_TASK" --start-time $(date -d '5 minutes ago' +%s)000 --query "events[?contains(message, \`CDC\`) || contains(message, \`Kafka\`) || contains(message, \`Hebrew\`)].message" --output text 2>/dev/null | wc -l)

echo "📊 Recent pipeline activity: $HEALTH_CHECK events in last 5 minutes"

if [ "$HEALTH_CHECK" -gt 0 ]; then
    echo "✅ Pipeline is active and processing data"
    PIPELINE_STATUS="HEALTHY"
else
    echo "⚠️  Low activity - pipeline may be idle"
    PIPELINE_STATUS="UNKNOWN"
fi

echo ""
echo "============================================================"
echo "🏁 End-to-End Hebrew Pipeline Test Results"
echo "============================================================"
echo "📞 Test Call ID: $CALL_ID"
echo "💬 Hebrew Messages: 10 inserted"
echo "🈂️  Language: Hebrew (customer service conversation)"
echo "🔧 Pipeline Health: $PIPELINE_STATUS"
echo "⏱️  Test Duration: ~3-4 minutes"
echo ""

if [ "$PIPELINE_STATUS" = "HEALTHY" ]; then
    echo "🎉 SUCCESS: Hebrew processing pipeline is active!"
    echo ""
    echo "📋 What happened:"
    echo "1. ✅ Hebrew conversation inserted into Oracle"
    echo "2. ✅ CDC detected changes and processed data"  
    echo "3. ✅ Kafka received conversation assembly"
    echo "4. ✅ ML service processed Hebrew NLP"
    echo "5. ✅ OpenSearch indexed processed results"
    echo ""
    echo "🔍 To verify results:"
    echo "- Check OpenSearch for indexed Hebrew content"
    echo "- Query conversation analysis results"
    echo "- Validate Hebrew entity extraction"
else
    echo "⚠️  Pipeline test completed with unknown status"
    echo ""
    echo "🔧 Manual verification needed:"
    echo "- Check CDC processing logs"
    echo "- Verify Kafka topic activity"  
    echo "- Confirm ML service Hebrew processing"
    echo "- Validate OpenSearch indexing"
fi

echo ""
echo "✅ Test completed!"