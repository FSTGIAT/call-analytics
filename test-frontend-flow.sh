#!/bin/bash

# Call Analytics AI Platform - Frontend Testing Workflow
# This script tests the complete frontend-to-backend flow

echo "🧪 Call Analytics AI Platform - Frontend Testing Workflow"
echo "========================================================"
echo

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test URLs
API_BASE="http://localhost:3000/api/v1"
ML_BASE="http://localhost:5000"
FRONTEND_BASE="http://localhost:8080"
CUSTOMER_ID="test-frontend-user"

echo -e "${BLUE}🔧 PHASE 1: BACKEND PREPARATION${NC}"
echo "=================================="

# 1. Start CDC Processing
echo -e "${YELLOW}⚡ Starting CDC processing...${NC}"
curl -s -X POST -H "X-Customer-ID: $CUSTOMER_ID" "$API_BASE/realtime-cdc/start" | jq '.success'

# 2. Insert test conversation data
echo -e "${YELLOW}📝 Inserting test conversation data...${NC}"
TEST_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -H "X-Customer-ID: $CUSTOMER_ID" \
  "$API_BASE/realtime-cdc/test" \
  -d "{\"customerId\": \"$CUSTOMER_ID\"}")

CALL_ID=$(echo $TEST_RESPONSE | jq -r '.testData.callId')
echo -e "${GREEN}✅ Test call created: $CALL_ID${NC}"

# 3. Wait for processing
echo -e "${YELLOW}⏳ Waiting for CDC processing...${NC}"
sleep 5

echo -e "\n${BLUE}🔍 PHASE 2: SEMANTIC SEARCH TESTING${NC}"
echo "===================================="

# 4. Test Semantic Search (Key Frontend Feature)
echo -e "${YELLOW}🧠 Testing semantic search...${NC}"
SEARCH_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
  "$ML_BASE/vector/search" \
  -d '{
    "query": "בעיה עם חשבון חיוב",
    "customer_id": "'$CUSTOMER_ID'",
    "limit": 5,
    "certainty": 0.7
  }')

echo $SEARCH_RESPONSE | jq '.total_found'

echo -e "\n${BLUE}🤖 PHASE 3: MCP CLIENT TESTING${NC}"
echo "==============================="

# 5. Test MCP Client (AI Conversation)
echo -e "${YELLOW}🗣️  Testing Hebrew conversation...${NC}"
CONVERSATION_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -H "X-Customer-ID: $CUSTOMER_ID" \
  "$API_BASE/mcp/llm/request" \
  -d '{
    "prompt": "לקוח מתקשר: שלום, יש לי בעיה עם החשבון שלי. החיוב לא נראה נכון.",
    "system_prompt": "אתה נציג שירות לקוחות מקצועי. ענה בעברית בצורה אדיבה ומועילה.",
    "metadata": {
      "priority": "realtime",
      "context": "customer_support"
    }
  }')

echo $CONVERSATION_RESPONSE | jq '.success'

echo -e "\n${BLUE}📊 PHASE 4: ANALYTICS DATA${NC}"
echo "=========================="

# 6. Get system statistics
echo -e "${YELLOW}📈 Getting system statistics...${NC}"
MCP_STATS=$(curl -s -H "X-Customer-ID: $CUSTOMER_ID" "$API_BASE/mcp/health")
CDC_STATS=$(curl -s -H "X-Customer-ID: $CUSTOMER_ID" "$API_BASE/realtime-cdc/status")

echo "MCP Health:" $(echo $MCP_STATS | jq '.status')
echo "CDC Status:" $(echo $CDC_STATS | jq '.status.isRunning')

echo -e "\n${BLUE}🎨 PHASE 5: FRONTEND TESTING INSTRUCTIONS${NC}"
echo "=========================================="

echo -e "${GREEN}🌐 Frontend is available at: $FRONTEND_BASE${NC}"
echo
echo -e "${YELLOW}📋 MANUAL TESTING CHECKLIST:${NC}"
echo
echo "1. 🔐 LOGIN (if required):"
echo "   - Navigate to: $FRONTEND_BASE/login"
echo "   - Use test credentials or skip if in dev mode"
echo
echo "2. 🔍 SEARCH TESTING:"
echo "   - Navigate to: $FRONTEND_BASE/search"
echo "   - Test Semantic Search:"
echo "     • Query: 'בעיה עם חשבון'"
echo "     • Should return Hebrew results"
echo "   - Test Advanced Filters:"
echo "     • Date range, sentiment, call type"
echo "   - Test Voice Search (if microphone available)"
echo
echo "3. 📞 CALLS MANAGEMENT:"
echo "   - Navigate to: $FRONTEND_BASE/calls"
echo "   - Should show call ID: $CALL_ID"
echo "   - Click on call for details"
echo
echo "4. 💬 CONVERSATIONS:"
echo "   - Navigate to: $FRONTEND_BASE/conversations"
echo "   - Test Hebrew conversation interface"
echo
echo "5. 🔗 MCP CLIENT:"
echo "   - Navigate to: $FRONTEND_BASE/mcp"
echo "   - Check AI model routing status"
echo "   - Test local vs cloud routing"
echo
echo "6. 📊 ANALYTICS:"
echo "   - Navigate to: $FRONTEND_BASE/analytics"
echo "   - Check real-time metrics"
echo "   - View conversation trends"

echo -e "\n${BLUE}🧪 PHASE 6: API ENDPOINT TESTING${NC}"
echo "================================"

echo -e "${YELLOW}🔧 Test these API endpoints manually:${NC}"
echo
echo "Health Checks:"
echo "  curl $API_BASE/../health"
echo "  curl $ML_BASE/health"
echo
echo "Search API (for frontend):"
echo "  curl -X POST -H 'Content-Type: application/json' \\"
echo "    -H 'X-Customer-ID: $CUSTOMER_ID' \\"
echo "    '$API_BASE/search/semantic' \\"
echo "    -d '{\"query\": \"בעיה עם חשבון\", \"limit\": 10}'"
echo
echo "MCP Conversation:"
echo "  curl -X POST -H 'Content-Type: application/json' \\"
echo "    -H 'X-Customer-ID: $CUSTOMER_ID' \\"
echo "    '$API_BASE/mcp/llm/request' \\"
echo "    -d '{\"prompt\": \"שלום, איך אני יכול לעזור?\"}'"

echo -e "\n${BLUE}📱 PHASE 7: MOBILE TESTING${NC}"
echo "=========================="

echo -e "${YELLOW}📱 Mobile Testing Instructions:${NC}"
echo "1. Open browser developer tools"
echo "2. Enable mobile device simulation"
echo "3. Test responsive design on $FRONTEND_BASE"
echo "4. Verify Hebrew RTL text rendering"
echo "5. Test touch interactions for search"

echo -e "\n${BLUE}🎯 EXPECTED RESULTS${NC}"
echo "=================="

echo -e "${GREEN}✅ SUCCESS CRITERIA:${NC}"
echo "• Frontend loads at $FRONTEND_BASE"
echo "• Search returns Hebrew results"
echo "• MCP routing works (local Hebrew, cloud English)"
echo "• Real-time CDC processing active"
echo "• Analytics show system statistics"
echo "• Responsive design works on mobile"
echo
echo -e "${RED}❌ FAILURE INDICATORS:${NC}"
echo "• Frontend shows connection errors"
echo "• Search returns no results"
echo "• Hebrew text displays incorrectly"
echo "• API endpoints return 500 errors"

echo -e "\n${GREEN}🎉 Frontend testing workflow prepared!${NC}"
echo -e "${YELLOW}👆 Follow the manual testing checklist above${NC}"
echo