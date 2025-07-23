#!/bin/bash
# Check CDC Mode Status - shows both normal and historical mode status
# Usage: ./check-cdc-status.sh

set -e

echo "📊 CDC MODE STATUS CHECK"
echo "========================"
echo ""

# Execute the SQL command with proper Hebrew support
docker exec -i call-analytics-oracle bash -c "
  export NLS_LANG=AMERICAN_AMERICA.AL32UTF8
  sqlplus -S system/Call_Analytics_2024!@XE << 'EOF'
    SET PAGESIZE 50
    SET LINESIZE 120
    
    -- Show detailed CDC mode status
    SELECT 
        CASE WHEN TABLE_NAME = 'CDC_NORMAL_MODE' THEN 'Normal CDC Mode' 
             ELSE 'Historical CDC Mode' END as CDC_MODE,
        CASE WHEN TOTAL_PROCESSED = 1 THEN 'ENABLED' ELSE 'DISABLED' END as STATUS,
        TO_CHAR(LAST_PROCESSED_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS') as LAST_PROCESSED,
        LAST_CHANGE_ID,
        TO_CHAR(LAST_UPDATED, 'YYYY-MM-DD HH24:MI:SS') as LAST_UPDATED
    FROM CDC_PROCESSING_STATUS 
    WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE')
    ORDER BY TABLE_NAME;
    
    -- Show summary
    SELECT 
        'Summary: ' ||
        CASE 
            WHEN SUM(CASE WHEN TABLE_NAME = 'CDC_NORMAL_MODE' AND TOTAL_PROCESSED = 1 THEN 1 ELSE 0 END) = 1 
                 AND SUM(CASE WHEN TABLE_NAME = 'CDC_HISTORICAL_MODE' AND TOTAL_PROCESSED = 1 THEN 1 ELSE 0 END) = 1 
            THEN 'DUAL MODE ACTIVE (Normal + Historical)'
            WHEN SUM(CASE WHEN TABLE_NAME = 'CDC_NORMAL_MODE' AND TOTAL_PROCESSED = 1 THEN 1 ELSE 0 END) = 1 
            THEN 'NORMAL MODE ONLY'
            ELSE 'NO ACTIVE CDC MODES'
        END as CDC_STATUS
    FROM CDC_PROCESSING_STATUS 
    WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE');
    
    -- Show processing counts today
    SELECT 
        'Processed today: ' || COUNT(*) || ' records' as TODAY_STATS
    FROM CDC_PROCESSING_LOG 
    WHERE TRUNC(PROCESSED_AT) = TRUNC(SYSDATE);
EOF"

echo ""
echo "💡 API Endpoints:"
echo "   Status: curl http://localhost:5001/api/v1/realtime-cdc/historical/status"
echo "   Enable: curl -X POST http://localhost:5001/api/v1/realtime-cdc/historical/enable -H 'Content-Type: application/json' -d '{\"fromDate\":\"2025-01-15\"}'"
echo "   Disable: curl -X POST http://localhost:5001/api/v1/realtime-cdc/historical/disable"