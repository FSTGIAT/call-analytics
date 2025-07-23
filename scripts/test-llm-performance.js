const axios = require('axios');
const { performance } = require('perf_hooks');

// Test configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5000';
const CONCURRENT_REQUESTS = 5;
const TOTAL_REQUESTS = 20;

// Hebrew test data
const hebrewTestCases = [
  {
    name: 'Customer Service Call',
    transcription: `שלום, אני מתקשר בנוגע לבעיה עם החבילה שלי. המספר שלי הוא 054-123-4567. 
    יש לי בעיה עם האינטרנט כבר שבועיים. החיבור מתנתק כל הזמן והמהירות איטית.
    ניסיתי לאתחל את הראוטר מספר פעמים אבל זה לא עוזר.
    אני עובד מהבית ויש לי פגישות וידאו חשובות היום.
    תוכלו לעזור לי לפתור את זה?`
  },
  {
    name: 'Technical Support',
    transcription: `היי, יש לי בעיה עם המכשיר החדש שקניתי אתמול.
    ה-iPhone 15 Pro לא מזהה את כרטיס ה-SIM שלי.
    ניסיתי להוציא ולהכניס אותו כמה פעמים אבל עדיין לא עובד.
    האם יש פתרון או שאני צריך להחזיר את המכשיר?
    הקנייה הייתה דרך האתר שלכם אתמול בערב.`
  },
  {
    name: 'Billing Inquiry',
    transcription: `שלום, התקשרתי בנוגע לחשבון שלי מהחודש הזה.
    ראיתי חיוב של 500 שקל שלא הבנתי מה זה.
    החבילה שלי אמורה להיות 120 שקל בחודש.
    יש איזשהו חיוב נוסף שלא ביקשתי.
    תוכלו לבדוק את זה ולהסביר לי מה קרה?
    אני לקוח כבר 5 שנים ומעולם לא היה לי חיוב כזה.`
  }
];

