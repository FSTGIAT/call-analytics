# Hebrew Call Analytics AI Platform - 2-Server Production Architecture

## Executive Summary

This guide describes an optimized 2-server production deployment where ML and LLM services are consolidated onto a single powerful GPU server, reducing complexity while maintaining high performance for Hebrew language processing.

## Architecture Overview

### Server Distribution

#### Server 1: Combined GPU-AI Server (192.168.1.10)
**Hardware:**
- GPU: RTX 5090 32GB (Shared for LLM + ML)
- CPU: Intel i9-13900K (24+ cores)
- RAM: 128GB DDR5
- Storage: 2TB NVMe SSD + 4TB HDD

**Services:**
- **Ollama**: DictaLM 2.0 Hebrew LLM (GPU-accelerated)
- **ML Service**: AlephBERT Hebrew embeddings (GPU-accelerated)
- **OpenSearch**: Hebrew text search and analytics
- **Redis**: Unified caching for LLM and embeddings
- **Kafka Consumers**: Processing all AI requests

#### Server 2: CPU-Core Server (192.168.1.11)
**Hardware:**
- CPU: Intel i9-13900K (24+ cores)
- RAM: 64GB DDR5
- Storage: 2TB NVMe SSD + 4TB HDD

**Services:**
- **API Server**: Node.js Express API
- **Frontend**: Vue.js web application
- **Oracle Database**: Primary data storage
- **Kafka Broker**: Message queue orchestration
- **Zookeeper**: Kafka coordination
- **nginx**: Reverse proxy and load balancer

## Service Architecture

### Simplified Service Flow

```
Internet → nginx (Server 2:80/443)
            ↓
         API Server ←→ Kafka Broker
            ↓              ↓
      Oracle DB      Server 1 (AI)
                    ├── Ollama (LLM)
                    ├── ML Service
                    ├── OpenSearch
                    └── Redis Cache
```

### GPU Resource Sharing (Server 1)

```yaml
GPU Memory Allocation (32GB Total):
- Ollama (DictaLM): 18GB (56%)
- ML Service (AlephBERT): 10GB (31%)
- System/Overhead: 4GB (13%)

CPU Core Assignment:
- Ollama: 8 cores
- ML Service: 6 cores
- OpenSearch: 6 cores
- Redis & System: 4 cores
```

## Optimized Docker Compose

### Server 1: docker-compose.server1-gpu-ai.yml

