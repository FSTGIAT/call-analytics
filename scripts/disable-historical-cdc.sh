#!/bin/bash
# Disable CDC Historical Mode - return to normal CDC processing only
# Usage: ./disable-historical-cdc.sh

set -e

echo "🔴 DISABLING CDC Historical Mode"
echo "   System will return to normal CDC processing (new data only)"
echo ""

# Execute the SQL command with proper Hebrew support
echo "🔄 Executing SQL command..."
docker exec -i call-analytics-oracle bash -c "
  export NLS_LANG=AMERICAN_AMERICA.AL32UTF8
  sqlplus -S system/Call_Analytics_2024!@XE << 'EOF'
    -- Disable historical CDC mode
    UPDATE CDC_PROCESSING_STATUS 
    SET TOTAL_PROCESSED = 0,
        LAST_UPDATED = CURRENT_TIMESTAMP
    WHERE TABLE_NAME = 'CDC_HISTORICAL_MODE';
    
    COMMIT;
    
    -- Show current status
    SELECT 'Historical CDC Mode: DISABLED' as STATUS FROM DUAL;
    
    -- Show both modes
    SELECT TABLE_NAME,
           CASE WHEN TOTAL_PROCESSED = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END as STATUS
    FROM CDC_PROCESSING_STATUS 
    WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE')
    ORDER BY TABLE_NAME;
EOF"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Historical CDC Mode DISABLED successfully!"
    echo "📊 System now processes only:"
    echo "   - New data (normal CDC mode)"
    echo ""
    echo "💡 To monitor: curl http://localhost:5001/api/v1/realtime-cdc/status"
    echo "💡 To re-enable: ./enable-historical-cdc.sh YYYY-MM-DD"
else
    echo "❌ Error: Failed to disable historical CDC mode"
    exit 1
fi