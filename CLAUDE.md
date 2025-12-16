# CLAUDE.md - Hebrew Call Analytics AI Platform

## Project Overview

Real-time call analytics platform for processing and analyzing Hebrew customer service conversations. Integrates Oracle CDC, AWS SQS messaging, ML-based classification with Hebrew NLP models (DictaLM 2.0, AlephBERT), OpenSearch indexing, and Vue.js frontend.

## Architecture

```
Oracle VERINT_TEXT_ANALYSIS → CDC Service → AWS SQS → ML Consumer → Classifications → OpenSearch → Vue.js Frontend
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend API** | Node.js/TypeScript, Express.js |
| **Frontend** | Vue.js 3, Vite, Element Plus, Pinia, Chart.js/ECharts |
| **ML Service** | Python/Flask, DictaLM 2.0, AlephBERT (768-dim embeddings) |
| **Database** | Oracle 21c XE with CDC (Change Data Capture) |
| **Search** | OpenSearch 2.11.1 with Hebrew text optimization |
| **Cache** | Redis 7 |
| **Message Queue** | AWS SQS (migrated from Kafka) |
| **Container** | Docker Compose with NVIDIA GPU support |

## Project Structure

```
call-analytics/
├── api/                    # Node.js TypeScript API server
│   ├── src/               # Source code
│   ├── Dockerfile         # Production Docker build
│   └── package.json       # Dependencies
├── frontend/              # Vue.js 3 frontend
│   ├── src/              # Vue components & views
│   ├── vite.config.ts    # Vite configuration
│   └── package.json      # Dependencies
├── ml-service/            # Python Flask ML service
│   ├── app.py            # Main Flask application
│   ├── src/              # ML service modules
│   └── requirements.txt  # Python dependencies
├── config/                # Configuration files
│   ├── call-classifications.json  # 65+ Hebrew classification categories
│   └── .env.*            # Environment configs
├── scripts/               # Utility scripts
│   ├── enable-historical-cdc.sh
│   ├── disable-historical-cdc.sh
│   └── check-cdc-status.sh
├── oracle/                # Oracle DB init scripts
├── docker-compose.yml     # Local development orchestration
└── docker-compose.aws.yml # AWS deployment config
```

## Development Commands

### Start Services
```bash
# Start all services
docker-compose up -d

# Start with logs
docker-compose up

# Start specific services
docker-compose up api ml-service opensearch

# Start with OpenSearch Dashboards
docker-compose --profile dashboards up -d
```

### Build & Development
```bash
# API development
cd api && npm run dev

# Frontend development
cd frontend && npm run dev

# Build API
cd api && npm run build

# Build frontend
cd frontend && npm run build
```

### Testing
```bash
# API tests
cd api && npm test

# Type checking
cd api && npm run typecheck
cd frontend && npm run type-check

# Lint
cd api && npm run lint
cd frontend && npm run lint
```

### Monitoring
```bash
# View service logs
docker logs -f call-analytics-api
docker logs -f call-analytics-ml
docker logs -f call-analytics-opensearch

# Health checks
curl http://localhost:3000/api/health
curl http://localhost:5000/health
curl http://localhost:9200/_cluster/health
```

## Key Services & Ports

| Service | Port | Health Endpoint |
|---------|------|-----------------|
| API | 3000 | `/api/health` |
| ML Service | 5000 | `/health` |
| Frontend | 8080 | - |
| OpenSearch | 9200 | `/_cluster/health` |
| Oracle | 1521 | - |
| Redis | 6379 | - |
| Ollama | 11434 | - |
| OpenSearch Dashboards | 5601 | - |

## CDC (Change Data Capture) Management

### Check CDC Status
```bash
./scripts/check-cdc-status.sh
curl http://localhost:3000/api/v1/realtime-cdc/status
```

### Enable Historical Processing
```bash
./scripts/enable-historical-cdc.sh 2025-01-15 "Reprocess for ML improvements"
```

### Disable Historical Processing
```bash
./scripts/disable-historical-cdc.sh
```

### Reset CDC (Emergency)
```sql
UPDATE CDC_PROCESSING_STATUS SET TOTAL_PROCESSED = 0;
COMMIT;
```

## Hebrew Classification System

- **Location**: `config/call-classifications.json`
- **Categories**: 65+ Hebrew classification categories
- **Hot Reload**: `curl -X POST http://localhost:5000/admin/reload-classifications`

### Main Categories
- Billing & Payments (7 categories)
- Plan & Package Management (4 categories)
- Technical Support (12 categories)
- International Services (8 categories)
- Account Management (15 categories)

## Database Schema

### VERINT_TEXT_ANALYSIS Table
```sql
CALL_ID: NUMBER(19)        -- Unique conversation identifier
BAN: VARCHAR2(50)          -- Customer account number
SUBSCRIBER_NO: VARCHAR2(15) -- Phone number
CALL_TIME: TIMESTAMP       -- Conversation timestamp
TEXT_TIME: TIMESTAMP       -- Message timestamp
OWNER: CHAR(1)             -- 'A' (Agent) or 'C' (Customer)
TEXT: CLOB                 -- Hebrew conversation text
```

## Common Issues & Troubleshooting

### CDC Infinite Loop
**Symptom**: Repeated processing of same call IDs, high CPU
```bash
# Check for loop detection
docker logs call-analytics-api | grep -E "Circuit Breaker|INFINITE LOOP"

# Emergency stop
UPDATE CDC_PROCESSING_STATUS SET TOTAL_PROCESSED = 0; COMMIT;
docker-compose restart api
```

### ML Service JSON Parsing (Hebrew Punctuation)
**Symptom**: HTTP 500 with "Conversation analysis error"
- Caused by Hebrew punctuation (geresh ׳, gershayim ״) in LLM responses
- Check logs: `docker logs call-analytics-ml | grep -E "(JSON|parsing)"`

### Classification Loading
**Symptom**: Classifications show as null
```bash
docker logs call-analytics-ml | grep "classification"
curl -X POST http://localhost:5000/admin/reload-classifications
```

## Performance Benchmarks

- CDC Detection: < 5 seconds
- SQS Processing: < 2 seconds
- ML Analysis: < 15 seconds
- OpenSearch Indexing: < 5 seconds
- Total Pipeline: < 30 seconds end-to-end

## Environment Files

| File | Purpose |
|------|---------|
| `config/.env.api` | API server configuration |
| `config/.env.oracle` | Oracle DB credentials |
| `config/.env.sqs` | AWS SQS configuration |
| `config/.env.ml` | ML service configuration |
| `config/.env.frontend` | Frontend configuration |
| `config/.env.search` | OpenSearch configuration |
| `.env.models` | Ollama/model configuration |

## AWS Deployment

```bash
# Deploy to AWS
./scripts/deploy-to-aws.sh

# Test AWS connectivity
./scripts/test-aws-connectivity.sh

# Setup AWS secrets
./scripts/setup-aws-secrets.sh
```

## GPU Configuration

The ML service and Ollama require NVIDIA GPU:
- Runtime: `nvidia`
- Memory: 12-20GB allocated
- Models: DictaLM 2.0 (Q4_K_M quantization)

## Code Style

- **TypeScript**: ESLint with `@typescript-eslint`
- **Python**: Black, Flake8, MyPy
- **Vue**: Vue ESLint plugin with TypeScript config

## Important Notes

- Hebrew text uses RTL (Right-to-Left) support throughout
- Customer data isolation: Index-per-customer architecture (`call-analytics-{customerId}-transcriptions`)
- UTF-8/AL32UTF8 encoding required for Hebrew support
- CDC has infinite loop protection with automatic circuit breaker
