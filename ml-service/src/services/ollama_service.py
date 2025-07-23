import os
import json
import asyncio
import aiohttp
import logging
import hashlib
from typing import Dict, List, Optional, AsyncGenerator
from dataclasses import dataclass
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


@dataclass
class OllamaConfig:
    base_url: str
    model_name: str
    temperature: float
    max_tokens: int
    timeout: int


@dataclass
class LLMResponse:
    content: str
    model: str
    timestamp: datetime
    tokens_used: int
    processing_time: float
    metadata: Dict


class InferenceCache:
    """High-performance inference cache for LLM responses"""
    
    def __init__(self, max_size: int = 1000, ttl_seconds: int = 3600):
        self.cache = {}
        self.max_size = max_size
        self.ttl = timedelta(seconds=ttl_seconds)
        logger.info(f"Initialized inference cache with max_size={max_size}, ttl={ttl_seconds}s")
    
    def _get_cache_key(self, prompt: str, model: str, temperature: float, max_tokens: int) -> str:
        """Generate cache key for request"""
        cache_data = {
            'prompt': prompt,
            'model': model,
            'temperature': temperature,
            'max_tokens': max_tokens
        }
        return hashlib.md5(json.dumps(cache_data, sort_keys=True).encode()).hexdigest()
    
    def get(self, prompt: str, model: str, temperature: float, max_tokens: int) -> Optional[LLMResponse]:
        """Get cached response if available and valid"""
        key = self._get_cache_key(prompt, model, temperature, max_tokens)
        
        if key in self.cache:
            response, timestamp = self.cache[key]
            if datetime.now() - timestamp < self.ttl:
                logger.debug(f"Cache hit for key: {key[:8]}...")
                return response
            else:
                # Remove expired entry
                del self.cache[key]
                logger.debug(f"Cache expired for key: {key[:8]}...")
        
        return None
    
    def set(self, prompt: str, model: str, temperature: float, max_tokens: int, response: LLMResponse):
        """Cache response with automatic size management"""
        key = self._get_cache_key(prompt, model, temperature, max_tokens)
        
        # Remove oldest entries if cache is full
        if len(self.cache) >= self.max_size:
            oldest_key = min(self.cache.keys(), key=lambda k: self.cache[k][1])
            del self.cache[oldest_key]
            logger.debug(f"Removed oldest cache entry: {oldest_key[:8]}...")
        
        self.cache[key] = (response, datetime.now())
        logger.debug(f"Cached response for key: {key[:8]}...")
    
    def clear(self):
        """Clear all cached entries"""
        self.cache.clear()
        logger.info("Inference cache cleared")
    
    def get_stats(self) -> Dict:
        """Get cache statistics"""
        return {
            'size': len(self.cache),
            'max_size': self.max_size,
            'hit_ratio': getattr(self, '_hit_count', 0) / max(getattr(self, '_total_requests', 1), 1)
        }


