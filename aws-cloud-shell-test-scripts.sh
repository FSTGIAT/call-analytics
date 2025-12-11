#!/bin/bash

# AWS Cloud Shell Test Scripts for Call Analytics Platform
# Generated: $(date)
# Services: Ollama (Hebrew DictaLM) + ML Service (Classifications)

# Current Service IPs (from ECS)
OLLAMA_IP="10.0.1.178"
ML_IP="10.0.1.233"
OLLAMA_PORT="11434"
ML_PORT="5000"

echo "🚀 Call Analytics Platform - AWS Cloud Shell Testing"
echo "=============================================="
echo "Ollama Service: $OLLAMA_IP:$OLLAMA_PORT"
echo "ML Service:     $ML_IP:$ML_PORT"
echo ""

# ==========================================
# PHASE 1: OLLAMA HEBREW MODEL TESTING
# ==========================================

echo "📊 Phase 1: Testing Ollama Hebrew DictaLM Model"
echo "----------------------------------------------"

# Test 1: Check if Ollama is responding
test_ollama_health() {
    echo "🔍 Test 1.1: Ollama Health Check"
    curl -s -m 10 "http://$OLLAMA_IP:$OLLAMA_PORT/api/tags" | jq '.'
    echo ""
}

# Test 2: List available models
test_ollama_models() {
    echo "🔍 Test 1.2: Available Models"
    curl -s -m 10 "http://$OLLAMA_IP:$OLLAMA_PORT/api/tags" | jq '.models[].name'
    echo ""
}

# Test 3: Simple Hebrew text generation
test_ollama_hebrew_simple() {
    echo "🔍 Test 1.3: Simple Hebrew Generation"
    curl -s -m 30 "http://$OLLAMA_IP:$OLLAMA_PORT/api/generate" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "dictalm2.0-instruct:Q4_K_M",
        "prompt": "תגובה קצרה: מה המטרה של שירות לקוחות?",
        "stream": false,
        "options": {
            "temperature": 0.2,
            "max_tokens": 100
        }
    }' | jq '.response'
    echo ""
}

# Test 4: Customer service conversation analysis
test_ollama_customer_service() {
    echo "🔍 Test 1.4: Customer Service Analysis"
    curl -s -m 60 "http://$OLLAMA_IP:$OLLAMA_PORT/api/generate" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "dictalm2.0-instruct:Q4_K_M",
        "prompt": "נתח את השיחה הבאה ותן סיכום:\n\nלקוח: שלום, יש לי בעיה עם החשבון\nנציג: שלום! במה אוכל לעזור?\nלקוח: יש חיוב מוזר של 50 שקל\nנציג: אני אבדוק עבורך כעת\n\nסיכום:",
        "stream": false,
        "options": {
            "temperature": 0.3,
            "max_tokens": 200
        }
    }' | jq '.response'
    echo ""
}

# ==========================================
# PHASE 2: ML SERVICE TESTING
# ==========================================

echo "📊 Phase 2: Testing ML Service Classifications"
echo "--------------------------------------------"

# Test 5: ML Service health check
test_ml_health() {
    echo "🔍 Test 2.1: ML Service Health Check"
    curl -s -m 10 "http://$ML_IP:$ML_PORT/health" | jq '.'
    echo ""
}

# Test 6: Hebrew text classification
test_ml_classification() {
    echo "🔍 Test 2.2: Hebrew Text Classification"
    curl -s -m 60 "http://$ML_IP:$ML_PORT/api/analyze-conversation" \
    -H "Content-Type: application/json" \
    -d '{
        "text": "שלום, אני רוצה לבטל את החבילה שלי\nאת החבילה הבינלאומית\nבסדר, יש עמלת ביטול של 25 שקל\nלמה יש עמלה?\nאני יכול לוותר על העמלה\nתודה רבה",
        "callId": "test-classification-$(date +%s)",
        "options": {
            "includeEmbedding": false,
            "includeSentiment": true,
            "includeEntities": true,
            "includeSummary": true,
            "includeTopics": false,
            "language": "auto-detect",
            "useCallIdPrompt": true,
            "promptTemplate": "summarize_with_id"
        }
    }' | jq '{callId: .callId, classifications: .classifications, summary: .summary, sentiment: .sentiment}'
    echo ""
}

