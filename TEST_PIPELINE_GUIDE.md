# Test Pipeline Guide - Hebrew Call Analytics Platform

## Overview
This guide documents the test methodology for the Hebrew Call Analytics AI Platform, specifically for testing the conversation assembly and ML processing pipeline.

## System Architecture
The platform processes Hebrew call data through the following pipeline:
1. **CDC (Change Data Capture)** - Monitors Oracle database for new call data
2. **Conversation Assembly** - Collects individual messages into complete conversations
3. **ML Processing** - Analyzes complete conversations for sentiment, entities, and summaries
4. **OpenSearch Indexing** - Stores processed results for search and analytics

## Test Environment Setup

### Database Connection
```bash
# Connect to Oracle container with Hebrew encoding
docker exec -i call-analytics-oracle bash -c "
export NLS_LANG=AMERICAN_AMERICA.AL32UTF8
sqlplus -S system/Call_Analytics_2024!@XE
"
```

### Critical Configuration
The conversation assembly system uses these timeout settings to properly batch messages:
- `BUFFER_TIMEOUT`: 180000ms (3 minutes) - Allows time for CDC batch gaps
- `MIN_MESSAGES_BEFORE_FLUSH`: 5 messages minimum before flush consideration
- `CONVERSATION_COMPLETION_TIMEOUT`: 300000ms (5 minutes) maximum wait
- Flush check interval: 5000ms (5 seconds)

## Test Data Structure

### Database Schema
The `VERINT_TEXT_ANALYSIS` table contains:
- `CALL_ID`: Unique identifier for the call (NUMBER)
- `BAN`: Business Account Number (VARCHAR2)  
- `SUBSCRIBER_NO`: Customer subscriber number (VARCHAR2)
- `OWNER`: Call participant type ('C' for Customer, 'A' for Agent) (CHAR(1))
- `TEXT`: Hebrew conversation text (CLOB)
- `TEXT_TIME`: Message timestamp (DATE)
- `CALL_TIME`: Call start time (DATE)

## Creating Test Conversations

### 35-Message Conversation Example
This method creates a realistic Hebrew conversation with proper temporal spacing:

