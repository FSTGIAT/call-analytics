#!/usr/bin/env python3
"""
Simple script to insert 1000 unique customers with realistic conversations
Each conversation is multiple rows grouped by call_id
"""

import json
import random
import urllib.request
from datetime import datetime, timedelta

def insert_to_weaviate(data):
    """Insert single row into Weaviate"""
    try:
        weaviate_url = "http://localhost:8088/v1/objects"
        json_data = json.dumps(data).encode('utf-8')
        
        req = urllib.request.Request(
            weaviate_url,
            data=json_data,
            headers={"Content-Type": "application/json"}
        )
        
        response = urllib.request.urlopen(req, timeout=10)
        return response.getcode() == 200
        
    except Exception as e:
        print(f"Insert error: {e}")
        return False

def generate_conversation_rows(customer_id, call_id, subscriber_id, conversation_type):
    """Generate conversation rows for a single call"""
    
    conversations = {
        'billing': [
            "Customer: Hi, I have a question about my bill",
            "Agent: Hello! I'd be happy to help you with your billing question. What would you like to know?",
            "Customer: I see a charge for 150 shekels that I don't recognize",
            "Agent: Let me check that for you. I see it's a charge for international roaming service. Did you travel abroad recently?",
            "Customer: Yes, I was in Europe last week. But 150 shekels seems high",
            "Agent: I understand your concern. You used 2GB of data roaming. I can offer you a better roaming package for future trips",
            "Customer: That would be great. Can you also give me a discount on this charge?",
            "Agent: I can apply a 30% discount as a one-time courtesy. The new charge will be 105 shekels",
            "Customer: Thank you, that's much better. Please set up the roaming package",
            "Agent: Done! You'll receive an SMS confirmation shortly. Is there anything else I can help you with?"
        ],
        'technical': [
            "Customer: Hi, I'm having internet connectivity issues",
            "Agent: I'm sorry to hear that. Let me help you troubleshoot. When did the problem start?",
            "Customer: Since yesterday evening. The connection keeps dropping",
            "Agent: Let's check your connection. Can you restart your router for me?",
            "Customer: Okay, I've restarted it. It seems to be working now",
            "Agent: Great! Let me also check the signal strength in your area",
            "Customer: The speed is still slower than usual though",
            "Agent: I see there's maintenance in your area. It should be resolved by tomorrow",
            "Customer: Will I get compensation for the outage?",
            "Agent: Yes, we'll automatically credit your account for the affected period. You'll see it on your next bill"
        ],
        'support': [
            "Customer: I want to upgrade my plan",
            "Agent: I'd be happy to help you upgrade! What's your current plan?",
            "Customer: I have the basic plan but need more data",
            "Agent: Perfect! I can offer you our premium plan with 50GB for just 20 shekels more per month",
            "Customer: That sounds good. What about international calls?",
            "Agent: The premium plan includes 100 minutes of international calls to Europe and US",
            "Customer: Great! When will the upgrade take effect?",
            "Agent: It will be active immediately. You'll receive a confirmation SMS",
            "Customer: Thank you. Will my bill change this month?",
            "Agent: The change will be prorated from today. You'll see the details on your next bill"
        ],
        'cyber': [
            "Customer: Hi, I'm looking for a cyber security package",
            "Agent: Excellent choice! We offer comprehensive cyber protection. What devices do you need to protect?",
            "Customer: I have a laptop, phone, and tablet",
            "Agent: Our family cyber package covers up to 5 devices for 25 shekels per month",
            "Customer: What protection does it include?",
            "Agent: Antivirus, firewall, VPN, identity theft protection, and 24/7 monitoring",
            "Customer: That sounds comprehensive. How long is the contract?",
            "Agent: You can choose monthly or get 2 months free with an annual contract",
            "Customer: I'll take the annual contract. Can you set it up now?",
            "Agent: Absolutely! I'll activate it immediately and send you the download links via SMS"
        ]
    }
    
    conv_lines = conversations[conversation_type]
    rows = []
    
    for i, line in enumerate(conv_lines):
        # Extract speaker and text
        if line.startswith("Customer:"):
            speaker = "Customer"
            text = line.replace("Customer: ", "")
        else:
            speaker = "Agent"
            text = line.replace("Agent: ", "")
        
        # Create row data
        row_data = {
            "class": "CallTranscription",
            "properties": {
                "callId": call_id,
                "customerId": str(customer_id),
                "subscriberId": subscriber_id,
                "text": text,
                "language": "he" if random.random() < 0.7 else "en",
                "callDate": (datetime.now() - timedelta(days=random.randint(1, 365))).isoformat() + "Z",
                "messageCount": len(conv_lines)
            }
        }
        
        rows.append(row_data)
    
    return rows

def main():
    print("🚀 Starting simple data insertion...")
    print("📊 Target: 1000 unique customers")
    
    conversation_types = ['billing', 'technical', 'support', 'cyber']
    successful_inserts = 0
    failed_inserts = 0
    
    for customer_id in range(1, 1001):  # 1000 customers
        # Generate 1-3 calls per customer
        num_calls = random.randint(1, 3)
        
        for call_num in range(num_calls):
            # Generate unique IDs
            call_id = f"CALL{customer_id:04d}{call_num+1:02d}{random.randint(1000, 9999)}"
            subscriber_id = f"SUB{customer_id:06d}{call_num+1:02d}"
            
            # Choose conversation type
            conv_type = random.choice(conversation_types)
            
            # Generate conversation rows
            rows = generate_conversation_rows(customer_id, call_id, subscriber_id, conv_type)
            
            # Insert each row
            call_success = True
            for row in rows:
                if not insert_to_weaviate(row):
                    call_success = False
                    break
            
            if call_success:
                successful_inserts += 1
            else:
                failed_inserts += 1
                print(f"✗ Failed to insert call {call_id}")
        
        # Progress update every 50 customers
        if customer_id % 50 == 0:
            print(f"📈 Progress: {customer_id}/1000 customers processed")
            print(f"   ✓ Successful calls: {successful_inserts}")
            print(f"   ✗ Failed calls: {failed_inserts}")
    
    # Final summary
    total_calls = successful_inserts + failed_inserts
    success_rate = (successful_inserts / total_calls) * 100 if total_calls > 0 else 0
    
    print(f"\n🎉 Data insertion completed!")
    print(f"   👥 Customers processed: 1000")
    print(f"   📞 Total calls: {total_calls}")
    print(f"   ✓ Successful: {successful_inserts}")
    print(f"   ✗ Failed: {failed_inserts}")
    print(f"   📊 Success rate: {success_rate:.1f}%")

if __name__ == "__main__":
    main()