async function testLLMPerformance() {
  console.log('🚀 Starting LLM Performance Tests\n');
  
  try {
    // 1. Health Check
    console.log('1. Testing LLM service health...');
    const healthResponse = await axios.get(`${ML_SERVICE_URL}/llm/health`);
    console.log('✅ LLM Health Status:');
    console.log('   Overall:', healthResponse.data.overall_status);
    console.log('   Primary Service:', healthResponse.data.primary_service);
    console.log('   Services:', Object.keys(healthResponse.data.services).map(s => 
      `${s}: ${healthResponse.data.services[s].status}`).join(', '));
    console.log('---\n');
    
    // 2. Model Information
    console.log('2. Checking available models...');
    const modelsResponse = await axios.get(`${ML_SERVICE_URL}/llm/models`);
    console.log('✅ Available Models:');
    console.log('   Ollama models:', modelsResponse.data.ollama_models);
    console.log('   Bedrock enabled:', modelsResponse.data.bedrock_enabled);
    console.log('   Default model:', modelsResponse.data.default_model);
    console.log('---\n');
    
    // 3. Single Request Performance
    console.log('3. Testing single request performance...');
    const singleTestCase = hebrewTestCases[0];
    
    const singleStart = performance.now();
    const singleResponse = await axios.post(`${ML_SERVICE_URL}/llm/summarize`, {
      transcription: singleTestCase.transcription,
      language: 'hebrew',
      prefer_local: true
    });
    const singleEnd = performance.now();
    
    console.log('✅ Single Request Results:');
    console.log('   Response time:', Math.round(singleEnd - singleStart), 'ms');
    console.log('   Service used:', singleResponse.data.service || 'unknown');
    console.log('   Success:', singleResponse.data.success);
    
    if (singleResponse.data.success && singleResponse.data.summary) {
      console.log('   Summary generated:', singleResponse.data.summary.summary?.substring(0, 100) + '...');
      console.log('   Sentiment:', singleResponse.data.summary.sentiment);
      console.log('   Key points count:', singleResponse.data.summary.key_points?.length || 0);
    }
    console.log('---\n');
    
    // 4. Concurrent Request Performance
    console.log(`4. Testing concurrent performance (${CONCURRENT_REQUESTS} concurrent requests)...`);
    
    const concurrentStart = performance.now();
    const concurrentPromises = [];
    
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
      const testCase = hebrewTestCases[i % hebrewTestCases.length];
      concurrentPromises.push(
        axios.post(`${ML_SERVICE_URL}/llm/summarize`, {
          transcription: testCase.transcription,
          language: 'hebrew',
          prefer_local: true
        }).catch(error => ({ error: error.message }))
      );
    }
    
    const concurrentResults = await Promise.all(concurrentPromises);
    const concurrentEnd = performance.now();
    
    const successfulConcurrent = concurrentResults.filter(r => r.data?.success).length;
    
    console.log('✅ Concurrent Request Results:');
    console.log('   Total time:', Math.round(concurrentEnd - concurrentStart), 'ms');
    console.log('   Average per request:', Math.round((concurrentEnd - concurrentStart) / CONCURRENT_REQUESTS), 'ms');
    console.log('   Successful requests:', successfulConcurrent, '/', CONCURRENT_REQUESTS);
    console.log('   Success rate:', Math.round((successfulConcurrent / CONCURRENT_REQUESTS) * 100), '%');
    console.log('---\n');
    
    // 5. Batch Processing Test
    console.log('5. Testing batch processing...');
    
    const batchTranscriptions = hebrewTestCases.map((tc, index) => ({
      text: tc.transcription,
      language: 'hebrew',
      id: `test-${index}`
    }));
    
    const batchStart = performance.now();
    const batchResponse = await axios.post(`${ML_SERVICE_URL}/llm/batch-summarize`, {
      transcriptions: batchTranscriptions,
      max_concurrent: 3
    });
    const batchEnd = performance.now();
    
    console.log('✅ Batch Processing Results:');
    console.log('   Total time:', Math.round(batchEnd - batchStart), 'ms');
    console.log('   Items processed:', batchResponse.data.total_processed);
    console.log('   Successful:', batchResponse.data.successful);
    console.log('   Batch efficiency:', Math.round((batchEnd - batchStart) / batchResponse.data.total_processed), 'ms per item');
    console.log('---\n');
    
    // 6. Load Test
    console.log(`6. Running load test (${TOTAL_REQUESTS} total requests)...`);
    
    const loadTestStart = performance.now();
    const loadTestPromises = [];
    const semaphore = new Semaphore(CONCURRENT_REQUESTS);
    
    for (let i = 0; i < TOTAL_REQUESTS; i++) {
      loadTestPromises.push(
        semaphore.acquire().then(async (release) => {
          try {
            const testCase = hebrewTestCases[i % hebrewTestCases.length];
            const requestStart = performance.now();
            
            const response = await axios.post(`${ML_SERVICE_URL}/llm/summarize`, {
              transcription: testCase.transcription,
              language: 'hebrew',
              prefer_local: true
            });
            
            const requestEnd = performance.now();
            
            return {
              success: response.data.success,
              responseTime: requestEnd - requestStart,
              service: response.data.service,
              index: i
            };
          } catch (error) {
            return {
              success: false,
              error: error.message,
              index: i
            };
          } finally {
            release();
          }
        })
      );
    }
    
    const loadTestResults = await Promise.all(loadTestPromises);
    const loadTestEnd = performance.now();
    
    const successfulLoad = loadTestResults.filter(r => r.success).length;
    const responseTimes = loadTestResults.filter(r => r.responseTime).map(r => r.responseTime);
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const minResponseTime = Math.min(...responseTimes);
    const maxResponseTime = Math.max(...responseTimes);
    
    console.log('✅ Load Test Results:');
    console.log('   Total time:', Math.round(loadTestEnd - loadTestStart), 'ms');
    console.log('   Requests per second:', Math.round(TOTAL_REQUESTS / ((loadTestEnd - loadTestStart) / 1000)));
    console.log('   Success rate:', Math.round((successfulLoad / TOTAL_REQUESTS) * 100), '%');
    console.log('   Response times:');
    console.log('     Average:', Math.round(avgResponseTime), 'ms');
    console.log('     Min:', Math.round(minResponseTime), 'ms');
    console.log('     Max:', Math.round(maxResponseTime), 'ms');
    console.log('---\n');
    
    // 7. Service Statistics
    console.log('7. Getting service statistics...');
    const statsResponse = await axios.get(`${ML_SERVICE_URL}/llm/stats`);
    
    console.log('✅ Service Statistics:');
    console.log('   Orchestrator:', JSON.stringify(statsResponse.data.orchestrator, null, 2));
    console.log('   Ollama:', JSON.stringify(statsResponse.data.ollama, null, 2));
    console.log('   Bedrock:', JSON.stringify(statsResponse.data.bedrock, null, 2));
    
    console.log('\n🎉 LLM Performance Tests Completed Successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Make sure the ML service is running:');
      console.error('   cd ml-service && python app.py');
    }
  }
}

// Simple semaphore implementation for concurrency control
class Semaphore {
  constructor(count) {
    this.count = count;
    this.waiting = [];
  }
  
  acquire() {
    return new Promise((resolve) => {
      if (this.count > 0) {
        this.count--;
        resolve(() => this.release());
      } else {
        this.waiting.push(() => resolve(() => this.release()));
      }
    });
  }
  
  release() {
    this.count++;
    if (this.waiting.length > 0) {
      this.count--;
      const next = this.waiting.shift();
      next();
    }
  }
}

// Run the tests
testLLMPerformance().catch(console.error);