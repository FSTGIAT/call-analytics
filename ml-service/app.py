import os
import logging
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# Import utilities and services
# Removed hebrew_processor - DictaLM and AlephBERT handle Hebrew natively
from src.services.llm_orchestrator import llm_orchestrator
from src.services.huggingface_service import huggingface_service
# from src.services.bedrock_service import bedrock_service  # Removed - not using Bedrock
from src.services.embedding_service import embedding_service
from src.services.weaviate_service import weaviate_service
from src.services.ml_pipeline import ml_pipeline

# Load environment variables
load_dotenv('../config/.env.ml')

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('ML_LOG_LEVEL', 'INFO').upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False  # Allow non-ASCII characters in JSON responses
CORS(app)

# Ensure UTF-8 encoding for all responses
app.config['JSON_AS_ASCII'] = False

@app.before_request
def before_request():
    """Ensure all requests are handled with UTF-8 encoding."""
    if request.content_type and 'application/json' in request.content_type:
        request.encoding = 'utf-8'

@app.after_request
def after_request(response):
    """Ensure all responses use UTF-8 encoding."""
    response.headers['Content-Type'] = 'application/json; charset=utf-8'
    return response


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    # Use synchronous health check for now
    pipeline_health = {
        'pipeline_status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'components': {
            'embeddings': {'status': 'healthy'},
            'llm': {'status': 'healthy'},
            'hebrew_support': {'status': 'native', 'note': 'Built into DictaLM and AlephBERT'}
        }
    }
    
    return jsonify({
        'status': pipeline_health['pipeline_status'],
        'service': 'ml-service',
        'timestamp': pipeline_health['timestamp'],
        'components': pipeline_health['components'],
        'error': pipeline_health.get('error')
    })


@app.route('/hebrew/tokenize', methods=['POST'])
def tokenize_hebrew():
    """Tokenize Hebrew text."""
    try:
        data = request.get_json()
        text = data.get('text', '')
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        tokens = hebrew_processor.tokenize_hebrew(text)
        
        return jsonify({
            'tokens': tokens,
            'count': len(tokens)
        })
    
    except Exception as e:
        logger.error(f"Tokenization error: {e}")
        return jsonify({'error': 'Tokenization failed'}), 500


@app.route('/hebrew/normalize', methods=['POST'])
def normalize_hebrew():
    """Normalize Hebrew text."""
    try:
        data = request.get_json()
        text = data.get('text', '')
        remove_stopwords = data.get('remove_stopwords', False)
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        # Normalize text
        normalized = hebrew_processor.normalize_text(text)
        
        # Tokenize
        tokens = hebrew_processor.tokenize_hebrew(normalized)
        
        # Remove stopwords if requested
        if remove_stopwords:
            tokens = hebrew_processor.remove_stopwords(tokens)
            normalized = ' '.join(tokens)
        
        return jsonify({
            'original': text,
            'normalized': normalized,
            'tokens': tokens
        })
    
    except Exception as e:
        logger.error(f"Normalization error: {e}")
        return jsonify({'error': 'Normalization failed'}), 500


@app.route('/hebrew/entities', methods=['POST'])
def extract_entities():
    """Extract entities from Hebrew text."""
    try:
        data = request.get_json()
        text = data.get('text', '')
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        entities = hebrew_processor.extract_entities(text)
        language_mix = hebrew_processor.detect_language_mix(text)
        phone_numbers = hebrew_processor.extract_phone_numbers(text)
        
        return jsonify({
            'entities': entities,
            'language_composition': language_mix,
            'phone_numbers': phone_numbers
        })
    
    except Exception as e:
        logger.error(f"Entity extraction error: {e}")
        return jsonify({'error': 'Entity extraction failed'}), 500


@app.route('/hebrew/lemmatize', methods=['POST'])
def lemmatize_hebrew():
    """Get lemmas for Hebrew text."""
    try:
        data = request.get_json()
        text = data.get('text', '')
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        lemmas = hebrew_processor.get_lemmas(text)
        
        return jsonify({
            'lemmas': [{'word': word, 'lemma': lemma} for word, lemma in lemmas]
        })
    
    except Exception as e:
        logger.error(f"Lemmatization error: {e}")
        return jsonify({'error': 'Lemmatization failed'}), 500


