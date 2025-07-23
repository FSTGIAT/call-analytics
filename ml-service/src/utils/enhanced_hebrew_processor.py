import re
import unicodedata
import logging
from typing import Optional, List, Dict

logger = logging.getLogger(__name__)

class EnhancedHebrewProcessor:
    """
    Enhanced Hebrew text processor optimized for AlephBERT embeddings.
    Based on latest research for Hebrew NLP optimization.
    """
    
    def __init__(self):
        # Hebrew final letter normalization mapping
        self.final_letter_map = {
            'ף': 'פ',  # Final Pe -> Pe
            'ץ': 'צ',  # Final Tzade -> Tzade
            'ך': 'כ',  # Final Kaf -> Kaf
            'ן': 'נ',  # Final Nun -> Nun
            'ם': 'מ'   # Final Mem -> Mem
        }
        
        # Hebrew vowel points (niqqud) for optional removal
        self.hebrew_vowels = [
            '\u05B0',  # Sheva
            '\u05B1',  # Hataf Segol
            '\u05B2',  # Hataf Patah
            '\u05B3',  # Hataf Qamats
            '\u05B4',  # Hiriq
            '\u05B5',  # Tsere
            '\u05B6',  # Segol
            '\u05B7',  # Patah
            '\u05B8',  # Qamats
            '\u05B9',  # Holam
            '\u05BA',  # Holam Haser for Vav
            '\u05BB',  # Qubuts
            '\u05BC',  # Dagesh
            '\u05BD',  # Meteg
            '\u05BE',  # Maqaf
            '\u05BF',  # Rafe
            '\u05C0',  # Paseq
            '\u05C1',  # Shin Dot
            '\u05C2',  # Sin Dot
            '\u05C3',  # Sof Pasuq
            '\u05C4',  # Upper Dot
            '\u05C5',  # Lower Dot
        ]
        
        # Call center specific terms for better tokenization
        self.call_center_terms = {
            'בעיה טכנית': 'בעיה_טכנית',
            'שירות לקוחות': 'שירות_לקוחות',
            'תמיכה טכנית': 'תמיכה_טכנית',
            'אינטרנט איטי': 'אינטרנט_איטי',
            'ניתוק חיבור': 'ניתוק_חיבור',
            'חיוב כפול': 'חיוב_כפול',
            'בעיית קישוריות': 'בעיית_קישוריות',
            'איכות שיחה': 'איכות_שיחה',
            'מהירות גלישה': 'מהירות_גלישה',
            'תקלת רשת': 'תקלת_רשת'
        }
        
        logger.info("Enhanced Hebrew Processor initialized for AlephBERT optimization")
    
    def normalize_unicode(self, text: str) -> str:
        """
        Apply Unicode NFC normalization for consistent character representation.
        Handles composed vs decomposed Hebrew characters.
        """
        return unicodedata.normalize('NFC', text)
    
    def normalize_final_letters(self, text: str) -> str:
        """
        Convert Hebrew final letters to their standard forms.
        Improves token consistency for AlephBERT.
        """
        for final_letter, standard_letter in self.final_letter_map.items():
            text = text.replace(final_letter, standard_letter)
        return text
    
    def remove_niqqud(self, text: str, remove_vowels: bool = True) -> str:
        """
        Remove Hebrew vowel points (niqqud) for consistent tokenization.
        Optional based on use case requirements.
        """
        if not remove_vowels:
            return text
            
        for vowel in self.hebrew_vowels:
            text = text.replace(vowel, '')
        return text
    
    def normalize_vowel_combinations(self, text: str) -> str:
        """
        Normalize Hebrew vowel point combinations.
        Handles Unicode combinations like U+05BA and U+05B9 (both holam).
        """
        # Normalize holam variations
        text = text.replace('\u05BA', '\u05B9')  # Holam Haser -> Holam
        
        # Remove duplicate vowel points
        text = re.sub(r'[\u05B0-\u05C5]+', lambda m: ''.join(set(m.group())), text)
        
        return text
    
    def enhance_call_center_terms(self, text: str) -> str:
        """
        Convert multi-word call center terms to single tokens.
        Improves semantic understanding for domain-specific content.
        """
        for term, enhanced_term in self.call_center_terms.items():
            text = text.replace(term, enhanced_term)
        return text
    
    def optimize_mixed_language_text(self, text: str) -> str:
        """
        Optimize Hebrew-English mixed text for better embedding.
        Handles common patterns in customer service calls.
        """
        # Add space around English words in Hebrew text
        text = re.sub(r'([א-ת])([A-Za-z])', r'\1 \2', text)
        text = re.sub(r'([A-Za-z])([א-ת])', r'\1 \2', text)
        
        # Normalize common English technical terms
        tech_terms = {
            'wifi': 'WiFi',
            'router': 'Router', 
            'modem': 'Modem',
            'internet': 'Internet',
            'email': 'Email'
        }
        
        for old_term, new_term in tech_terms.items():
            text = re.sub(rf'\b{old_term}\b', new_term, text, flags=re.IGNORECASE)
        
        return text
    
    def preprocess_for_alephbert(
        self, 
        text: str, 
        remove_vowels: bool = True,
        enhance_domain_terms: bool = True,
        normalize_finals: bool = True
    ) -> str:
        """
        Complete preprocessing pipeline optimized for AlephBERT embeddings.
        
        Args:
            text: Input Hebrew text
            remove_vowels: Whether to remove niqqud
            enhance_domain_terms: Whether to enhance call center terms
            normalize_finals: Whether to normalize final letters
            
        Returns:
            Optimized text for AlephBERT processing
        """
        if not text or not text.strip():
            return text
        
        try:
            # Step 1: Unicode normalization
            text = self.normalize_unicode(text)
            
            # Step 2: Normalize final letters
            if normalize_finals:
                text = self.normalize_final_letters(text)
            
            # Step 3: Handle vowel points
            if remove_vowels:
                text = self.normalize_vowel_combinations(text)
                text = self.remove_niqqud(text, remove_vowels=True)
            
            # Step 4: Enhance domain-specific terms
            if enhance_domain_terms:
                text = self.enhance_call_center_terms(text)
            
            # Step 5: Optimize mixed language content
            text = self.optimize_mixed_language_text(text)
            
            # Step 6: Clean up extra whitespace
            text = re.sub(r'\s+', ' ', text).strip()
            
            return text
            
        except Exception as e:
            logger.error(f"Error in Hebrew preprocessing: {e}")
            return text  # Return original text on error
    
    def batch_preprocess(self, texts: List[str], **kwargs) -> List[str]:
        """
        Batch preprocessing for multiple texts.
        More efficient for large datasets.
        """
        return [self.preprocess_for_alephbert(text, **kwargs) for text in texts]
    
    def get_preprocessing_stats(self, original_text: str, processed_text: str) -> Dict:
        """
        Get statistics about preprocessing changes.
        Useful for monitoring optimization impact.
        """
        return {
            'original_length': len(original_text),
            'processed_length': len(processed_text),
            'length_reduction': len(original_text) - len(processed_text),
            'final_letters_normalized': sum(1 for char in original_text if char in self.final_letter_map),
            'vowels_removed': sum(1 for char in original_text if char in self.hebrew_vowels),
            'domain_terms_enhanced': sum(1 for term in self.call_center_terms.keys() if term in original_text)
        }

# Global instance for use across the application
enhanced_hebrew_processor = EnhancedHebrewProcessor()