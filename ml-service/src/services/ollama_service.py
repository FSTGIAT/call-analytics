import os
import json
import asyncio
import aiohttp
import logging
import hashlib
import time
from typing import Dict, List, Optional, AsyncGenerator
from dataclasses import dataclass
from datetime import datetime, timedelta

# Import call direction detection (lightweight, no keyword filtering)
# NOTE: Keyword-based classification filtering removed - trust DictaLM's Hebrew understanding
from .classification_keywords import detect_call_direction

# Import CloudWatch metrics service
from .cloudwatch_metrics_service import cloudwatch_metrics

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
        # Periodically clean up expired entries (every 100 requests)
        if len(self.cache) % 100 == 0:
            self.cleanup_expired()
            
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
    
    def cleanup_expired(self):
        """Remove expired entries from cache"""
        current_time = datetime.now()
        expired_keys = []
        
        for key, (response, timestamp) in self.cache.items():
            if current_time - timestamp > self.ttl:
                expired_keys.append(key)
        
        for key in expired_keys:
            del self.cache[key]
            
        if expired_keys:
            logger.info(f"Cleaned up {len(expired_keys)} expired cache entries")
    
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
            base_url=os.getenv('OLLAMA_BASE_URL', 'http://ollama.callanalytics.local:11434'),
            model_name=os.getenv('DEFAULT_MODEL', 'dictalm2.0-instruct:Q4_K_M'),  # Updated model name
            temperature=float(os.getenv('MODEL_TEMPERATURE', '0.5')),  # Optimized for Hebrew
            max_tokens=int(os.getenv('MODEL_MAX_TOKENS', '4000')),  # Increased from 3000 for Hebrew JSON
            timeout=int(os.getenv('REQUEST_TIMEOUT', '60'))  # 60s timeout - Ollama running on CPU (NEEDS GPU!)
        )
        
        # Always use DictaLM for everything
        self.hebrew_model = os.getenv('HEBREW_MODEL', 'dictalm2.0-instruct:Q4_K_M')
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

        # Load keyword-based classification mappings
        self.classification_keywords = {}
        try:
            keywords_path = '/app/config/classification-keywords.json'
            if os.path.exists(keywords_path):
                with open(keywords_path, 'r', encoding='utf-8') as f:
                    keywords_config = json.load(f)
                    self.classification_keywords = keywords_config.get('keywords', {})
                    logger.info(f"✅ Loaded keyword mappings for {len(self.classification_keywords)} categories")
            else:
                logger.warning(f"Keywords file not found at {keywords_path}")
        except Exception as e:
            logger.error(f"Failed to load classification keywords: {e}")
            self.classification_keywords = {}
        
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

    def _classify_by_keywords(self, transcription: str) -> Optional[str]:
        """
        Keyword-based classification to assist/override LLM classification.
        Returns the best matching category based on keyword presence in transcription.

        Args:
            transcription: The call transcription text

        Returns:
            Best matching category or None if no strong match
        """
        if not self.classification_keywords or not transcription:
            return None

        text_lower = transcription.lower()
        scores = {}

        for category, keywords_data in self.classification_keywords.items():
            score = 0
            strong_keywords = keywords_data.get('strong', [])
            weak_keywords = keywords_data.get('weak', [])

            # Strong keywords = 3 points each
            for keyword in strong_keywords:
                if keyword in text_lower:
                    score += 3
                    logger.debug(f"🔑 Strong keyword '{keyword}' found for '{category}' (+3)")

            # Weak keywords = 1 point each
            for keyword in weak_keywords:
                if keyword in text_lower:
                    score += 1
                    logger.debug(f"🔑 Weak keyword '{keyword}' found for '{category}' (+1)")

            if score > 0:
                scores[category] = score

        if not scores:
            return None

        # Get best match (minimum threshold of 2)
        best_category = max(scores.keys(), key=lambda k: scores[k])
        best_score = scores[best_category]

        if best_score >= 2:
            logger.info(f"🎯 Keyword classification: '{best_category}' (score: {best_score})")
            # Log all scores for debugging
            sorted_scores = sorted(scores.items(), key=lambda x: -x[1])[:5]
            logger.info(f"📊 Top keyword scores: {sorted_scores}")
            return best_category

        return None

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

    def _validate_classifications(self, classifications: list, valid_list: list = None) -> list:
        """
        STRENGTHENED validation - reject non-matching classifications completely.

        Args:
            classifications: List of classifications from DictaLM
            valid_list: The filtered list to validate against (if None, uses full list)

        Returns:
            List of validated classifications that match the valid list
        """
        # Use provided valid_list or fall back to full list
        reference_list = valid_list if valid_list else self.hebrew_classifications

        if not classifications or not reference_list:
            logger.warning("⚠️ No classifications to validate or no reference list")
            return ["לא מסווג"]

        # STRICT: Only accept list type
        if not isinstance(classifications, list):
            logger.error(f"❌ Invalid classification type: {type(classifications)} - MUST be list. Returning default.")
            return ["לא מסווג"]

        validated = []
        for classification in classifications:
            # Skip empty/None values
            if not classification and classification != 0:
                continue

            # Handle integer indices (when DictaLM returns [1, 2] instead of text)
            if isinstance(classification, int):
                # Convert 1-based index to 0-based and lookup in reference list
                idx = classification - 1  # DictaLM uses 1-based numbering
                if 0 <= idx < len(reference_list):
                    resolved = reference_list[idx]
                    logger.info(f"🔢 Resolved index {classification} → '{resolved}'")
                    validated.append(resolved)
                else:
                    logger.warning(f"❌ Invalid classification index: {classification} (list has {len(reference_list)} items)")
                continue

            # STRICT: Only accept strings after handling integers
            if not isinstance(classification, str):
                logger.warning(f"❌ Non-string classification detected: {type(classification)} - skipping")
                continue

            # Strip whitespace
            classification = classification.strip()
            if not classification:
                continue

            # Strip number prefix if exists (e.g., "8. מעבר תכנית" -> "מעבר תכנית")
            import re
            classification = re.sub(r'^\d+\.\s*', '', classification).strip()

            # Check exact match first
            if classification in reference_list:
                validated.append(classification)
                logger.debug(f"✅ Exact match: '{classification}'")
                continue

            # Fuzzy matching: 85% threshold (balanced for Hebrew variations)
            from difflib import get_close_matches
            matches = get_close_matches(classification, reference_list, n=1, cutoff=0.85)

            if matches:
                logger.info(f"🔍 Fuzzy matched (85%+): '{classification}' → '{matches[0]}'")
                validated.append(matches[0])
            else:
                # STRICT: Reject classifications that don't match at 95%
                logger.warning(f"❌ REJECTED - Not in valid list: '{classification}'")
                logger.debug(f"   Valid options were: {reference_list[:5]}... (showing first 5)")

        # If no valid classifications after strict validation, use default
        if not validated:
            logger.warning("⚠️ No valid classifications passed strict validation - using 'לא מסווג'")
            validated.append("לא מסווג")

        return validated

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
        perf_start = time.time()
        
        # Performance logging
        logger.info(f"[PERF] === STARTING LLM REQUEST AT {start_time} ===")
        logger.info(f"[PERF] Prompt length: {len(prompt)} chars")
        if system_prompt:
            logger.info(f"[PERF] System prompt length: {len(system_prompt)} chars")
        
        # Always use DictaLM - it handles Hebrew, English, and mixed text perfectly
        model_name = self.hebrew_model
        logger.info(f"[PERF] Using DictaLM model: {model_name}")
        logger.info(f"[PERF] Timeout configured: {self.config.timeout}s")
        logger.info(f"[PERF] Ollama URL: {self.config.base_url}")
        logger.info(f"[PERF] Using model: {self.config.model_name}")
        logger.info(f"[PERF] Prompt length: {len(prompt)} characters")
        
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
                    "format": "json",  # Force Ollama to return valid JSON only
                    "options": {
                        "temperature": temp,
                        "num_predict": max_tok,
                        "num_ctx": 16384,  # Increased from 8192 for long Hebrew conversations
                        "repeat_penalty": 1.1,
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
                            
                            # Detailed performance logging
                            response_length = len(data.get('response', ''))
                            eval_duration = data.get('eval_duration', 0) / 1e9  # Convert nanoseconds to seconds
                            prompt_eval_duration = data.get('prompt_eval_duration', 0) / 1e9
                            total_duration = data.get('total_duration', 0) / 1e9
                            load_duration = data.get('load_duration', 0) / 1e9
                            
                            # Enhanced performance logging with token usage analysis
                            tokens_generated = data.get('eval_count', 0)
                            tokens_limit = max_tok
                            token_usage_pct = (tokens_generated / tokens_limit * 100) if tokens_limit > 0 else 0

                            logger.info(f"[PERF] === OLLAMA PERFORMANCE BREAKDOWN ===")
                            logger.info(f"[PERF] Model load time: {load_duration:.2f}s")
                            logger.info(f"[PERF] Prompt eval time: {prompt_eval_duration:.2f}s")
                            logger.info(f"[PERF] Prompt tokens: {data.get('prompt_eval_count', 0)}")
                            logger.info(f"[PERF] Generation time: {eval_duration:.2f}s")
                            logger.info(f"[PERF] Total Ollama time: {total_duration:.2f}s")
                            logger.info(f"[PERF] Full request time: {processing_time:.2f}s")
                            logger.info(f"[PERF] Response length: {response_length} chars")
                            if processing_time > 0:
                                logger.info(f"[PERF] Generation speed: {response_length/processing_time:.1f} chars/sec")
                            logger.info(f"[PERF] Tokens generated: {tokens_generated} / {tokens_limit} ({token_usage_pct:.1f}%)")

                            # Warning if approaching token limit
                            if token_usage_pct > 90:
                                logger.warning(f"⚠️ TOKEN LIMIT WARNING: Using {token_usage_pct:.1f}% of max_tokens - response may be truncated!")
                            elif token_usage_pct > 75:
                                logger.warning(f"Token usage high: {token_usage_pct:.1f}% of limit")

                            # Hebrew tokenization ratio analysis
                            if response_length > 0 and tokens_generated > 0:
                                chars_per_token = response_length / tokens_generated
                                logger.info(f"[PERF] Hebrew efficiency: {chars_per_token:.2f} chars/token")

                            logger.info(f"[PERF] === END PERFORMANCE BREAKDOWN ===")

                            # === CloudWatch Metrics: LLM Performance ===
                            cloudwatch_metrics.put_metric('LLMProcessingTime', processing_time * 1000, 'Milliseconds')
                            cloudwatch_metrics.put_metric('TokenUsagePercent', token_usage_pct, 'Percent')

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

                            # Cache the response ONLY if it's valid JSON (defensive programming)
                            if self.cache:
                                classifications_available = len(self.hebrew_classifications) > 0
                                try:
                                    # Validate response is valid JSON before caching
                                    json.loads(llm_response.content)
                                    self.cache.set(full_prompt, model_name, temp, max_tok, classifications_available, llm_response)
                                    logger.debug(f"Response validated and cached")
                                except json.JSONDecodeError:
                                    logger.warning(f"Not caching response - invalid JSON format")
                                    # Don't cache, but still return the response for error handling downstream
                            
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
                        "num_predict": 3000,  # Increased for Hebrew responses
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

        # Escape Hebrew gershayim (double quotes in abbreviations) to prevent JSON breakage
        # חו"ל contains an ASCII double-quote that breaks JSON parsing
        transcription = transcription.replace('חו"ל', 'חו״ל')  # Replace with Hebrew gershayim ״
        transcription = transcription.replace('ש"ח', 'ש״ח')
        transcription = transcription.replace('ת"ז', 'ת״ז')
        transcription = transcription.replace('ד"ר', 'ד״ר')

        # Truncate very long conversations to prevent context overflow
        # With num_ctx=16384 tokens and Hebrew ~2.5 chars/token:
        # - Reserve ~4000 tokens for output, ~2000 for prompt template
        # - Leaves ~10000 tokens = ~25000 chars for transcription
        MAX_TRANSCRIPTION_CHARS = 20000  # ~5000 Hebrew words (safe margin for 16K context)
        if len(transcription) > MAX_TRANSCRIPTION_CHARS:
            logger.warning(f"⚠️ Truncating transcription from {len(transcription)} to {MAX_TRANSCRIPTION_CHARS} chars")
            # Keep middle + end (where resolution usually happens), cut beginning
            transcription = "...[תחילת השיחה קוצרה]...\n" + transcription[-MAX_TRANSCRIPTION_CHARS:]

        # Build Hebrew prompt for DictaLM (all calls are Hebrew)
        categories_list = '\n'.join([f'- {cat}' for cat in self.hebrew_classifications])
        logger.info(f"📊 Using Hebrew prompt with {len(self.hebrew_classifications)} categories")

        call_id_line = f"מזהה שיחה: {call_id}\n" if call_id else ""

        prompt = f"""אתה מומחה לניתוח שיחות - סכם את שיחת שירות הלקוחות של פלאפון. החזר JSON בעברית בלבד.
A=נציג, C=לקוח. התעלם מ-B (בוט).

מדריך סיווג (בחר הקטגוריה המתאימה ביותר):
- תקלת קליטה = אין קליטה, רשת חלשה, אנטנות, אזור ללא כיסוי
- תקלת גלישה בארץ = אינטרנט לא עובד, גלישה איטית, חבילת גלישה נגמרה
- תקלת שיחות יוצאות /נכנסות בארץ = לא מצליח להתקשר או לקבל שיחות
- סימני נטישה או איום לעזוב = רק אם הלקוח אומר במפורש: "אני עוזב", "רוצה לנתק", "עובר לחברה אחרת"
- בירור חוב = שאלות על חובות קיימים, תשלומים שלא בוצעו
- הסבר חשבונית או חיוב = שאלות על חיובים, הבנת החשבונית
- מעבר תכנית/ מסלול = לקוח רוצה לשנות חבילה או מסלול
- מידע על חבילת חו״ל = שאלות על חבילות לחו״ל, נסיעות
- שעון ESIM -תפעול = בעיות עם שעון חכם, eSIM לשעון
- רכישת מכשיר = לקוח רוצה לקנות טלפון חדש
- שיחת שיווק או הצעה = רק אם נציג פלאפון התקשר בכדי להציע חבילה

פורמט JSON (השתמש בשמות האמיתיים מהשיחה בלבד):
{{"summary": "תיאור קצר של השיחה", "categories": ["קטגוריה"], "sentiment": "חיובי/שלילי/נייטרלי", "products": [], "customer_satisfaction": 1-5, "unresolved_issues": "בעיות שלא נפתרו או ריק"}}

הערכת שביעות רצון (customer_satisfaction):
1 = מאוד לא מרוצה (כעס, תלונות חריפות)
2 = לא מרוצה (תסכול, אי שביעות רצון)
3 = נייטרלי (שיחה עניינית ללא רגש מיוחד)
4 = מרוצה (תודות, שביעות רצון)
5 = מאוד מרוצה (שבחים, המלצות)

{call_id_line}קטגוריות זמינות:
{categories_list}

השיחה לסיכום:
{transcription}"""

        try:
            # Format prompt for DictaLM2.0-instruct with [INST] tags
            # Note: DictaLM does NOT support system prompts, only user prompts
            # IMPORTANT: Don't add <s> - Ollama adds BOS token automatically
            formatted_prompt = f"[INST] {prompt} [/INST]"

            logger.info(f"Using DictaLM instruction format with [INST] tags (no BOS/system prompt)")

            response = await self.generate_response(
                prompt=formatted_prompt,
                system_prompt=None,  # Already included in formatted_prompt
                temperature=0.5,  # Optimized for Hebrew creativity and detail extraction
                max_tokens=4000  # Increased from 3000 for Hebrew JSON
            )
            
            # Try to parse JSON response
            try:
                # Debug: Log raw Ollama response
                logger.info(f"Raw Ollama response length: {len(response.content)}")
                logger.info(f"Raw Ollama response: {response.content[:2000]}")  # Increased to see more

                # Check for truncation before parsing
                content = response.content.strip()
                open_braces = content.count('{')
                close_braces = content.count('}')

                if open_braces != close_braces:
                    logger.error(f"⚠️ JSON TRUNCATION DETECTED! {{ count: {open_braces}, }} count: {close_braces}")
                    logger.error(f"Response length: {len(content)} chars - likely hit token limit")
                    logger.error(f"Tokens used: {response.tokens_used if hasattr(response, 'tokens_used') else 'unknown'}")

                    # Check for severe truncation - threshold of 100 chars
                    if len(content) < 100:
                        logger.error(f"Severe truncation detected - only {len(content)} chars (threshold: 100)")
                        # Return FAILURE so app.py doesn't send to downstream queues (Oracle/OpenSearch)
                        return {
                            'success': False,  # Changed from True - prevents downstream processing
                            'error': 'severe_truncation',
                            'summary': {
                                'callId': call_id if call_id else 'unknown',
                                'summary': 'תקלה בניתוח - תגובה קצרה מדי מהמודל',
                                'classifications': ['לא מסווג'],
                                'entities': {
                                    'names': [],
                                    'phone_numbers': [],
                                    'account_numbers': [],
                                    'amounts': [],
                                    'dates': [],
                                    'products': []
                                },
                                'sentiment': 'נייטרלי',
                                'main_issue': 'תקלת עיבוד - תגובה קטועה',
                                'action_items': [],
                                'customer_satisfaction': 'לא ידוע',
                                'unresolved_issues': '',
                                'threats': [],
                                'error': 'severe_truncation'
                            },
                            'callId': call_id if call_id else 'unknown',
                            'metadata': {
                                'processing_time': 0,
                                'model': 'dictalm2.0-instruct:Q4_K_M',
                                'error': 'severe_truncation',
                                'original_length': len(content),
                                'threshold': 250
                            }
                        }

                    # Try to auto-complete JSON structure for minor truncation
                    if open_braces > close_braces:
                        missing_braces = open_braces - close_braces
                        content = content + ('}' * missing_braces)
                        logger.info(f"Added {missing_braces} closing braces to complete JSON")

                # Sanitize Hebrew text before JSON parsing
                logger.info("Attempting JSON parsing...")
                sanitized_content = self._sanitize_hebrew_for_json(content)
                logger.info(f"Sanitized content: {sanitized_content[:1000]}")
                summary_data = json.loads(sanitized_content)
                logger.info(f"JSON parsed successfully! Keys: {list(summary_data.keys())}")

                # === NORMALIZE JSON KEYS - DictaLM returns inconsistent casing ===
                # Supports both English and Hebrew key names
                key_mapping = {
                    # English variations (case normalization)
                    'Summary': 'summary',
                    'Categories': 'categories',
                    'Category': 'categories',
                    'category': 'categories',
                    'Sentiment': 'sentiment',
                    'Products': 'products',
                    'Customer_satisfaction': 'customer_satisfaction',
                    'Unresolved_issues': 'unresolved_issues',
                    # Hebrew keys (DictaLM uses these)
                    'סיכום': 'summary',
                    'סיכום השיחה': 'summary',
                    'קטגוריות': 'categories',
                    'קטגוריה': 'categories',
                    'רגש': 'sentiment',
                    'רגשות': 'sentiment',
                    'מוצרים': 'products',
                    'שביעות רצון': 'customer_satisfaction',
                    'שביעות_רצון': 'customer_satisfaction',
                    'בעיות פתוחות': 'unresolved_issues',
                    'בעיות שלא נפתרו': 'unresolved_issues',
                    'שם': '_name',  # Ignore name field if returned
                }
                normalized_data = {}
                for key, value in summary_data.items():
                    normalized_key = key_mapping.get(key, key.lower())
                    normalized_data[normalized_key] = value
                summary_data = normalized_data
                logger.info(f"Normalized keys: {list(summary_data.keys())}")
                # === END KEY NORMALIZATION ===

                logger.info(f"Summary field from JSON: {summary_data.get('summary', 'NOT_FOUND')}")

                # === REJECT ENGLISH SUMMARIES - Force Hebrew only ===
                def is_hebrew_text(text: str) -> bool:
                    """Check if text contains Hebrew characters (at least 30%)"""
                    if not text:
                        return False
                    hebrew_chars = sum(1 for c in text if '\u0590' <= c <= '\u05FF')
                    return hebrew_chars > len(text) * 0.3

                summary_text = summary_data.get('summary', '')
                if summary_text and not is_hebrew_text(summary_text):
                    logger.warning(f"⚠️ REJECTING English summary: {summary_text[:100]}...")
                    raise Exception("english_summary_rejected")  # Will trigger retry
                # === END HEBREW VALIDATION ===

                # SIMPLIFIED FORMAT: Only 'summary' is required (categories may be absent)
                if 'summary' not in summary_data:
                    logger.error("⚠️ INCOMPLETE JSON - Missing 'summary' field")
                    return {
                        'success': False,
                        'error': 'incomplete_json',
                        'summary': {
                            'callId': call_id if call_id else 'unknown',
                            'summary': 'תקלה בניתוח - JSON חלקי',
                            'classifications': ['לא מסווג'],
                            'main_category': 'לא מסווג',
                            'secondary_category': '',
                            'entities': {},
                            'sentiment': 3,
                            'action_items': [],
                            'customer_satisfaction': 3,
                            'unresolved_issues': '',
                            'threats': ''
                        },
                        'callId': call_id if call_id else 'unknown',
                        'metadata': {
                            'processing_time': response.processing_time if response else 0,
                            'model': 'dictalm2.0-instruct:Q4_K_M',
                            'error': 'missing_summary'
                        }
                    }

                # POST-PROCESSING: Convert simplified response to full format
                # Handle 'categories' - can be string OR list from DictaLM
                from difflib import get_close_matches, SequenceMatcher

                categories_raw = summary_data.get('categories', '')

                # Handle both list and string formats from DictaLM
                if isinstance(categories_raw, list):
                    raw_cats = [str(c).strip() for c in categories_raw if c]
                elif isinstance(categories_raw, str):
                    raw_cats = [c.strip() for c in categories_raw.split(',') if c.strip()]
                else:
                    raw_cats = []
                    logger.warning(f"Unexpected categories type: {type(categories_raw)}")

                # === KEYWORD-BASED CLASSIFICATION (pre-LLM backup) ===
                # Run keyword classification on original transcription
                keyword_category = self._classify_by_keywords(transcription)
                if keyword_category:
                    logger.info(f"🔑 Keyword-based category detected: '{keyword_category}'")

                # Fuzzy match each category - use balanced threshold to avoid bad matches
                matched = []
                for cat in raw_cats:
                    # Try exact match first
                    if cat in self.hebrew_classifications:
                        matched.append(cat)
                        logger.info(f"✅ Exact match: '{cat}'")
                        continue

                    # Fuzzy match with balanced threshold (0.65) - reject dissimilar categories
                    matches = get_close_matches(cat, self.hebrew_classifications, n=1, cutoff=0.65)
                    if matches:
                        matched.append(matches[0])
                        logger.info(f"🔍 Fuzzy matched (65%+): '{cat}' → '{matches[0]}'")
                    else:
                        # Don't force bad matches - log and skip
                        logger.warning(f"⚠️ No good match for category '{cat}' (cutoff 0.65) - skipping")

                # === KEYWORD CLASSIFICATION - ALWAYS USE BEST MATCH AS PRIMARY ===
                # Keywords are more reliable than LLM for specific telecom categories
                if keyword_category:
                    if not matched:
                        # No LLM match - use keyword
                        matched = [keyword_category]
                        logger.info(f"🔑 Using keyword classification (LLM had no match): '{keyword_category}'")
                    elif keyword_category not in matched:
                        # Keyword found different category - PRIORITIZE KEYWORD as primary
                        logger.info(f"🔄 Keyword override: '{keyword_category}' beats LLM '{matched[0]}'")
                        # Put keyword match first (primary), keep LLM match as secondary
                        matched = [keyword_category] + [m for m in matched if m != keyword_category][:1]
                    # else: keyword matches LLM - keep as is
                elif not matched:
                    # No keyword, no LLM match - use neutral default
                    matched = ['בירור כללי']
                    logger.warning(f"No categories found, using neutral default: {matched[0]}")

                # Build full structure for backward compatibility
                summary_data['classifications'] = matched
                summary_data['main_category'] = matched[0]
                summary_data['secondary_category'] = matched[1] if len(matched) > 1 else ''
                summary_data['is_churn_signal'] = 'נטישה' in matched[0]
                summary_data['call_type'] = 'inbound_service'
                summary_data['entities'] = {}

                # === EXTRACT PRODUCTS from LLM response ===
                products = summary_data.get('products', [])
                if not products:
                    products = summary_data.get('מוצרים', [])
                # Ensure products is always a list
                if isinstance(products, str):
                    products = [p.strip() for p in products.split(',') if p.strip()]
                elif not isinstance(products, list):
                    products = []
                summary_data['products'] = products
                if products:
                    logger.info(f"📦 Products extracted: {products}")
                # === END PRODUCTS EXTRACTION ===

                # === PARSE SENTIMENT from LLM response (Hebrew words → 1-5 scale) ===
                raw_sentiment = summary_data.get('sentiment', 'נייטרלי')
                if isinstance(raw_sentiment, str):
                    sentiment_map = {
                        'חיובי': 4, 'positive': 4,
                        'שלילי': 2, 'negative': 2,
                        'נייטרלי': 3, 'neutral': 3,
                        'מעורב': 3, 'mixed': 3
                    }
                    summary_data['sentiment'] = sentiment_map.get(raw_sentiment.lower().strip(), 3)
                    logger.info(f"📊 Sentiment parsed: '{raw_sentiment}' → {summary_data['sentiment']}")
                elif isinstance(raw_sentiment, (int, float)):
                    summary_data['sentiment'] = max(1, min(5, int(raw_sentiment)))
                else:
                    summary_data['sentiment'] = 3  # Default only if completely missing
                # === END SENTIMENT PARSING ===

                summary_data['action_items'] = []

                # === PARSE CUSTOMER SATISFACTION from LLM response (1-5 scale) ===
                raw_satisfaction = summary_data.get('customer_satisfaction', 3)
                if isinstance(raw_satisfaction, (int, float)):
                    summary_data['customer_satisfaction'] = max(1, min(5, int(raw_satisfaction)))
                elif isinstance(raw_satisfaction, str):
                    # Try to parse number from string
                    try:
                        summary_data['customer_satisfaction'] = max(1, min(5, int(raw_satisfaction.strip())))
                    except ValueError:
                        summary_data['customer_satisfaction'] = 3
                else:
                    summary_data['customer_satisfaction'] = 3
                logger.info(f"😊 Customer satisfaction: {summary_data['customer_satisfaction']}")
                # === END CUSTOMER SATISFACTION ===

                # === PARSE UNRESOLVED ISSUES from LLM response ===
                unresolved = summary_data.get('unresolved_issues', '')
                if not unresolved:
                    unresolved = summary_data.get('בעיות_פתוחות', '')
                if not unresolved:
                    unresolved = summary_data.get('בעיות שלא נפתרו', '')
                summary_data['unresolved_issues'] = str(unresolved) if unresolved else ''
                if summary_data['unresolved_issues']:
                    logger.info(f"⚠️ Unresolved issues: {summary_data['unresolved_issues']}")
                # === END UNRESOLVED ISSUES ===

                summary_data['threats'] = ''

                if call_id:
                    summary_data['callId'] = call_id

                logger.info(f"🎯 FINAL Classifications: {matched}")

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
                # === CloudWatch Metrics: JSON Parse Error ===
                cloudwatch_metrics.put_metric('JSONParseErrors', 1)
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
                'fallback_summary': {
                    'summary': 'שגיאה ביצירת סיכום - נדרשת בדיקה ידנית',
                    'sentiment': 'unknown',
                    'classifications': ['processing_error'],
                    'key_points': ['שגיאה בעיבוד אוטומטי'],
                    'call_type': 'error',
                    'action_items': ['בדיקה ידנית נדרשת']
                }
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