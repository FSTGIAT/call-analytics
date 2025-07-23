#!/usr/bin/env python3
"""
Check AlephBERTGimmel model configuration
"""

from transformers import AutoModel, AutoConfig

# Check AlephBERTGimmel configuration
model_names = [
    "imvladikon/alephbertgimmel-base-512",
    "onlplab/alephbert-base",
    "avichr/heBERT"
]

print("Hebrew BERT Model Configurations:\n")

for model_name in model_names:
    try:
        # Load the configuration
        config = AutoConfig.from_pretrained(model_name)
        
        print(f"Model: {model_name}")
        print(f"  Hidden size (embedding dimension): {config.hidden_size}")
        print(f"  Number of layers: {config.num_hidden_layers}")
        print(f"  Number of attention heads: {config.num_attention_heads}")
        print(f"  Max position embeddings: {config.max_position_embeddings}")
        print(f"  Vocabulary size: {config.vocab_size}")
        print()
        
    except Exception as e:
        print(f"Error loading {model_name}: {e}")
        print()

# Also check the current model
current_model = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
try:
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(current_model)
    print(f"Current model: {current_model}")
    print(f"  Embedding dimension: {model.get_sentence_embedding_dimension()}")
except Exception as e:
    print(f"Error loading current model: {e}")