#!/bin/bash

# Hebrew E2E Test - Working AWS Execution
# Based on provided task IDs and correct approach

ORACLE_TASK="b8b5bde27a9b482183329d34a56dd821"
API_TASK="64f90f5d10904c478d39eb08529f32a9"
CALL_ID=$(date +%s)123  # Unique Call ID with suffix

echo "🧪 Hebrew Call Analytics E2E Test - AWS Execution"
echo "=================================================="
echo "Oracle Task: $ORACLE_TASK"
echo "API Task: $API_TASK"
echo "Call ID: $CALL_ID"
echo "Timestamp: $(date)"
echo ""

echo "📝 Step 1: Inserting Hebrew conversation into Oracle..."

# Execute the working command you provided
cd /home/roygi/call-analytics-ai-platform_aws/call-analytics && \
export AWS_PROFILE=811287567672_AWSPowerUserAccess && \
PATH="$PATH:$(pwd)/usr/local/sessionmanagerplugin/bin" \
aws ecs execute-command \
  --cluster accomplished-lion-toy \
  --task $ORACLE_TASK \
  --container ca-oracle \
  --interactive \
  --command "bash -c \"export NLS_LANG=AMERICAN_AMERICA.AL32UTF8 && sqlplus -S system/2288@localhost:1521/XE << 'EOL'

-- Hebrew conversation E2E test
-- Call ID: $CALL_ID
-- Generated: $(date)

-- Set proper encoding
ALTER SESSION SET NLS_LANGUAGE='AMERICAN';
ALTER SESSION SET NLS_CHARACTERSET='AL32UTF8';

-- Insert Hebrew customer service conversation about data plan upgrade
INSERT ALL
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP, 'C', 'שלום, יש לי בעיה עם חבילת הגלישה שלי')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '5' SECOND, 'A', 'שלום! אני כאן לעזור. איזו בעיה יש לך עם החבילה?')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '10' SECOND, 'C', 'נגמרה לי הגלישה באמצע החודש ואני משלם המון על גלישה נוספת')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '15' SECOND, 'A', 'אני מבין, זה מעצבן. בוא אני אבדוק במערכת את השימוש שלך')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '20' SECOND, 'C', 'תודה. אני גולש בעיקר ביוטיוב ובנטפליקס')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '25' SECOND, 'A', 'אני רואה שאתה צורך 50 ג''יגה לחודש. יש לי הצעה לחבילה מתאימה')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '30' SECOND, 'C', 'כמה זה עולה? החבילה הנוכחית שלי עולה 79 שקל')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '35' SECOND, 'A', 'חבילה של 60 ג''יגה עולה 99 שקל - זה יחסוך לך כסף')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '40' SECOND, 'C', 'מעולה! איך אני עובר לחבילה החדשה?')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) 
  VALUES ($CALL_ID, '8098067', '509097566', SYSTIMESTAMP, SYSTIMESTAMP + INTERVAL '45' SECOND, 'A', 'אני מעביר אותך עכשיו, זה יכנס לתוקף מיד')
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
SELECT CALL_ID, OWNER, SUBSTR(TEXT, 1, 40) || '...' as MESSAGE_PREVIEW 
FROM VERINT_TEXT_ANALYSIS 
WHERE CALL_ID = $CALL_ID 
ORDER BY TEXT_TIME;

SELECT 'E2E Test Data Inserted Successfully for Call ID: $CALL_ID' as TEST_STATUS FROM DUAL;

EXIT;
EOL\""

echo ""
echo "✅ Hebrew conversation insertion completed!"
echo "📞 Call ID: $CALL_ID"
echo "💬 Messages: 10 Hebrew customer-agent conversation"
echo "🈂️  Content: Data plan upgrade conversation"
echo ""
echo "📡 Next: Monitor CDC processing for Call ID $CALL_ID"
echo "🤖 Expected: Hebrew ML processing → OpenSearch indexing"
echo "🔍 Verify: Query OpenSearch for conversation summary"
echo ""
echo "📋 Manual Monitoring Commands:"
echo "1. CDC Processing:"
echo "   aws logs filter-log-events --log-group-name /ecs/callAnalytics-API --filter-pattern \"$CALL_ID\""
echo ""
echo "2. Hebrew Processing:"  
echo "   aws logs filter-log-events --log-group-name /ecs/callAnalytics-ML --filter-pattern \"Hebrew\""
echo ""
echo "3. OpenSearch Query:"
echo "   curl -X GET 'opensearch-endpoint:9200/call-analytics-*/_search?q=callId:$CALL_ID'"