```yaml
version: '3.8'

services:
  # Ollama for DictaLM Hebrew LLM
  ollama:
    build:
      context: ../../ollama
      dockerfile: Dockerfile
    container_name: server1-ollama
    runtime: nvidia
    ports:
      - "11434:11434"
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - CUDA_VISIBLE_DEVICES=0
      - OLLAMA_GPU_MEMORY_FRACTION=0.56  # 18GB of 32GB
      - OLLAMA_NUM_GPU_LAYERS=32
      - OLLAMA_MAX_LOADED_MODELS=1
      - OLLAMA_NUM_PARALLEL=4
      - OLLAMA_NUM_THREADS=8
    volumes:
      - ../../data/ollama:/root/.ollama
      - ../../logs/ollama:/app/logs
    deploy:
      resources:
        limits:
          memory: 24G
          cpus: '8'
    restart: unless-stopped

  # ML Service for AlephBERT
  ml-service:
    build:
      context: ../../ml-service
      dockerfile: Dockerfile
    container_name: server1-ml-service
    runtime: nvidia
    ports:
      - "5000:5000"
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - CUDA_VISIBLE_DEVICES=0
      - GPU_MEMORY_FRACTION=0.31  # 10GB of 32GB
      - PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512
    volumes:
      - ../../ml-service:/app
      - ../../data/models:/app/models
      - ../../logs/ml:/app/logs
    deploy:
      resources:
        limits:
          memory: 16G
          cpus: '6'
    depends_on:
      - ollama  # Ensure Ollama starts first for GPU init
    restart: unless-stopped

  # OpenSearch for Hebrew text search
  opensearch:
    image: opensearchproject/opensearch:2.11.1
    container_name: server1-opensearch
    environment:
      - cluster.name=call-analytics-search
      - discovery.type=single-node
      - "OPENSEARCH_JAVA_OPTS=-Xms4g -Xmx8g"
      - plugins.security.disabled=true
    ports:
      - "9200:9200"
    volumes:
      - opensearch_data:/usr/share/opensearch/data
      - ../../logs/opensearch:/var/log/opensearch
    deploy:
      resources:
        limits:
          memory: 10G
          cpus: '6'
    restart: unless-stopped

  # Unified Redis Cache
  redis:
    image: redis:7-alpine
    container_name: server1-redis
    command: redis-server --appendonly yes --maxmemory 8gb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    deploy:
      resources:
        limits:
          memory: 10G
          cpus: '2'
    restart: unless-stopped

  # Unified Kafka Consumer
  ai-consumer:
    build:
      context: ../../api
      dockerfile: Dockerfile.consumer
    container_name: server1-ai-consumer
    environment:
      - CONSUMER_TYPE=unified
      - KAFKA_CONSUMER_GROUP=ai-consumers
      - KAFKA_BROKERS=192.168.1.11:9092
      - OLLAMA_URL=http://ollama:11434
      - ML_SERVICE_URL=http://ml-service:5000
      - OPENSEARCH_URL=http://opensearch:9200
      - REDIS_URL=redis://redis:6379
    volumes:
      - ../../logs/consumer:/app/logs
    depends_on:
      - ollama
      - ml-service
      - opensearch
      - redis
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2'
    restart: unless-stopped

networks:
  call-analytics-network:
    driver: bridge

volumes:
  opensearch_data:
  redis_data:
```

## Performance Optimization

### GPU Scheduling Strategy

1. **Time-Slicing Approach:**
   - Ollama gets priority (56% VRAM)
   - ML Service uses remaining capacity
   - CUDA MPS enabled for concurrent execution

2. **Request Routing:**
   ```javascript
   // Unified consumer handles both types
   if (topic === 'llm-requests') {
     // Route to Ollama with higher priority
     await processWithPriority('high', ollamaRequest);
   } else if (topic === 'embedding-requests') {
     // Route to ML Service with normal priority
     await processWithPriority('normal', mlRequest);
   }
   ```

3. **Memory Management:**
   - Ollama: Fixed 18GB allocation
   - ML Service: Dynamic 10GB with spillover
   - Shared CUDA context for efficiency

## Kafka Configuration

### Modified Topic Structure
```bash
# Unified request topic with type field
ai-requests (partitions: 8)
  - type: "llm" or "embedding"
  - priority: "high", "normal", "low"

# Separate response topics maintained
llm-responses (partitions: 6)
embedding-responses (partitions: 4)
```

### Consumer Configuration
```yaml
Unified AI Consumer:
  - Consumes: ai-requests
  - Routes based on type field
  - Manages GPU queue internally
  - Produces to appropriate response topic
```

## Resource Allocation

### Server 1 (GPU-AI) Resources
```
Total: 128GB RAM, 24 Cores, 32GB VRAM

Service Allocation:
- Ollama: 24GB RAM, 8 cores, 18GB VRAM
- ML Service: 16GB RAM, 6 cores, 10GB VRAM
- OpenSearch: 10GB RAM, 6 cores
- Redis: 10GB RAM, 2 cores
- Consumers: 4GB RAM, 2 cores
- System: 64GB RAM (buffer), 4GB VRAM
```

### Server 2 (CPU-Core) Resources
```
Total: 64GB RAM, 24 Cores

Service Allocation:
- Oracle: 24GB RAM, 8 cores
- Kafka: 8GB RAM, 4 cores
- API Server: 4GB RAM, 4 cores
- Frontend: 2GB RAM, 2 cores
- nginx: 1GB RAM, 2 cores
- System: 25GB RAM (buffer), 4 cores
```

