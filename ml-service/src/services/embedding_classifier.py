"""
Embedding-based Classification Service for Hebrew Call Analytics.

Uses AlephBERT embeddings to classify call transcriptions into predefined categories
based on semantic similarity. Much faster than LLM-based classification (~50ms vs 6+ seconds).
"""

import os
import json
import logging
import numpy as np
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class ClassificationResult:
    """Result of a classification operation."""
    category_id: str
    category_name: str
    confidence: float
    keyword_boost: float = 0.0


class EmbeddingClassifier:
    """
    Fast embedding-based classifier for Hebrew call transcriptions.

    Uses pre-computed category embeddings and cosine similarity for classification.
    Optionally applies keyword boost for high-confidence patterns.
    """

    def __init__(self, embedding_service):
        """
        Initialize the classifier.

        Args:
            embedding_service: The embedding service instance (AlephBERT)
        """
        self.embedding_service = embedding_service
        self.category_embeddings: Dict[str, np.ndarray] = {}
        self.categories: Dict[str, Dict] = {}  # id -> {name, description}
        self.keywords: Dict[str, Dict] = {}  # category_name -> {strong: [], weak: []}
        self.initialized = False

        # Configuration
        self.default_threshold = float(os.getenv('CLASSIFICATION_THRESHOLD', '0.35'))
        self.keyword_strong_boost = float(os.getenv('KEYWORD_STRONG_BOOST', '0.15'))
        self.keyword_weak_boost = float(os.getenv('KEYWORD_WEAK_BOOST', '0.05'))

        # Churn detection configuration
        self.churn_embedding: Optional[np.ndarray] = None
        self.churn_config: Dict = {}
        self.churn_initialized = False
        self.churn_threshold = float(os.getenv('CHURN_DETECTION_THRESHOLD', '0.40'))

        # Churn keyword boosting (loaded from keywords config)
        self.churn_keywords: Dict[str, list] = {'strong': [], 'medium': [], 'weak': [], 'negative': []}
        self.churn_scoring: Dict = {
            'strong_boost': 35,
            'medium_boost': 20,
            'weak_boost': 10,
            'min_baseline': 0.50,
            'max_signal': 0.72
        }

        # Stats
        self.stats = {
            'classifications': 0,
            'total_time': 0.0,
            'keyword_boosts_applied': 0,
            'churn_detections': 0,
            'churn_positives': 0
        }

        logger.info("EmbeddingClassifier initialized")

    async def initialize(self, classifications_path: str, keywords_path: Optional[str] = None) -> bool:
        """
        Initialize the classifier by loading categories and computing embeddings.

        Args:
            classifications_path: Path to call-classifications.json
            keywords_path: Optional path to classification-keywords.json

        Returns:
            True if initialization successful
        """
        try:
            # Ensure embedding model is loaded
            if not self.embedding_service.model_loaded:
                logger.info("Initializing embedding model...")
                await self.embedding_service.initialize_model()

            # Load classifications
            logger.info(f"Loading classifications from {classifications_path}")
            with open(classifications_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            classifications = data.get('classifications', [])
            if not classifications:
                logger.error("No classifications found in file")
                return False

            # Check if new format (objects) or old format (strings)
            if isinstance(classifications[0], str):
                logger.warning("Old classification format detected. Descriptions required for optimal accuracy.")
                # Convert old format
                for i, name in enumerate(classifications):
                    cat_id = f"cat_{i}"
                    self.categories[cat_id] = {
                        'name': name,
                        'description': name  # Use name as description fallback
                    }
            else:
                # New format with id, name, description
                for cat in classifications:
                    cat_id = cat.get('id', cat.get('name'))
                    self.categories[cat_id] = {
                        'name': cat.get('name'),
                        'description': cat.get('description', cat.get('name'))
                    }

            logger.info(f"Loaded {len(self.categories)} categories")

            # Load keywords if provided
            if keywords_path and os.path.exists(keywords_path):
                logger.info(f"Loading keywords from {keywords_path}")
                with open(keywords_path, 'r', encoding='utf-8') as f:
                    keywords_data = json.load(f)
                self.keywords = keywords_data.get('keywords', {})
                logger.info(f"Loaded keywords for {len(self.keywords)} categories")

                # Load churn-specific keywords and scoring config
                churn_kw = keywords_data.get('churn_keywords', {})
                if churn_kw:
                    self.churn_keywords = {
                        'strong': churn_kw.get('strong', []),
                        'medium': churn_kw.get('medium', []),
                        'weak': churn_kw.get('weak', []),
                        'negative': churn_kw.get('negative', [])
                    }
                    logger.info(f"Loaded churn keywords: {len(self.churn_keywords['strong'])} strong, "
                                f"{len(self.churn_keywords['medium'])} medium, {len(self.churn_keywords['weak'])} weak, "
                                f"{len(self.churn_keywords['negative'])} negative")

                churn_scoring = keywords_data.get('churn_scoring', {})
                if churn_scoring:
                    self.churn_scoring.update(churn_scoring)
                    logger.info(f"Loaded churn scoring config: {self.churn_scoring}")

            # Compute category embeddings
            await self._compute_category_embeddings()

            # Load and compute churn detection embedding
            churn_config = data.get('churn_detection', {})
            if churn_config.get('enabled', False):
                await self._compute_churn_embedding(churn_config)

            self.initialized = True
            logger.info(f"EmbeddingClassifier initialized with {len(self.category_embeddings)} category embeddings")

            return True

        except Exception as e:
            logger.error(f"Failed to initialize EmbeddingClassifier: {e}")
            return False

    async def _compute_category_embeddings(self):
        """Pre-compute embeddings for all categories."""
        logger.info("Computing category embeddings...")
        start_time = datetime.now()

        for cat_id, cat_data in self.categories.items():
            # Combine name and description for richer embedding
            text = f"{cat_data['name']} {cat_data['description']}"

            try:
                result = await self.embedding_service.generate_embedding(text)
                self.category_embeddings[cat_id] = result.embedding
            except Exception as e:
                logger.error(f"Failed to compute embedding for category {cat_id}: {e}")

        elapsed = (datetime.now() - start_time).total_seconds()
        logger.info(f"Computed {len(self.category_embeddings)} category embeddings in {elapsed:.2f}s")

    async def _compute_churn_embedding(self, churn_config: Dict) -> bool:
        """
        Pre-compute embedding for independent churn detection.

        Args:
            churn_config: Dict with 'enabled', 'description', 'threshold'

        Returns:
            True if churn embedding computed successfully
        """
        if not churn_config or not churn_config.get('enabled', False):
            logger.info("Churn detection disabled in config")
            return False

        description = churn_config.get('description', '')
        if not description:
            logger.error("No churn description provided in config")
            return False

        try:
            logger.info("Computing churn detection embedding...")
            result = await self.embedding_service.generate_embedding(description)
            self.churn_embedding = result.embedding
            self.churn_config = churn_config
            self.churn_threshold = float(churn_config.get('threshold', 0.40))
            self.churn_initialized = True

            logger.info(f"Churn embedding computed (threshold: {self.churn_threshold})")
            return True

        except Exception as e:
            logger.error(f"Failed to compute churn embedding: {e}")
            return False

    def _calculate_churn_keyword_boost(self, text: str) -> tuple[float, str]:
        """
        Calculate keyword boost for churn detection.

        Returns:
            Tuple of (boost_value, matched_level) where matched_level is 'strong', 'medium', 'weak', 'negative', or 'none'
        """
        text_lower = text.lower()

        # Check NEGATIVE keywords FIRST (highest priority!)
        # These indicate someone is JOINING Pelephone, not leaving
        # Examples: "לעבור לפלאפון", "להצטרף לפלאפון", "חוזר לפלאפון"
        for keyword in self.churn_keywords.get('negative', []):
            if keyword.lower() in text_lower:
                logger.info(f"NEGATIVE churn keyword detected: '{keyword}' - this is NOT churn (customer joining)")
                return (self.churn_scoring.get('negative_boost', -80), 'negative')

        # Check strong keywords (churn signals)
        for keyword in self.churn_keywords.get('strong', []):
            if keyword.lower() in text_lower:
                return (self.churn_scoring.get('strong_boost', 35), 'strong')

        # Check medium keywords
        for keyword in self.churn_keywords.get('medium', []):
            if keyword.lower() in text_lower:
                return (self.churn_scoring.get('medium_boost', 20), 'medium')

        # Check weak keywords
        for keyword in self.churn_keywords.get('weak', []):
            if keyword.lower() in text_lower:
                return (self.churn_scoring.get('weak_boost', 10), 'weak')

        return (0.0, 'none')

    async def detect_churn(self, text: str) -> Dict:
        """
        Detect churn signal using embedding similarity + keyword boosting.

        The raw cosine similarity is rescaled from the observed range (0.50-0.72)
        to a 0-100 scale, then keyword boosts are added for explicit churn signals.

        Args:
            text: The conversation transcription text

        Returns:
            Dict with:
                - is_churn: bool (True if final score >= 40)
                - churn_confidence: float (rescaled score 0.0-1.0)
                - churn_score: int (0-100 scale for display)
                - raw_similarity: float (original cosine similarity)
                - keyword_boost: float (points added from keywords)
                - keyword_match: str ('strong', 'medium', 'weak', or 'none')
        """
        if not self.churn_initialized or self.churn_embedding is None:
            return {
                'is_churn': False,
                'churn_confidence': 0.0,
                'churn_score': 0,
                'raw_similarity': 0.0,
                'keyword_boost': 0,
                'keyword_match': 'none'
            }

        try:
            start_time = datetime.now()

            # Generate embedding for input text
            text_result = await self.embedding_service.generate_embedding(text)
            text_embedding = text_result.embedding

            # Compute cosine similarity with churn embedding
            raw_similarity = float(np.dot(text_embedding, self.churn_embedding))

            # Step 1: Rescale from observed range to 0-100
            min_baseline = self.churn_scoring.get('min_baseline', 0.50)
            max_signal = self.churn_scoring.get('max_signal', 0.72)

            # Normalize: (similarity - min) / (max - min) -> 0-1
            normalized = (raw_similarity - min_baseline) / (max_signal - min_baseline)
            base_score = max(0, min(100, normalized * 100))

            # Step 2: Calculate keyword boost
            keyword_boost, keyword_match = self._calculate_churn_keyword_boost(text)

            # Step 3: Combine scores (clamp to 0-100)
            # Negative boost can bring score down (e.g., customer joining Pelephone, not leaving)
            final_score = max(0, min(100, base_score + keyword_boost))

            # Determine churn: score >= 40 is considered churn risk
            is_churn = final_score >= 40

            # Update stats
            self.stats['churn_detections'] += 1
            if is_churn:
                self.stats['churn_positives'] += 1

            elapsed_ms = (datetime.now() - start_time).total_seconds() * 1000

            # Log with detailed breakdown
            if keyword_match == 'negative':
                # Special logging for false positive prevention
                logger.info(
                    f"NOT CHURN (customer joining): score={final_score:.0f} "
                    f"(base={base_score:.0f} + negative_boost={keyword_boost:.0f}) "
                    f"raw_sim={raw_similarity:.3f}, time={elapsed_ms:.1f}ms"
                )
            elif is_churn:
                logger.info(
                    f"CHURN DETECTED: score={final_score:.0f} "
                    f"(base={base_score:.0f} + keyword={keyword_boost:.0f} [{keyword_match}]) "
                    f"raw_sim={raw_similarity:.3f}, time={elapsed_ms:.1f}ms"
                )
            else:
                logger.debug(
                    f"No churn: score={final_score:.0f} "
                    f"(base={base_score:.0f} + keyword={keyword_boost:.0f}) "
                    f"raw_sim={raw_similarity:.3f}"
                )

            return {
                'is_churn': is_churn,
                'churn_confidence': round(final_score / 100.0, 3),  # 0.0-1.0 for backwards compatibility
                'churn_score': int(final_score),  # 0-100 for display
                'raw_similarity': round(raw_similarity, 3),
                'keyword_boost': int(keyword_boost),
                'keyword_match': keyword_match
            }

        except Exception as e:
            logger.error(f"Churn detection error: {e}")
            return {
                'is_churn': False,
                'churn_confidence': 0.0,
                'churn_score': 0,
                'raw_similarity': 0.0,
                'keyword_boost': 0,
                'keyword_match': 'none'
            }

    def _calculate_keyword_boost(self, text: str, category_name: str) -> float:
        """
        Calculate keyword boost for a category based on text content.

        Args:
            text: The transcription text
            category_name: The category name to check keywords for

        Returns:
            Boost value (0.0 if no keywords match)
        """
        if category_name not in self.keywords:
            return 0.0

        text_lower = text.lower()
        keywords = self.keywords[category_name]

        boost = 0.0

        # Check strong keywords
        strong_keywords = keywords.get('strong', [])
        for keyword in strong_keywords:
            if keyword.lower() in text_lower:
                boost += self.keyword_strong_boost
                break  # Only count once per category

        # Check weak keywords
        weak_keywords = keywords.get('weak', [])
        weak_count = sum(1 for kw in weak_keywords if kw.lower() in text_lower)
        if weak_count >= 2:  # Need at least 2 weak keywords
            boost += self.keyword_weak_boost

        return boost

    async def classify(
        self,
        text: str,
        top_k: int = 2,
        threshold: Optional[float] = None
    ) -> List[ClassificationResult]:
        """
        Classify text into categories using embedding similarity.

        Args:
            text: The transcription text to classify
            top_k: Number of top categories to return
            threshold: Minimum confidence threshold (uses default if not specified)

        Returns:
            List of ClassificationResult objects sorted by confidence
        """
        if not self.initialized:
            logger.error("Classifier not initialized. Call initialize() first.")
            return []

        threshold = threshold if threshold is not None else self.default_threshold
        start_time = datetime.now()

        try:
            # Generate embedding for the input text
            text_result = await self.embedding_service.generate_embedding(text)
            text_embedding = text_result.embedding

            # Calculate similarity with all categories
            scores: List[Tuple[str, float, float]] = []  # (cat_id, similarity, keyword_boost)

            for cat_id, cat_embedding in self.category_embeddings.items():
                # Cosine similarity (embeddings are already normalized)
                similarity = float(np.dot(text_embedding, cat_embedding))

                # Calculate keyword boost
                cat_name = self.categories[cat_id]['name']
                keyword_boost = self._calculate_keyword_boost(text, cat_name)

                if keyword_boost > 0:
                    self.stats['keyword_boosts_applied'] += 1

                # Combined score
                final_score = similarity + keyword_boost

                if final_score >= threshold:
                    scores.append((cat_id, similarity, keyword_boost))

            # Sort by combined score and take top_k
            scores.sort(key=lambda x: x[1] + x[2], reverse=True)
            top_scores = scores[:top_k]

            # Create results
            results = []
            for cat_id, similarity, keyword_boost in top_scores:
                results.append(ClassificationResult(
                    category_id=cat_id,
                    category_name=self.categories[cat_id]['name'],
                    confidence=similarity + keyword_boost,
                    keyword_boost=keyword_boost
                ))

            # Update stats
            elapsed = (datetime.now() - start_time).total_seconds()
            self.stats['classifications'] += 1
            self.stats['total_time'] += elapsed

            if results:
                logger.debug(f"Classification completed in {elapsed*1000:.1f}ms. "
                           f"Top: {results[0].category_name} ({results[0].confidence:.3f})")
            else:
                logger.debug(f"No classification above threshold {threshold}")

            return results

        except Exception as e:
            logger.error(f"Classification error: {e}")
            return []

    async def classify_with_fallback(
        self,
        text: str,
        fallback_category: str = "בירור כללי",
        top_k: int = 2,
        threshold: Optional[float] = None
    ) -> List[ClassificationResult]:
        """
        Classify with a guaranteed fallback category.

        Args:
            text: The transcription text to classify
            fallback_category: Default category if no matches found
            top_k: Number of top categories to return
            threshold: Minimum confidence threshold

        Returns:
            List of ClassificationResult objects (never empty)
        """
        results = await self.classify(text, top_k, threshold)

        if not results:
            # Find the fallback category ID
            fallback_id = None
            for cat_id, cat_data in self.categories.items():
                if cat_data['name'] == fallback_category:
                    fallback_id = cat_id
                    break

            if fallback_id is None:
                # Use first category as ultimate fallback
                fallback_id = list(self.categories.keys())[0]

            results = [ClassificationResult(
                category_id=fallback_id,
                category_name=self.categories[fallback_id]['name'],
                confidence=0.0,
                keyword_boost=0.0
            )]

        return results

    def get_category_name(self, category_id: str) -> str:
        """Get category name by ID."""
        if category_id in self.categories:
            return self.categories[category_id]['name']
        return category_id

    def get_all_categories(self) -> List[Dict]:
        """Get list of all categories."""
        return [
            {'id': cat_id, **cat_data}
            for cat_id, cat_data in self.categories.items()
        ]

    def get_stats(self) -> Dict:
        """Get classifier statistics."""
        avg_time = (self.stats['total_time'] / max(1, self.stats['classifications'])) * 1000
        return {
            'initialized': self.initialized,
            'num_categories': len(self.categories),
            'num_keywords': len(self.keywords),
            'classifications_performed': self.stats['classifications'],
            'avg_classification_time_ms': round(avg_time, 2),
            'keyword_boosts_applied': self.stats['keyword_boosts_applied'],
            'threshold': self.default_threshold,
            # Churn detection stats
            'churn_initialized': self.churn_initialized,
            'churn_threshold': self.churn_threshold,
            'churn_detections': self.stats['churn_detections'],
            'churn_positives': self.stats['churn_positives'],
            # Churn scoring config (for debugging)
            'churn_scoring': self.churn_scoring,
            'churn_keywords_loaded': {
                'strong': len(self.churn_keywords.get('strong', [])),
                'medium': len(self.churn_keywords.get('medium', [])),
                'weak': len(self.churn_keywords.get('weak', []))
            }
        }

    async def reload_configs_safe(
        self,
        classifications_data: Optional[Dict] = None,
        keywords_data: Optional[Dict] = None
    ) -> bool:
        """
        Safely reload configs WITHOUT disrupting current processing.
        Uses atomic pointer swap - instant, no locks needed.

        This method allows hot-reloading of ML configurations from S3
        without restarting the service or interrupting call processing.

        Args:
            classifications_data: Parsed JSON from call-classifications.json
            keywords_data: Parsed JSON from classification-keywords.json

        Returns:
            True if reload successful, False if validation failed
        """
        try:
            logger.info("Starting safe config reload...")

            # Step 1: Validate inputs
            if classifications_data:
                classifications = classifications_data.get('classifications', [])
                if len(classifications) < 5:
                    logger.error("Config validation failed: too few classifications")
                    return False

            # Step 2: Build new data structures in memory (background work)
            new_categories = None
            new_category_embeddings = None
            new_keywords = None
            new_churn_keywords = None
            new_churn_scoring = None

            if classifications_data:
                classifications = classifications_data.get('classifications', [])
                new_categories = {}

                # Parse classifications (support both old and new format)
                if isinstance(classifications[0], str):
                    for i, name in enumerate(classifications):
                        cat_id = f"cat_{i}"
                        new_categories[cat_id] = {
                            'name': name,
                            'description': name
                        }
                else:
                    for cat in classifications:
                        cat_id = cat.get('id', cat.get('name'))
                        new_categories[cat_id] = {
                            'name': cat.get('name'),
                            'description': cat.get('description', cat.get('name'))
                        }

                # Compute new embeddings
                logger.info(f"   Computing embeddings for {len(new_categories)} categories...")
                new_category_embeddings = {}
                for cat_id, cat_data in new_categories.items():
                    text = f"{cat_data['name']} {cat_data['description']}"
                    result = await self.embedding_service.generate_embedding(text)
                    new_category_embeddings[cat_id] = result.embedding

                # Check for churn config update
                churn_config = classifications_data.get('churn_detection', {})
                if churn_config.get('enabled', False):
                    description = churn_config.get('description', '')
                    if description:
                        result = await self.embedding_service.generate_embedding(description)
                        new_churn_embedding = result.embedding
                        new_churn_threshold = float(churn_config.get('threshold', 0.40))

            if keywords_data:
                new_keywords = keywords_data.get('keywords', {})

                # Load churn keywords
                churn_kw = keywords_data.get('churn_keywords', {})
                if churn_kw:
                    new_churn_keywords = {
                        'strong': churn_kw.get('strong', []),
                        'medium': churn_kw.get('medium', []),
                        'weak': churn_kw.get('weak', []),
                        'negative': churn_kw.get('negative', [])
                    }

                # Load churn scoring config
                churn_scoring = keywords_data.get('churn_scoring', {})
                if churn_scoring:
                    new_churn_scoring = churn_scoring

            # Step 3: ATOMIC SWAP - instant pointer switch
            # Python GIL ensures thread-safety for reference assignment
            if new_categories is not None:
                self.categories = new_categories
                logger.info(f"   Loaded {len(new_categories)} categories")

            if new_category_embeddings is not None:
                self.category_embeddings = new_category_embeddings
                logger.info(f"   Loaded {len(new_category_embeddings)} category embeddings")

            if new_keywords is not None:
                self.keywords = new_keywords
                logger.info(f"   Loaded keywords for {len(new_keywords)} categories")

            if new_churn_keywords is not None:
                self.churn_keywords = new_churn_keywords
                logger.info(f"   Loaded churn keywords: {len(new_churn_keywords.get('strong', []))} strong, "
                           f"{len(new_churn_keywords.get('medium', []))} medium, "
                           f"{len(new_churn_keywords.get('weak', []))} weak")

            if new_churn_scoring is not None:
                self.churn_scoring.update(new_churn_scoring)
                logger.info(f"   Updated churn scoring config")

            if classifications_data and 'churn_detection' in classifications_data:
                churn_config = classifications_data['churn_detection']
                if churn_config.get('enabled', False) and 'new_churn_embedding' in dir():
                    self.churn_embedding = new_churn_embedding
                    self.churn_threshold = new_churn_threshold
                    self.churn_initialized = True
                    logger.info(f"   Updated churn embedding (threshold: {new_churn_threshold})")

            logger.info("Config reload complete - ZERO DISRUPTION")
            return True

        except Exception as e:
            logger.error(f"Config reload failed: {e} - keeping old config")
            return False


# Singleton instance (will be initialized with embedding_service in app.py)
embedding_classifier: Optional[EmbeddingClassifier] = None


def get_embedding_classifier() -> Optional[EmbeddingClassifier]:
    """Get the singleton embedding classifier instance."""
    return embedding_classifier


def create_embedding_classifier(embedding_service) -> EmbeddingClassifier:
    """Create and return a new EmbeddingClassifier instance."""
    global embedding_classifier
    embedding_classifier = EmbeddingClassifier(embedding_service)
    return embedding_classifier
