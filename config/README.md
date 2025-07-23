# Environment Configuration

This directory contains environment configuration templates for all services in the Call Analytics AI Platform.

## Setup Instructions

1. Copy each `.template` file to create your actual environment files:
   ```bash
   cp .env.api.template .env.api
   cp .env.oracle.template .env.oracle
   cp .env.ml.template .env.ml
   cp .env.aws.template .env.aws
   cp .env.search.template .env.search
   cp .env.frontend.template .env.frontend
   ```

2. Edit each `.env` file with your actual configuration values

3. Never commit `.env` files to version control (they're already in .gitignore)

## Configuration Files

### `.env.api`
Main API server configuration including:
- Server settings (port, environment)
- Security (JWT, CORS)
- Service connections (Redis, OpenSearch, Weaviate)
- Logging and rate limiting

### `.env.oracle`
Oracle database connection settings:
- Connection details (host, port, credentials)
- Connection pool configuration
- Schema and table names
- Performance tuning options

### `.env.ml`
Machine Learning service configuration:
- Model settings (Ollama/Mistral 7B)
- Hebrew NLP configuration
- Embedding model settings
- GPU configuration
- Fallback options

### `.env.aws`
AWS services configuration:
- AWS credentials and region
- Bedrock configuration for LLM fallback
- Neptune graph database settings
- S3 bucket for exports
- Cost control limits

### `.env.search`
OpenSearch configuration:
- Cluster settings
- Hebrew analysis plugins
- Index configuration
- Performance tuning

### `.env.frontend`
Frontend application settings:
- API endpoints
- Hebrew/RTL support
- Feature flags
- UI preferences

## Security Notes

- Always use strong, unique passwords
- Rotate credentials regularly
- Use AWS IAM roles in production instead of access keys
- Enable SSL/TLS for all services in production
- Implement proper network isolation

## Hebrew Language Support

The platform is configured for full Hebrew support:
- RTL text rendering in frontend
- Hebrew tokenization and analysis in OpenSearch
- Multilingual embeddings for semantic search
- Hebrew-aware text processing in ML service