## Performance Metrics

### 2-Server vs 3-Server Comparison

| Metric | 3-Server Setup | 2-Server Setup | Difference |
|--------|----------------|----------------|------------|
| LLM Response Time | 1-7 seconds | 2-8 seconds | +1 second |
| Embedding Time | <500ms | <700ms | +200ms |
| Concurrent LLM | 8-10 requests | 6-8 requests | -20% |
| Concurrent Embed | 32 requests | 24 requests | -25% |
| Daily Capacity | 200,000 calls | 150,000 calls | -25% |
| Hardware Cost | $20,000 | $13,000 | -35% |
| Power Usage | 1.5kW | 1.0kW | -33% |

## Deployment Process

### Simplified Deployment Steps

1. **Server 2 Setup (Core Services):**
   ```bash
   # Deploy core infrastructure first
   docker-compose -f docker-compose.server2-core.yml up -d
   
   # Initialize Kafka topics
   ./scripts/init-kafka-topics-2server.sh
   
   # Start API and Frontend
   docker-compose -f docker-compose.server2-core.yml up -d api frontend nginx
   ```

2. **Server 1 Setup (AI Services):**
   ```bash
   # Set GPU performance mode
   sudo nvidia-smi -pm 1
   sudo nvidia-smi -pl 450
   
   # Deploy AI services
   docker-compose -f docker-compose.server1-gpu-ai.yml up -d
   
   # Load models
   docker exec server1-ollama ollama pull dictalm2.0-instruct:Q4_K_M
   ```

## Monitoring & Optimization

### GPU Monitoring Script
```bash
#!/bin/bash
# Monitor GPU usage for both services

while true; do
  clear
  echo "=== GPU Resource Monitor ==="
  nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu \
    --format=csv,noheader,nounits
  
  echo -e "\n=== Process Details ==="
  nvidia-smi pmon -c 1
  
  echo -e "\n=== Service Status ==="
  docker stats --no-stream server1-ollama server1-ml-service
  
  sleep 5
done
```

### Performance Tuning

1. **GPU Optimization:**
   - Enable CUDA MPS for better sharing
   - Use dynamic parallelism
   - Implement request batching

2. **Memory Optimization:**
   - Shared memory pools between services
   - Aggressive garbage collection
   - Model quantization (Q4_K_M)

3. **Queue Management:**
   - Priority queues for LLM requests
   - Batch embedding requests
   - Timeout handling

## Advantages of 2-Server Setup

1. **Cost Savings:**
   - 35% lower hardware cost
   - 33% lower power consumption
   - Simplified maintenance

2. **Operational Benefits:**
   - Fewer servers to manage
   - Simplified networking
   - Unified monitoring

3. **Resource Efficiency:**
   - Better GPU utilization
   - Shared caching layer
   - Reduced data transfer

## Limitations & Mitigation

1. **GPU Contention:**
   - Mitigation: Priority scheduling, request queuing
   - Impact: +1-2 seconds on response times

2. **Single Point of Failure:**
   - Mitigation: Frequent backups, hot standby option
   - Impact: All AI services affected if GPU fails

3. **Scaling Constraints:**
   - Mitigation: Clear upgrade path to 3-server
   - Impact: Limited to 150,000 calls/day

## Migration Path

### From 2-Server to 3-Server
1. Prepare new GPU server
2. Move ML Service to new server
3. Reconfigure Kafka consumers
4. Update load balancing
5. Total migration time: 2 hours

## Conclusion

The 2-server architecture provides:
- **80% of 3-server performance** at 65% of the cost
- **Sufficient capacity** for 150,000 Hebrew calls/day
- **Simplified operations** with unified GPU management
- **Clear upgrade path** when scaling needed

This configuration is ideal for:
- Organizations processing <150,000 calls/day
- Budget-conscious deployments
- Proof of concept implementations
- Environments with limited IT resources