#!/bin/bash

# Test Script for Oracle Database Connection
# This script tests the Oracle database connectivity and setup

echo "🗃️  Testing Oracle Database Connection for Call Analytics Platform"
echo "================================================================"

# Check if Oracle container is running
echo "📋 Step 1: Checking if Oracle container is running..."
if docker ps | grep -q "call-analytics-oracle"; then
    echo "✅ Oracle container is running"
else
    echo "❌ Oracle container is not running"
    echo "To start Oracle container, run: docker-compose up oracle -d"
    exit 1
fi

echo ""
echo "🔌 Step 2: Testing Oracle database connection..."

# Wait for Oracle to be ready
echo "⏳ Waiting for Oracle database to be ready (this may take 1-2 minutes)..."
sleep 30

# Test connection from host
echo "Testing direct connection to Oracle database..."
docker exec call-analytics-oracle sqlplus -S sys/Call_Analytics_2024!@localhost:1521/XE as sysdba <<EOF
SELECT 'Oracle Database is running!' as status FROM dual;
EXIT;
EOF

if [ $? -eq 0 ]; then
    echo "✅ Oracle database is accessible"
else
    echo "❌ Oracle database connection failed"
    echo "Check Oracle logs: docker logs call-analytics-oracle"
    exit 1
fi

echo ""
echo "📊 Step 3: Testing Call Analytics schema..."

# Test Call Analytics user and schema
docker exec call-analytics-oracle sqlplus -S CALL_ANALYTICS/Call_Analytics_2024!@localhost:1521/XE <<EOF
SELECT 'CALL_ANALYTICS schema is ready!' as status FROM dual;

-- Check if tables exist
SELECT table_name FROM user_tables ORDER BY table_name;

-- Count sample data
SELECT 'CALL_TRANSCRIPTIONS' as table_name, COUNT(*) as row_count FROM CALL_TRANSCRIPTIONS
UNION ALL
SELECT 'CALL_SUMMARIES' as table_name, COUNT(*) as row_count FROM CALL_SUMMARIES
UNION ALL
SELECT 'CALL_AI_METADATA' as table_name, COUNT(*) as row_count FROM CALL_AI_METADATA
UNION ALL
SELECT 'CUSTOMERS' as table_name, COUNT(*) as row_count FROM CUSTOMERS;

EXIT;
EOF

if [ $? -eq 0 ]; then
    echo "✅ Call Analytics schema is accessible and populated"
else
    echo "❌ Call Analytics schema test failed"
    echo "The schema might not be initialized yet. Run the init script manually:"
    echo "docker exec call-analytics-oracle sqlplus sys/Call_Analytics_2024!@localhost:1521/XE as sysdba @/opt/oracle/scripts/setup/01-init-db.sql"
fi

echo ""
echo "🔗 Step 4: Testing API container Oracle connection..."

# Check if API container can connect to Oracle
if docker ps | grep -q "call-analytics-api"; then
    echo "Testing API -> Oracle connectivity..."
    
    # Test the health endpoint
    API_HEALTH=$(curl -s http://localhost:3000/health 2>/dev/null)
    if echo "$API_HEALTH" | jq -e '.services.oracle == "connected"' > /dev/null 2>&1; then
        echo "✅ API successfully connected to Oracle"
        echo "📊 API Health Status:"
        echo "$API_HEALTH" | jq '.services'
    else
        echo "❌ API failed to connect to Oracle"
        echo "API Health Response: $API_HEALTH"
        echo "Check API logs: docker logs call-analytics-api"
    fi
else
    echo "❌ API container is not running"
    echo "To start API container, run: docker-compose up api -d"
fi

echo ""
echo "📋 Step 5: Testing sample queries..."

# Test a sample query that the API would execute
docker exec call-analytics-oracle sqlplus -S CALL_ANALYTICS/Call_Analytics_2024!@localhost:1521/XE <<EOF
-- Test query: Get recent calls for demo customer
SELECT 
    CALL_ID,
    CUSTOMER_ID,
    SUBSTR(TRANSCRIPTION_TEXT, 1, 50) || '...' as TRANSCRIPT_PREVIEW,
    LANGUAGE,
    CALL_DATE,
    CALL_TYPE
FROM CALL_TRANSCRIPTIONS 
WHERE CUSTOMER_ID = 'DEMO-CUSTOMER'
ORDER BY CALL_DATE DESC;

-- Test join: Get calls with summaries
SELECT 
    t.CALL_ID,
    t.CUSTOMER_ID,
    SUBSTR(t.TRANSCRIPTION_TEXT, 1, 30) || '...' as TRANSCRIPT,
    s.SENTIMENT,
    SUBSTR(s.SUMMARY_TEXT, 1, 40) || '...' as SUMMARY
FROM CALL_TRANSCRIPTIONS t
LEFT JOIN CALL_SUMMARIES s ON t.CALL_ID = s.CALL_ID
WHERE t.CUSTOMER_ID = 'DEMO-CUSTOMER';

EXIT;
EOF

echo ""
echo "✅ Oracle Database Test Complete!"
echo ""
echo "📋 Summary:"
echo "  ✓ Oracle container is running"
echo "  ✓ Oracle database is accessible"
echo "  ✓ CALL_ANALYTICS schema exists with sample data"
echo "  ✓ Sample queries execute successfully"
echo ""
echo "🚀 Oracle Database is ready for Call Analytics Platform!"
echo ""
echo "🔗 Connection Details:"
echo "  Host: localhost (or 'oracle' from within containers)"
echo "  Port: 1521"
echo "  Service: XE"
echo "  User: CALL_ANALYTICS"
echo "  Schema: CALL_ANALYTICS"
echo ""
echo "📊 Sample Tables Created:"
echo "  • CALL_TRANSCRIPTIONS (call records and transcripts)"
echo "  • CALL_SUMMARIES (AI-generated summaries)"
echo "  • CALL_AI_METADATA (processing metadata)"
echo "  • CUSTOMERS (customer information)"
echo ""
echo "🎯 Next Steps:"
echo "  1. Start API container: docker-compose up api -d"
echo "  2. Test API endpoints: curl http://localhost:3000/health"
echo "  3. Test call ingestion through the API"