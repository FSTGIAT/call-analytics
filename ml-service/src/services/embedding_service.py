import os
import numpy as np
import logging
import asyncio
from typing import List, Dict, Optional, Union, Tuple
from datetime import datetime
import torch
from sentence_transformers import SentenceTransformer
import faiss
import pickle
from dataclasses import dataclass

# Import hebrew processors - handle relative import
try:
    from ..utils.hebrew_processor import hebrew_processor
    from ..utils.enhanced_hebrew_processor import enhanced_hebrew_processor
except ImportError:
    # Fallback for direct execution
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(__file__)))
    from utils.hebrew_processor import hebrew_processor
    from utils.enhanced_hebrew_processor import enhanced_hebrew_processor

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingConfig:
    model_name: str
    dimension: int
    batch_size: int
    device: str
    cache_embeddings: bool
    max_cache_size: int


@dataclass
class EmbeddingResult:
    text: str
    embedding: np.ndarray
    model_name: str
    timestamp: datetime
    processing_time: float
    text_hash: str


class EmbeddingService:
    """
    Service for generating and managing text embeddings.
    Optimized for Hebrew and multilingual text processing.
    """
    
    def __init__(self):
        # Configuration - Optimized for Hebrew
        self.config = EmbeddingConfig(
            model_name=os.getenv('EMBEDDING_MODEL', 'imvladikon/sentence-transformers-alephbert'),
            dimension=int(os.getenv('EMBEDDING_DIMENSION', '768')),  # AlephBERT dimension
            batch_size=int(os.getenv('EMBEDDING_BATCH_SIZE', '32')),
            device='cuda' if torch.cuda.is_available() and os.getenv('USE_GPU', 'true').lower() == 'true' else 'cpu',
            cache_embeddings=os.getenv('ENABLE_MODEL_CACHE', 'true').lower() == 'true',
            max_cache_size=int(os.getenv('MODEL_CACHE_SIZE', '10000'))
        )
        
        # Hebrew optimization settings
        self.use_enhanced_hebrew_processing = os.getenv('ENABLE_ENHANCED_HEBREW', 'true').lower() == 'true'
        self.remove_niqqud = os.getenv('REMOVE_NIQQUD', 'true').lower() == 'true'
        self.normalize_finals = os.getenv('NORMALIZE_HEBREW_FINALS', 'true').lower() == 'true'
        
        # Initialize model
        self.model = None
        self.model_loaded = False
        
        # In-memory cache for embeddings
        self.embedding_cache = {}
        self.cache_timestamps = {}
        
        # FAISS index for similarity search
        self.faiss_index = None
        self.indexed_texts = []
        self.index_metadata = []
        
        # Performance tracking
        self.stats = {
            'embeddings_generated': 0,
            'cache_hits': 0,
            'batch_operations': 0,
            'total_processing_time': 0.0
        }
        
        logger.info(f"Embedding service initialized with model: {self.config.model_name}")
        logger.info(f"Device: {self.config.device}")
        
    async def initialize_model(self) -> bool:
        """Initialize the embedding model."""
        try:
            if self.model_loaded and self.model is not None:
                return True
                
            logger.info(f"Loading embedding model: {self.config.model_name}")
            
            # Check if model is already being loaded by another process
            if hasattr(self, '_loading') and self._loading:
                logger.info("Model is already being loaded, waiting...")
                while self._loading:
                    await asyncio.sleep(0.1)
                return self.model_loaded
            
            self._loading = True
            
            try:
                # Load model with optimized settings for Hebrew
                loop = asyncio.get_event_loop()
                
                def load_optimized_model():
                    model = SentenceTransformer(
                        self.config.model_name, 
                        device=self.config.device,
                        trust_remote_code=True
                    )
                    
                    # Optimize for Hebrew processing
                    if hasattr(model, 'max_seq_length'):
                        model.max_seq_length = 512  # Optimal for Hebrew
                    
                    # Enable mixed precision for better performance
                    if self.config.device == 'cuda':
                        model.half()  # Use FP16 for faster inference
                        # Optimize pooling strategy for Hebrew
                        if hasattr(model, '_modules') and '1' in model._modules:
                            pooling_layer = model._modules['1']
                            if hasattr(pooling_layer, 'pooling_mode_mean_tokens'):
                                pooling_layer.pooling_mode_mean_tokens = True
                                pooling_layer.pooling_mode_cls_token = False
                                pooling_layer.pooling_mode_max_tokens = False
                    
                    return model
                
                self.model = await loop.run_in_executor(None, load_optimized_model)
            finally:
                self._loading = False
            
            self.model_loaded = True
            logger.info(f"Model loaded successfully on {self.config.device}")
            
            # Initialize FAISS index
            self.faiss_index = faiss.IndexFlatIP(self.config.dimension)  # Inner product for cosine similarity
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize embedding model: {e}")
            return False
    
    def _get_text_hash(self, text: str) -> str:
        """Generate hash for text caching."""
        import hashlib
        return hashlib.md5(text.encode('utf-8')).hexdigest()
    
    def _preprocess_text(self, text: str) -> str:
        """No preprocessing - AlephBERT handles Hebrew natively."""
        # AlephBERT is designed for raw Hebrew text
        return text
    
    async def generate_embedding(
        self, 
        text: str, 
        preprocess: bool = True
    ) -> EmbeddingResult:
        """Generate embedding for a single text."""
        if not self.model_loaded:
            await self.initialize_model()
        
        start_time = datetime.now()
        
        # Preprocess text
        processed_text = self._preprocess_text(text) if preprocess else text
        text_hash = self._get_text_hash(processed_text)
        
        # Check cache
        if self.config.cache_embeddings and text_hash in self.embedding_cache:
            self.stats['cache_hits'] += 1
            cached_embedding = self.embedding_cache[text_hash]
            
            return EmbeddingResult(
                text=text,
                embedding=cached_embedding,
                model_name=self.config.model_name,
                timestamp=datetime.now(),
                processing_time=0.0,
                text_hash=text_hash
            )
        
        try:
            # Generate embedding
            loop = asyncio.get_event_loop()
            embedding = await loop.run_in_executor(
                None,
                lambda: self.model.encode([processed_text], convert_to_numpy=True)[0]
            )
            
            # Normalize embedding for cosine similarity
            embedding = embedding / np.linalg.norm(embedding)
            
            end_time = datetime.now()
            processing_time = (end_time - start_time).total_seconds()
            
            # Cache embedding
            if self.config.cache_embeddings:
                self._cache_embedding(text_hash, embedding)
            
            # Update stats
            self.stats['embeddings_generated'] += 1
            self.stats['total_processing_time'] += processing_time
            
            return EmbeddingResult(
                text=text,
                embedding=embedding,
                model_name=self.config.model_name,
                timestamp=end_time,
                processing_time=processing_time,
                text_hash=text_hash
            )
            
        except Exception as e:
            logger.error(f"Error generating embedding: {e}")
            raise
    
    async def generate_batch_embeddings(
        self, 
        texts: List[str], 
        preprocess: bool = True
    ) -> List[EmbeddingResult]:
        """Generate embeddings for multiple texts in batches."""
        if not self.model_loaded:
            await self.initialize_model()
        
        start_time = datetime.now()
        results = []
        
        # Preprocess texts
        processed_texts = []
        text_hashes = []
        original_texts = []
        
        for text in texts:
            processed = self._preprocess_text(text) if preprocess else text
            text_hash = self._get_text_hash(processed)
            
            processed_texts.append(processed)
            text_hashes.append(text_hash)
            original_texts.append(text)
        
        # Check cache for existing embeddings
        uncached_indices = []
        uncached_texts = []
        
        for i, text_hash in enumerate(text_hashes):
            if self.config.cache_embeddings and text_hash in self.embedding_cache:
                # Use cached embedding
                self.stats['cache_hits'] += 1
                results.append(EmbeddingResult(
                    text=original_texts[i],
                    embedding=self.embedding_cache[text_hash],
                    model_name=self.config.model_name,
                    timestamp=datetime.now(),
                    processing_time=0.0,
                    text_hash=text_hash
                ))
            else:
                uncached_indices.append(i)
                uncached_texts.append(processed_texts[i])
        
        # Generate embeddings for uncached texts
        if uncached_texts:
            try:
                loop = asyncio.get_event_loop()
                
                # Process in batches
                for i in range(0, len(uncached_texts), self.config.batch_size):
                    batch_texts = uncached_texts[i:i + self.config.batch_size]
                    batch_indices = uncached_indices[i:i + self.config.batch_size]
                    
                    batch_embeddings = await loop.run_in_executor(
                        None,
                        lambda: self.model.encode(batch_texts, convert_to_numpy=True)
                    )
                    
                    # Normalize embeddings
                    batch_embeddings = batch_embeddings / np.linalg.norm(batch_embeddings, axis=1, keepdims=True)
                    
                    # Create results for this batch
                    for j, embedding in enumerate(batch_embeddings):
                        original_idx = batch_indices[j]
                        text_hash = text_hashes[original_idx]
                        
                        # Cache embedding
                        if self.config.cache_embeddings:
                            self._cache_embedding(text_hash, embedding)
                        
                        results.append(EmbeddingResult(
                            text=original_texts[original_idx],
                            embedding=embedding,
                            model_name=self.config.model_name,
                            timestamp=datetime.now(),
                            processing_time=0.0,  # Will be calculated at the end
                            text_hash=text_hash
                        ))
                
                self.stats['batch_operations'] += 1
                self.stats['embeddings_generated'] += len(uncached_texts)
                
            except Exception as e:
                logger.error(f"Error in batch embedding generation: {e}")
                raise
        
        # Sort results to match original order
        results.sort(key=lambda x: original_texts.index(x.text))
        
        end_time = datetime.now()
        total_processing_time = (end_time - start_time).total_seconds()
        self.stats['total_processing_time'] += total_processing_time
        
        # Update processing times
        if uncached_texts:
            avg_processing_time = total_processing_time / len(uncached_texts)
            for result in results:
                if result.processing_time == 0.0:  # Newly generated
                    result.processing_time = avg_processing_time
        
        return results
    
    def _cache_embedding(self, text_hash: str, embedding: np.ndarray):
        """Cache embedding with size management."""
        if len(self.embedding_cache) >= self.config.max_cache_size:
            # Remove oldest entry
            oldest_hash = min(self.cache_timestamps.keys(), key=self.cache_timestamps.get)
            del self.embedding_cache[oldest_hash]
            del self.cache_timestamps[oldest_hash]
        
        self.embedding_cache[text_hash] = embedding
        self.cache_timestamps[text_hash] = datetime.now()
    
    async def add_to_index(
        self, 
        texts: List[str], 
        metadata: List[Dict] = None
    ) -> bool:
        """Add texts to FAISS index for similarity search."""
        try:
            if not self.faiss_index:
                logger.error("FAISS index not initialized")
                return False
            
            # Generate embeddings
            embedding_results = await self.generate_batch_embeddings(texts)
            embeddings = np.array([result.embedding for result in embedding_results])
            
            # Add to FAISS index
            self.faiss_index.add(embeddings)
            
            # Store text and metadata
            self.indexed_texts.extend(texts)
            if metadata:
                self.index_metadata.extend(metadata)
            else:
                self.index_metadata.extend([{} for _ in texts])
            
            logger.info(f"Added {len(texts)} texts to index. Total: {self.faiss_index.ntotal}")
            return True
            
        except Exception as e:
            logger.error(f"Error adding to index: {e}")
            return False
    
    async def search_similar(
        self, 
        query_text: str, 
        k: int = 10, 
        threshold: float = 0.5
    ) -> List[Dict]:
        """Search for similar texts in the index."""
        try:
            if not self.faiss_index or self.faiss_index.ntotal == 0:
                logger.warning("FAISS index is empty")
                return []
            
            # Generate query embedding
            query_result = await self.generate_embedding(query_text)
            query_embedding = query_result.embedding.reshape(1, -1)
            
            # Search in index
            scores, indices = self.faiss_index.search(query_embedding, min(k, self.faiss_index.ntotal))
            
            # Filter by threshold
            results = []
            for score, idx in zip(scores[0], indices[0]):
                if score >= threshold and idx < len(self.indexed_texts):
                    results.append({
                        'text': self.indexed_texts[idx],
                        'similarity_score': float(score),
                        'metadata': self.index_metadata[idx] if idx < len(self.index_metadata) else {},
                        'index': int(idx)
                    })
            
            return results
            
        except Exception as e:
            logger.error(f"Error in similarity search: {e}")
            return []
    
    async def batch_process_oracle_data(
        self, 
        texts: List[str], 
        metadata: List[Dict],
        batch_size: int = None
    ) -> Dict:
        """Process large batches of Oracle data for indexing."""
        batch_size = batch_size or self.config.batch_size * 4  # Larger batches for bulk processing
        
        start_time = datetime.now()
        total_processed = 0
        errors = 0
        
        try:
            # Process in chunks
            for i in range(0, len(texts), batch_size):
                chunk_texts = texts[i:i + batch_size]
                chunk_metadata = metadata[i:i + batch_size] if metadata else None
                
                try:
                    # Generate embeddings
                    await self.generate_batch_embeddings(chunk_texts)
                    
                    # Add to index
                    await self.add_to_index(chunk_texts, chunk_metadata)
                    
                    total_processed += len(chunk_texts)
                    
                    # Progress logging
                    if total_processed % 1000 == 0:
                        logger.info(f"Processed {total_processed}/{len(texts)} texts")
                        
                except Exception as e:
                    logger.error(f"Error processing chunk {i}-{i+len(chunk_texts)}: {e}")
                    errors += len(chunk_texts)
                    continue
            
            end_time = datetime.now()
            processing_time = (end_time - start_time).total_seconds()
            
            return {
                'success': True,
                'total_texts': len(texts),
                'processed': total_processed,
                'errors': errors,
                'processing_time': processing_time,
                'rate': total_processed / processing_time if processing_time > 0 else 0
            }
            
        except Exception as e:
            logger.error(f"Error in batch processing: {e}")
            return {
                'success': False,
                'error': str(e),
                'processed': total_processed,
                'errors': errors
            }
    
    def save_index(self, file_path: str) -> bool:
        """Save FAISS index and metadata to disk."""
        try:
            # Save FAISS index
            faiss.write_index(self.faiss_index, f"{file_path}.faiss")
            
            # Save metadata
            with open(f"{file_path}.metadata", 'wb') as f:
                pickle.dump({
                    'texts': self.indexed_texts,
                    'metadata': self.index_metadata,
                    'config': self.config
                }, f)
            
            logger.info(f"Index saved to {file_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error saving index: {e}")
            return False
    
    def load_index(self, file_path: str) -> bool:
        """Load FAISS index and metadata from disk."""
        try:
            # Load FAISS index
            self.faiss_index = faiss.read_index(f"{file_path}.faiss")
            
            # Load metadata
            with open(f"{file_path}.metadata", 'rb') as f:
                data = pickle.load(f)
                self.indexed_texts = data['texts']
                self.index_metadata = data['metadata']
            
            logger.info(f"Index loaded from {file_path}. Total texts: {len(self.indexed_texts)}")
            return True
            
        except Exception as e:
            logger.error(f"Error loading index: {e}")
            return False
    
    def get_stats(self) -> Dict:
        """Get embedding service statistics."""
        return {
            **self.stats,
            'model_loaded': self.model_loaded,
            'cache_size': len(self.embedding_cache),
            'indexed_texts': len(self.indexed_texts),
            'cache_hit_rate': (self.stats['cache_hits'] / max(1, self.stats['embeddings_generated'] + self.stats['cache_hits'])) * 100,
            'avg_processing_time': self.stats['total_processing_time'] / max(1, self.stats['embeddings_generated']),
            'config': {
                'model_name': self.config.model_name,
                'dimension': self.config.dimension,
                'device': self.config.device,
                'batch_size': self.config.batch_size
            }
        }
    
    def clear_cache(self):
        """Clear embedding cache."""
        self.embedding_cache.clear()
        self.cache_timestamps.clear()
        logger.info("Embedding cache cleared")
    
    async def test_hebrew_preprocessing(self, sample_texts: List[str]) -> Dict:
        """Test Hebrew preprocessing optimization with statistics."""
        try:
            results = {
                'enhanced_processing_enabled': self.use_enhanced_hebrew_processing,
                'preprocessing_comparison': [],
                'embedding_comparison': []
            }
            
            for text in sample_texts:
                # Test basic preprocessing
                basic_processed = hebrew_processor.preprocess_for_embedding(text)
                
                # Test enhanced preprocessing
                enhanced_processed = enhanced_hebrew_processor.preprocess_for_alephbert(
                    text,
                    remove_vowels=self.remove_niqqud,
                    normalize_finals=self.normalize_finals
                )
                
                # Get preprocessing statistics
                preprocessing_stats = enhanced_hebrew_processor.get_preprocessing_stats(
                    text, enhanced_processed
                )
                
                # Generate embeddings for comparison
                basic_embedding = await self.generate_embedding(text, preprocess=False)
                enhanced_embedding = await self.generate_embedding(enhanced_processed, preprocess=False)
                
                results['preprocessing_comparison'].append({
                    'original_text': text,
                    'basic_processed': basic_processed,
                    'enhanced_processed': enhanced_processed,
                    'stats': preprocessing_stats
                })
                
                results['embedding_comparison'].append({
                    'original_text': text,
                    'basic_processing_time': basic_embedding.processing_time,
                    'enhanced_processing_time': enhanced_embedding.processing_time,
                    'embedding_similarity': float(
                        np.dot(basic_embedding.embedding, enhanced_embedding.embedding)
                    )
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Error in Hebrew preprocessing test: {e}")
            return {'error': str(e)}


# Singleton instance
embedding_service = EmbeddingService()