```sql
SET PAGESIZE 0
SET FEEDBACK OFF
SET SERVEROUTPUT ON

INSERT ALL
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'שלום, אני צריך עזרה עם החשבון שלי', TIMESTAMP '2025-08-23 20:15:01', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'שלום! אני כאן לעזור לך. מה הבעיה עם החשבון?', TIMESTAMP '2025-08-23 20:15:05', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'אני רואה חיובים שאני לא מכיר בחשבון החודשי', TIMESTAMP '2025-08-23 20:15:10', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'בוא נבדוק את זה יחד. איזה חיובים אתה רואה שנראים לך לא מוכרים?', TIMESTAMP '2025-08-23 20:15:15', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'יש פה חיוב של 50 שקל בשם "שירותים נוספים" - מה זה?', TIMESTAMP '2025-08-23 20:15:22', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'בוא אני אבדוק במערכת... נראה שזה חיוב עבור הודעות SMS בינלאומיות', TIMESTAMP '2025-08-23 20:15:30', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'אבל אני לא שלחתי הודעות בינלאומיות השבוע', TIMESTAMP '2025-08-23 20:15:35', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'המערכת מראה שנשלחו 10 הודעות לנמרות בחו"ל בתאריך 15 באוגוסט', TIMESTAMP '2025-08-23 20:15:42', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'רגע, אולי הילדים שלי... הם משתמשים בטלפון שלי לפעמים', TIMESTAMP '2025-08-23 20:15:48', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'זה הגיוני. ההודעות נשלחו למספרים באיטליה ובספרד', TIMESTAMP '2025-08-23 20:15:55', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'כן, הבן שלי היה בטיול באירופה. סליחה על הבלבול', TIMESTAMP '2025-08-23 20:16:02', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'אין בעיה בכלל! זה קורה. יש עוד משהו שאני יכול לעזור?', TIMESTAMP '2025-08-23 20:16:08', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'כן, אני רוצה לדעת איך אני יכול למנוע חיובים כאלה בעתיד', TIMESTAMP '2025-08-23 20:16:15', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'אני יכול להוסיף לך הודעות התרעה עבור שימוש בינלאומי', TIMESTAMP '2025-08-23 20:16:22', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'זה נשמע מצוין! איך זה עובד?', TIMESTAMP '2025-08-23 20:16:28', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'תקבל הודעת SMS כשיש שימוש בינלאומי מעל 20 שקל ביום', TIMESTAMP '2025-08-23 20:16:35', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'מושלם! אפשר גם להגביל כמה אפשר לבזבז בחודש?', TIMESTAMP '2025-08-23 20:16:42', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'כן, אני יכול לקבוע מגבלה של 100 שקל לחודש לשימוש בינלאומי', TIMESTAMP '2025-08-23 20:16:48', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', '100 שקל זה הגיוני. בוא נעשה את זה', TIMESTAMP '2025-08-23 20:16:55', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'מצוין! אני מגדיר עכשיו את ההגבלה וההתרעות...', TIMESTAMP '2025-08-23 20:17:02', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'אני מחכה...', TIMESTAMP '2025-08-23 20:17:08', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'בוצע! קבלת הגבלה של 100 שקל והתרעות מעל 20 שקל ביום', TIMESTAMP '2025-08-23 20:17:15', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'איך אני יכול לבדוק את המגבלה בעצמי?', TIMESTAMP '2025-08-23 20:17:22', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'באפליקציית החברה, בחלק "ניהול חשבון" → "מגבלות שימוש"', TIMESTAMP '2025-08-23 20:17:28', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'נהדר! יש לי עוד שאלה על החבילה שלי', TIMESTAMP '2025-08-23 20:17:35', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'בטח, מה השאלה?', TIMESTAMP '2025-08-23 20:17:40', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'האם יש לי גיגה בייט נוספים זמינים החודש?', TIMESTAMP '2025-08-23 20:17:47', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'בוא אני אבדוק... יש לך 12 גיגה שנשארו מתוך 25', TIMESTAMP '2025-08-23 20:17:55', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'מעולה! זה אמור להספיק לי. תודה רבה על העזרה', TIMESTAMP '2025-08-23 20:18:02', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'בשמחה! אם יש לך עוד שאלות, אל תהסס לפנות אלינו', TIMESTAMP '2025-08-23 20:18:08', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'בוודאי. יום טוב!', TIMESTAMP '2025-08-23 20:18:15', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'יום טוב גם לך! חיוני מנוין וכל הבעיות נפתרו', TIMESTAMP '2025-08-23 20:18:20', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'C', 'תודה! להתראות', TIMESTAMP '2025-08-23 20:18:25', TIMESTAMP '2025-08-23 20:15:00')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, OWNER, TEXT, TEXT_TIME, CALL_TIME) VALUES (53454654734555321122, '1234567890', 'SUB123456', 'A', 'להתראות!', TIMESTAMP '2025-08-23 20:18:28', TIMESTAMP '2025-08-23 20:15:00')
SELECT 1 FROM DUAL;

COMMIT;
```

### Key Features of This Test Method:
1. **Atomic Insert**: All 35 messages inserted in a single transaction
2. **Realistic Timestamps**: Progressive 3-7 second gaps between messages
3. **Hebrew Content**: Proper Hebrew conversation about billing and services
4. **Conversation Flow**: Natural back-and-forth between CUSTOMER and AGENT
5. **Recent Timestamps**: Uses current date/time to trigger CDC processing
6. **Proper Encoding**: Uses AL32UTF8 for Hebrew character support

## Testing Timeline

### Expected System Behavior:
1. **CDC Detection**: Oracle CDC will detect all 35 new rows (within 5-10 seconds)
2. **Conversation Assembly**: System will buffer messages for up to 3 minutes
3. **Smart Flushing**: Won't flush until:
   - At least 5 messages collected AND
   - 3 minutes timeout reached OR
   - No new messages for 3 minutes
4. **ML Processing**: Receives complete 35-message conversation as single unit
5. **OpenSearch**: Stores summarized conversation with all context

### Verification Commands:
```sql
-- Check test data was inserted
SELECT COUNT(*) FROM VERINT_TEXT_ANALYSIS WHERE CALL_ID = 53454654734555321122;

-- View conversation chronologically
SELECT OWNER, TEXT, TEXT_TIME 
FROM VERINT_TEXT_ANALYSIS 
WHERE CALL_ID = 53454654734555321122 
ORDER BY TEXT_TIME;
```

## Monitoring and Logs

### Expected Log Sequence:
1. **CDC Producer**: "Processing X changes in normal mode"
2. **Conversation Assembly**: "Buffering message for conversation [CALL_ID]"
3. **Conversation Assembly**: "Flushing conversation [CALL_ID] with 35 messages" (after timeout)
4. **ML Consumer**: "Processing conversation for ML analysis" with messageCount: 35
5. **OpenSearch**: "Indexing ML result for conversation [CALL_ID]"

