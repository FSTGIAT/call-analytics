#!/bin/bash

# Direct Oracle insertion using your exact approach
CALL_ID=$(date +%s)999

echo "🔥 DIRECT AWS ORACLE INSERTION"
echo "Call ID: $CALL_ID"
echo ""

cd /home/roygi/call-analytics-ai-platform_aws/call-analytics && \
export AWS_PROFILE=811287567672_AWSPowerUserAccess && \
PATH="$PATH:$(pwd)/usr/local/sessionmanagerplugin/bin" \
aws ecs execute-command \
  --cluster accomplished-lion-toy \
  --task b8b5bde27a9b482183329d34a56dd821 \
  --container ca-oracle \
  --interactive \
  --command "bash -c \"export NLS_LANG=AMERICAN_AMERICA.AL32UTF8 && sqlplus -S system/2288@localhost:1521/XE << 'EOL'
  
-- Hebrew E2E Test  
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

-- Show results
SELECT COUNT(*) as INSERTED_MESSAGES FROM VERINT_TEXT_ANALYSIS WHERE CALL_ID = $CALL_ID;
SELECT 'Hebrew E2E Test - Call ID: $CALL_ID' as STATUS FROM DUAL;

EXIT;
EOL\""

echo ""
echo "✅ DIRECT ORACLE COMMAND EXECUTED"
echo "📞 Call ID: $CALL_ID"  
echo "🈂️  Hebrew conversation inserted"
echo "📡 CDC should now detect and process this data"