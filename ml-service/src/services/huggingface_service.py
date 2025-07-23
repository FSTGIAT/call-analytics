import os
import json
import asyncio
import aiohttp
import logging
from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class HuggingFaceConfig:
    endpoint_url: str
    model_name: str
    api_token: str
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


class HuggingFaceService:
    """
    Service for interacting with Hugging Face Inference Endpoints.
    Replaces Ollama with Llama 3.1 70B hosted on HF infrastructure.
    """
    
    def __init__(self):
        self.config = HuggingFaceConfig(
            endpoint_url=os.getenv('HF_ENDPOINT_URL', 'https://yatwgywcy7echpom.us-east-1.aws.endpoints.huggingface.cloud'),
            model_name=os.getenv('HF_MODEL_NAME', 'meta-llama/Llama-3.1-70B-Instruct'),
            api_token=os.getenv('HF_TOKEN'),
            temperature=float(os.getenv('MODEL_TEMPERATURE', '0.7')),
            max_tokens=int(os.getenv('MODEL_MAX_TOKENS', '2048')),
            timeout=int(os.getenv('REQUEST_TIMEOUT', '60'))
        )
        
        if not self.config.api_token:
            logger.error("HF_TOKEN environment variable is required")
            raise ValueError("HuggingFace API token is required")
        
        if not self.config.endpoint_url:
            logger.error("HF_ENDPOINT_URL environment variable is required")
            raise ValueError("HuggingFace Endpoint URL is required")
        
        # Request tracking
        self.request_count = 0
        self.max_concurrent = int(os.getenv('MAX_CONCURRENT_REQUESTS', '10'))
        self.semaphore = asyncio.Semaphore(self.max_concurrent)
        
        logger.info(f"HuggingFace service initialized with model: {self.config.model_name}")
        logger.info(f"Using endpoint: {self.config.endpoint_url}")
    
    async def health_check(self) -> bool:
        """Check if HuggingFace Inference Endpoint is available."""
        try:
            headers = {
                'Authorization': f'Bearer {self.config.api_token}',
                'Content-Type': 'application/json'
            }
            
            # Simple health check payload
            payload = {
                "inputs": "Hello",
                "parameters": {
                    "max_new_tokens": 1,
                    "temperature": 0.1
                }
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.config.endpoint_url,
                    json=payload,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    return response.status == 200
                    
        except Exception as e:
            logger.error(f"HuggingFace health check failed: {e}")
            return False
    
    async def list_models(self) -> List[str]:
        """List available models (returns current model)."""
        return [self.config.model_name]
    
    async def generate_response(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ) -> LLMResponse:
        """Generate a response using HuggingFace Inference Endpoint."""
        
        start_time = datetime.now()
        
        async with self.semaphore:  # Rate limiting
            try:
                temp = temperature if temperature is not None else self.config.temperature
                max_tok = max_tokens or self.config.max_tokens
                
                # Format prompt for Llama 3.1 Chat format
                formatted_prompt = self._format_chat_prompt(prompt, system_prompt)
                
                headers = {
                    'Authorization': f'Bearer {self.config.api_token}',
                    'Content-Type': 'application/json'
                }
                
                # Detect Hebrew and adjust parameters accordingly
                has_hebrew = any(ord(char) >= 0x0590 and ord(char) <= 0x05FF for char in formatted_prompt)
                
                # Hebrew requires more tokens due to inefficient tokenization (research: 3-5x more)
                if has_hebrew:
                    adjusted_max_tokens = min(max_tok * 5, 2048)  # Increase to 5x based on research
                    adjusted_temp = max(temp, 0.8)  # Higher temperature for Hebrew creativity
                    stop_sequences = ["<|eot_id|>"]  # Minimal stop sequences for Hebrew
                    # Add Hebrew-specific parameters
                    repetition_penalty = 1.1  # Lower for Hebrew (research recommendation)
                    top_p = 0.95  # Higher for Hebrew diversity
                else:
                    adjusted_max_tokens = max_tok
                    adjusted_temp = temp
                    stop_sequences = ["<|eot_id|>", "<|end_of_text|>"]
                    repetition_penalty = 1.2
                    top_p = 0.9
                
                payload = {
                    "inputs": formatted_prompt,
                    "parameters": {
                        "max_new_tokens": adjusted_max_tokens,
                        "temperature": adjusted_temp,
                        "do_sample": adjusted_temp > 0.0,
                        "top_p": top_p,
                        "top_k": 100 if has_hebrew else 50,  # Higher for Hebrew diversity
                        "repetition_penalty": repetition_penalty,
                        "return_full_text": False,
                        "stop": stop_sequences,
                        "pad_token_id": 128001,
                        "eos_token_id": 128009
                    }
                }
                
                logger.info(f"Sending request to HF endpoint: {self.config.endpoint_url}")
                logger.info(f"Payload size: {len(str(payload))} chars, prompt length: {len(formatted_prompt)}")
                logger.info(f"Formatted prompt preview: {formatted_prompt[:300]}...")
                
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        self.config.endpoint_url,
                        json=payload,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=self.config.timeout)
                    ) as response:
                        
                        if response.status == 200:
                            data = await response.json()
                            end_time = datetime.now()
                            processing_time = (end_time - start_time).total_seconds()
                            
                            self.request_count += 1
                            
                            # Extract response from HF format
                            if isinstance(data, list) and len(data) > 0:
                                content = data[0].get('generated_text', '')
                            else:
                                content = data.get('generated_text', '')
                            
                            # Validate response quality  
                            expect_hebrew = any(ord(char) >= 0x0590 and ord(char) <= 0x05FF for char in prompt) or "Hebrew" in str(system_prompt)
                            logger.info(f"Raw HF response: {content[:200]}...")
                            logger.info(f"Expect Hebrew: {expect_hebrew}")
                            content = self._validate_and_clean_response(content, expect_hebrew)
                            
                            logger.info(f"HF response after validation, length: {len(content)}")
                            
                            return LLMResponse(
                                content=content,
                                model=self.config.model_name,
                                timestamp=end_time,
                                tokens_used=len(content.split()),  # Approximate
                                processing_time=processing_time,
                                metadata={
                                    'endpoint_url': self.config.endpoint_url,
                                    'request_id': response.headers.get('x-request-id', ''),
                                    'response_status': response.status
                                }
                            )
                        else:
                            error_text = await response.text()
                            logger.error(f"HF API error {response.status}: {error_text}")
                            raise Exception(f"HuggingFace API error {response.status}: {error_text}")
                            
            except asyncio.TimeoutError:
                raise Exception(f"Request timed out after {self.config.timeout} seconds")
            except Exception as e:
                logger.error(f"Error generating response: {e}")
                raise
    
    def _format_chat_prompt(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Optimized Llama 3.1 format for Hebrew and English."""
        
        # Detect Hebrew in prompt
        has_hebrew = any(ord(char) >= 0x0590 and ord(char) <= 0x05FF for char in prompt)
        
        if has_hebrew:
            # Use Llama 3.1 format optimized for Hebrew
            if system_prompt:
                formatted = f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n{system_prompt}\n\nIMPORTANT: Respond in Hebrew only.<|eot_id|><|start_header_id|>user<|end_header_id|>\n{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n"
            else:
                formatted = f"<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n{prompt}\n\nRespond in Hebrew.<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n"
        else:
            # Standard English format
            if system_prompt:
                formatted = f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n{system_prompt}<|eot_id|><|start_header_id|>user<|end_header_id|>\n{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n"
            else:
                formatted = f"<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n"
        
        return formatted
    
    def _validate_and_clean_response(self, content: str, expect_hebrew: bool = False) -> str:
        """Validate and clean LLM response for quality."""
        if not content:
            return ""
        
        # Remove leading/trailing whitespace
        content = content.strip()
        
        # Check for excessive repetition only on longer responses to avoid breaking short Hebrew responses
        words = content.split()
        if len(words) > 20:  # Increased threshold to protect short responses
            # Check for repetitive patterns
            phrase_counts = {}
            for i in range(len(words) - 2):
                phrase = ' '.join(words[i:i+3])
                phrase_counts[phrase] = phrase_counts.get(phrase, 0) + 1
            
            max_repetition = max(phrase_counts.values()) if phrase_counts else 0
            if max_repetition > 5:  # Increased threshold
                logger.warning(f"Detected repetitive response, max repetition: {max_repetition}")
                # Find the first repetition point and cut there
                seen_phrases = set()
                clean_words = []
                for i in range(len(words) - 2):
                    phrase = ' '.join(words[i:i+3])
                    if phrase in seen_phrases:
                        break
                    seen_phrases.add(phrase)
                    clean_words.extend(words[i:i+3])
                if clean_words:
                    content = ' '.join(clean_words[:100])  # Keep more content
                else:
                    content = ' '.join(words[:50])  # Fallback to first 50 words
        
        # Validate language expectation
        has_hebrew = any(ord(char) >= 0x0590 and ord(char) <= 0x05FF for char in content)
        has_english = any(char.isalpha() and ord(char) < 0x0590 for char in content)
        
        if expect_hebrew and not has_hebrew and has_english:
            logger.warning("Expected Hebrew response but got English")
            # Don't modify - let it through but log the issue
        
        # Remove common artifacts
        content = content.replace('<|eot_id|>', '')
        content = content.replace('<|start_header_id|>', '')
        content = content.replace('<|end_header_id|>', '')
        
        return content.strip()
    
    async def summarize_call(
        self,
        transcription: str,
        language: str = 'hebrew',
        include_sentiment: bool = True,
        include_products: bool = True
    ) -> Dict:
        """Generate a structured summary of a call transcription."""
        
        # Use English prompts for better model performance
        if language.lower() in ['hebrew', 'he']:
            system_prompt = """Analyze customer service calls. Analyze Hebrew calls and respond with Hebrew values in JSON format only."""
            
            prompt = f"""Customer call transcription (Hebrew): {transcription}

Analyze this call and provide a structured summary.
Respond with JSON only, with Hebrew values:
{{
    "summary": "Brief summary in Hebrew",
    "key_points": ["point 1 in Hebrew", "point 2 in Hebrew"],
    "sentiment": "positive/negative/neutral",
    "products_mentioned": ["product names if any"],
    "main_issue": "main issue or need in Hebrew",
    "call_type": "inquiry/complaint/request/info"
}}"""
        else:
            # English system prompt  
            system_prompt = """Analyze customer service calls. 
Summarize calls and extract important information.
Always respond in structured JSON format only."""
            
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
                temperature=0.2,  # Low for consistency
                max_tokens=400 if language.lower() in ['hebrew', 'he'] else 500
            )
            
            # Try to parse JSON response
            try:
                # Clean response - remove any leading/trailing text
                content = response.content.strip()
                if content.startswith('```json'):
                    content = content[7:]
                if content.endswith('```'):
                    content = content[:-3]
                content = content.strip()
                
                summary_data = json.loads(content)
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
        """Test different Hebrew prompt strategies with Llama 3.1."""
        
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
        return {
            'total_requests': self.request_count,
            'max_concurrent': self.max_concurrent,
            'current_model': self.config.model_name,
            'endpoint_url': self.config.endpoint_url,
            'service_type': 'huggingface'
        }


# Singleton instance
huggingface_service = HuggingFaceService()