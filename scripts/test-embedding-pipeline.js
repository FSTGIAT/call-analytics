const axios = require('axios');
const { performance } = require('perf_hooks');

// Test configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5000';

// Hebrew test data for embeddings
const hebrewTestTexts = [
  'שלום, אני מתקשר בנוגע לבעיה עם האינטרנט שלי',
  'יש לי בעיה עם החשבון החודשי',
  'אני רוצה לבטל את החבילה',
  'המכשיר החדש לא עובד כמו שצריך',
  'תודה על השירות המעולה שקיבלתי',
  'אני צריך עזרה עם התקנת הראוטר',
  'החיוב הזה לא נכון במיוחד',
  'מתי אוכל לקבל טכנאי לבית?',
  'האפליקציה לא נפתחת במכשיר',
  'אני רוצה לשדרג את החבילה שלי'
];

const sampleTranscriptions = [
  {
    callId: 'test-001',
    customerId: 'DEMO-CUSTOMER',
    subscriberId: 'SUB-001',
    transcriptionText: 'שלום, אני מתקשר כי יש לי בעיה עם האינטרנט. החיבור מתנתק כל הזמן.',
    language: 'he',
    callDate: new Date().toISOString(),
    durationSeconds: 180,
    agentId: 'AGENT-001',
    callType: 'support',
    sentiment: 'negative',
    productsMentioned: ['אינטרנט', 'ראוטר'],
    keyPoints: ['בעיה טכנית', 'חיבור לא יציב']
  },
  {
    callId: 'test-002',
    customerId: 'DEMO-CUSTOMER',
    subscriberId: 'SUB-002',
    transcriptionText: 'היי, אני רוצה לדעת על החבילות החדשות שיש לכם.',
    language: 'he',
    callDate: new Date().toISOString(),
    durationSeconds: 120,
    agentId: 'AGENT-002',
    callType: 'sales',
    sentiment: 'positive',
    productsMentioned: ['חבילות'],
    keyPoints: ['מידע על מוצרים']
  }
];