class OllamaService:
    """
    Service for interacting with Ollama for local LLM inference.
    Optimized for Hebrew text processing and call analytics.
    """
    
    def __init__(self):
        # ONLY DictaLM - no other models!
        self.config = OllamaConfig(
            base_url=os.getenv('OLLAMA_BASE_URL', 'http://ollama:11434'),
            model_name='dictalm2.0-instruct:Q4_K_M',  # DictaLM ONLY
            temperature=float(os.getenv('MODEL_TEMPERATURE', '0.2')),  # Lower for faster, more focused responses
            max_tokens=int(os.getenv('MODEL_MAX_TOKENS', '8000')),  # Much larger for Hebrew conversation analysis
            timeout=int(os.getenv('REQUEST_TIMEOUT', '15'))  # Aggressive timeout
        )
        
        # Always use DictaLM for everything
        self.hebrew_model = 'dictalm2.0-instruct:Q4_K_M'
        self.use_dictalm_for_hebrew = True  # Always true - DictaLM is our primary model
        
        # Initialize inference cache
        cache_enabled = os.getenv('ENABLE_INFERENCE_CACHE', 'true').lower() == 'true'
        if cache_enabled:
            cache_size = int(os.getenv('INFERENCE_CACHE_SIZE', '1000'))
            cache_ttl = int(os.getenv('INFERENCE_CACHE_TTL', '3600'))
            self.cache = InferenceCache(max_size=cache_size, ttl_seconds=cache_ttl)
            logger.info("Inference cache enabled")
        else:
            self.cache = None
            logger.info("Inference cache disabled")
        
        # Request tracking for rate limiting
        self.request_count = 0
        self.max_concurrent = int(os.getenv('MAX_CONCURRENT_REQUESTS', '10'))
        self._semaphores = {}  # Store semaphores per event loop
        
        logger.info(f"Ollama service initialized with model: {self.config.model_name}")
        logger.info(f"Hebrew model configured: {self.hebrew_model} (enabled: {self.use_dictalm_for_hebrew})")
    
    def _get_semaphore(self) -> asyncio.Semaphore:
        """Get or create semaphore for current event loop."""
        try:
            loop = asyncio.get_running_loop()
            loop_id = id(loop)
            
            if loop_id not in self._semaphores:
                self._semaphores[loop_id] = asyncio.Semaphore(self.max_concurrent)
                logger.debug(f"Created semaphore for event loop {loop_id}")
            
            return self._semaphores[loop_id]
        except RuntimeError:
            # No running event loop, create a new semaphore
            logger.warning("No running event loop found, creating standalone semaphore")
            return asyncio.Semaphore(self.max_concurrent)
    
    async def health_check(self) -> bool:
        """Check if Ollama service is available."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.config.base_url}/api/tags",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        models = [model['name'] for model in data.get('models', [])]
                        return self.config.model_name in models
                    return False
        except Exception as e:
            logger.error(f"Ollama health check failed: {e}")
            return False
    
    async def list_models(self) -> List[str]:
        """List available models in Ollama."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.config.base_url}/api/tags") as response:
                    if response.status == 200:
                        data = await response.json()
                        return [model['name'] for model in data.get('models', [])]
                    return []
        except Exception as e:
            logger.error(f"Failed to list models: {e}")
            return []
    
    async def pull_model(self, model_name: Optional[str] = None) -> bool:
        """Pull a model to Ollama."""
        model = model_name or self.config.model_name
        
        try:
            async with aiohttp.ClientSession() as session:
                payload = {"name": model}
                
                async with session.post(
                    f"{self.config.base_url}/api/pull",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=600)  # 10 minutes for model download
                ) as response:
                    if response.status == 200:
                        logger.info(f"Successfully pulled model: {model}")
                        return True
                    else:
                        logger.error(f"Failed to pull model {model}: {response.status}")
                        return False
        except Exception as e:
            logger.error(f"Error pulling model {model}: {e}")
            return False
    
    async def generate_response(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ) -> LLMResponse:
        """Generate a response using Ollama with caching."""
        
        start_time = datetime.now()
        
        # Always use DictaLM - it handles Hebrew, English, and mixed text perfectly
        model_name = 'dictalm2.0-instruct:Q4_K_M'
        logger.info(f"Using DictaLM model: {model_name}")
        
        temp = temperature if temperature is not None else self.config.temperature
        max_tok = max_tokens or self.config.max_tokens
        
        # Create full prompt for caching
        full_prompt = f"{system_prompt}\n{prompt}" if system_prompt else prompt
        
        # Check cache first
        if self.cache:
            cached_response = self.cache.get(full_prompt, model_name, temp, max_tok)
            if cached_response:
                logger.info(f"Cache hit for prompt: {prompt[:50]}...")
                return cached_response
        
        # Get semaphore for current event loop
        semaphore = self._get_semaphore()
        
        async with semaphore:  # Rate limiting
            try:
                
                # Prepare the request payload
                payload = {
                    "model": model_name,
                    "prompt": prompt,
                    "options": {
                        "temperature": temp,
                        "num_predict": max_tok,
                        "num_ctx": 16384,  # Much larger context window for Hebrew conversations
                        "repeat_penalty": 1.1,  # Restore original
                    },
                    "stream": False
                }
                
                if system_prompt:
                    payload["system"] = system_prompt
                
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{self.config.base_url}/api/generate",
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=self.config.timeout)
                    ) as response:
                        
                        if response.status == 200:
                            data = await response.json()
                            end_time = datetime.now()
                            processing_time = (end_time - start_time).total_seconds()
                            
                            self.request_count += 1
                            
                            llm_response = LLMResponse(
                                content=data.get('response', ''),
                                model=model_name,
                                timestamp=end_time,
                                tokens_used=data.get('eval_count', 0),
                                processing_time=processing_time,
                                metadata={
                                    'eval_duration': data.get('eval_duration', 0),
                                    'prompt_eval_count': data.get('prompt_eval_count', 0),
                                    'total_duration': data.get('total_duration', 0),
                                    'load_duration': data.get('load_duration', 0)
                                }
                            )
                            
                            # Cache the response
                            if self.cache:
                                self.cache.set(full_prompt, model_name, temp, max_tok, llm_response)
                            
                            return llm_response
                        elif response.status == 404 and model_name == self.hebrew_model:
                            # DictaLM not found, fallback to default model (avoid recursion)
                            logger.warning(f"Hebrew model {model_name} not found, falling back to {self.config.model_name}")
                            
                            # Create new payload with default model
                            fallback_payload = {
                                "model": self.config.model_name,
                                "prompt": prompt,
                                "options": {
                                    "temperature": temperature if temperature is not None else self.config.temperature,
                                    "num_predict": max_tokens or self.config.max_tokens,
                                },
                                "stream": False
                            }
                            
                            if system_prompt:
                                fallback_payload["system"] = system_prompt
                            
                            # Make direct API call to avoid recursion
                            async with session.post(
                                f"{self.config.base_url}/api/generate",
                                json=fallback_payload,
                                timeout=aiohttp.ClientTimeout(total=self.config.timeout)
                            ) as fallback_response:
                                if fallback_response.status == 200:
                                    fallback_data = await fallback_response.json()
                                    end_time = datetime.now()
                                    processing_time = (end_time - start_time).total_seconds()
                                    
                                    self.request_count += 1
                                    
                                    fallback_response = LLMResponse(
                                        content=fallback_data.get('response', ''),
                                        model=self.config.model_name,
                                        timestamp=end_time,
                                        tokens_used=fallback_data.get('eval_count', 0),
                                        processing_time=processing_time,
                                        metadata={
                                            'eval_duration': fallback_data.get('eval_duration', 0),
                                            'prompt_eval_count': fallback_data.get('prompt_eval_count', 0),
                                            'total_duration': fallback_data.get('total_duration', 0),
                                            'load_duration': fallback_data.get('load_duration', 0),
                                            'fallback_used': True
                                        }
                                    )
                                    
                                    # Cache the fallback response
                                    if self.cache:
                                        self.cache.set(full_prompt, self.config.model_name, temp, max_tok, fallback_response)
                                    
                                    return fallback_response
                                else:
                                    fallback_error = await fallback_response.text()
                                    raise Exception(f"Fallback model error {fallback_response.status}: {fallback_error}")
                        else:
                            error_text = await response.text()
                            raise Exception(f"Ollama API error {response.status}: {error_text}")
                            
            except asyncio.TimeoutError:
                raise Exception(f"Request timed out after {self.config.timeout} seconds")
            except Exception as e:
                logger.error(f"Error generating response: {e}")
                raise
    
    async def generate_stream(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """Generate streaming response from Ollama."""
        
        # Get semaphore for current event loop
        semaphore = self._get_semaphore()
        
        async with semaphore:
            try:
                model_name = model or self.config.model_name
                
                payload = {
                    "model": model_name,
                    "prompt": prompt,
                    "stream": True,
                    "options": {
                        "temperature": self.config.temperature,
                        "num_predict": self.config.max_tokens,
                    }
                }
                
                if system_prompt:
                    payload["system"] = system_prompt
                
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{self.config.base_url}/api/generate",
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=self.config.timeout)
                    ) as response:
                        
                        if response.status == 200:
                            async for line in response.content:
                                if line:
                                    try:
                                        data = json.loads(line.decode('utf-8'))
                                        if 'response' in data:
                                            yield data['response']
                                        if data.get('done', False):
                                            break
                                    except json.JSONDecodeError:
                                        continue
                        else:
                            error_text = await response.text()
                            raise Exception(f"Ollama streaming error {response.status}: {error_text}")
                            
            except Exception as e:
                logger.error(f"Error in streaming generation: {e}")
                raise
    
    async def summarize_call(
        self,
        transcription: str,
        language: str = 'hebrew',
        include_sentiment: bool = True,
        include_products: bool = True
    ) -> Dict:
        """Generate a structured summary of a call transcription."""
        
        # Improved prompts in English for better LLM understanding
        if language.lower() in ['hebrew', 'he']:
            system_prompt = """Analyze customer service call. Output structured JSON only. 
IMPORTANT: The call is in Hebrew, provide all text fields in Hebrew."""
            
            prompt = f"""Analyze this customer service call transcription:

{transcription}

Provide a structured analysis with the following JSON format. All text values must be in Hebrew:
{{
    "summary": "Brief summary of the call in Hebrew",
    "key_points": ["First key point in Hebrew", "Second key point in Hebrew"],
    "sentiment": "חיובי" or "שלילי" or "נייטרלי",
    "products_mentioned": ["Product names in Hebrew if mentioned"],
    "main_issue": "The main issue or need in Hebrew",
    "call_type": "פנייה" or "תלונה" or "בקשה" or "מידע",
    "action_items": ["Required actions in Hebrew"],
    "customer_satisfaction": "גבוה" or "בינוני" or "נמוך"
}}

Respond with valid JSON only."""
        else:
            # English system prompt
            system_prompt = """Analyze customer service calls. 
Summarize calls and extract important information.
Always respond in structured JSON format."""
            
            prompt = f"""Analyze the following customer service call transcription and provide a structured summary:

Call transcription:
{transcription}

Please provide the analysis in the following JSON format:
{{
    "summary": "Brief summary of the call",
    "key_points": ["Important point 1", "Important point 2"],
    "sentiment": "positive/negative/neutral",
    "products_mentioned": ["Product 1", "Product 2"],
    "action_items": ["Required action 1", "Required action 2"],
    "customer_satisfaction": "high/medium/low",
    "issue_resolved": true/false,
    "call_duration_assessment": "appropriate/too_long/too_short"
}}

Ensure the response is valid JSON only."""
        
        try:
            response = await self.generate_response(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.3,  # Balanced for structured output
                max_tokens=800  # Increased to prevent cutoffs
            )
            
            # Try to parse JSON response
            try:
                summary_data = json.loads(response.content)
                return {
                    'success': True,
                    'summary': summary_data,
                    'metadata': {
                        'processing_time': response.processing_time,
                        'tokens_used': response.tokens_used,
                        'model': response.model
                    }
                }
            except json.JSONDecodeError:
                # Fallback: extract JSON from response if it's embedded in text
                import re
                json_match = re.search(r'\{.*\}', response.content, re.DOTALL)
                if json_match:
                    summary_data = json.loads(json_match.group())
                    return {
                        'success': True,
                        'summary': summary_data,
                        'metadata': {
                            'processing_time': response.processing_time,
                            'tokens_used': response.tokens_used,
                            'model': response.model
                        }
                    }
                else:
                    raise Exception("Failed to parse JSON from LLM response")
                    
        except Exception as e:
            logger.error(f"Error in call summarization: {e}")
            return {
                'success': False,
                'error': str(e),
                'fallback_summary': transcription[:200] + "..." if len(transcription) > 200 else transcription
            }
    
    async def test_hebrew_strategies(
        self,
        transcription: str,
        strategies: List[str] = None
    ) -> Dict:
        """Test different Hebrew prompt strategies and compare results."""
        
        if not strategies:
            strategies = ['structured', 'simple', 'chain_of_thought', 'few_shot']
        
        results = {}
        
        for strategy in strategies:
            try:
                if strategy == 'structured':
                    # Current improved approach
                    result = await self.summarize_call(transcription, 'hebrew')
                    
                elif strategy == 'simple':
                    # Simple approach
                    system_prompt = "תשיב בעברית בפורמט JSON."
                    prompt = f"סכם את השיחה הזו: {transcription}\n\nJSON:"
                    response = await self.generate_response(
                        prompt=prompt,
                        system_prompt=system_prompt,
                        temperature=0.2,
                        max_tokens=300
                    )
                    result = {'content': response.content, 'time': response.processing_time}
                    
                elif strategy == 'chain_of_thought':
                    # Step-by-step reasoning
                    system_prompt = "נתח שיחות. חשוב צעד אחר צעד."
                    prompt = f"""שיחה: {transcription}

תהליך הניתוח:
1. קרא את השיחה
2. זהה את הנושא העיקרי
3. קבע את הרגש
4. מצא מוצרים
5. סכם הכל

תוצאה בJSON:"""
                    response = await self.generate_response(
                        prompt=prompt,
                        system_prompt=system_prompt,
                        temperature=0.2,
                        max_tokens=400
                    )
                    result = {'content': response.content, 'time': response.processing_time}
                    
                elif strategy == 'few_shot':
                    # Few-shot learning with examples
                    system_prompt = "תשיב בעברית בפורמט JSON כמו בדוגמאות."
                    prompt = f"""דוגמה 1:
שיחה: "שלום, יש לי בעיה עם האינטרנט, זה לא עובד כבר שעתיים"
תוצאה: {{"summary": "בעיה טכנית באינטרנט", "sentiment": "שלילי", "products_mentioned": ["אינטרנט"]}}

דוגמה 2:
שיחה: "תודה רבה על השירות המעולה, הבעיה נפתרה"
תוצאה: {{"summary": "הכרת תודה על פתרון בעיה", "sentiment": "חיובי", "products_mentioned": []}}

עכשיו נתח:
שיחה: {transcription}
תוצאה:"""
                    response = await self.generate_response(
                        prompt=prompt,
                        system_prompt=system_prompt,
                        temperature=0.2,
                        max_tokens=300
                    )
                    result = {'content': response.content, 'time': response.processing_time}
                
                results[strategy] = {
                    'success': True,
                    'result': result,
                    'processing_time': result.get('time', 0)
                }
                
            except Exception as e:
                results[strategy] = {
                    'success': False,
                    'error': str(e),
                    'processing_time': 0
                }
        
        return results
    
    def get_stats(self) -> Dict:
        """Get service statistics."""
        stats = {
            'total_requests': self.request_count,
            'max_concurrent': self.max_concurrent,
            'current_model': self.config.model_name,
            'base_url': self.config.base_url
        }
        
        # Add cache statistics
        if self.cache:
            stats['cache'] = self.cache.get_stats()
        else:
            stats['cache'] = {'enabled': False}
            
        return stats
    
    def get_cache_stats(self) -> Dict:
        """Get cache statistics"""
        if self.cache:
            return self.cache.get_stats()
        return {'cache_enabled': False}
    
    def clear_cache(self):
        """Clear inference cache"""
        if self.cache:
            self.cache.clear()
            logger.info("Inference cache cleared")


# Singleton instance
ollama_service = OllamaService()