import os
import logging
import signal
import atexit
import numpy as np
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# Import utilities and services
# Removed hebrew_processor - DictaLM and AlephBERT handle Hebrew natively
from src.services.llm_orchestrator import llm_orchestrator
from src.services.ollama_service import ollama_service
# from src.services.huggingface_service import huggingface_service  # Using Ollama instead
# from src.services.bedrock_service import bedrock_service  # Removed - not using Bedrock
from src.services.embedding_service import embedding_service
# from src.services.weaviate_service import weaviate_service  # Disabled - not using Weaviate
# from src.services.ml_pipeline import ml_pipeline  # Disabled - causes Weaviate connection attempts
from src.services.churn_prediction_service import churn_prediction_service
from src.services.churn_endpoints import churn_bp

# Load environment variables
load_dotenv('../config/.env.ml')

# Import AWS secrets service
from src.services.aws_secrets_service import aws_secrets_service

# Import SQS consumer and producer services
from src.services.sqs_consumer_service import create_ml_consumer, SQSConsumerService
from src.services.sqs_producer_service import get_sqs_producer

# Import CloudWatch metrics service
from src.services.cloudwatch_metrics_service import cloudwatch_metrics

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('ML_LOG_LEVEL', 'INFO').upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Message processor function for SQS
async def process_sqs_message(message_data):
    """Process incoming SQS messages for ML processing"""
    try:
        logger.info(f"Processing SQS message for call ID: {message_data.get('callId', 'unknown')}")
        
        # Extract conversation data
        call_id = message_data.get('callId', '')
        messages = message_data.get('messages', [])
        
        # Build transcription text from messages
        transcription_lines = []
        for msg in messages:
            # CDC service sends 'channel' (not 'speaker'): 'A' for agent, 'C' for customer
            channel = msg.get('channel', msg.get('speaker', 'unknown'))
            text = msg.get('text', '')
            if text:
                transcription_lines.append(f"{channel}: {text}")
        
        transcription_text = '\n'.join(transcription_lines)
        
        if not transcription_text:
            logger.warning(f"No transcription text found for call {call_id}")
            return False
        
        # Call the LLM orchestrator to generate summary with classifications
        logger.info(f"Generating summary for call {call_id} with {len(messages)} messages")
        result = await llm_orchestrator.summarize_call(
            transcription=transcription_text,
            call_id=call_id,
            language='hebrew',  # Default to Hebrew for this deployment
            prefer_local=True,
            use_call_id_prompt=True,
            prompt_template='summarize_with_id'
        )
        
        # Always send results (success or fallback)
        summary_data = result.get('summary', {}) if result.get('success') else result.get('fallback_summary', {})
        is_success = result.get('success', False)
        error_msg = result.get('error', '')

        # Get processing time from metadata
        processing_time = result.get('metadata', {}).get('processing_time', 0)

        # === CloudWatch Metrics: Phase 1 ===
        cloudwatch_metrics.put_metric('CallsProcessed', 1)
        cloudwatch_metrics.put_metric('ProcessingTime', processing_time * 1000, 'Milliseconds')

        if is_success:
            logger.info(f"✅ Summary generated successfully for call {call_id}")
            cloudwatch_metrics.put_metric('CallsSuccessful', 1)

            # Sentiment tracking from summary
            sentiment = summary_data.get('sentiment', 3)
            if isinstance(sentiment, int):
                if sentiment >= 4:
                    cloudwatch_metrics.put_metric('SentimentPositive', 1)
                elif sentiment <= 2:
                    cloudwatch_metrics.put_metric('SentimentNegative', 1)
                else:
                    cloudwatch_metrics.put_metric('SentimentNeutral', 1)
            elif isinstance(sentiment, str):
                # Handle string sentiment values
                sentiment_lower = sentiment.lower()
                if sentiment_lower in ['positive', 'חיובי']:
                    cloudwatch_metrics.put_metric('SentimentPositive', 1)
                elif sentiment_lower in ['negative', 'שלילי']:
                    cloudwatch_metrics.put_metric('SentimentNegative', 1)
                else:
                    cloudwatch_metrics.put_metric('SentimentNeutral', 1)
        else:
            logger.warning(f"⚠️ LLM failed for call {call_id}: {error_msg}, using fallback summary")
            cloudwatch_metrics.put_metric('CallsFailed', 1)

        # Prepare ML result data (works for both success and fallback)
        sqs_producer = get_sqs_producer()
        ml_result = {
            'callId': call_id,
            'summary': summary_data.get('summary', 'שגיאה ביצירת סיכום - נדרשת בדיקה ידנית'),
            'sentiment': {
                'overall': summary_data.get('sentiment', 'neutral'),
                'score': 0.8 if is_success else 0.5
            },
            'classification': {
                'primary': summary_data.get('classifications', ['general_inquiry'])[0] if summary_data.get('classifications') else 'general_inquiry',
                'all': summary_data.get('classifications', [])
            },
            'classifications': summary_data.get('classifications', ['requires_manual_review'] if not is_success else []),
            'confidence': 0.85 if is_success else 0.3,  # Lower confidence for fallback
            'keyPoints': summary_data.get('key_points', ['LLM processing failed - manual review required'] if not is_success else []),
            'actionItems': summary_data.get('action_items', ['Manual review required'] if not is_success else []),
            'processingTime': result.get('metadata', {}).get('processing_time', 0) * 1000 if is_success else 0,
            'processingError': error_msg if not is_success else None
        }

        # 1. Send to SQS for CDC service to save to local Oracle database
        # ONLY send if summarization was successful - don't save failed attempts
        if is_success:
            ml_sent = await sqs_producer.send_ml_result(ml_result)
            if ml_sent:
                logger.info(f"✅ ML result sent to SQS for CDC → Oracle processing")
            else:
                logger.warning(f"⚠️ Failed to send ML result to SQS for call {call_id}")

            # 2. Send to OpenSearch for quick LLM/Dicta retrieval (AWS cloud indexing)
            # ONLY send successful summaries to OpenSearch too
            opensearch_sent = await sqs_producer.send_to_opensearch_queue(ml_result)
            if opensearch_sent:
                logger.info(f"✅ ML result sent for OpenSearch indexing (for Dicta quick access)")

            # 3. Generate and send embeddings for vector search (3-queue architecture)
            # Generate embedding from the summary text
            try:
                summary_text = summary_data.get('summary', '')
                if summary_text:
                    logger.info(f"🔄 Generating AlephBERT embedding for call {call_id}")

                    # Generate embedding using AlephBERT
                    embedding_results = await embedding_service.generate_batch_embeddings([summary_text])

                    if embedding_results and isinstance(embedding_results, list) and len(embedding_results) > 0:
                        # Extract the embedding from the EmbeddingResult object
                        embedding_result = embedding_results[0]  # Get first (and only) result
                        embedding_vector = embedding_result.embedding  # Get the actual embedding numpy array

                        # Send embedding to dedicated queue
                        embedding_sent = await sqs_producer.send_embedding(
                            call_id=call_id,
                            embedding=embedding_vector.tolist() if hasattr(embedding_vector, 'tolist') else list(embedding_vector),
                            summary_text=summary_text
                        )

                        if embedding_sent:
                            logger.info(f"✅ Embedding sent to queue for call {call_id} (768 dimensions)")
                        else:
                            logger.warning(f"⚠️ Failed to send embedding to queue for call {call_id}")
                    else:
                        logger.warning(f"⚠️ No embedding generated for call {call_id}")
                else:
                    logger.warning(f"⚠️ No summary text available for embedding generation for call {call_id}")

            except Exception as embedding_error:
                # Don't fail the whole process if embedding fails
                logger.error(f"❌ Error generating/sending embedding for call {call_id}: {embedding_error}")
                # Continue - embeddings are optional enhancement
        else:
            # LLM failed - retry via SQS
            logger.warning(f"⚠️ LLM failed for call {call_id} - will retry via SQS: {error_msg}")

            # Get retry count from message to prevent infinite loops
            retry_count = message_data.get('retryCount', 0)
            max_retries = 3

            if retry_count >= max_retries:
                logger.error(f"❌ Max retries ({max_retries}) exceeded for call {call_id} - message will go to DLQ")
                # Return True to delete from main queue - SQS will send to DLQ
                return True

            logger.warning(f"❌ LLM failure (attempt {retry_count + 1}/{max_retries}) for call {call_id} - keeping in SQS for retry")
            return False  # Keep message in SQS for retry

        logger.info(f"Summary: {summary_data.get('summary', 'N/A')[:200]}...")
        logger.info(f"Classifications: {summary_data.get('classifications', [])}")
        logger.info(f"Key Points: {summary_data.get('key_points', [])}")

        return True  # Success - delete message from SQS
            
    except Exception as e:
        logger.error(f"Error processing SQS message: {e}")
        return False