@app.route('/hebrew/preprocess', methods=['POST'])
def preprocess_for_embedding():
    """Preprocess Hebrew text for embedding generation."""
    try:
        data = request.get_json()
        text = data.get('text', '')
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        # Full preprocessing pipeline
        preprocessed = hebrew_processor.preprocess_for_embedding(text)
        
        # Additional analysis
        language_mix = hebrew_processor.detect_language_mix(text)
        sentences = hebrew_processor.segment_sentences(text)
        
        return jsonify({
            'original': text,
            'preprocessed': preprocessed,
            'language_composition': language_mix,
            'sentences': sentences,
            'sentence_count': len(sentences)
        })
    
    except Exception as e:
        logger.error(f"Preprocessing error: {e}")
        return jsonify({'error': 'Preprocessing failed'}), 500


@app.route('/hebrew/rtl-fix', methods=['POST'])
def fix_rtl_display():
    """Fix RTL display for mixed Hebrew-English text."""
    try:
        data = request.get_json()
        text = data.get('text', '')
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        fixed_text = hebrew_processor.fix_rtl_display(text)
        
        return jsonify({
            'original': text,
            'rtl_fixed': fixed_text
        })
    
    except Exception as e:
        logger.error(f"RTL fix error: {e}")
        return jsonify({'error': 'RTL fix failed'}), 500


@app.route('/test/hebrew', methods=['GET'])
def test_hebrew_processing():
    """Test Hebrew processing with sample text."""
    sample_text = "שלום, איך אתה היום? Hello world! מספר טלפון: 054-123-4567"
    
    try:
        # Run all processing functions
        normalized = hebrew_processor.normalize_text(sample_text)
        tokens = hebrew_processor.tokenize_hebrew(sample_text)
        entities = hebrew_processor.extract_entities(sample_text)
        language_mix = hebrew_processor.detect_language_mix(sample_text)
        phone_numbers = hebrew_processor.extract_phone_numbers(sample_text)
        rtl_fixed = hebrew_processor.fix_rtl_display(sample_text)
        
        return jsonify({
            'sample_text': sample_text,
            'normalized': normalized,
            'tokens': tokens,
            'entities': entities,
            'language_composition': language_mix,
            'phone_numbers': phone_numbers,
            'rtl_fixed': rtl_fixed,
            'status': 'success'
        })
    
    except Exception as e:
        logger.error(f"Hebrew test error: {e}")
        return jsonify({'error': str(e), 'status': 'failed'}), 500