# Test 7: Billing inquiry classification
test_ml_billing_classification() {
    echo "🔍 Test 2.3: Billing Inquiry Classification"
    curl -s -m 60 "http://$ML_IP:$ML_PORT/api/analyze-conversation" \
    -H "Content-Type: application/json" \
    -d '{
        "text": "שלום, אני רוצה להבין את החיובים בחשבון\nיש לי חיוב של 120 שקל שאני לא מזהה\nזה עבור שיחות בינלאומיות\nאבל אני לא זוכר ששיחתי לחו״ל\nבוא נבדוק את הפירוט\nאה, זה מהטיול של הבן שלי\nהכל ברור עכשיו, תודה",
        "callId": "billing-inquiry-$(date +%s)",
        "options": {
            "includeEmbedding": false,
            "includeSentiment": true,
            "includeEntities": false,
            "includeSummary": true,
            "includeTopics": false,
            "language": "hebrew",
            "useCallIdPrompt": true,
            "promptTemplate": "summarize_with_id"
        }
    }' | jq '{callId: .callId, classifications: .classifications, summary: .summary}'
    echo ""
}

# ==========================================
# PHASE 3: ORACLE DATABASE TESTING
# ==========================================

echo "📊 Phase 3: Oracle Database Insert Commands"
echo "------------------------------------------"

# Test 8: Generate Oracle INSERT commands
generate_oracle_inserts() {
    echo "🔍 Test 3.1: Oracle Insert Commands (Copy these to your Oracle client)"
    echo ""
    
    # Generate a unique CALL_ID
    CALL_ID=$(date +%s)000$(shuf -i 100-999 -n 1)
    
    echo "-- Hebrew Call Analytics Test Data"
    echo "-- CALL_ID: $CALL_ID"
    echo "-- Generated: $(date)"
    echo ""
    
    cat <<EOF
-- Connect with Hebrew encoding:
docker exec -i call-analytics-oracle bash -c "
export NLS_LANG=AMERICAN_AMERICA.AL32UTF8
sqlplus -S system/Call_Analytics_2024!@XE << 'SQLEOF'

-- Insert Hebrew conversation test data
INSERT ALL
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) VALUES ($CALL_ID, '8098067', '509097566', TO_DATE('$(date +'%d/%m/%Y %H:%M')', 'DD/MM/YYYY HH24:MI'), TO_DATE('$(date +'%d/%m/%Y %H:%M')', 'DD/MM/YYYY HH24:MI'), 'C', 'שלום, יש לי בעיה עם החשבון החודשי שלי')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) VALUES ($CALL_ID, '8098067', '509097566', TO_DATE('$(date +'%d/%m/%Y %H:%M')', 'DD/MM/YYYY HH24:MI'), TO_DATE('$(date -d '+5 seconds' +'%d/%m/%Y %H:%M:%S')', 'DD/MM/YYYY HH24:MI:SS'), 'A', 'שלום! אני כאן לעזור. מה הבעיה עם החשבון?')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) VALUES ($CALL_ID, '8098067', '509097566', TO_DATE('$(date +'%d/%m/%Y %H:%M')', 'DD/MM/YYYY HH24:MI'), TO_DATE('$(date -d '+10 seconds' +'%d/%m/%Y %H:%M:%S')', 'DD/MM/YYYY HH24:MI:SS'), 'C', 'אני רואה חיוב של 50 שקל שאני לא מכיר - מה זה?')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) VALUES ($CALL_ID, '8098067', '509097566', TO_DATE('$(date +'%d/%m/%Y %H:%M')', 'DD/MM/YYYY HH24:MI'), TO_DATE('$(date -d '+15 seconds' +'%d/%m/%Y %H:%M:%S')', 'DD/MM/YYYY HH24:MI:SS'), 'A', 'בוא אני אבדוק במערכת... זה חיוב עבור SMS בינלאומי')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) VALUES ($CALL_ID, '8098067', '509097566', TO_DATE('$(date +'%d/%m/%Y %H:%M')', 'DD/MM/YYYY HH24:MI'), TO_DATE('$(date -d '+20 seconds' +'%d/%m/%Y %H:%M:%S')', 'DD/MM/YYYY HH24:MI:SS'), 'C', 'אה, זה מהבן שלי שהיה בחו״ל. אפשר לקבל הגבלה לעתיד?')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) VALUES ($CALL_ID, '8098067', '509097566', TO_DATE('$(date +'%d/%m/%Y %H:%M')', 'DD/MM/YYYY HH24:MI'), TO_DATE('$(date -d '+25 seconds' +'%d/%m/%Y %H:%M:%S')', 'DD/MM/YYYY HH24:MI:SS'), 'A', 'כמובן! אני קובע הגבלה של 100 שקל לחודש ושליחת התרעה')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) VALUES ($CALL_ID, '8098067', '509097566', TO_DATE('$(date +'%d/%m/%Y %H:%M')', 'DD/MM/YYYY HH24:MI'), TO_DATE('$(date -d '+30 seconds' +'%d/%m/%Y %H:%M:%S')', 'DD/MM/YYYY HH24:MI:SS'), 'C', 'מצוין! תודה רבה על העזרה')
  INTO VERINT_TEXT_ANALYSIS (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT) VALUES ($CALL_ID, '8098067', '509097566', TO_DATE('$(date +'%d/%m/%Y %H:%M')', 'DD/MM/YYYY HH24:MI'), TO_DATE('$(date -d '+35 seconds' +'%d/%m/%Y %H:%M:%S')', 'DD/MM/YYYY HH24:MI:SS'), 'A', 'בשמחה! ההגבלה מוגדרת ותקבל SMS בעת חריגה')