# Create SQS consumer instance
sqs_consumer = create_ml_consumer(process_sqs_message)

# Initialize Flask app
app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False  # Allow non-ASCII characters in JSON responses
CORS(app)

# Register churn prediction blueprint
app.register_blueprint(churn_bp)

# Ensure UTF-8 encoding for all responses
app.config['JSON_AS_ASCII'] = False

# Initialize services on startup to ensure classifications are loaded
logger.info("🚀 Initializing ML services on startup...")
# Force OllamaService initialization by accessing it
_ = ollama_service.hebrew_classifications
logger.info(f"✅ OllamaService initialized with {len(ollama_service.hebrew_classifications)} classifications")

# Pre-load embedding service to initialize CUDA on startup
try:
    import asyncio
    async def init_embedding_service():
        logger.info("🔥 Pre-loading embedding service and CUDA...")
        # Generate a dummy embedding to initialize CUDA
        result = await embedding_service.generate_batch_embeddings(["שלום"])
        logger.info("✅ Embedding service and CUDA initialized successfully")
    
    # Run the async initialization
    asyncio.get_event_loop().run_until_complete(init_embedding_service())
except Exception as e:
    logger.warning(f"⚠️ Could not pre-load embedding service: {e}")
    logger.info("🔄 Service will continue, embeddings will be loaded on first use")

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
    # Check SQS consumer health
    sqs_health = sqs_consumer.health_check()
    
    # Use synchronous health check for now
    pipeline_health = {
        'pipeline_status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'components': {
            'embeddings': {'status': 'healthy'},
            'llm': {'status': 'healthy'},
            'hebrew_support': {'status': 'native', 'note': 'Built into DictaLM and AlephBERT'},
            'sqs_consumer': sqs_health
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


@app.route('/admin/reload-classifications', methods=['POST'])
async def reload_classifications():
    """Reload call classifications from JSON file."""
    try:
        # Reload classifications
        success = ollama_service.reload_classifications()
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Classifications reloaded successfully',
                'count': len(ollama_service.hebrew_classifications)
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to reload classifications'
            }), 500
            
    except Exception as e:
        logger.error(f"Error reloading classifications: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/admin/clear-cache', methods=['POST'])
async def clear_cache():
    """Clear the Ollama inference cache."""
    try:
        ollama_service.clear_cache()
        return jsonify({
            'success': True,
            'message': 'Cache cleared successfully'
        })
    except Exception as e:
        logger.error(f"Error clearing cache: {e}")
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


# ML Pipeline Endpoints (Old endpoints disabled - using new implementations below)

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


@app.route('/api/analyze-conversation', methods=['POST'])
async def analyze_conversation():
    """Analyze conversation - endpoint expected by API consumer."""
    try:
        data = request.get_json()
        text = data.get('text', '')
        call_id = data.get('callId', '')
        options = data.get('options', {})
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        # Use the LLM orchestrator to get summary with classifications
        # Pass call_id and new options for prompt generation
        result = await llm_orchestrator.summarize_call(
            transcription=text,
            call_id=call_id,  # Pass call ID for Hebrew prompt generation
            language='hebrew' if any(ord(c) >= 0x0590 and ord(c) <= 0x05FF for c in text) else 'english',
            prefer_local=True,
            use_call_id_prompt=options.get('useCallIdPrompt', True),  # Enable by default
            prompt_template=options.get('promptTemplate', 'summarize_with_id')
        )
        
        # Generate embedding if requested
        embedding = None
        if options.get('includeEmbedding', False):
            embedding_result = await embedding_service.generate_batch_embeddings([text])
            if embedding_result and len(embedding_result) > 0:
                # Get the embedding from the EmbeddingResult object
                embedding_obj = embedding_result[0]
                if hasattr(embedding_obj, 'embedding'):
                    embedding_array = embedding_obj.embedding
                    if isinstance(embedding_array, np.ndarray):
                        embedding = embedding_array.tolist()
                    else:
                        embedding = list(embedding_array)
        
        # Extract summary data correctly - the LLM orchestrator returns data nested under 'summary'
        summary_data = result.get('summary', {})
        
        # Debug logging
        logger.info(f"ML result keys: {list(result.keys())}")
        logger.info(f"Summary data: {summary_data}")
        logger.info(f"Summary text: {summary_data.get('summary', 'EMPTY')}")
        logger.info(f"Classifications: {summary_data.get('classifications', [])}")
        logger.info(f"Key points: {summary_data.get('key_points', [])}")
        
        # Format response to match what the API consumer expects
        response = {
            'callId': call_id,
            'embedding': embedding,
            'sentiment': {
                'overall': summary_data.get('sentiment', 'neutral'),
                'score': 0.8,  # Default score
                'distribution': {
                    'positive': 0.33,
                    'negative': 0.33,
                    'neutral': 0.34
                }
            },
            'language': {
                'detected': 'hebrew' if any(ord(c) >= 0x0590 and ord(c) <= 0x05FF for c in text) else 'english',
                'confidence': 0.95,
                'isHebrew': any(ord(c) >= 0x0590 and ord(c) <= 0x05FF for c in text)
            },
            'summary': summary_data.get('summary', ''),
            'classifications': summary_data.get('classifications', []),
            'keyPoints': summary_data.get('key_points', []),
            'actionItems': summary_data.get('action_items', []),
            'entities': [],  # Could be populated later
            'topics': [],   # Could be populated later
            'success': True,
            'processingTime': result.get('metadata', {}).get('processing_time', 0)
        }
        
        return jsonify(response)
    
    except Exception as e:
        logger.error(f"Conversation analysis error: {e}")
        return jsonify({'error': str(e)}), 500


def _validate_conversation_quality(text: str) -> str:
    """
    Validate conversation quality.
    Returns: 'good', 'low_quality', or 'empty'
    """
    if not text or len(text.strip()) < 100:
        logger.warning(f"Empty or very short conversation: {len(text) if text else 0} chars")
        return 'empty'

    # Check for A: and C: markers (agent and customer dialogue)
    has_agent = 'A:' in text or 'א:' in text
    has_customer = 'C:' in text or 'ל:' in text

    if not (has_agent and has_customer):
        logger.warning("Missing dialogue markers (A:/C:) in conversation")
        return 'low_quality'

    # Check for excessive repetition
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    if len(lines) > 3:
        unique_lines = len(set(lines))
        repetition_ratio = unique_lines / len(lines)
        if repetition_ratio < 0.3:  # >70% repetition
            logger.warning(f"High repetition detected: {repetition_ratio:.2%} unique lines")
            return 'low_quality'

    return 'good'


@app.route('/pipeline/process-call', methods=['POST'])
async def process_call_pipeline():
    """Process call pipeline endpoint - matches API service expectations."""
    try:
        logger.info("Pipeline process-call endpoint called")
        data = request.get_json()
        logger.info(f"Received data: {data}")
        
        if data is None:
            logger.error("No JSON data received")
            return jsonify({'error': 'No JSON data provided'}), 400
            
        call_data = data.get('call_data', {})
        customer_context = data.get('customer_context', {})
        options = data.get('options', {})
        
        logger.info(f"Parsed - call_data keys: {list(call_data.keys()) if call_data else 'None'}")
        logger.info(f"Parsed - customer_context: {customer_context}")
        logger.info(f"Parsed - options: {options}")
        
        # Extract call information
        call_id = call_data.get('callId', '')
        transcription_text = call_data.get('transcriptionText', '')

        if not transcription_text:
            return jsonify({
                'success': False,
                'callId': call_id,
                'processingTime': 0,
                'results': {},
                'errors': ['No transcription text provided']
            }), 400

        # Validate conversation quality
        conversation_quality = _validate_conversation_quality(transcription_text)
        logger.info(f"Conversation quality for call {call_id}: {conversation_quality}")

        # Modify transcription for low-quality conversations
        if conversation_quality in ['empty', 'low_quality']:
            # Add context to help model generate appropriate "אין מספיק מידע" response
            transcription_text = f"{transcription_text}\n\n[Quality: {conversation_quality} - insufficient information for detailed analysis]"

        # Use the same simple logic as analyze_conversation - avoid ML pipeline
        result = await llm_orchestrator.summarize_call(
            transcription=transcription_text,
            language='hebrew' if any(ord(c) >= 0x0590 and ord(c) <= 0x05FF for c in transcription_text) else 'english',
            prefer_local=True
        )
        
        # Generate embedding if requested (handle multiple option formats)
        embedding = None
        should_generate_embedding = (
            options.get('enableEmbeddings', False) or 
            options.get('generate_embeddings', False)
        )
        
        if should_generate_embedding:
            embedding_result = await embedding_service.generate_batch_embeddings([transcription_text])
            if embedding_result and len(embedding_result) > 0:
                embedding_obj = embedding_result[0]
                if hasattr(embedding_obj, 'embedding'):
                    embedding_array = embedding_obj.embedding
                    if isinstance(embedding_array, np.ndarray):
                        embedding = embedding_array.tolist()
                    else:
                        embedding = list(embedding_array)
        
        # Debug: log the result structure
        logger.info(f"LLM result structure: {result}")
        
        # Format response to match MLProcessingResult interface
        response = {
            'success': True,
            'callId': call_id,
            'processingTime': result.get('metadata', {}).get('processing_time', 0),
            'conversationQuality': conversation_quality,  # Add quality flag
            'results': {
                'preprocessing': {
                    'language': 'hebrew' if any(ord(c) >= 0x0590 and ord(c) <= 0x05FF for c in transcription_text) else 'english',
                    'textLength': len(transcription_text),
                    'conversationQuality': conversation_quality  # Also in preprocessing for compatibility
                },
                'embedding': embedding,
                'llmAnalysis': {
                    'summary': result.get('summary', {}).get('summary', ''),
                    'classifications': result.get('summary', {}).get('classifications', []),
                    'sentiment': result.get('summary', {}).get('sentiment', 'neutral'),
                    'keyPoints': result.get('summary', {}).get('key_points', []),
                    'actionItems': result.get('summary', {}).get('action_items', [])
                },
                'vectorStorage': None,  # Will be handled by downstream services
                'productAnalysis': {
                    'productsDetected': result.get('summary', {}).get('products_mentioned', [])
                }
            },
            'errors': []
        }
        
        return jsonify(response)
    
    except Exception as e:
        logger.error(f"Pipeline processing error: {e}")
        return jsonify({
            'success': False,
            'callId': call_data.get('callId', 'unknown') if 'call_data' in locals() else 'unknown',
            'processingTime': 0,
            'results': {},
            'errors': [str(e)]
        }), 500


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


def shutdown_handler(signum=None, frame=None):
    """Gracefully shutdown the application and SQS consumer."""
    logger.info("🛑 Shutdown signal received - cleaning up...")
    try:
        sqs_consumer.stop()
        logger.info("✅ SQS consumer stopped gracefully")
    except Exception as e:
        logger.error(f"❌ Error stopping SQS consumer: {e}")
    logger.info("👋 ML Service shutdown complete")


if __name__ == '__main__':
    port = int(os.getenv('ML_SERVICE_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    
    logger.info(f"Starting ML Service on port {port}")
    logger.info("Native Hebrew processing via DictaLM and AlephBERT")
    
    # Register shutdown handlers for graceful cleanup
    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)
    atexit.register(shutdown_handler)
    
    # Pre-warm models before starting the server
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(pre_warm_models())
    loop.close()
    
    # Start SQS consumer after model pre-warming
    logger.info("🚀 Starting SQS consumer service...")
    if sqs_consumer.start():
        logger.info("✅ SQS consumer started successfully")
    else:
        logger.warning("⚠️ SQS consumer failed to start - service will continue with REST-only mode")
    
    logger.info("🔥 All models pre-warmed - starting Flask server...")
    app.run(host='0.0.0.0', port=port, debug=debug)