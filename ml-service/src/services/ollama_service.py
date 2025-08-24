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
    
    def _get_cache_key(self, prompt: str, model: str, temperature: float, max_tokens: int, classifications_available: bool = False) -> str:
        """Generate cache key for request"""
        cache_data = {
            'prompt': prompt,
            'model': model,
            'temperature': temperature,
            'max_tokens': max_tokens,
            'classifications_available': classifications_available
        }
        return hashlib.md5(json.dumps(cache_data, sort_keys=True).encode()).hexdigest()
    
    def get(self, prompt: str, model: str, temperature: float, max_tokens: int, classifications_available: bool = False) -> Optional[LLMResponse]:
        """Get cached response if available and valid"""
        key = self._get_cache_key(prompt, model, temperature, max_tokens, classifications_available)
        
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
    
    def set(self, prompt: str, model: str, temperature: float, max_tokens: int, classifications_available: bool, response: LLMResponse):
        """Cache response with automatic size management"""
        key = self._get_cache_key(prompt, model, temperature, max_tokens, classifications_available)
        
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
            model_name=os.getenv('DEFAULT_MODEL', 'dictalm-fast'),  # Use env variable
            temperature=float(os.getenv('MODEL_TEMPERATURE', '0.2')),  # Lower for faster, more focused responses
            max_tokens=int(os.getenv('MODEL_MAX_TOKENS', '800')),  # Increased for complex conversations
            timeout=int(os.getenv('REQUEST_TIMEOUT', '10'))  # Very aggressive timeout
        )
        
        # Always use DictaLM for everything
        self.hebrew_model = os.getenv('HEBREW_MODEL', 'dictalm-fast')
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
        
        # Load Hebrew call classifications
        logger.info("🚀 OllamaService initializing - loading classifications...")
        self.hebrew_classifications = []
        try:
            classifications_path = '/app/config/call-classifications.json'
            logger.info(f"Checking classifications file at: {classifications_path}")
            if os.path.exists(classifications_path):
                with open(classifications_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    self.hebrew_classifications = config.get('classifications', [])
                    logger.info(f"✅ Loaded {len(self.hebrew_classifications)} call classifications on startup")
            else:
                logger.warning(f"Classifications file not found at {classifications_path}")
        except Exception as e:
            logger.error(f"Failed to load classifications: {e}")
            self.hebrew_classifications = []
        
        # Force log final state
        logger.info(f"OllamaService initialization complete. Classifications available: {len(self.hebrew_classifications) > 0}")
        
        # Load prompt templates for Hebrew prompts with call ID
        self.prompt_templates = {}
        try:
            templates_path = '/app/config/prompt-templates.json'
            if os.path.exists(templates_path):
                with open(templates_path, 'r', encoding='utf-8') as f:
                    templates_config = json.load(f)
                    self.prompt_templates = templates_config.get('templates', {})
                    logger.info(f"Loaded prompt templates for Hebrew and English")
            else:
                logger.warning(f"Prompt templates file not found at {templates_path}")
                # Default templates if file not found
                self.prompt_templates = {
                    'hebrew': {
                        'summarize_with_id': 'סכם את שיחה מספר {callId}',
                        'system_prompt': 'אתה עוזר AI מומחה בניתוח שיחות שירות בעברית. תמיד ציין את מספר השיחה בתשובותיך.'
                    }
                }
        except Exception as e:
            logger.error(f"Failed to load prompt templates: {e}")
            self.prompt_templates = {
                'hebrew': {
                    'summarize_with_id': 'סכם את שיחה מספר {callId}',
                    'system_prompt': 'אתה עוזר AI מומחה בניתוח שיחות שירות בעברית.'
                }
            }
        
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
    
    def _sanitize_hebrew_for_json(self, text: str) -> str:
        """
        Sanitize Hebrew text to prevent JSON parsing errors.
        Comprehensive fix for Hebrew punctuation and JSON structure issues.
        """
        import re
        import json
        
        # Remove control characters that definitely break JSON
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
        
        # Try parsing first - if it works, return as-is
        try:
            json.loads(text)
            return text  # Already valid JSON
        except json.JSONDecodeError as e:
            logger.info(f"JSON needs fixing: {e}")
            
            # Step 1: Fix Hebrew gershayim (double quotes) - be more comprehensive
            hebrew_fixes = [
                ('חו"ל', 'חו\\"ל'),
                ('ש"ח', 'ש\\"ח'), 
                ('ח"כ', 'ח\\"כ'),
                ('מ"ר', 'מ\\"ר'),
                ('ד"ר', 'ד\\"ר'),
                ('ח"י', 'ח\\"י'),
                ('א"ב', 'א\\"ב'),
                ('מ"מ', 'מ\\"מ'),
                ('ת"ד', 'ת\\"ד'),
                # Handle any Hebrew letter + " + Hebrew letter pattern
                (r'([א-ת])"([א-ת])', r'\1\\"\2')
            ]
            
            for pattern, replacement in hebrew_fixes:
                if len(pattern) > 10:  # It's a regex
                    text = re.sub(pattern, replacement, text)
                else:
                    text = text.replace(pattern, replacement)
            
            # Step 2: Fix missing commas - more robust patterns
            # Pattern 1: "field": "value"<whitespace>"nextfield"
            text = re.sub(r'(".*?")\s*\n\s*(".*?":\s*)', r'\1,\n  \2', text)
            
            # Pattern 2: Handle arrays and objects - "value"]<whitespace>"nextfield"
            text = re.sub(r'(\])\s*\n\s*(".*?":\s*)', r'\1,\n  \2', text)
            
            # Pattern 3: Handle after closing brace }
            text = re.sub(r'(\})\s*\n\s*(".*?":\s*)', r'\1,\n  \2', text)
            
            # Step 3: Try to parse again
            try:
                json.loads(text)
                logger.info("Fixed Hebrew JSON issues successfully")
                return text
            except json.JSONDecodeError as e2:
                logger.warning(f"Still having JSON issues after fixes: {e2}")
                
                # Step 4: More aggressive fix - extract and reconstruct JSON
                try:
                    json_match = re.search(r'\{.*\}', text, re.DOTALL)
                    if json_match:
                        json_text = json_match.group(0)
                        
                        # Apply all fixes to extracted JSON
                        for pattern, replacement in hebrew_fixes:
                            if len(pattern) > 10:  # It's a regex
                                json_text = re.sub(pattern, replacement, json_text)
                            else:
                                json_text = json_text.replace(pattern, replacement)
                        
                        # Fix structure issues
                        json_text = re.sub(r'(".*?")\s*\n\s*(".*?":\s*)', r'\1,\n  \2', json_text)
                        json_text = re.sub(r'(\])\s*\n\s*(".*?":\s*)', r'\1,\n  \2', json_text)
                        json_text = re.sub(r'(\})\s*\n\s*(".*?":\s*)', r'\1,\n  \2', json_text)
                        
                        # Test the reconstructed JSON
                        json.loads(json_text)
                        logger.info("Successfully reconstructed valid JSON")
                        return json_text
                        
                except json.JSONDecodeError as e3:
                    logger.error(f"Final JSON reconstruction failed: {e3}")
                    logger.error(f"Problematic text (first 500 chars): {text[:500]}")
                    
                # Step 5: Last resort - return sanitized text and let caller handle
                return text
    
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
        model_name = self.hebrew_model
        logger.info(f"Using DictaLM model: {model_name}")
        
        temp = temperature if temperature is not None else self.config.temperature
        max_tok = max_tokens or self.config.max_tokens
        
        # Create full prompt for caching
        full_prompt = f"{system_prompt}\n{prompt}" if system_prompt else prompt
        
        # Check cache first - include classification availability in cache key
        if self.cache:
            # Include classification availability in cache key to avoid using
            # cached responses from before classifications were loaded
            classifications_available = len(self.hebrew_classifications) > 0
            cached_response = self.cache.get(full_prompt, model_name, temp, max_tok, classifications_available)
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
                        "num_ctx": 4096,  # Increased for complex conversations
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
                            
                            # Cache the response with classification availability
                            if self.cache:
                                classifications_available = len(self.hebrew_classifications) > 0
                                self.cache.set(full_prompt, model_name, temp, max_tok, classifications_available, llm_response)
                            
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
                        "num_predict": 800,
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
        call_id: str = None,
        language: str = 'hebrew',
        include_sentiment: bool = True,
        include_products: bool = True,
        use_call_id_prompt: bool = True,
        prompt_template: str = 'summarize_with_id'
    ) -> Dict:
        """Generate a structured summary of a call transcription with automatic Hebrew prompt."""
        
        # Improved prompts in English for better LLM understanding
        if language.lower() in ['hebrew', 'he']:
            # Use template-based system prompt if available
            lang_templates = self.prompt_templates.get('hebrew', {})
            system_prompt = lang_templates.get('system_prompt', 
                """Analyze customer service call. Output structured JSON only. 
IMPORTANT: The call is in Hebrew, provide all text fields in Hebrew.""")
            
            # Build classifications list for prompt
            classifications_text = ""
            if self.hebrew_classifications:
                classifications_text = f"\n\nAvailable classifications (choose 1-3 most relevant):\n{', '.join(self.hebrew_classifications)}"
            
            # Generate prompt with call ID if enabled
            if use_call_id_prompt and call_id:
                # Use template to generate Hebrew prompt with call ID
                template = lang_templates.get(prompt_template, 'סכם את שיחה מספר {callId}')
                call_prompt = template.format(callId=call_id)
                
                prompt = f"""{call_prompt}

{transcription}{classifications_text}

ספק ניתוח מובנה בפורמט JSON הבא. כל הערכים חייבים להיות בעברית:
{{
    "callId": "{call_id}",
    "summary": "סיכום קצר של השיחה בעברית",
    "classifications": ["הסיווג הרלוונטי ביותר מהרשימה", "סיווג נוסף אם רלוונטי"],
    "key_points": ["נקודה מרכזית ראשונה בעברית", "נקודה מרכזית שנייה בעברית"],
    "sentiment": "חיובי" או "שלילי" או "נייטרלי",
    "products_mentioned": ["שמות מוצרים בעברית אם הוזכרו"],
    "main_issue": "הבעיה או הצורך המרכזי בעברית",
    "call_type": "פנייה" או "תלונה" או "בקשה" או "מידע",
    "action_items": ["פעולות נדרשות בעברית"],
    "customer_satisfaction": "גבוה" או "בינוני" או "נמוך"
}}

הגב עם JSON תקין בלבד. תמיד כלול את מספר השיחה ({call_id}) בתשובה."""
            else:
                # Original prompt without call ID
                prompt = f"""נתח את תמליל שיחת השירות הבאה:

{transcription}{classifications_text}

ספק ניתוח מובנה בפורמט JSON הבא. כל הערכים חייבים להיות בעברית:
{{
    "summary": "סיכום קצר של השיחה בעברית",
    "classifications": ["הסיווג הרלוונטי ביותר מהרשימה", "סיווג נוסף אם רלוונטי"],
    "key_points": ["נקודה מרכזית ראשונה בעברית", "נקודה מרכזית שנייה בעברית"],
    "sentiment": "חיובי" או "שלילי" או "נייטרלי",
    "products_mentioned": ["שמות מוצרים בעברית אם הוזכרו"],
    "main_issue": "הבעיה או הצורך המרכזי בעברית",
    "call_type": "פנייה" או "תלונה" או "בקשה" או "מידע",
    "action_items": ["פעולות נדרשות בעברית"],
    "customer_satisfaction": "גבוה" או "בינוני" או "נמוך"
}}

הגב עם JSON תקין בלבד."""
        else:
            # English system prompt
            system_prompt = """Analyze customer service calls. 
Summarize calls and extract important information.
Always respond in structured JSON format."""
            
            # Build classifications list for prompt (English version)
            classifications_text = ""
            if self.hebrew_classifications:
                classifications_text = f"\n\nAvailable classifications:\n{', '.join(self.hebrew_classifications)}"
            
            prompt = f"""Analyze the following customer service call transcription and provide a structured summary:

Call transcription:
{transcription}{classifications_text}

Please provide the analysis in the following JSON format:
{{
    "summary": "Brief summary of the call",
    "classifications": ["Most relevant classification from the list", "Second classification if applicable"],
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
                temperature=0.1,  # Lower for faster, more deterministic output
                max_tokens=800  # Increased for complex conversations
            )
            
            # Try to parse JSON response
            try:
                # Debug: Log raw Ollama response
                logger.info(f"Raw Ollama response length: {len(response.content)}")
                logger.info(f"Raw Ollama response: {response.content[:2000]}")  # Increased to see more
                
                # Sanitize Hebrew text before JSON parsing
                logger.info("Attempting JSON parsing...")
                sanitized_content = self._sanitize_hebrew_for_json(response.content)
                logger.info(f"Sanitized content: {sanitized_content[:1000]}")
                summary_data = json.loads(sanitized_content)
                logger.info(f"JSON parsed successfully! Keys: {list(summary_data.keys())}")
                logger.info(f"Summary field from JSON: {summary_data.get('summary', 'NOT_FOUND')}")
                
                # Ensure call ID is included in response
                if call_id and 'callId' not in summary_data:
                    summary_data['callId'] = call_id
                
                return {
                    'success': True,
                    'summary': summary_data,
                    'callId': call_id,  # Include at top level for easy access
                    'metadata': {
                        'processing_time': response.processing_time,
                        'tokens_used': response.tokens_used,
                        'model': response.model,
                        'used_call_id_prompt': use_call_id_prompt
                    }
                }
            except json.JSONDecodeError as e:
                logger.warning(f"Primary JSON parsing failed: {e}")
                # Fallback: extract JSON from response if it's embedded in text
                import re
                json_match = re.search(r'\{.*\}', response.content, re.DOTALL)
                if json_match:
                    try:
                        json_text = json_match.group()
                        # Clean common JSON issues
                        json_text = json_text.replace('\n', ' ').replace('\r', ' ')
                        # Remove any trailing commas before closing braces/brackets
                        json_text = re.sub(r',(\s*[}\]])', r'\1', json_text)
                        # Fix Hebrew punctuation issues in JSON
                        json_text = self._sanitize_hebrew_for_json(json_text)
                        
                        summary_data = json.loads(json_text)
                        
                        # Ensure call ID is included in fallback response too
                        if call_id and 'callId' not in summary_data:
                            summary_data['callId'] = call_id
                        
                        return {
                            'success': True,
                            'summary': summary_data,
                            'callId': call_id,
                            'metadata': {
                                'processing_time': response.processing_time,
                                'tokens_used': response.tokens_used,
                                'model': response.model,
                                'used_call_id_prompt': use_call_id_prompt
                            }
                        }
                    except json.JSONDecodeError as e2:
                        logger.error(f"Fallback JSON parsing also failed: {e2}")
                        logger.error(f"Problematic JSON text: {json_text[:200]}...")
                        raise Exception(f"Failed to parse JSON from LLM response: {e2}")
                else:
                    raise Exception("No JSON found in LLM response")
                    
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
    
    def reload_classifications(self):
        """Reload classifications from file - can be called anytime"""
        try:
            classifications_path = '/app/config/call-classifications.json'
            if os.path.exists(classifications_path):
                with open(classifications_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    old_count = len(self.hebrew_classifications)
                    self.hebrew_classifications = config.get('classifications', [])
                    new_count = len(self.hebrew_classifications)
                    logger.info(f"Reloaded classifications: {old_count} -> {new_count} classifications")
                    return True
            else:
                logger.warning(f"Classifications file not found at {classifications_path}")
                return False
        except Exception as e:
            logger.error(f"Failed to reload classifications: {e}")
            return False


# Singleton instance
ollama_service = OllamaService()