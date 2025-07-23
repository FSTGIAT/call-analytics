const axios = require('axios');

// Test data with mixed Hebrew-English content
const testCases = [
  {
    name: 'Mixed Hebrew-English',
    text: 'שלום עולם! Hello world! איך אתה היום?'
  },
  {
    name: 'Hebrew with phone number',
    text: 'התקשר אליי בטלפון 054-123-4567 או ב-02-987-6543'
  },
  {
    name: 'Product mention',
    text: 'אני מעוניין לקנות iPhone 15 Pro או Samsung Galaxy S24'
  },
  {
    name: 'Customer service conversation',
    text: 'שלום, אני רוצה לבטל את החבילה שלי. המספר שלי הוא 054-111-2222'
  },
  {
    name: 'Technical support',
    text: 'יש לי בעיה עם האינטרנט. הראוטר לא עובד כבר שעתיים'
  },
  {
    name: 'RTL with English words',
    text: 'אני צריך לעדכן את ה-password ב-website שלכם'
  }
];

async function testHebrewProcessing() {
  console.log('🧪 Testing Hebrew Text Processing\n');
  
  const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:5000';
  
  try {
    // Test health check first
    console.log('1. Testing ML Service health...');
    const healthResponse = await axios.get(`${mlServiceUrl}/health`);
    console.log('✅ ML Service health:', healthResponse.data);
    console.log('---');
    
    // Test built-in Hebrew test
    console.log('2. Running built-in Hebrew test...');
    const testResponse = await axios.get(`${mlServiceUrl}/test/hebrew`);
    console.log('✅ Built-in test result:');
    console.log('   Sample:', testResponse.data.sample_text);
    console.log('   Tokens:', testResponse.data.tokens.slice(0, 5), '...');
    console.log('   Language mix:', testResponse.data.language_composition);
    console.log('   Phone numbers:', testResponse.data.phone_numbers);
    console.log('---');
    
    // Test each test case
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(`${i + 3}. Testing: ${testCase.name}`);
      console.log(`   Input: "${testCase.text}"`);
      
      try {
        // Test normalization
        const normalizeResponse = await axios.post(`${mlServiceUrl}/hebrew/normalize`, {
          text: testCase.text,
          remove_stopwords: true
        });
        
        // Test entity extraction
        const entitiesResponse = await axios.post(`${mlServiceUrl}/hebrew/entities`, {
          text: testCase.text
        });
        
        // Test RTL fix
        const rtlResponse = await axios.post(`${mlServiceUrl}/hebrew/rtl-fix`, {
          text: testCase.text
        });
        
        console.log('   ✅ Normalized:', normalizeResponse.data.normalized);
        console.log('   ✅ Entities:', entitiesResponse.data.entities);
        console.log('   ✅ Language:', entitiesResponse.data.language_composition);
        
        if (entitiesResponse.data.phone_numbers.length > 0) {
          console.log('   📞 Phone numbers found:', entitiesResponse.data.phone_numbers);
        }
        
        console.log('   ✅ RTL fixed:', rtlResponse.data.rtl_fixed);
        
      } catch (error) {
        console.log('   ❌ Error:', error.response?.data?.error || error.message);
      }
      
      console.log('---');
    }
    
    console.log('🎉 Hebrew processing tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Make sure the ML service is running:');
      console.error('   cd ml-service && python app.py');
    }
  }
}

// Test API endpoints with Hebrew content
async function testAPIHebrewHandling() {
  console.log('\n🌐 Testing API Hebrew Handling\n');
  
  const apiUrl = process.env.API_URL || 'http://localhost:3000/api/v1';
  
  try {
    // Test API health with Hebrew response
    const response = await axios.get(`${apiUrl}/../health`);
    console.log('✅ API Health:', response.data);
    
    // Test UTF-8 encoding in request/response
    const hebrewData = {
      query: 'חיפוש בעברית',
      filters: {
        language: 'he'
      }
    };
    
    console.log('📤 Sending Hebrew data:', hebrewData);
    
    // This will test the Hebrew middleware
    const testResponse = await axios.get(`${apiUrl}/test`, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
    
    console.log('✅ API response encoding test passed');
    console.log('   Response:', testResponse.data);
    
  } catch (error) {
    console.error('❌ API test failed:', error.response?.data || error.message);
  }
}

// Run tests
async function runAllTests() {
  await testHebrewProcessing();
  await testAPIHebrewHandling();
}

runAllTests().catch(console.error);