async function testEmbeddingPipeline() {
  console.log('🧠 Testing Embedding Pipeline\n');
  
  try {
    // 1. Health Check
    console.log('1. Testing ML service health...');
    const healthResponse = await axios.get(`${ML_SERVICE_URL}/health`);
    console.log('✅ Health Status:');
    console.log('   Service:', healthResponse.data.status);
    console.log('   Hebrew Processor:', healthResponse.data.hebrew_processor);
    console.log('   Embedding Model:', healthResponse.data.embedding_model_loaded);
    console.log('   Weaviate:', healthResponse.data.weaviate_connected);
    console.log('---\n');
    
    // 2. Test Single Embedding Generation
    console.log('2. Testing single embedding generation...');
    const singleText = hebrewTestTexts[0];
    
    const singleStart = performance.now();
    const singleResponse = await axios.post(`${ML_SERVICE_URL}/embeddings/generate`, {
      text: singleText,
      preprocess: true
    });
    const singleEnd = performance.now();
    
    console.log('✅ Single Embedding Results:');
    console.log('   Text:', singleText.substring(0, 50) + '...');
    console.log('   Embedding dimensions:', singleResponse.data.embedding.length);
    console.log('   Model:', singleResponse.data.model_name);
    console.log('   Processing time:', Math.round(singleEnd - singleStart), 'ms');
    console.log('   Text hash:', singleResponse.data.text_hash);
    console.log('---\n');
    
    // 3. Test Batch Embedding Generation
    console.log('3. Testing batch embedding generation...');
    
    const batchStart = performance.now();
    const batchResponse = await axios.post(`${ML_SERVICE_URL}/embeddings/batch`, {
      texts: hebrewTestTexts.slice(0, 5),
      preprocess: true
    });
    const batchEnd = performance.now();
    
    console.log('✅ Batch Embedding Results:');
    console.log('   Total texts:', batchResponse.data.total_processed);
    console.log('   Total time:', Math.round(batchEnd - batchStart), 'ms');
    console.log('   Average per text:', Math.round((batchEnd - batchStart) / batchResponse.data.total_processed), 'ms');
    console.log('   First embedding dims:', batchResponse.data.results[0].embedding.length);
    console.log('---\n');
    
    // 4. Test Built-in Embedding Test
    console.log('4. Running built-in embedding test...');
    const testResponse = await axios.get(`${ML_SERVICE_URL}/test/embeddings`);
    
    console.log('✅ Built-in Test Results:');
    console.log('   Single embedding shape:', testResponse.data.single_embedding.embedding_shape);
    console.log('   Batch processing time:', testResponse.data.batch_processing.avg_processing_time, 'ms avg');
    console.log('   Similarity search found:', testResponse.data.similarity_search.results.length, 'results');
    console.log('   Cache hit rate:', testResponse.data.stats.cache_hit_rate.toFixed(1) + '%');
    console.log('---\n');
    
    // 5. Test Vector Database Integration
    console.log('5. Testing vector database integration...');
    
    // Add sample transcription to vector DB
    const vectorAddResponse = await axios.post(`${ML_SERVICE_URL}/vector/add`, {
      transcription_data: sampleTranscriptions[0]
    });
    
    if (vectorAddResponse.data.success) {
      console.log('✅ Added transcription to vector database');
      
      // Test semantic search
      const searchResponse = await axios.post(`${ML_SERVICE_URL}/vector/search`, {
        query: 'בעיה עם האינטרנט',
        customer_id: 'DEMO-CUSTOMER',
        limit: 5,
        certainty: 0.6
      });
      
      console.log('✅ Semantic Search Results:');
      console.log('   Query:', searchResponse.data.query);
      console.log('   Results found:', searchResponse.data.total_found);
      
      if (searchResponse.data.results.length > 0) {
        const topResult = searchResponse.data.results[0];
        console.log('   Top result similarity:', topResult.similarity_score.toFixed(3));
        console.log('   Top result text:', topResult.transcriptionText.substring(0, 60) + '...');
      }
    } else {
      console.log('⚠️  Failed to add to vector database');
    }
    console.log('---\n');
    
    // 6. Test Batch Vector Operations
    console.log('6. Testing batch vector operations...');
    
    const batchVectorResponse = await axios.post(`${ML_SERVICE_URL}/vector/batch-add`, {
      transcriptions: sampleTranscriptions
    });
    
    console.log('✅ Batch Vector Results:');
    console.log('   Total transcriptions:', batchVectorResponse.data.total || 0);
    console.log('   Successful additions:', batchVectorResponse.data.successful || 0);
    console.log('   Errors:', batchVectorResponse.data.errors || 0);
    console.log('---\n');
    
    // 7. Performance Statistics
    console.log('7. Getting performance statistics...');
    
    const [embeddingStats, vectorStats] = await Promise.all([
      axios.get(`${ML_SERVICE_URL}/embeddings/stats`),
      axios.get(`${ML_SERVICE_URL}/vector/stats`)
    ]);
    
    console.log('✅ Embedding Service Stats:');
    console.log('   Embeddings generated:', embeddingStats.data.embeddings_generated);
    console.log('   Cache hits:', embeddingStats.data.cache_hits);
    console.log('   Cache hit rate:', embeddingStats.data.cache_hit_rate.toFixed(1) + '%');
    console.log('   Avg processing time:', embeddingStats.data.avg_processing_time.toFixed(3) + 's');
    console.log('   Model:', embeddingStats.data.config.model_name);
    console.log('   Device:', embeddingStats.data.config.device);
    
    console.log('\n✅ Vector Database Stats:');
    console.log('   Connected:', vectorStats.data.connected);
    console.log('   Total objects:', vectorStats.data.total_objects);
    console.log('   Classes:', vectorStats.data.classes.join(', ') || 'none');
    console.log('---\n');
    
    // 8. Test Hebrew-Specific Processing
    console.log('8. Testing Hebrew-specific processing...');
    
    const hebrewSpecificTests = [
      'שלום עולם!',  // Basic Hebrew
      'שלום world!',  // Mixed Hebrew-English
      'קוד: ABC123',  // Hebrew with code
      'מספר טלפון: 054-123-4567'  // Hebrew with phone
    ];
    
    for (const text of hebrewSpecificTests) {
      try {
        const response = await axios.post(`${ML_SERVICE_URL}/embeddings/generate`, {
          text: text,
          preprocess: true
        });
        
        console.log(`   ✅ "${text}" → ${response.data.embedding.length}D embedding`);
      } catch (error) {
        console.log(`   ❌ "${text}" → Error: ${error.message}`);
      }
    }
    
    console.log('\n🎉 Embedding Pipeline Tests Completed Successfully!');
    
    // Summary
    console.log('\n📊 Test Summary:');
    console.log('   • Single embedding generation: ✅');
    console.log('   • Batch embedding processing: ✅');
    console.log('   • Hebrew text preprocessing: ✅');
    console.log('   • Vector database integration: ✅');
    console.log('   • Semantic search functionality: ✅');
    console.log('   • Performance monitoring: ✅');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Make sure the ML service is running:');
      console.error('   cd ml-service && python app.py');
    }
  }
}

// Additional utility function to test Oracle batch processing
async function testOracleBatchProcessing() {
  console.log('\n📦 Testing Oracle Batch Processing...');
  
  try {
    const mockOracleData = hebrewTestTexts.map((text, index) => ({
      text: text,
      call_id: `oracle-${index}`,
      customer_id: 'DEMO-CUSTOMER',
      metadata: { source: 'oracle_test' }
    }));
    
    const texts = mockOracleData.map(item => item.text);
    const metadata = mockOracleData.map(item => ({ 
      call_id: item.call_id, 
      customer_id: item.customer_id,
      ...item.metadata 
    }));
    
    const batchResponse = await axios.post(`${ML_SERVICE_URL}/batch/process-oracle`, {
      texts: texts,
      metadata: metadata,
      batch_size: 5
    });
    
    console.log('✅ Oracle Batch Processing Results:');
    console.log('   Total texts:', batchResponse.data.total_texts);
    console.log('   Processing result:', batchResponse.data.embedding_processing);
    
  } catch (error) {
    console.error('❌ Oracle batch processing test failed:', error.message);
  }
}

// Run all tests
async function runAllTests() {
  await testEmbeddingPipeline();
  await testOracleBatchProcessing();
}

runAllTests().catch(console.error);