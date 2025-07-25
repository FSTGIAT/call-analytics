import os
import asyncio
import logging
from typing import Dict, Optional, List
from datetime import datetime

# from .huggingface_service import huggingface_service  # Removed - using local Ollama only
# from .bedrock_service import bedrock_service  # Removed - not using Bedrock
from .ollama_service import ollama_service

logger = logging.getLogger(__name__)


class LLMOrchestrator:
    """
    Orchestrates between local LLM (HuggingFace) and cloud fallback (Bedrock).
    Implements intelligent routing, failover, and load balancing.
    """
    
    def __init__(self):
        self.fallback_enabled = True
        self.fallback_threshold = int(os.getenv('FALLBACK_THRESHOLD', '3000'))  # Reduced from 5000ms to 3000ms
        self.max_retries = 2  # Reduced from 3 to 2 for faster failure
        self.use_ollama_for_hebrew = os.getenv('USE_OLLAMA_FOR_HEBREW', 'true').lower() == 'true'
        
        # DictaLM is our ONLY model - handles Hebrew and English perfectly
        self._model_cache = {
            'hebrew_model': os.getenv('HEBREW_MODEL', 'dictalm-fast'),
            'english_model': os.getenv('DEFAULT_MODEL', 'dictalm-fast'),  # DictaLM handles English too
            'default_model': os.getenv('DEFAULT_MODEL', 'dictalm-fast')
        }
        
        # Optimized timeouts for faster processing
        self._timeouts = {
            'ollama_timeout': int(os.getenv('OLLAMA_TIMEOUT', '15')),  # Increased for complex queries
            'bedrock_timeout': int(os.getenv('BEDROCK_TIMEOUT', '10')),  # 10s instead of 20s
            'health_check_timeout': 2  # Fast health checks
        }
        
        # Statistics
        self.stats = {
            'ollama_requests': 0,
            'bedrock_requests': 0,
            'fallback_triggers': 0,
            'total_errors': 0,
            'avg_response_time': 0.0,
            'fast_responses': 0,  # < 5s
            'slow_responses': 0   # >= 5s
        }
        
        logger.info("🚀 Optimized LLM Orchestrator initialized with fast model selection")
    
    # Removed complex query analysis - using fixed fast timeouts for all queries
    
    async def health_check(self) -> Dict:
        """Check health of all LLM services."""
        health_status = {
            'timestamp': datetime.now().isoformat(),
            'services': {}
        }
        
        try:
            # Check Ollama
            ollama_healthy = await ollama_service.health_check()
            health_status['services']['ollama'] = {
                'status': 'healthy' if ollama_healthy else 'unhealthy',
                'available_models': await ollama_service.list_models() if ollama_healthy else []
            }
        except Exception as e:
            health_status['services']['ollama'] = {
                'status': 'error',
                'error': str(e)
            }
        
        
        try:
            # Check Bedrock
            # bedrock_healthy = await bedrock_service.health_check()  # Removed
            health_status['services']['bedrock'] = {
                'status': 'healthy' if bedrock_healthy else 'unhealthy',
                'enabled': False  # Bedrock removed
            }
        except Exception as e:
            health_status['services']['bedrock'] = {
                'status': 'error',
                'error': str(e)
            }
        
        
        # Overall status
        ollama_ok = health_status['services']['ollama']['status'] == 'healthy'
        bedrock_ok = health_status['services']['bedrock']['status'] == 'healthy'
        
        health_status['overall_status'] = 'healthy' if (ollama_ok or bedrock_ok) else 'unhealthy'
        
        # Determine primary service
        if ollama_ok:
            primary = 'ollama'
        elif bedrock_ok:
            primary = 'bedrock'
        else:
            primary = 'none'
        
        health_status['primary_service'] = primary
        
        return health_status
    
    async def generate_response(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        prefer_local: bool = True,
        **kwargs
    ) -> Dict:
        """
        Generate response with intelligent routing between services.
        """
        start_time = datetime.now()
        errors = []
        
        # Fast Hebrew detection with caching
        has_hebrew = any(ord(char) >= 0x0590 and ord(char) <= 0x05FF for char in prompt)
        
        # Use configurable timeout from environment
        fixed_timeout = int(os.getenv('OLLAMA_TIMEOUT', '12'))  # Use env variable with 12s default
        
        # Fast model selection using cached configuration
        selected_model = self._model_cache['hebrew_model'] if has_hebrew else self._model_cache['english_model']
        
        # Optimized service order (single service prioritization)
        services_to_try = []
        
        if has_hebrew and self.use_ollama_for_hebrew:
            # Hebrew: fast route to DictaLM
            logger.info(f"⚡ Hebrew detected, fast-routing to Ollama with {selected_model}")
            services_to_try.append(('ollama', ollama_service, selected_model))
        else:
            # English/Other: fast route to Mistral  
            logger.info(f"⚡ Non-Hebrew text, fast-routing to Ollama with {selected_model}")
            services_to_try.append(('ollama', ollama_service, selected_model))
        
        # Only add fallback if primary fails
        # if self.fallback_enabled and bedrock_service.enabled:
        #     services_to_try.append(('bedrock', bedrock_service, None))  # Bedrock removed
        
        # Try each service with optimized timeouts
        for service_info in services_to_try:
            service_name, service, model_hint = service_info
            service_start = datetime.now()
            
            try:
                logger.info(f"⚡ Fast-processing with {service_name}{f' ({model_hint})' if model_hint else ''}")
                
                if service_name == 'ollama':
                    # Use fixed timeout for all queries
                    response = await asyncio.wait_for(
                        service.generate_response(
                            prompt=prompt,
                            system_prompt=system_prompt,
                            max_tokens=kwargs.get('max_tokens', 300),  # Much smaller for faster responses
                            temperature=kwargs.get('temperature', 0.3),
                            # Removed model_preference - not supported by Ollama service
                            **kwargs
                        ),
                        timeout=fixed_timeout
                    )
                    
                    service_time = (datetime.now() - service_start).total_seconds()
                    self.stats['ollama_requests'] += 1
                    
                    # Track fast vs slow responses with fixed timeout
                    if service_time < 5.0:
                        self.stats['fast_responses'] += 1
                        logger.info(f"🚀 Fast Ollama response in {service_time:.2f}s (timeout: {fixed_timeout}s)")
                    else:
                        self.stats['slow_responses'] += 1
                        logger.warning(f"⏰ Slow Ollama response in {service_time:.2f}s (timeout: {fixed_timeout}s)")
                    
                    logger.info(f"Ollama response - Content length: {len(response.content)}, Preview: {response.content[:50]}...")
                    
                    return {
                        'success': True,
                        'content': response.content,
                        'service': service_name,
                        'model': response.model,
                        'processing_time': response.processing_time,
                        'service_time': service_time,
                        'tokens_used': response.tokens_used,
                        'metadata': response.metadata
                    }
                
                
                elif service_name == 'bedrock':
                    # Fast timeout for Bedrock fallback
                    response = await asyncio.wait_for(
                        service.generate_response(
                            prompt=prompt,
                            system_prompt=system_prompt,
                            **kwargs
                        ),
                        timeout=self._timeouts['bedrock_timeout']
                    )
                    
                    service_time = (datetime.now() - service_start).total_seconds()
                    self.stats['bedrock_requests'] += 1
                    self.stats['fallback_triggers'] += 1
                    
                    logger.info(f"🔄 Bedrock fallback completed in {service_time:.2f}s")
                    
                    if response['success']:
                        return {
                            'success': True,
                            'content': response['content'],
                            'service': service_name,
                            'model': response['model'],
                            'processing_time': response['processing_time'],
                            'service_time': service_time,
                            'tokens_used': response['tokens_used'],
                            'metadata': response['metadata']
                        }
                    else:
                        errors.append(f"{service_name}: {response['error']}")
                        continue
                        
            except asyncio.TimeoutError:
                error_msg = f"{service_name} request timed out"
                logger.warning(error_msg)
                errors.append(error_msg)
                
                # Trigger fallback for slow responses
                if service_name == 'huggingface' and len(services_to_try) > 1:
                    logger.info("Triggering fallback due to timeout")
                    self.stats['fallback_triggers'] += 1
                continue
                
            except Exception as e:
                error_msg = f"{service_name} error: {str(e)}"
                logger.error(error_msg)
                errors.append(error_msg)
                continue
        
        # All services failed
        self.stats['total_errors'] += 1
        end_time = datetime.now()
        total_time = (end_time - start_time).total_seconds()
        
        return {
            'success': False,
            'errors': errors,
            'processing_time': total_time,
            'services_tried': [name for name, _, _ in services_to_try]
        }
    
    async def summarize_call(
        self,
        transcription: str,
        language: str = 'hebrew',
        prefer_local: bool = True
    ) -> Dict:
        """
        Summarize call with intelligent routing.
        Uses Hebrew-Mistral for Hebrew tasks, Ollama for English.
        """
        start_time = datetime.now()
        
        # Use Ollama for all languages (DictaLM for Hebrew, Mistral for English)
        if prefer_local:
            try:
                logger.info(f"Attempting call summarization with Ollama (language: {language})")
                result = await ollama_service.summarize_call(
                    transcription=transcription,
                    language=language
                )
                
                if result['success']:
                    self.stats['ollama_requests'] += 1
                    result['service'] = 'ollama'
                    return result
                else:
                    logger.warning(f"Ollama summarization failed: {result.get('error')}")
                    
            except Exception as e:
                logger.error(f"Ollama summarization error: {e}")
        
        # Try Bedrock fallback for any language
        # Bedrock fallback removed - using only Ollama
        # if self.fallback_enabled and bedrock_service.enabled:
        #     try:
        #         logger.info("Attempting call summarization with Bedrock fallback")
        #         result = await bedrock_service.summarize_call_fallback(
        #             transcription=transcription,
        #             language=language
        #         )
                
                if result['success']:
                    self.stats['bedrock_requests'] += 1
                    self.stats['fallback_triggers'] += 1
                    return result
                else:
                    logger.error(f"Bedrock summarization failed: {result.get('error')}")
                    
            except Exception as e:
                logger.error(f"Bedrock fallback error: {e}")
        
        # All methods failed - return basic summary
        end_time = datetime.now()
        processing_time = (end_time - start_time).total_seconds()
        
        return {
            'success': False,
            'error': 'All LLM services failed',
            'fallback_summary': {
                'summary': transcription[:200] + "..." if len(transcription) > 200 else transcription,
                'key_points': ['Call transcription available'],
                'sentiment': 'neutral',
                'products_mentioned': [],
                'action_items': ['Manual review required'],
                'customer_satisfaction': 'unknown',
                'issue_resolved': False
            },
            'service': 'fallback',
            'processing_time': processing_time
        }
    
    async def batch_summarize(
        self,
        transcriptions: List[Dict],
        max_concurrent: int = 5
    ) -> List[Dict]:
        """
        Batch process multiple call summarizations.
        """
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def process_single(transcription_data):
            async with semaphore:
                return await self.summarize_call(
                    transcription=transcription_data['text'],
                    language=transcription_data.get('language', 'hebrew')
                )
        
        # Process all transcriptions concurrently
        tasks = [process_single(trans) for trans in transcriptions]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Handle exceptions
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                processed_results.append({
                    'success': False,
                    'error': str(result),
                    'index': i
                })
            else:
                result['index'] = i
                processed_results.append(result)
        
        return processed_results
    
    def get_stats(self) -> Dict:
        """Get orchestrator statistics."""
        total_requests = self.stats['huggingface_requests'] + self.stats['bedrock_requests']
        
        return {
            **self.stats,
            'total_requests': total_requests,
            'huggingface_percentage': (self.stats['huggingface_requests'] / total_requests * 100) if total_requests > 0 else 0,
            'bedrock_percentage': (self.stats['bedrock_requests'] / total_requests * 100) if total_requests > 0 else 0,
            'error_rate': (self.stats['total_errors'] / total_requests * 100) if total_requests > 0 else 0,
            'fallback_rate': (self.stats['fallback_triggers'] / total_requests * 100) if total_requests > 0 else 0
        }
    
    async def update_configuration(self, config: Dict) -> bool:
        """Update orchestrator configuration."""
        try:
            if 'fallback_enabled' in config:
                self.fallback_enabled = config['fallback_enabled']
                
            if 'fallback_threshold' in config:
                self.fallback_threshold = config['fallback_threshold']
                
            if 'max_retries' in config:
                self.max_retries = config['max_retries']
                
            logger.info(f"Configuration updated: {config}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to update configuration: {e}")
            return False


# Singleton instance
llm_orchestrator = LLMOrchestrator()