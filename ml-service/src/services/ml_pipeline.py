import os
import logging
import asyncio
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime
from dataclasses import dataclass
import json

from .embedding_service import embedding_service
from .llm_orchestrator import llm_orchestrator
from .weaviate_service import weaviate_service
# Removed hebrew_processor - AlephBERT and DictaLM handle Hebrew natively

logger = logging.getLogger(__name__)


@dataclass
class MLPipelineConfig:
    enable_embeddings: bool
    enable_llm: bool
    enable_vector_storage: bool
    batch_size: int
    timeout: int


@dataclass
class ProcessingResult:
    success: bool
    call_id: str
    processing_time: float
    results: Dict
    errors: List[str]


class MLPipeline:
    """
    Comprehensive ML pipeline for call analytics processing.
    Integrates embedding generation, LLM analysis, and vector storage.
    """
    
    def __init__(self):
        self.config = MLPipelineConfig(
            enable_embeddings=os.getenv('ENABLE_EMBEDDINGS', 'true').lower() == 'true',
            enable_llm=os.getenv('ENABLE_LLM', 'true').lower() == 'true',
            enable_vector_storage=os.getenv('ENABLE_VECTOR_STORAGE', 'true').lower() == 'true',
            batch_size=int(os.getenv('PIPELINE_BATCH_SIZE', '10')),
            timeout=int(os.getenv('PIPELINE_TIMEOUT', '300'))
        )
        
        self.stats = {
            'calls_processed': 0,
            'embeddings_generated': 0,
            'summaries_created': 0,
            'vector_entries_added': 0,
            'errors': 0,
            'total_processing_time': 0.0
        }
        
        logger.info("ML Pipeline initialized")
    
    async def process_call(
        self,
        call_data: Dict,
        customer_context: Dict,
        options: Optional[Dict] = None
    ) -> ProcessingResult:
        """Process a single call through the complete ML pipeline."""
        
        start_time = datetime.now()
        call_id = call_data.get('callId', 'unknown')
        transcription = call_data.get('transcriptionText', '')
        language = call_data.get('language', 'he')
        
        results = {}
        errors = []
        
        try:
            logger.info(f"🚀 Processing call {call_id} with parallel pipeline")
            
            # PARALLEL OPTIMIZATION: Run independent operations concurrently
            parallel_tasks = []
            
            # Step 1: No preprocessing - DictaLM and AlephBERT handle Hebrew natively
            logger.info("⚡ Skipping preprocessing - Hebrew models handle raw text natively")
            
            # Step 2 & 3: Run Embedding Generation and LLM Analysis in PARALLEL
            if transcription:
                # Task 1: Embedding Generation (independent)
                if self.config.enable_embeddings:
                    async def generate_embedding_task():
                        try:
                            embedding_result = await embedding_service.generate_embedding(
                                transcription, preprocess=True
                            )
                            
                            self.stats['embeddings_generated'] += 1
                            return ('embedding', {
                                'dimension': len(embedding_result.embedding),
                                'processing_time': embedding_result.processing_time,
                                'model_name': embedding_result.model_name,
                                'text_hash': embedding_result.text_hash
                                # embedding_data removed for JSON serialization
                            })
                            
                        except Exception as e:
                            error_msg = f"Embedding generation failed: {e}"
                            errors.append(error_msg)
                            logger.error(error_msg)
                            return ('embedding', {'error': error_msg})
                    
                    parallel_tasks.append(generate_embedding_task())
                
                # Task 2: LLM Analysis (independent)
                if self.config.enable_llm:
                    async def llm_analysis_task():
                        try:
                            summary_result = await llm_orchestrator.summarize_call(
                                transcription=transcription,
                                language=language
                            )
                            
                            if summary_result['success']:
                                self.stats['summaries_created'] += 1
                                return ('llm_analysis', {
                                    'summary': summary_result['summary'],
                                    'service_used': summary_result.get('service', 'unknown'),
                                    'processing_time': summary_result.get('processing_time', 0),
                                    'metadata': summary_result.get('metadata', {})
                                })
                            else:
                                error_msg = f"LLM analysis failed: {summary_result.get('error', 'Unknown error')}"
                                errors.append(error_msg)
                                
                                return ('llm_analysis', {
                                    'summary': summary_result.get('fallback_summary', {}),
                                    'service_used': 'fallback',
                                    'error': error_msg
                                })
                        
                        except Exception as e:
                            error_msg = f"LLM processing failed: {e}"
                            errors.append(error_msg)
                            logger.error(error_msg)
                            return ('llm_analysis', {'error': error_msg})
                    
                    parallel_tasks.append(llm_analysis_task())
                
                # Execute parallel tasks
                if parallel_tasks:
                    logger.info(f"⚡ Running {len(parallel_tasks)} tasks in parallel")
                    parallel_results = await asyncio.gather(*parallel_tasks, return_exceptions=True)
                    
                    # Process parallel results
                    for task_result in parallel_results:
                        if isinstance(task_result, Exception):
                            errors.append(f"Parallel task failed: {task_result}")
                            continue
                        
                        task_name, task_data = task_result
                        results[task_name] = task_data
            
            # Step 4: Vector Database Storage (synchronous with proper error handling)
            if self.config.enable_vector_storage and transcription:
                try:
                    logger.info(f"💾 Starting vector storage for call {call_id}")
                    
                    # Prepare data for vector storage
                    vector_data = {
                        'callId': call_id,
                        'customerId': customer_context.get('customerId'),
                        'subscriberId': call_data.get('subscriberId'),
                        'transcriptionText': transcription,
                        'language': language,
                        'callDate': call_data.get('callDate'),
                        'durationSeconds': call_data.get('durationSeconds'),
                        'agentId': call_data.get('agentId'),
                        'callType': call_data.get('callType'),
                        'sentiment': results.get('llm_analysis', {}).get('summary', {}).get('sentiment'),
                        'productsMentioned': results.get('llm_analysis', {}).get('summary', {}).get('products_mentioned', []),
                        'keyPoints': results.get('llm_analysis', {}).get('summary', {}).get('key_points', [])
                    }
                    
                    vector_success = await weaviate_service.add_transcription(vector_data)
                    
                    if vector_success:
                        self.stats['vector_entries_added'] += 1
                        logger.info(f"✅ Vector storage completed for call {call_id}")
                        results['vector_storage'] = {
                            'success': True,
                            'message': 'Vector storage completed successfully'
                        }
                    else:
                        error_msg = f"Vector storage failed for call {call_id}"
                        logger.warning(f"⚠️ {error_msg}")
                        errors.append(error_msg)
                        results['vector_storage'] = {
                            'success': False,
                            'error': error_msg
                        }
                        
                except Exception as e:
                    error_msg = f"Vector storage error for call {call_id}: {e}"
                    logger.error(f"❌ {error_msg}")
                    errors.append(error_msg)
                    results['vector_storage'] = {
                        'success': False,
                        'error': error_msg
                    }
            
            # Step 5: Product and Entity Analysis
            if transcription:
                try:
                    # Extract product mentions using preprocessing results
                    preprocessing_results = results.get('preprocessing', {})
                    entities = preprocessing_results.get('entities', {})
                    
                    # Enhanced product detection
                    products_detected = []
                    if 'hebrew_words' in entities:
                        # Common product keywords in Hebrew
                        product_keywords = [
                            'אינטרנט', 'טלוויזיה', 'טלפון', 'חבילה', 'מכשיר', 'ראוטר',
                            'אייפון', 'סמסונג', 'מחשב', 'טאבלט', 'אפליקציה'
                        ]
                        
                        for word in entities['hebrew_words']:
                            if word in product_keywords:
                                products_detected.append(word)
                    
                    results['product_analysis'] = {
                        'products_detected': products_detected,
                        'phone_numbers_found': len(preprocessing_results.get('phone_numbers', [])),
                        'entity_summary': {k: len(v) for k, v in entities.items()}
                    }
                
                except Exception as e:
                    error_msg = f"Product analysis failed: {e}"
                    errors.append(error_msg)
                    logger.error(error_msg)
            
            # Update statistics
            end_time = datetime.now()
            processing_time = (end_time - start_time).total_seconds()
            
            self.stats['calls_processed'] += 1
            self.stats['total_processing_time'] += processing_time
            
            if errors:
                self.stats['errors'] += 1
            
            success = len(errors) == 0 or len(results) > len(errors)
            
            return ProcessingResult(
                success=success,
                call_id=call_id,
                processing_time=processing_time,
                results=results,
                errors=errors
            )
            
        except Exception as e:
            error_msg = f"Pipeline processing failed: {e}"
            logger.error(error_msg)
            
            end_time = datetime.now()
            processing_time = (end_time - start_time).total_seconds()
            
            return ProcessingResult(
                success=False,
                call_id=call_id,
                processing_time=processing_time,
                results=results,
                errors=[error_msg]
            )
    
    async def process_batch(
        self,
        calls_data: List[Dict],
        customer_context: Dict,
        options: Optional[Dict] = None
    ) -> List[ProcessingResult]:
        """Process multiple calls in parallel with controlled concurrency."""
        
        semaphore = asyncio.Semaphore(self.config.batch_size)
        
        async def process_single_with_semaphore(call_data):
            async with semaphore:
                return await self.process_call(call_data, customer_context, options)
        
        # Process all calls concurrently
        tasks = [process_single_with_semaphore(call_data) for call_data in calls_data]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Handle exceptions
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                processed_results.append(ProcessingResult(
                    success=False,
                    call_id=calls_data[i].get('callId', f'batch-{i}'),
                    processing_time=0.0,
                    results={},
                    errors=[str(result)]
                ))
            else:
                processed_results.append(result)
        
        return processed_results
    
    async def intelligent_search(
        self,
        query: str,
        customer_context: Dict,
        search_options: Optional[Dict] = None
    ) -> Dict:
        """Perform intelligent search combining embeddings and vector search."""
        
        start_time = datetime.now()
        
        try:
            # Default search options
            options = search_options or {}
            limit = options.get('limit', 10)
            certainty = options.get('certainty', 0.7)
            include_similar = options.get('include_similar', True)
            
            results = {}
            
            # Step 1: No preprocessing - DictaLM handles Hebrew natively  
            processed_query = query
            
            # Step 2: Generate query embedding
            if self.config.enable_embeddings:
                query_embedding = await embedding_service.generate_embedding(processed_query)
                results['query_embedding'] = {
                    'original_query': query,
                    'processed_query': processed_query,
                    'embedding_dimension': len(query_embedding.embedding)
                }
            
            # Step 3: Vector database search
            if self.config.enable_vector_storage:
                vector_results = await weaviate_service.semantic_search(
                    query=processed_query,
                    customer_id=customer_context.get('customerId'),
                    limit=limit,
                    certainty=certainty,
                    filters=options.get('filters')
                )
                
                results['vector_search'] = {
                    'results': vector_results,
                    'total_found': len(vector_results)
                }
            
            # Step 4: FAISS similarity search (if available)
            if include_similar and self.config.enable_embeddings:
                try:
                    faiss_results = await embedding_service.search_similar(
                        query_text=processed_query,
                        k=limit,
                        threshold=0.5
                    )
                    
                    results['faiss_search'] = {
                        'results': faiss_results,
                        'total_found': len(faiss_results)
                    }
                except Exception as e:
                    logger.warning(f"FAISS search failed: {e}")
            
            # Step 5: Merge and rank results
            merged_results = self._merge_search_results(
                results.get('vector_search', {}).get('results', []),
                results.get('faiss_search', {}).get('results', [])
            )
            
            end_time = datetime.now()
            processing_time = (end_time - start_time).total_seconds()
            
            return {
                'success': True,
                'query': query,
                'processed_query': processed_query,
                'results': merged_results,
                'total_found': len(merged_results),
                'processing_time': processing_time,
                'search_details': results
            }
            
        except Exception as e:
            logger.error(f"Intelligent search failed: {e}")
            
            end_time = datetime.now()
            processing_time = (end_time - start_time).total_seconds()
            
            return {
                'success': False,
                'query': query,
                'error': str(e),
                'processing_time': processing_time
            }
    
    def _merge_search_results(self, vector_results: List[Dict], faiss_results: List[Dict]) -> List[Dict]:
        """Merge and deduplicate search results from different sources."""
        
        # Use call_id or text as deduplication key
        seen_items = set()
        merged = []
        
        # Add vector results first (usually higher quality)
        for result in vector_results:
            key = result.get('callId') or result.get('transcriptionText', '')[:50]
            if key and key not in seen_items:
                result['search_source'] = 'vector'
                result['rank_score'] = result.get('similarity_score', 0)
                merged.append(result)
                seen_items.add(key)
        
        # Add FAISS results
        for result in faiss_results:
            key = result.get('callId') or result.get('text', '')[:50]
            if key and key not in seen_items:
                result['search_source'] = 'faiss'
                result['rank_score'] = result.get('similarity_score', 0)
                merged.append(result)
                seen_items.add(key)
        
        # Sort by rank score
        merged.sort(key=lambda x: x.get('rank_score', 0), reverse=True)
        
        return merged
    
    async def health_check(self) -> Dict:
        """Check health of all ML pipeline components."""
        
        health_status = {
            'pipeline_status': 'healthy',
            'timestamp': datetime.now().isoformat(),
            'components': {}
        }
        
        try:
            # Check embedding service
            if self.config.enable_embeddings:
                await embedding_service.initialize_model()
                health_status['components']['embeddings'] = {
                    'status': 'healthy' if embedding_service.model_loaded else 'unhealthy',
                    'model_loaded': embedding_service.model_loaded,
                    'stats': embedding_service.get_stats()
                }
            
            # Check LLM orchestrator
            if self.config.enable_llm:
                llm_health = await llm_orchestrator.health_check()
                health_status['components']['llm'] = llm_health
            
            # Check vector database
            if self.config.enable_vector_storage:
                weaviate_health = await weaviate_service.health_check()
                health_status['components']['vector_db'] = {
                    'status': 'healthy' if weaviate_health else 'unhealthy',
                    'connected': weaviate_health
                }
            
            # Hebrew processing handled natively by DictaLM and AlephBERT
            health_status['components']['hebrew_processor'] = {
                'status': 'healthy',
                'nlp_loaded': True,
                'note': 'Native Hebrew support via DictaLM and AlephBERT'
            }
            
            # Overall status
            component_statuses = [comp.get('status', 'unknown') for comp in health_status['components'].values()]
            if all(status == 'healthy' for status in component_statuses):
                health_status['pipeline_status'] = 'healthy'
            elif any(status == 'healthy' for status in component_statuses):
                health_status['pipeline_status'] = 'degraded'
            else:
                health_status['pipeline_status'] = 'unhealthy'
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            health_status['pipeline_status'] = 'error'
            health_status['error'] = str(e)
        
        return health_status
    
    def get_stats(self) -> Dict:
        """Get comprehensive pipeline statistics."""
        
        total_calls = self.stats['calls_processed']
        avg_processing_time = (
            self.stats['total_processing_time'] / total_calls 
            if total_calls > 0 else 0
        )
        
        return {
            **self.stats,
            'avg_processing_time': avg_processing_time,
            'success_rate': (
                (total_calls - self.stats['errors']) / total_calls * 100 
                if total_calls > 0 else 0
            ),
            'config': {
                'enable_embeddings': self.config.enable_embeddings,
                'enable_llm': self.config.enable_llm,
                'enable_vector_storage': self.config.enable_vector_storage,
                'batch_size': self.config.batch_size
            }
        }


# Singleton instance
ml_pipeline = MLPipeline()