SELECT 1 FROM DUAL;

COMMIT;

-- Verify the inserted data
SELECT COUNT(*) as MESSAGE_COUNT FROM VERINT_TEXT_ANALYSIS WHERE CALL_ID = $CALL_ID;

-- View the conversation
SELECT OWNER, TEXT, TEXT_TIME 
FROM VERINT_TEXT_ANALYSIS 
WHERE CALL_ID = $CALL_ID 
ORDER BY TEXT_TIME;

SQLEOF
"
EOF
    echo ""
    echo "NOTE: This creates a realistic Hebrew customer service conversation"
    echo "      C = Customer, A = Agent"
    echo "      CALL_ID: $CALL_ID"
    echo ""
}

# ==========================================
# PHASE 4: COMPREHENSIVE TESTING WORKFLOW
# ==========================================

# Test 9: Run all tests
run_all_tests() {
    echo "🔍 Test 4.1: Complete End-to-End Testing"
    echo ""
    
    echo "Step 1: Testing Ollama Hebrew Model..."
    test_ollama_health
    
    echo "Step 2: Testing ML Classifications..."
    test_ml_health
    
    echo "Step 3: Running Hebrew analysis..."
    test_ml_classification
    
    echo "Step 4: Generate Oracle commands..."
    generate_oracle_inserts
    
    echo ""
    echo "✅ All tests completed!"
    echo "📊 Summary:"
    echo "   - Ollama Service: http://$OLLAMA_IP:$OLLAMA_PORT"
    echo "   - ML Service: http://$ML_IP:$ML_PORT"
    echo "   - Oracle Insert commands generated above"
    echo ""
}

# ==========================================
# INTERACTIVE MENU
# ==========================================

show_menu() {
    echo "Choose a test to run:"
    echo "1. Ollama Health Check"
    echo "2. List Ollama Models"
    echo "3. Simple Hebrew Generation"
    echo "4. Customer Service Analysis"
    echo "5. ML Service Health"
    echo "6. Hebrew Classification Test"
    echo "7. Billing Inquiry Classification"
    echo "8. Generate Oracle Insert Commands"
    echo "9. Run All Tests"
    echo "0. Exit"
    echo ""
}

# Main execution
if [ "$1" == "auto" ]; then
    echo "🚀 Running all tests automatically..."
    run_all_tests
else
    while true; do
        show_menu
        read -p "Enter your choice (0-9): " choice
        
        case $choice in
            1) test_ollama_health ;;
            2) test_ollama_models ;;
            3) test_ollama_hebrew_simple ;;
            4) test_ollama_customer_service ;;
            5) test_ml_health ;;
            6) test_ml_classification ;;
            7) test_ml_billing_classification ;;
            8) generate_oracle_inserts ;;
            9) run_all_tests ;;
            0) echo "Goodbye!"; exit 0 ;;
            *) echo "Invalid choice. Please try again." ;;
        esac
        
        read -p "Press Enter to continue..."
        echo ""
    done
fi