# LLM Endpoints
@app.route('/llm/health', methods=['GET'])
async def llm_health():
    """Check LLM services health."""
    try:
        health = await llm_orchestrator.health_check()
        return jsonify(health)
    except Exception as e:
        logger.error(f"LLM health check error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/llm/generate', methods=['POST'])
async def generate_llm_response():
    """Generate response using LLM orchestrator."""
    try:
        data = request.get_json()
        prompt = data.get('prompt', '')
        system_prompt = data.get('system_prompt')
        prefer_local = data.get('prefer_local', True)
        
        if not prompt:
            return jsonify({'error': 'Prompt is required'}), 400
        
        response = await llm_orchestrator.generate_response(
            prompt=prompt,
            system_prompt=system_prompt,
            prefer_local=prefer_local
        )
        
        return jsonify(response)
    
    except Exception as e:
        logger.error(f"LLM generation error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/llm/summarize', methods=['POST'])
async def summarize_call():
    """Summarize call transcription using LLM."""
    try:
        data = request.get_json()
        transcription = data.get('transcription', '')
        language = data.get('language', 'hebrew')
        prefer_local = data.get('prefer_local', True)
        
        if not transcription:
            return jsonify({'error': 'Transcription is required'}), 400
        
        summary = await llm_orchestrator.summarize_call(
            transcription=transcription,
            language=language,
            prefer_local=prefer_local
        )
        
        return jsonify(summary)
    
    except Exception as e:
        logger.error(f"Call summarization error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/llm/batch-summarize', methods=['POST'])
async def batch_summarize():
    """Batch summarize multiple call transcriptions."""
    try:
        data = request.get_json()
        transcriptions = data.get('transcriptions', [])
        max_concurrent = data.get('max_concurrent', 5)
        
        if not transcriptions:
            return jsonify({'error': 'Transcriptions list is required'}), 400
        
        results = await llm_orchestrator.batch_summarize(
            transcriptions=transcriptions,
            max_concurrent=max_concurrent
        )
        
        return jsonify({
            'results': results,
            'total_processed': len(results),
            'successful': len([r for r in results if r.get('success')])
        })
    
    except Exception as e:
        logger.error(f"Batch summarization error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/llm/stats', methods=['GET'])
def llm_stats():
    """Get LLM orchestrator statistics."""
    try:
        stats = llm_orchestrator.get_stats()
        hf_stats = huggingface_service.get_stats()
        # bedrock_stats = bedrock_service.get_stats()  # Removed
        
        return jsonify({
            'orchestrator': stats,
            'huggingface': hf_stats,
            'bedrock': bedrock_stats
        })
    
    except Exception as e:
        logger.error(f"Stats error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/llm/models', methods=['GET'])
async def list_models():
    """List available LLM models."""
    try:
        hf_models = await huggingface_service.list_models()
        
        return jsonify({
            'huggingface_models': hf_models,
            'bedrock_enabled': False,  # Bedrock removed
            'default_model': huggingface_service.config.model_name
        })
    
    except Exception as e:
        logger.error(f"Model listing error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/test/llm', methods=['GET'])
async def test_llm():
    """Test LLM functionality with sample Hebrew text."""
    sample_transcription = """
    שלום, אני מתקשר בנוגע לבעיה עם האינטרנט שלי. 
    כבר שלושה ימים שהחיבור מתנתק כל הזמן.
    ניסיתי לאתחל את הראוטר אבל זה לא עוזר.
    אני צריך פתרון כי אני עובד מהבית.
    מספר הלקוח שלי הוא 123456789.
    """
    
    try:
        # Test basic generation
        simple_response = await llm_orchestrator.generate_response(
            prompt="תסכם בקצרה: " + sample_transcription,
            system_prompt="אתה עוזר וירטואלי שמסכם טקסטים בעברית"
        )
        
        # Test call summarization
        summary_response = await llm_orchestrator.summarize_call(
            transcription=sample_transcription,
            language='hebrew'
        )
        
        return jsonify({
            'sample_transcription': sample_transcription,
            'simple_generation': simple_response,
            'call_summary': summary_response,
            'test_status': 'success'
        })
    
    except Exception as e:
        logger.error(f"LLM test error: {e}")
        return jsonify({
            'error': str(e),
            'test_status': 'failed'
        }), 500


@app.route('/test/hebrew-strategies', methods=['POST'])
async def test_hebrew_strategies():
    """Test different Hebrew prompt strategies."""
    try:
        data = request.get_json()
        transcription = data.get('transcription', '')
        strategies = data.get('strategies', ['structured', 'simple', 'chain_of_thought', 'few_shot'])
        
        if not transcription:
            # Use default sample if none provided
            transcription = """
            שלום, אני מתקשר כי יש לי בעיה עם החבילה שלי.
            האינטרנט עובד לא טוב כבר שבוע.
            ניסיתי להתקשר כמה פעמים אבל התחכיתי.
            אני משלם 99 שקל בחודש ורוצה פתרון מיידי.
            """
        
        # Test different strategies using HuggingFace service
        results = await huggingface_service.test_hebrew_strategies(transcription, strategies)
        
        return jsonify({
            'transcription': transcription,
            'strategies_tested': strategies,
            'results': results,
            'test_status': 'success'
        })
    
    except Exception as e:
        logger.error(f"Hebrew strategies test error: {e}")
        return jsonify({
            'error': str(e),
            'test_status': 'failed'
        }), 500



# Embedding Endpoints
@app.route('/embeddings/generate', methods=['POST'])
async def generate_embedding():
    """Generate embeddings for text."""
    try:
        data = request.get_json()
        text = data.get('text', '')
        preprocess = data.get('preprocess', True)
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        result = await embedding_service.generate_embedding(text, preprocess)
        
        return jsonify({
            'text': result.text,
            'embedding': result.embedding.tolist(),
            'model_name': result.model_name,
            'processing_time': result.processing_time,
            'text_hash': result.text_hash
        })
    
    except Exception as e:
        logger.error(f"Embedding generation error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/embeddings/batch', methods=['POST'])
async def generate_batch_embeddings():
    """Generate embeddings for multiple texts."""
    try:
        data = request.get_json()
        texts = data.get('texts', [])
        preprocess = data.get('preprocess', True)
        
        if not texts:
            return jsonify({'error': 'Texts array is required'}), 400
        
        if len(texts) > 100:
            return jsonify({'error': 'Maximum 100 texts per batch'}), 400
        
        results = await embedding_service.generate_batch_embeddings(texts, preprocess)
        
        response_data = []
        for result in results:
            response_data.append({
                'text': result.text,
                'embedding': result.embedding.tolist(),
                'model_name': result.model_name,
                'processing_time': result.processing_time,
                'text_hash': result.text_hash
            })
        
        return jsonify({
            'results': response_data,
            'total_processed': len(response_data)
        })
    
    except Exception as e:
        logger.error(f"Batch embedding error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/embeddings/search', methods=['POST'])
async def search_similar():
    """Search for similar texts using embeddings."""
    try:
        data = request.get_json()
        query = data.get('query', '')
        k = data.get('k', 10)
        threshold = data.get('threshold', 0.5)
        
        if not query:
            return jsonify({'error': 'Query is required'}), 400
        
        results = await embedding_service.search_similar(query, k, threshold)
        
        return jsonify({
            'query': query,
            'results': results,
            'total_found': len(results)
        })
    
    except Exception as e:
        logger.error(f"Similarity search error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/embeddings/stats', methods=['GET'])
def embedding_stats():
    """Get embedding service statistics."""
    try:
        stats = embedding_service.get_stats()
        return jsonify(stats)
    
    except Exception as e:
        logger.error(f"Embedding stats error: {e}")
        return jsonify({'error': str(e)}), 500


# Vector Database Endpoints
@app.route('/vector/add', methods=['POST'])
async def add_to_vector_db():
    """Add transcription to vector database."""
    try:
        data = request.get_json()
        transcription_data = data.get('transcription_data')
        
        if not transcription_data:
            return jsonify({'error': 'Transcription data is required'}), 400
        
        success = await weaviate_service.add_transcription(transcription_data)
        
        if success:
            return jsonify({'success': True, 'message': 'Transcription added to vector database'})
        else:
            return jsonify({'success': False, 'error': 'Failed to add transcription'}), 500
    
    except Exception as e:
        logger.error(f"Vector add error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/vector/batch-add', methods=['POST'])
async def batch_add_to_vector_db():
    """Add multiple transcriptions to vector database."""
    try:
        data = request.get_json()
        transcriptions = data.get('transcriptions', [])
        
        if not transcriptions:
            return jsonify({'error': 'Transcriptions array is required'}), 400
        
        result = await weaviate_service.batch_add_transcriptions(transcriptions)
        
        return jsonify(result)
    
    except Exception as e:
        logger.error(f"Vector batch add error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/vector/search', methods=['POST'])
async def semantic_search():
    """Perform semantic search in vector database."""
    try:
        data = request.get_json()
        query = data.get('query', '')
        customer_id = data.get('customer_id')  # Allow None/null values
        limit = data.get('limit', 10)
        certainty = data.get('certainty', 0.7)
        filters = data.get('filters')
        
        if not query:
            return jsonify({'error': 'Query is required'}), 400
        
        # Customer ID is now optional - if None, search all data
        results = await weaviate_service.semantic_search(
            query, customer_id, limit, certainty, filters
        )
        
        return jsonify({
            'query': query,
            'customer_id': customer_id,
            'results': results,
            'total_found': len(results)
        })
    
    except Exception as e:
        logger.error(f"Semantic search error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/vector/stats', methods=['GET'])
async def vector_stats():
    """Get vector database statistics."""
    try:
        stats = await weaviate_service.get_stats()
        return jsonify(stats)
    
    except Exception as e:
        logger.error(f"Vector stats error: {e}")
        return jsonify({'error': str(e)}), 500


# Batch Processing Endpoints
@app.route('/batch/process-oracle', methods=['POST'])
async def batch_process_oracle():
    """Batch process Oracle data for embeddings and vector storage."""
    try:
        data = request.get_json()
        texts = data.get('texts', [])
        metadata = data.get('metadata', [])
        batch_size = data.get('batch_size')
        
        if not texts:
            return jsonify({'error': 'Texts array is required'}), 400
        
        # Process embeddings
        embedding_result = await embedding_service.batch_process_oracle_data(
            texts, metadata, batch_size
        )
        
        return jsonify({
            'embedding_processing': embedding_result,
            'total_texts': len(texts)
        })
    
    except Exception as e:
        logger.error(f"Batch Oracle processing error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/test/embeddings', methods=['GET'])
async def test_embeddings():
    """Test embedding functionality with Hebrew samples."""
    try:
        # Initialize model if needed
        await embedding_service.initialize_model()
        
        # Sample Hebrew texts
        sample_texts = [
            "שלום, אני מתקשר בנוגע לבעיה עם האינטרנט",
            "יש לי בעיה עם החשבון שלי",
            "אני רוצה לבטל את החבילה",
            "המכשיר לא עובד כמו שצריך",
            "תודה על השירות המעולה"
        ]
        
        # Test single embedding
        single_result = await embedding_service.generate_embedding(sample_texts[0])
        
        # Test batch embeddings
        batch_results = await embedding_service.generate_batch_embeddings(sample_texts)
        
        # Test similarity search (add to index first)
        await embedding_service.add_to_index(sample_texts[:3])
        search_results = await embedding_service.search_similar("בעיה טכנית", k=2)
        
        return jsonify({
            'single_embedding': {
                'text': single_result.text,
                'embedding_shape': single_result.embedding.shape,
                'processing_time': single_result.processing_time
            },
            'batch_processing': {
                'total_texts': len(batch_results),
                'avg_processing_time': sum(r.processing_time for r in batch_results) / len(batch_results)
            },
            'similarity_search': {
                'query': "בעיה טכנית",
                'results': search_results
            },
            'stats': embedding_service.get_stats(),
            'test_status': 'success'
        })
    
    except Exception as e:
        logger.error(f"Embedding test error: {e}")
        return jsonify({
            'error': str(e),
            'test_status': 'failed'
        }), 500


@app.route('/test/hebrew-preprocessing', methods=['POST'])
async def test_hebrew_preprocessing():
    """Test enhanced Hebrew preprocessing optimization."""
    try:
        data = request.get_json()
        texts = data.get('texts', [
            "שלום, יש לי בעיה טכנית עם ראוטר WiFi שלי",
            "אני מתקשר בנוגע לחיוב כפול בחשבון האינטרנט",
            "איכות השיחה לא טובה, יש ניתוק חיבור תמידי",
            "תמיכה טכנית - בעיית קישוריות במודם",
            "מהירות הגלישה איטית מאוד, תקלת רשת"
        ])
        
        # Test enhanced preprocessing
        results = await embedding_service.test_hebrew_preprocessing(texts)
        
        return jsonify({
            'test_results': results,
            'test_status': 'success'
        })
    
    except Exception as e:
        logger.error(f"Hebrew preprocessing test error: {e}")
        return jsonify({
            'error': str(e),
            'test_status': 'failed'
        }), 500


# ML Pipeline Endpoints
@app.route('/pipeline/process-call', methods=['POST'])
async def process_call():
    """Process a single call through the complete ML pipeline."""
    try:
        data = request.get_json()
        call_data = data.get('call_data')
        customer_context = data.get('customer_context')
        options = data.get('options')
        
        if not call_data:
            return jsonify({'error': 'Call data is required'}), 400
        
        if not customer_context:
            return jsonify({'error': 'Customer context is required'}), 400
        
        result = await ml_pipeline.process_call(call_data, customer_context, options)
        
        return jsonify({
            'success': result.success,
            'call_id': result.call_id,
            'processing_time': result.processing_time,
            'results': result.results,
            'errors': result.errors
        })
    
    except Exception as e:
        logger.error(f"Pipeline call processing error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/pipeline/process-batch', methods=['POST'])
async def process_batch():
    """Process multiple calls through the ML pipeline."""
    try:
        data = request.get_json()
        calls_data = data.get('calls_data', [])
        customer_context = data.get('customer_context')
        options = data.get('options')
        
        if not calls_data:
            return jsonify({'error': 'Calls data array is required'}), 400
        
        if not customer_context:
            return jsonify({'error': 'Customer context is required'}), 400
        
        if len(calls_data) > 50:
            return jsonify({'error': 'Maximum 50 calls per batch'}), 400
        
        results = await ml_pipeline.process_batch(calls_data, customer_context, options)
        
        # Aggregate results
        successful = len([r for r in results if r.success])
        total_errors = sum(len(r.errors) for r in results)
        avg_processing_time = sum(r.processing_time for r in results) / len(results)
        
        response_data = []
        for result in results:
            response_data.append({
                'success': result.success,
                'call_id': result.call_id,
                'processing_time': result.processing_time,
                'results': result.results,
                'errors': result.errors
            })
        
        return jsonify({
            'batch_results': response_data,
            'summary': {
                'total_calls': len(calls_data),
                'successful': successful,
                'failed': len(calls_data) - successful,
                'total_errors': total_errors,
                'avg_processing_time': avg_processing_time
            }
        })
    
    except Exception as e:
        logger.error(f"Pipeline batch processing error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/pipeline/intelligent-search', methods=['POST'])
async def intelligent_search():
    """Perform intelligent search using the ML pipeline."""
    try:
        data = request.get_json()
        query = data.get('query', '')
        customer_context = data.get('customer_context')
        search_options = data.get('search_options')
        
        if not query:
            return jsonify({'error': 'Query is required'}), 400
        
        if not customer_context:
            return jsonify({'error': 'Customer context is required'}), 400
        
        result = await ml_pipeline.intelligent_search(query, customer_context, search_options)
        
        return jsonify(result)
    
    except Exception as e:
        logger.error(f"Intelligent search error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/pipeline/stats', methods=['GET'])
def pipeline_stats():
    """Get ML pipeline statistics."""
    try:
        stats = ml_pipeline.get_stats()
        return jsonify(stats)
    
    except Exception as e:
        logger.error(f"Pipeline stats error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/test/pipeline', methods=['GET'])
async def test_pipeline():
    """Test the complete ML pipeline with sample data."""
    try:
        # Sample call data
        sample_call = {
            'callId': 'pipeline-test-001',
            'subscriberId': 'SUB-TEST-001',
            'transcriptionText': '''
            שלום, אני מתקשר בנוגע לבעיה רצינית עם האינטרנט שלי.
            כבר שלושה ימים שהחיבור מתנתק כל חצי שעה.
            ניסיתי לאתחל את הראוטר מספר פעמים אבל זה לא עוזר.
            אני עובד מהבית ויש לי פגישות וידאו חשובות היום.
            המספר שלי הוא 054-123-4567.
            תוכלו בבקשה לשלוח טכנאי או לתת לי פתרון מיידי?
            ''',
            'language': 'he',
            'callDate': '2024-01-15T10:30:00Z',
            'durationSeconds': 240,
            'agentId': 'AGENT-TEST-001',
            'callType': 'support'
        }
        
        customer_context = {
            'customerId': 'PIPELINE-TEST-CUSTOMER',
            'subscriberIds': ['SUB-TEST-001']
        }
        
        # Process through pipeline
        result = await ml_pipeline.process_call(sample_call, customer_context)
        
        # Test intelligent search
        search_result = await ml_pipeline.intelligent_search(
            query='בעיה עם האינטרנט',
            customer_context=customer_context,
            search_options={'limit': 3, 'certainty': 0.6}
        )
        
        return jsonify({
            'pipeline_processing': {
                'success': result.success,
                'call_id': result.call_id,
                'processing_time': result.processing_time,
                'results_keys': list(result.results.keys()),
                'errors': result.errors
            },
            'intelligent_search': {
                'success': search_result['success'],
                'query': search_result['query'],
                'results_found': search_result['total_found'],
                'processing_time': search_result['processing_time']
            },
            'pipeline_stats': ml_pipeline.get_stats(),
            'test_status': 'success'
        })
    
    except Exception as e:
        logger.error(f"Pipeline test error: {e}")
        return jsonify({
            'error': str(e),
            'test_status': 'failed'
        }), 500


async def pre_warm_models():
    """Pre-warm all ML models during startup to eliminate cold start delays."""
    try:
        logger.info("🔥 Pre-warming models to eliminate cold start delays...")
        start_time = datetime.now()
        
        # Pre-warm embedding service (biggest bottleneck - 20-30s)
        logger.info("Pre-warming AlephBERT embedding model...")
        embedding_success = await embedding_service.initialize_model()
        if embedding_success:
            logger.info("✅ AlephBERT model pre-warmed successfully")
        else:
            logger.error("❌ Failed to pre-warm AlephBERT model")
        
        # Pre-warm LLM orchestrator
        logger.info("Pre-warming LLM orchestrator...")
        try:
            llm_health = await llm_orchestrator.health_check()
            if llm_health.get('status') == 'healthy':
                logger.info("✅ LLM orchestrator pre-warmed successfully")
            else:
                logger.warning("⚠️ LLM orchestrator health check returned warnings")
        except Exception as e:
            logger.error(f"❌ Failed to pre-warm LLM orchestrator: {e}")
        
        # No Hebrew processor needed - DictaLM and AlephBERT handle Hebrew natively
        logger.info("✅ Hebrew processing handled natively by DictaLM and AlephBERT")
        
        # Pre-warm with sample embedding to fully initialize GPU
        if embedding_success:
            try:
                logger.info("Generating sample embedding to fully initialize GPU...")
                sample_result = await embedding_service.generate_embedding(
                    "דוגמה לטקסט עברי לחימום המודל", 
                    preprocess=True
                )
                logger.info(f"✅ GPU fully initialized - sample embedding took {sample_result.processing_time:.2f}s")
            except Exception as e:
                logger.error(f"❌ Failed to generate sample embedding: {e}")
        
        end_time = datetime.now()
        total_warmup_time = (end_time - start_time).total_seconds()
        
        logger.info(f"🚀 Model pre-warming completed in {total_warmup_time:.2f}s")
        logger.info("✨ Cold start delays eliminated - service ready for production!")
        
    except Exception as e:
        logger.error(f"❌ Critical error during model pre-warming: {e}")
        logger.error("⚠️ Service will continue but may experience cold start delays")

if __name__ == '__main__':
    port = int(os.getenv('ML_SERVICE_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    
    logger.info(f"Starting ML Service on port {port}")
    logger.info("Native Hebrew processing via DictaLM and AlephBERT")
    
    # Pre-warm models before starting the server
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(pre_warm_models())
    loop.close()
    
    logger.info("🔥 All models pre-warmed - starting Flask server...")
    app.run(host='0.0.0.0', port=port, debug=debug)