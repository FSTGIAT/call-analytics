#!/bin/bash
# Enable CDC Historical Mode - allows reprocessing of old data
# Usage: ./enable-historical-cdc.sh YYYY-MM-DD [reason]

set -e

# Check if date parameter is provided
if [ -z "$1" ]; then
    echo "❌ Error: Date parameter required"
    echo "Usage: $0 YYYY-MM-DD [reason]"
    echo "Example: $0 2025-01-15 'Reprocess for ML improvements'"
    exit 1
fi

FROM_DATE="$1"
REASON="${2:-Manual activation via script}"

echo "🟢 ENABLING CDC Historical Mode"
echo "   From Date: $FROM_DATE"
echo "   Reason: $REASON"
echo "   This will process BOTH new data AND old data from the specified date"
echo ""

# Validate date format
if ! date -d "$FROM_DATE" >/dev/null 2>&1; then
    echo "❌ Error: Invalid date format. Please use YYYY-MM-DD"
    exit 1
fi

# Execute the SQL command with proper Hebrew support
echo "🔄 Executing SQL command..."
docker exec -i call-analytics-oracle bash -c "
  export NLS_LANG=AMERICAN_AMERICA.AL32UTF8
  sqlplus -S system/Call_Analytics_2024!@XE << 'EOF'
    -- Enable historical CDC mode
    UPDATE CDC_PROCESSING_STATUS 
    SET LAST_PROCESSED_TIMESTAMP = TO_DATE('$FROM_DATE', 'YYYY-MM-DD'),
        TOTAL_PROCESSED = 1,
        LAST_UPDATED = CURRENT_TIMESTAMP
    WHERE TABLE_NAME = 'CDC_HISTORICAL_MODE';
    
    COMMIT;
    
    -- Show current status
    SELECT 
        'Historical CDC Mode: ' || 
        CASE WHEN TOTAL_PROCESSED = 1 THEN 'ENABLED' ELSE 'DISABLED' END || 
        ' from ' || TO_CHAR(LAST_PROCESSED_TIMESTAMP, 'YYYY-MM-DD') as STATUS
    FROM CDC_PROCESSING_STATUS 
    WHERE TABLE_NAME = 'CDC_HISTORICAL_MODE';
    
    -- Show both modes  
    SELECT TABLE_NAME, 
           CASE WHEN TOTAL_PROCESSED = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END as STATUS
    FROM CDC_PROCESSING_STATUS 
    WHERE TABLE_NAME IN ('CDC_NORMAL_MODE', 'CDC_HISTORICAL_MODE')
    ORDER BY TABLE_NAME;
EOF"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Historical CDC Mode ENABLED successfully!"
    echo "📊 System will now process:"
    echo "   - New data (normal CDC mode)"
    echo "   - Historical data from $FROM_DATE (historical CDC mode)"
    echo ""
    echo "💡 To monitor progress: curl http://localhost:5001/api/v1/realtime-cdc/historical/status"
    echo "💡 To disable: ./disable-historical-cdc.sh"
else
    echo "❌ Error: Failed to enable historical CDC mode"
    exit 1
fi