### Success Indicators:
- ML Consumer logs show `messageCount: 35` (not individual messages)
- Single ML processing event per conversation
- Complete Hebrew summary in OpenSearch
- No duplicate processing warnings

## Troubleshooting

### Common Issues:
1. **Individual Message Processing**: If ML shows `messageCount: 1`
   - Check conversation assembly timeout settings
   - Verify CDC batch timing doesn't exceed buffer timeout

2. **Hebrew Encoding Issues**: 
   - Ensure NLS_LANG environment variable is set correctly
   - Verify Oracle container has AL32UTF8 charset

3. **Missing Messages**:
   - Check CDC processing position vs. test data timestamps
   - Verify all required fields are included in the INSERT statement

### Performance Notes:
- 35-message conversations should process in ~2-5 minutes total
- Most time spent in conversation assembly buffer (waiting for completion)
- ML processing typically takes 10-30 seconds for Hebrew analysis

## Testing ML Service Classifications

### Direct ML Service Test
To verify that the ML service is processing Hebrew text and returning classifications correctly:

```bash
curl -s -X POST http://localhost:5000/api/analyze-conversation \
-H "Content-Type: application/json" \
-d '{
  "text": "שלום, אני רוצה לבטל את החבילה שלי\nאת החבילה הבינלאומית\nבסדר, יש עמלת ביטול של 25 שקל\nלמה יש עמלה?\nאני יכול לוותר על העמלה\nתודה רבה",
  "callId": "test-classifications-123",
  "options": {
    "includeEmbedding": false,
    "includeSentiment": true,
    "includeEntities": false,
    "includeSummary": true,
    "includeTopics": false,
    "language": "auto-detect",
    "useCallIdPrompt": true,
    "promptTemplate": "summarize_with_id"
  }
}' | jq '{classifications, summary}'
```

**Expected Response:**
```json
{
  "classifications": [
    "בירור פרטי תכנית/מסלול",
    "מעבר תכנית/מסלול"
  ],
  "summary": "ביקש לבטל חבילה בינלאומית, אך גילה שיש עמלת ביטול של 25 ש\"ח..."
}
```

### Verify Classifications in OpenSearch
After a conversation is processed through the complete pipeline, verify classifications are stored:

```bash
curl -s "http://localhost:9200/call-analytics-*/_search?pretty" \
-H "Content-Type: application/json" \
-d '{
  "query": {
    "term": {
      "callId": "YOUR_CALL_ID_HERE"
    }
  },
  "_source": ["callId", "classifications", "sentiment", "language"],
  "size": 1
}' | jq '.hits.hits[0]._source | {callId, classifications, sentiment, language}'
```

**Expected Response:**
```json
{
  "callId": "YOUR_CALL_ID_HERE",
  "classifications": {
    "primary": "בירור פרטי תכנית/מסלול",
    "secondary": ["מעבר תכנית/מסלול"],
    "all": ["בירור פרטי תכנית/מסלול", "מעבר תכנית/מסלול"],
    "confidence": 0.9
  },
  "sentiment": {
    "overall": "neutral",
    "score": 0.7
  },
  "language": {
    "detected": "hebrew",
    "confidence": 0.95,
    "isHebrew": true
  }
}
```

### Common Issues and Solutions

#### Issue: Classifications showing as `null`
**Cause**: ML service JSON parsing failure due to Hebrew punctuation  
**Solution**: Hebrew text sanitization implemented in ML service  
**Check**: Verify ML service logs show `Fixed Hebrew JSON issues successfully`

#### Issue: Empty classifications array `[]`
**Cause**: LLM not generating classifications or incorrect prompt template  
**Check**: Verify `useCallIdPrompt: true` and correct `promptTemplate` in options

#### Issue: Processing timeout or errors  
**Cause**: ML service overloaded or model issues  
**Check**: ML service health endpoint: `curl http://localhost:5000/health`

## Best Practices

1. **Test Data**: Always use future timestamps relative to CDC position
2. **Bulk Inserts**: Use INSERT ALL for atomic conversation creation
3. **Hebrew Content**: Include realistic Hebrew text for proper language detection
4. **Message Spacing**: Use realistic time gaps (3-10 seconds) between messages
5. **Verification**: Always check logs to confirm expected behavior
6. **Classifications Testing**: Use direct ML service calls to verify classification functionality
7. **End-to-End Testing**: Verify classifications flow from ML service to OpenSearch storage

This methodology successfully demonstrates that the conversation assembly system now properly collects all messages from a conversation before sending to ML processing, ensuring complete conversations are summarized as single units rather than individual message processing with full classification support.

