#!/usr/bin/env python3
"""
Simple script to insert 1000 customers using curl commands
"""

import subprocess
import json
import random

def run_curl_insert(customer_id, call_id, subscriber_id, text, language="en"):
    """Insert data using curl command"""
    data = {
        "class": "CallTranscription",
        "properties": {
            "callId": call_id,
            "customerId": str(customer_id),
            "subscriberId": subscriber_id,
            "text": text,
            "language": language,
            "callDate": f"2025-01-{(customer_id % 28 + 1):02d}T{(customer_id % 12 + 10):02d}:30:00Z",
            "messageCount": len(text.split('.'))
        }
    }
    
    try:
        cmd = [
            'curl', '-s', '-X', 'POST', 
            'http://localhost:8088/v1/objects',
            '-H', 'Content-Type: application/json',
            '-d', json.dumps(data)
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return result.returncode == 0
    except:
        return False

def main():
    print("🚀 Inserting 1000 customers...")
    
    conversations = {
        'billing': [
            "Customer: Hi I have a billing question about my account. Agent: Hello I can help you with billing. What is your question? Customer: I see a charge for {} shekels that I do not recognize. Agent: Let me check that for you. It appears to be for roaming services. Customer: I did not use roaming services. Agent: I can remove that charge and give you a credit. Customer: Thank you that would be great. Agent: Done! You will see the credit on your next bill.",
            "Customer: My bill is higher than usual this month. Agent: Let me check your account. What amount are you seeing? Customer: {} shekels instead of my usual {}. Agent: I see you used more data this month. Customer: Can you give me a better data plan? Agent: I can offer unlimited data for 20 shekels more. Customer: That sounds good please activate it. Agent: Done! It will be active immediately."
        ],
        'technical': [
            "Customer: Hi I am having technical problems with my internet. Agent: Hello I can help with technical issues. What problem are you experiencing? Customer: My internet connection keeps dropping every few minutes. Agent: Let me run a diagnostic on your line. I can see some instability. Customer: How long will it take to fix? Agent: We are dispatching a technician who will arrive within 24 hours. Customer: Thank you for your help.",
            "Customer: My internet speed is very slow. Agent: I can help you with that. What speed are you getting? Customer: Only {} MB but I should get {}MB. Agent: Let me check your connection. There seems to be interference. Customer: How can we fix this? Agent: I can schedule a technician visit or send you a new router. Customer: Please send a new router. Agent: It will arrive within 2 business days."
        ],
        'hebrew': [
            "לקוח: שלום יש לי בעיה עם השירות שלי. נציג: שלום אני יכול לעזור לך. מה הבעיה? לקוח: האינטרנט שלי איטי מאוד. נציג: אני בודק את החיבור שלך עכשיו. יש בעיה ברשת. לקוח: מתי זה יתוקן? נציג: זה יתוקן תוך שעתיים. לקוח: תודה רבה.",
            "לקוח: יש לי שאלה לגבי החשבון שלי. נציג: בוודאי אני יכול לעזור. מה השאלה? לקוח: יש חיוב של {} שקל שאני לא מבין. נציג: אני בודק עבורך. זה חיוב עבור נתונים נוספים. לקוח: לא ידעתי שאני משתמש בנתונים נוספים. נציג: אני יכול לשדרג אותך לחבילה ללא הגבלה. לקוח: זה נשמע טוב בבקשה. נציג: בוצע יהיה פעיל מיד."
        ],
        'support': [
            "Customer: Hi I want to upgrade my plan. Agent: Hello I can help you with plan upgrades. What would you like to upgrade to? Customer: I need more data in my plan. Agent: I can offer you our premium plan with unlimited data for just 30 shekels more. Customer: That sounds good. When does it take effect? Agent: It will be active immediately. Customer: Perfect thank you.",
            "Customer: I want to add another line for my family. Agent: I can help you with that. How many lines do you need? Customer: {} additional lines. Agent: Each line costs {} shekels per month. Customer: That works for me. Agent: I will activate them now. Customer: When will I receive the SIM cards? Agent: They will arrive within 3 business days."
        ]
    }
    
    successful = 0
    failed = 0
    
    for customer_id in range(1000, 2000):  # 1000 customers (1000-1999)
        # Choose conversation type
        conv_types = ['billing', 'technical', 'hebrew', 'support']
        conv_type = random.choice(conv_types)
        
        # Choose random conversation template
        template = random.choice(conversations[conv_type])
        
        # Fill in variables
        if '{}' in template:
            if conv_type == 'billing':
                text = template.format(random.randint(50, 200), random.randint(80, 150))
            elif conv_type == 'technical':
                text = template.format(random.randint(5, 30), random.randint(50, 100))
            elif conv_type == 'hebrew':
                text = template.format(random.randint(50, 200))
            elif conv_type == 'support':
                text = template.format(random.randint(1, 3), random.randint(40, 80))
        else:
            text = template
        
        # Generate IDs
        call_id = f"CALL{customer_id}01"
        subscriber_id = f"SUB{customer_id}01"
        
        # Set language
        language = "he" if conv_type == 'hebrew' else "en"
        
        # Insert customer
        if run_curl_insert(customer_id, call_id, subscriber_id, text, language):
            successful += 1
            if successful % 100 == 0:
                print(f"📈 Progress: {successful}/1000 customers inserted")
        else:
            failed += 1
            print(f"✗ Failed to insert customer {customer_id}")
    
    print(f"\n🎉 Insertion completed!")
    print(f"✅ Successful: {successful}")
    print(f"❌ Failed: {failed}")
    print(f"📊 Success rate: {(successful/(successful+failed)*100):.1f}%")

if __name__ == "__main__":
    main()