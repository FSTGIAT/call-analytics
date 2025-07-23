import re
import unicodedata
import hashlib
from typing import List, Dict
from functools import lru_cache
import logging

logger = logging.getLogger(__name__)


class HebrewTextProcessor:
    """
    Simplified Hebrew text processor for DictaLM.
    Since DictaLM handles Hebrew natively, we only do basic cleaning.
    """
    
    def __init__(self):
        # Basic patterns for cleaning
        self.hebrew_pattern = re.compile(r'[\u0590-\u05FF]+')
        self.english_pattern = re.compile(r'[a-zA-Z]+')
        self.number_pattern = re.compile(r'\d+')
        
    def normalize_text(self, text: str) -> str:
        """Basic text normalization - minimal processing for DictaLM."""
        # Remove Unicode control characters
        text = ''.join(ch for ch in text if unicodedata.category(ch)[0] != 'C')
        
        # Normalize whitespace
        text = ' '.join(text.split())
        
        # Fix common encoding issues
        text = text.replace('״', '"').replace('׳', "'")
        
        return text
    
    def remove_nikkud(self, text: str) -> str:
        """Remove Hebrew nikkud (vowel marks) from text."""
        nikkud_chars = [
            '\u05B0', '\u05B1', '\u05B2', '\u05B3', '\u05B4', '\u05B5', 
            '\u05B6', '\u05B7', '\u05B8', '\u05B9', '\u05BA', '\u05BB',
            '\u05BC', '\u05BD', '\u05BF', '\u05C1', '\u05C2', '\u05C4',
            '\u05C5', '\u05C7'
        ]
        for char in nikkud_chars:
            text = text.replace(char, '')
        return text
    
    def basic_clean(self, text: str) -> str:
        """Basic cleaning for DictaLM - let the model handle the rest."""
        # Normalize text
        text = self.normalize_text(text)
        
        # Remove nikkud if present
        text = self.remove_nikkud(text)
        
        # That's it - let DictaLM handle Hebrew naturally
        return text
    
    def detect_language_mix(self, text: str) -> Dict[str, float]:
        """Detect the language composition of the text."""
        total_chars = len(text)
        if total_chars == 0:
            return {'hebrew': 0.0, 'english': 0.0, 'other': 0.0}
        
        hebrew_chars = len(self.hebrew_pattern.findall(text))
        english_chars = len(self.english_pattern.findall(text))
        
        return {
            'hebrew': hebrew_chars / total_chars,
            'english': english_chars / total_chars,
            'other': 1.0 - (hebrew_chars + english_chars) / total_chars
        }
    
    def extract_phone_numbers(self, text: str) -> List[str]:
        """Extract Israeli phone numbers from text."""
        # Israeli phone number patterns
        patterns = [
            r'05\d{1}[-\s]?\d{7}',  # Mobile
            r'0[2-9][-\s]?\d{7}',   # Landline
            r'1[-\s]?800[-\s]?\d{6}',  # Toll-free
            r'\*\d{4}',  # Short codes
        ]
        
        phone_numbers = []
        for pattern in patterns:
            matches = re.findall(pattern, text)
            phone_numbers.extend(matches)
        
        return phone_numbers
    
    def extract_product_mentions(self, text: str, product_keywords: List[str]) -> List[str]:
        """Extract product mentions from text based on keywords."""
        text_lower = text.lower()
        mentioned_products = []
        
        for product in product_keywords:
            if product.lower() in text_lower:
                mentioned_products.append(product)
        
        return mentioned_products


# Singleton instance
hebrew_processor = HebrewTextProcessor()