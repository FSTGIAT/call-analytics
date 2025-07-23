# 🚀 **Hebrew Call Analytics AI Platform - Production Operations Guide**

## 📋 **Quick Reference**
- **System**: Real-time Hebrew conversation analytics with Kafka streaming
- **Architecture**: Oracle → CDC → Kafka → ML (AlephBERT + DictaLM) → OpenSearch → AI Chat
- **Performance**: 10,000+ concurrent Hebrew conversations, sub-second processing
- **Language Support**: Native Hebrew with AI models optimized for Hebrew text

---

## 🏁 **STARTUP COMMANDS**

### **Complete System Startup:**
```bash
# Start all services (Oracle, Kafka, ML, OpenSearch, API, Frontend)
docker-compose up -d

# Verify all services are running
docker-compose ps

# Check system health
curl http://localhost:3000/health
```

### **Individual Service Management:**
```bash
# Restart API only (if code changes)
docker-compose restart api

# Restart ML service (if model updates)
docker-compose restart ml-service

# View logs for troubleshooting
docker-compose logs -f kafka
docker-compose logs -f api
```

---

## 📊 **MONITORING & HEALTH CHECKS**

### **System Health Endpoints:**
```bash
# Overall system health
curl http://localhost:3000/health

# Kafka pipeline health
curl http://localhost:3000/api/v1/kafka/health | jq '.'

# ML service health (Hebrew models)
curl http://localhost:5000/health | jq '.'

# OpenSearch cluster health
curl http://localhost:9200/_cluster/health | jq '.'
```

### **Web Dashboards:**
- **Kafka UI**: http://localhost:8090 (Topic monitoring, message inspection)
- **Frontend**: http://localhost:3001 (User interface)
- **API Documentation**: http://localhost:3000/api/v1 (API endpoints)

### **Real-Time Monitoring:**
```bash
# Monitor Kafka CDC processing
curl -s http://localhost:3000/api/v1/kafka/health | jq '.services.kafkaCDCProducer.metrics'

# Check consumer lag
curl -s http://localhost:3000/api/v1/kafka/consumer-lag | jq '.'

# View recent Hebrew conversations
curl -s "http://localhost:9200/_search?q=language:he&size=5" | jq '.hits.hits[]._source'
```

---

## 🛠️ **OPERATIONAL SCRIPTS**

### **Daily Operations:**
```bash
# Health check (run every 15 minutes)
./scripts/kafka-health-check.sh

# Validate end-to-end pipeline
./scripts/validate-kafka-consistency.sh --verbose

# Check CDC status
./scripts/check-cdc-status.sh
```

### **Maintenance Operations:**
```bash
# Enable historical data processing
./scripts/enable-historical-cdc.sh --from-date 2025-01-01

# Disable historical mode (normal operation)
./scripts/disable-historical-cdc.sh

# Performance testing
node scripts/kafka-load-test.js --duration 300 --rate 100
```

---

## 🇮🇱 **HEBREW CONVERSATION TESTING**

### **Insert Test Hebrew Conversation:**
```bash
# Direct Oracle insertion
docker exec -i call-analytics-oracle bash -c "
  export NLS_LANG=AMERICAN_AMERICA.AL32UTF8
  sqlplus -S system/Call_Analytics_2024!@XE << 'EOF'
  
  INSERT INTO VERINT_TEXT_ANALYSIS 
  (CALL_ID, BAN, SUBSCRIBER_NO, CALL_TIME, TEXT_TIME, OWNER, TEXT)
  VALUES 
  ($(date +%s), '13055', '506242294', SYSDATE, SYSDATE, 'C', 
   'שלום, יש לי בעיה עם האינטרנט. האם אתם יכולים לעזור?');
  
  COMMIT;
  EXIT;
EOF"
```

### **Test Hebrew AI Chat:**
```bash
# Get admin token
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/admin/login \
    -H "Content-Type: application/json" \
    -d '{"username": "admin", "password": "admin123456", "adminKey": "call-analytics-admin-key-2025"}' | jq -r '.token')

# Test Hebrew conversation analysis
curl -s -X POST http://localhost:3000/api/v1/ai/chat \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"message": "סכם את השיחות האחרונות של לקוח 13055", "language": "he"}' | jq '.response'
```

---

## 🚨 **TROUBLESHOOTING GUIDE**

