# 🚀 GPU-Optimized Hebrew Call Analytics Deployment Guide

## Quick GPU Setup & Fix Summary

### 🔧 **Critical Fixes Applied**

1. **Memory Configuration**:
   - ML Service: `4GB → 12GB` memory limit
   - Ollama: `16GB → 20GB` memory limit
   - Added GPU memory management

2. **Timeout Configuration**:
   - Ollama timeout: `10s → 120s`
   - ML Consumer timeout: `120s → 180s`
   - Kafka session timeout: `45s → 60s`

3. **GPU Optimization**:
   - Added `runtime: nvidia` to both services
   - Configured `OLLAMA_NUM_GPU_LAYERS=-1` (use all GPU layers)
   - Set `OLLAMA_GPU_MEMORY_FRACTION=0.75`
   - Added GPU memory fragmentation controls

4. **Cache Management**:
   - Added automatic cache cleanup every 100 requests
   - Reduced cache sizes to prevent OOM
   - Added TTL-based expiration

5. **Memory Leak Fixes**:
   - Added cleanup for processed conversation history
   - Limited conversation tracking to 1000 entries
   - Automatic cleanup of oldest entries

---

## 🚦 **Deployment Steps**

### 1. Prerequisites
```bash
# Ensure NVIDIA Docker runtime is installed
sudo apt install nvidia-docker2
sudo systemctl restart docker

# Verify GPU access
nvidia-smi
```

### 2. Deploy with GPU Support
```bash
cd /home/roygi/call-analytics-ai-platform_aws/call-analytics

# Stop existing containers
docker-compose down

# Rebuild with GPU optimizations
docker-compose build --no-cache ml-service ollama

# Start with GPU support
docker-compose up -d
```

### 3. Verify GPU Pipeline
```bash
# Run comprehensive GPU tests
./scripts/test-gpu-pipeline.sh

# Check GPU usage
nvidia-smi

# Monitor container GPU access
docker exec call-analytics-ml nvidia-smi
docker exec call-analytics-ollama nvidia-smi
```

---

## 📊 **Performance Monitoring**

### Health Checks
```bash
# Ollama GPU health check
docker exec call-analytics-ollama /scripts/health-check.sh

# ML Service health
curl http://localhost:5000/health

# Pipeline test
curl -X POST http://localhost:5000/api/analyze-conversation \
  -H "Content-Type: application/json" \
  -d '{
    "text": "שלום, יש לי בעיה טכנית עם האינטרנט",
    "callId": "test-001",
    "options": {"includeEmbedding": true}
  }'
```

### Resource Monitoring
```bash
# GPU memory usage
watch -n 1 nvidia-smi

# Container resource usage
docker stats call-analytics-ml call-analytics-ollama

# Cache statistics
curl http://localhost:5000/admin/clear-cache -X POST  # Clear if needed
```

---

## ⚡ **Performance Expectations**

### Before Fix (Issues):
- Memory: 4GB ML service (insufficient)
- Timeout: 10s Ollama (too short)
- Pipeline: Gets stuck, high memory, timeouts
- GPU: Not properly utilized

### After Fix (GPU Optimized):
- Memory: 12GB ML service (sufficient for Hebrew LLM)
- Timeout: 120s Ollama (adequate for GPU processing)
- Pipeline: Smooth processing, automatic cleanup
- GPU: Full utilization with -1 layers

### Expected Performance:
- Hebrew conversation analysis: **15-30 seconds**
- Hebrew embeddings (768d): **2-5 seconds**
- Memory usage: **Stable under 8GB**
- GPU utilization: **80%+**

---

## 🔍 **Troubleshooting**

### Common Issues

1. **GPU Not Detected**:
   ```bash
   # Check NVIDIA Docker runtime
   docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
   
   # Restart Docker if needed
   sudo systemctl restart docker
   ```

2. **Memory Issues**:
   ```bash
   # Check current memory limits
   docker inspect call-analytics-ml | grep -i memory
   
   # Monitor actual usage
   docker stats --format "table {{.Container}}\t{{.MemUsage}}\t{{.MemPerc}}"
   ```

3. **Pipeline Stuck**:
   ```bash
   # Check ML consumer logs
   docker logs call-analytics-api | grep "ML Consumer"
   
   # Check processing queue status
   curl http://localhost:3000/api/v1/health
   
   # Reset if needed
   docker restart call-analytics-ml call-analytics-ollama
   ```

4. **Cache Issues**:
   ```bash
   # Clear caches
   curl -X POST http://localhost:5000/admin/clear-cache
   
   # Restart services
   docker restart call-analytics-ml
   ```

---

## 📈 **Optimization Tips**

### GPU Memory Optimization
- Monitor GPU memory with `nvidia-smi`
- Adjust `OLLAMA_GPU_MEMORY_FRACTION` if needed (0.6-0.8 range)
- Use `OLLAMA_KEEP_ALIVE=10m` to free memory faster

### Performance Tuning
- Increase batch sizes if more GPU memory available
- Adjust `OLLAMA_NUM_PARALLEL=2` based on GPU capacity
- Monitor and adjust cache sizes based on usage patterns

### Production Recommendations
- Set up monitoring for GPU temperature and utilization
- Implement automatic cache cleanup scheduling
- Consider load balancing for high-traffic scenarios
- Regular memory usage monitoring and alerting

---

## ✅ **Success Indicators**

Your pipeline is working correctly when:

- ✅ `nvidia-smi` shows GPU usage during processing
- ✅ Hebrew conversations complete in 15-30 seconds  
- ✅ Memory usage remains stable under 10GB
- ✅ No timeout errors in logs
- ✅ Classifications and embeddings are generated
- ✅ Pipeline processes multiple conversations without getting stuck

---

## 🆘 **Emergency Recovery**

If the pipeline gets stuck again:

```bash
# 1. Check resource usage
nvidia-smi
docker stats

# 2. Clear caches
curl -X POST http://localhost:5000/admin/clear-cache

# 3. Restart in order
docker restart call-analytics-ollama
sleep 30
docker restart call-analytics-ml
sleep 30

# 4. Test pipeline
./scripts/test-gpu-pipeline.sh

# 5. If still issues, full reset
docker-compose down
docker system prune -f
docker-compose up -d
```

Your Hebrew Call Analytics system is now GPU-optimized and should handle the pipeline processing smoothly! 🎉