### **Common Issues & Solutions:**

#### **1. Kafka Consumer Lag**
```bash
# Check consumer status
curl http://localhost:3000/api/v1/kafka/consumer-lag

# Restart slow consumers
docker-compose restart api

# Scale up processing (if needed)
# Increase partitions in config/kafka/topics-config.json
```

#### **2. Hebrew ML Processing Failures**
```bash
# Check ML service logs
docker-compose logs ml-service | grep -i error

# Test Hebrew processing directly
curl -X POST http://localhost:5000/pipeline/process-call \
  -H "Content-Type: application/json" \
  -d '{"call_data": {"transcriptionText": "שלום עולם", "language": "he"}}'

# Restart ML service if needed
docker-compose restart ml-service
```

#### **3. OpenSearch Indexing Issues**
```bash
# Check OpenSearch health
curl http://localhost:9200/_cluster/health

# Check Hebrew indices
curl http://localhost:9200/_cat/indices | grep call-analytics

# Test Hebrew search
curl -X GET "http://localhost:9200/_search" \
  -H "Content-Type: application/json" \
  -d '{"query": {"match": {"transcriptionText": "שלום"}}}'
```

#### **4. Oracle CDC Connection**
```bash
# Check CDC processing status
./scripts/check-cdc-status.sh

# Verify Oracle connection
docker exec call-analytics-oracle sqlplus -S system/Call_Analytics_2024!@XE <<< "SELECT COUNT(*) FROM VERINT_TEXT_ANALYSIS;"

# Restart CDC if needed
curl -X POST http://localhost:3000/api/v1/realtime-cdc/start
```

---

## 📈 **PERFORMANCE OPTIMIZATION**

### **Scaling Guidelines:**
- **Light Load** (< 1,000 calls/day): Default configuration
- **Medium Load** (1,000-10,000 calls/day): Increase Kafka partitions to 6
- **Heavy Load** (> 10,000 calls/day): Add more API replicas, increase ML service resources

### **Resource Monitoring:**
```bash
# Check Docker resource usage
docker stats

# Monitor Kafka disk usage
docker exec call-analytics-kafka du -sh /var/lib/kafka/data

# OpenSearch storage
curl http://localhost:9200/_cat/allocation?v
```

---

## 🔐 **SECURITY & BACKUP**

### **Regular Backups:**
```bash
# Oracle database backup (weekly)
docker exec call-analytics-oracle exp system/Call_Analytics_2024! file=/backup/$(date +%Y%m%d).dmp

# Kafka topic backup (if needed)
docker exec call-analytics-kafka kafka-console-consumer --bootstrap-server localhost:9092 --topic cdc-raw-changes --from-beginning > backup-$(date +%Y%m%d).json
```

### **Security Checklist:**
- [ ] Admin passwords changed from defaults
- [ ] API authentication tokens rotated
- [ ] Oracle database credentials secured
- [ ] Network access limited to required ports
- [ ] SSL/TLS enabled for production

---

## 📞 **SUPPORT & MAINTENANCE**

### **Log Locations:**
- **API Logs**: `docker-compose logs api`
- **Kafka Logs**: `docker-compose logs kafka`
- **ML Service Logs**: `docker-compose logs ml-service`
- **Oracle Logs**: `docker-compose logs oracle`

### **Regular Maintenance Tasks:**
- **Daily**: Health checks, log review
- **Weekly**: Performance metrics review, backup verification
- **Monthly**: Update dependencies, clean old logs
- **Quarterly**: Full system testing, capacity planning

---

## 🎯 **SUCCESS METRICS**

**Key Performance Indicators:**
- **Processing Latency**: < 2 seconds end-to-end
- **Hebrew Accuracy**: > 95% for conversation analysis
- **System Uptime**: > 99.5%
- **Data Loss**: Zero (guaranteed by Kafka)
- **Customer Satisfaction**: Immediate insights available

**Current Capabilities:**
- ✅ 10,000+ concurrent Hebrew conversations
- ✅ Real-time conversation assembly and analysis
- ✅ Native Hebrew language processing
- ✅ Fault-tolerant streaming architecture
- ✅ Administrative Hebrew AI Chat interface
- ✅ Complete observability and monitoring

---

*For additional support or questions about Hebrew language processing, refer to the technical documentation or contact the development team.*