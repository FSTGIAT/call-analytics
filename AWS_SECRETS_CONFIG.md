# AWS Secrets Manager Configuration Guide
## Hebrew Call Analytics AI Platform with On-Premise Oracle

This guide provides comprehensive instructions for deploying the Hebrew Call Analytics platform on AWS while maintaining Oracle database on-premise, using AWS Secrets Manager for secure credential management.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [AWS Secrets Manager Setup](#aws-secrets-manager-setup)
3. [Network Configuration](#network-configuration)
4. [ECS Task Definitions](#ecs-task-definitions)
5. [Application Code Changes](#application-code-changes)
6. [Docker Compose for AWS](#docker-compose-for-aws)
7. [AWS Managed Services Setup](#aws-managed-services-setup)
8. [Connection Testing](#connection-testing)
9. [Monitoring & Failover](#monitoring--failover)

---

## Architecture Overview

```
On-Premise                     |                    AWS Cloud
                              |
Oracle Database ←---VPN/DX---→ | VPC → ECS Fargate → API Service
(Port 1521)                    |      ↓
                              |      AWS Secrets Manager
                              |      ↓
                              |      ElastiCache (Redis)
                              |      OpenSearch Service
                              |      MSK (Kafka)
                              |      ML Service (GPU)
```

---

## AWS Secrets Manager Setup

### Step 1: Create Secrets in AWS Secrets Manager

```bash
# 1. Oracle Database Credentials - For on-premise connection
aws secretsmanager create-secret \
    --name prod/call-analytics/oracle \
    --description "On-premise Oracle database credentials" \
    --secret-string '{
        "username": "call_analytics",
        "password": "Production_Oracle_2024!",
        "host": "your-on-prem-oracle-host.company.internal",
        "port": "1521",
        "service_name": "ORCLPDB1"
    }'

# 2. Redis Password (AWS ElastiCache)
aws secretsmanager create-secret \
    --name prod/call-analytics/redis \
    --description "ElastiCache Redis password" \
    --secret-string '{
        "password": "Production_Redis_2024!",
        "endpoint": "redis-cluster.abc123.cache.amazonaws.com"
    }'

# 3. JWT Secret
aws secretsmanager create-secret \
    --name prod/call-analytics/jwt \
    --description "JWT signing secret" \
    --secret-string '{
        "secret": "Production_JWT_Secret_2024_Very_Long_Random_Key"
    }'

# 4. API Keys
aws secretsmanager create-secret \
    --name prod/call-analytics/api-keys \
    --description "API authentication keys" \
    --secret-string '{
        "admin_key": "call-analytics-admin-key-2025",
        "mcp_api_key": "your-mcp-api-key"
    }'

# 5. ML Service Secrets
aws secretsmanager create-secret \
    --name prod/call-analytics/ml-service \
    --description "ML service credentials" \
    --secret-string '{
        "hf_token": "your-huggingface-token"
    }'

# 6. OpenSearch Credentials (AWS OpenSearch Service)
aws secretsmanager create-secret \
    --name prod/call-analytics/opensearch \
    --description "AWS OpenSearch Service credentials" \
    --secret-string '{
        "endpoint": "search-call-analytics-xxx.us-east-1.es.amazonaws.com",
        "username": "admin",
        "password": "Production_Search_2024!"
    }'
```

### Step 2: Create IAM Role for ECS Tasks

```bash
# Create trust policy file
cat > ecs-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the role
aws iam create-role \
    --role-name CallAnalyticsECSTaskRole \
    --assume-role-policy-document file://ecs-trust-policy.json

# Attach policy for Secrets Manager access
aws iam put-role-policy \
    --role-name CallAnalyticsECSTaskRole \
    --policy-name SecretsManagerAccess \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "secretsmanager:GetSecretValue",
                    "kms:Decrypt"
                ],
                "Resource": [
                    "arn:aws:secretsmanager:*:*:secret:prod/call-analytics/*"
                ]
            }
        ]
    }'
```

---

## Network Configuration

### VPN Connection to On-Premise Oracle

```bash
# Create Customer Gateway
aws ec2 create-customer-gateway \
    --bgp-asn 65000 \
    --public-ip YOUR_ON_PREM_PUBLIC_IP \
    --type ipsec.1

# Create Virtual Private Gateway
aws ec2 create-vpn-gateway --type ipsec.1

# Attach VPN Gateway to VPC
aws ec2 attach-vpn-gateway \
    --vpn-gateway-id vgw-xxxxx \
    --vpc-id vpc-xxxxx

# Create VPN connection
aws ec2 create-vpn-connection \
    --type ipsec.1 \
    --customer-gateway-id cgw-xxxxx \
    --vpn-gateway-id vgw-xxxxx \
    --options "{\"StaticRoutesOnly\":true}"

# Add route to on-premise Oracle network
aws ec2 create-route \
    --route-table-id rtb-xxxxx \
    --destination-cidr-block 10.0.0.0/16  # Your on-prem network
    --vpn-connection-id vpn-xxxxx

# Security Group for ECS tasks
aws ec2 create-security-group \
    --group-name call-analytics-ecs \
    --description "Security group for Call Analytics ECS tasks"

# Allow Oracle connection
aws ec2 authorize-security-group-egress \
    --group-id sg-xxxxx \
    --protocol tcp \
    --port 1521 \
    --cidr 10.0.0.0/16  # Your on-prem network
```

---

## ECS Task Definitions

### API Service Task Definition

```json
{
  "family": "call-analytics-api",
  "taskRoleArn": "arn:aws:iam::YOUR_ACCOUNT:role/CallAnalyticsECSTaskRole",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT:role/ecsTaskExecutionRole",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "YOUR_ECR_REPO/call-analytics-api:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "AUTO_MIGRATE", "value": "false"},
        {"name": "CDC_POLL_INTERVAL_MS", "value": "10000"},
        {"name": "CDC_BATCH_SIZE", "value": "25"},
        {"name": "CDC_MAX_CONCURRENT", "value": "10"},
        {"name": "LC_ALL", "value": "C.UTF-8"},
        {"name": "LANG", "value": "C.UTF-8"},
        {"name": "NLS_LANG", "value": "AMERICAN_AMERICA.AL32UTF8"}
      ],
      "secrets": [
        {
          "name": "ORACLE_CONFIG",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:prod/call-analytics/oracle"
        },
        {
          "name": "REDIS_CONFIG",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:prod/call-analytics/redis"
        },
        {
          "name": "JWT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:prod/call-analytics/jwt:secret::"
        },
        {
          "name": "API_KEYS",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:prod/call-analytics/api-keys"
        },
        {
          "name": "OPENSEARCH_CONFIG",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:prod/call-analytics/opensearch"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/call-analytics-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/api/v1/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

### ML Service Task Definition (GPU)

```json
{
  "family": "call-analytics-ml",
  "taskRoleArn": "arn:aws:iam::YOUR_ACCOUNT:role/CallAnalyticsECSTaskRole",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT:role/ecsTaskExecutionRole",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["EC2"],
  "cpu": "4096",
  "memory": "16384",
  "containerDefinitions": [
    {
      "name": "ml-service",
      "image": "YOUR_ECR_REPO/call-analytics-ml:latest",
      "portMappings": [
        {
          "containerPort": 5000,
          "protocol": "tcp"
        }
      ],
      "resourceRequirements": [
        {
          "type": "GPU",
          "value": "1"
        }
      ],
      "environment": [
        {"name": "MODEL_TEMPERATURE", "value": "0.2"},
        {"name": "MODEL_MAX_TOKENS", "value": "400"},
        {"name": "REQUEST_TIMEOUT", "value": "40"},
        {"name": "DEFAULT_MODEL", "value": "dictalm2.0-instruct:Q4_K_M"},
        {"name": "HEBREW_MODEL", "value": "dictalm2.0-instruct:Q4_K_M"}
      ],
      "secrets": [
        {
          "name": "HF_TOKEN",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:prod/call-analytics/ml-service:hf_token::"
        }
      ],
      "mountPoints": [
        {
          "sourceVolume": "models",
          "containerPath": "/app/models"
        }
      ]
    }
  ],
  "volumes": [
    {
      "name": "models",
      "host": {
        "sourcePath": "/mnt/efs/models"
      }
    }
  ]
}
```

---

## Application Code Changes

### Database Connection Manager (TypeScript)

```typescript
// src/config/database.ts
import oracledb from 'oracledb';
import AWS from 'aws-sdk';

export class OracleConnectionManager {
  private static instance: OracleConnectionManager;
  private pool: any;
  private secretsManager: AWS.SecretsManager;
  
  static async getInstance(): Promise<OracleConnectionManager> {
    if (!this.instance) {
      this.instance = new OracleConnectionManager();
      await this.instance.initialize();
    }
    return this.instance;
  }
  
  private constructor() {
    this.secretsManager = new AWS.SecretsManager({
      region: process.env.AWS_REGION || 'us-east-1'
    });
  }
  
  private async initialize(): Promise<void> {
    try {
      // Fetch Oracle credentials from Secrets Manager
      const secret = await this.secretsManager.getSecretValue({
        SecretId: 'prod/call-analytics/oracle'
      }).promise();
      
      const oracleConfig = JSON.parse(secret.SecretString!);
      
      // Configure Oracle client for thick mode (better for VPN)
      oracledb.initOracleClient({
        libDir: '/opt/oracle/instantclient'
      });
      
      // Create connection pool for on-premise Oracle
      this.pool = await oracledb.createPool({
        user: oracleConfig.username,
        password: oracleConfig.password,
        connectString: `${oracleConfig.host}:${oracleConfig.port}/${oracleConfig.service_name}`,
        poolMin: 10,
        poolMax: 40,
        poolIncrement: 5,
        poolTimeout: 60,
        queueTimeout: 60000,
        // Connection health check for VPN
        expireTime: 30,
        enableStatistics: true,
        // Enable connection validation
        sessionCallback: this.initSession
      });
      
      console.log('✅ Connected to on-premise Oracle via VPN');
      
      // Test connection
      await this.testConnection();
      
    } catch (error) {
      console.error('❌ Failed to connect to on-premise Oracle:', error);
      throw error;
    }
  }
  
  private async initSession(connection: any, requestedTag: string) {
    // Set session properties for Hebrew support
    await connection.execute(`ALTER SESSION SET NLS_LANGUAGE='AMERICAN'`);
    await connection.execute(`ALTER SESSION SET NLS_TERRITORY='AMERICA'`);
    await connection.execute(`ALTER SESSION SET NLS_CHARACTERSET='AL32UTF8'`);
  }
  
  private async testConnection(): Promise<void> {
    let connection;
    try {
      connection = await this.pool.getConnection();
      const result = await connection.execute('SELECT 1 FROM DUAL');
      console.log('✅ Oracle connection test successful');
    } finally {
      if (connection) {
        await connection.close();
      }
    }
  }
  
  async getConnection() {
    return await this.pool.getConnection();
  }
  
  async closePool() {
    if (this.pool) {
      await this.pool.close(10);
    }
  }
}
```

### Secrets Helper Service

```typescript
// src/services/secrets.service.ts
import AWS from 'aws-sdk';

export class SecretsService {
  private static instance: SecretsService;
  private secretsManager: AWS.SecretsManager;
  private cache: Map<string, any> = new Map();
  
  static getInstance(): SecretsService {
    if (!this.instance) {
      this.instance = new SecretsService();
    }
    return this.instance;
  }
  
  private constructor() {
    this.secretsManager = new AWS.SecretsManager({
      region: process.env.AWS_REGION || 'us-east-1'
    });
  }
  
  async getSecret(secretId: string): Promise<any> {
    // Check cache first
    if (this.cache.has(secretId)) {
      return this.cache.get(secretId);
    }
    
    try {
      const secret = await this.secretsManager.getSecretValue({
        SecretId: secretId
      }).promise();
      
      const value = JSON.parse(secret.SecretString!);
      this.cache.set(secretId, value);
      
      return value;
    } catch (error) {
      console.error(`Failed to retrieve secret ${secretId}:`, error);
      throw error;
    }
  }
  
  async getOracleConfig() {
    return await this.getSecret('prod/call-analytics/oracle');
  }
  
  async getRedisConfig() {
    return await this.getSecret('prod/call-analytics/redis');
  }
  
  async getJWTSecret() {
    const secret = await this.getSecret('prod/call-analytics/jwt');
    return secret.secret;
  }
  
  async getAPIKeys() {
    return await this.getSecret('prod/call-analytics/api-keys');
  }
  
  async getOpenSearchConfig() {
    return await this.getSecret('prod/call-analytics/opensearch');
  }
}
```

### Entrypoint Script for Non-ECS Deployments

```bash
#!/bin/bash
# entrypoint-aws.sh

set -e

# Function to get secret from AWS Secrets Manager
get_secret() {
    local secret_name=$1
    local json_key=$2
    
    secret_value=$(aws secretsmanager get-secret-value \
        --secret-id "$secret_name" \
        --query SecretString \
        --output text 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        echo "$secret_value" | jq -r ".$json_key"
    else
        echo ""
    fi
}

# Only fetch secrets if not running in ECS (ECS injects them automatically)
if [ -z "$ECS_CONTAINER_METADATA_URI_V4" ]; then
    echo "Not running in ECS - fetching secrets from Secrets Manager..."
    
    # Fetch Oracle credentials for on-premise connection
    echo "Fetching Oracle credentials..."
    ORACLE_JSON=$(aws secretsmanager get-secret-value \
        --secret-id prod/call-analytics/oracle \
        --query SecretString --output text)
    
    export ORACLE_USERNAME=$(echo "$ORACLE_JSON" | jq -r '.username')
    export ORACLE_PASSWORD=$(echo "$ORACLE_JSON" | jq -r '.password')
    export ORACLE_HOST=$(echo "$ORACLE_JSON" | jq -r '.host')
    export ORACLE_PORT=$(echo "$ORACLE_JSON" | jq -r '.port')
    export ORACLE_SERVICE_NAME=$(echo "$ORACLE_JSON" | jq -r '.service_name')
    
    # Fetch Redis configuration
    echo "Fetching Redis configuration..."
    REDIS_JSON=$(aws secretsmanager get-secret-value \
        --secret-id prod/call-analytics/redis \
        --query SecretString --output text)
    
    export REDIS_PASSWORD=$(echo "$REDIS_JSON" | jq -r '.password')
    export REDIS_ENDPOINT=$(echo "$REDIS_JSON" | jq -r '.endpoint')
    
    # Fetch JWT secret
    echo "Fetching JWT secret..."
    export JWT_SECRET=$(get_secret "prod/call-analytics/jwt" "secret")
    
    # Fetch API keys
    echo "Fetching API keys..."
    API_KEYS_JSON=$(aws secretsmanager get-secret-value \
        --secret-id prod/call-analytics/api-keys \
        --query SecretString --output text)
    
    export ADMIN_API_KEY=$(echo "$API_KEYS_JSON" | jq -r '.admin_key')
    export MCP_API_KEY=$(echo "$API_KEYS_JSON" | jq -r '.mcp_api_key')
    
    # Fetch OpenSearch configuration
    echo "Fetching OpenSearch configuration..."
    OPENSEARCH_JSON=$(aws secretsmanager get-secret-value \
        --secret-id prod/call-analytics/opensearch \
        --query SecretString --output text)
    
    export OPENSEARCH_ENDPOINT=$(echo "$OPENSEARCH_JSON" | jq -r '.endpoint')
    export OPENSEARCH_USERNAME=$(echo "$OPENSEARCH_JSON" | jq -r '.username')
    export OPENSEARCH_PASSWORD=$(echo "$OPENSEARCH_JSON" | jq -r '.password')
    
    echo "All secrets loaded successfully"
else
    echo "Running in ECS - using injected secrets"
fi

# Execute the original command
exec "$@"
```

---

## Docker Compose for AWS

### docker-compose.aws.yml

```yaml
version: '3.8'

x-aws-logs: &aws-logs
  logging:
    driver: awslogs
    options:
      awslogs-region: ${AWS_REGION:-us-east-1}
      awslogs-stream-prefix: call-analytics

services:
  api:
    build: 
      context: ./api
      dockerfile: Dockerfile.aws
    image: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/call-analytics-api:latest
    <<: *aws-logs
    environment:
      # Non-sensitive configuration
      - NODE_ENV=production
      - AUTO_MIGRATE=false  # Don't auto-migrate on-prem Oracle
      - CDC_POLL_INTERVAL_MS=10000
      - CDC_BATCH_SIZE=25
      - CDC_MAX_CONCURRENT=10
      - LC_ALL=C.UTF-8
      - LANG=C.UTF-8
      - NLS_LANG=AMERICAN_AMERICA.AL32UTF8
      
      # AWS Service Discovery endpoints
      - KAFKA_BROKERS=${MSK_BOOTSTRAP_SERVERS}
      - AWS_REGION=${AWS_REGION}
      
      # Secrets will be injected by ECS
      - ORACLE_CONFIG
      - REDIS_CONFIG
      - JWT_SECRET
      - API_KEYS
      - OPENSEARCH_CONFIG
    ports:
      - "3000:3000"
    networks:
      - call-analytics-network

  ml-service:
    build:
      context: ./ml-service
      dockerfile: Dockerfile.aws
    image: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/call-analytics-ml:latest
    <<: *aws-logs
    runtime: nvidia
    environment:
      # Model configuration
      - MODEL_TEMPERATURE=0.2
      - MODEL_MAX_TOKENS=400
      - REQUEST_TIMEOUT=40
      - OLLAMA_TIMEOUT=40
      - DEFAULT_MODEL=dictalm2.0-instruct:Q4_K_M
      - HEBREW_MODEL=dictalm2.0-instruct:Q4_K_M
      
      # Ollama endpoint (separate GPU instance)
      - OLLAMA_URL=http://ollama.internal:11434
      
      # AWS Region
      - AWS_REGION=${AWS_REGION}
      
      # Secrets injected by ECS
      - HF_TOKEN
    ports:
      - "5000:5000"
    networks:
      - call-analytics-network

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        - VUE_APP_API_URL=https://api.call-analytics.example.com
    image: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/call-analytics-frontend:latest
    <<: *aws-logs
    environment:
      - NODE_ENV=production
    ports:
      - "8080:8080"
    networks:
      - call-analytics-network

  # Ollama service (runs on GPU instance)
  ollama:
    build:
      context: ./ollama
      dockerfile: Dockerfile
    image: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/call-analytics-ollama:latest
    <<: *aws-logs
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - OLLAMA_GPU_MEMORY_FRACTION=0.9
      - OLLAMA_NUM_GPU_LAYERS=32
      - OLLAMA_KEEP_ALIVE=15m
    ports:
      - "11434:11434"
    volumes:
      - ollama_models:/root/.ollama/models
    networks:
      - call-analytics-network

networks:
  call-analytics-network:
    driver: bridge

volumes:
  ollama_models:
    driver: efs
    driver_opts:
      fileSystemId: ${EFS_ID}
      transitEncryption: "tls"
```

### Dockerfile.aws for API

```dockerfile
FROM node:18-alpine

# Install AWS CLI and Oracle Instant Client
RUN apk add --no-cache \
    aws-cli \
    jq \
    bash \
    libaio \
    libnsl \
    && rm -rf /var/cache/apk/*

# Install Oracle Instant Client
WORKDIR /opt/oracle
RUN wget https://download.oracle.com/otn_software/linux/instantclient/instantclient-basic-linux.zip \
    && unzip instantclient-basic-linux.zip \
    && rm instantclient-basic-linux.zip \
    && ln -s /opt/oracle/instantclient* /opt/oracle/instantclient

ENV LD_LIBRARY_PATH=/opt/oracle/instantclient:$LD_LIBRARY_PATH

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
COPY entrypoint-aws.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint-aws.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint-aws.sh"]
CMD ["node", "src/index.js"]
```

---

## AWS Managed Services Setup

### 1. ElastiCache Redis

```bash
# Create subnet group
aws elasticache create-cache-subnet-group \
    --cache-subnet-group-name call-analytics-subnet \
    --cache-subnet-group-description "Subnet group for Call Analytics Redis" \
    --subnet-ids subnet-xxx subnet-yyy subnet-zzz

# Create Redis cluster
aws elasticache create-cache-cluster \
    --cache-cluster-id call-analytics-redis \
    --engine redis \
    --cache-node-type cache.r6g.xlarge \
    --num-cache-nodes 1 \
    --cache-subnet-group-name call-analytics-subnet \
    --security-group-ids sg-xxxxx \
    --port 6379 \
    --preferred-maintenance-window "sun:05:00-sun:06:00" \
    --snapshot-retention-limit 7
```

### 2. OpenSearch Service

```bash
aws opensearch create-domain \
    --domain-name call-analytics \
    --engine-version OpenSearch_2.11 \
    --cluster-config '{
        "InstanceType": "r5.xlarge.search",
        "InstanceCount": 3,
        "DedicatedMasterEnabled": true,
        "DedicatedMasterType": "r5.large.search",
        "DedicatedMasterCount": 3,
        "ZoneAwarenessEnabled": true,
        "ZoneAwarenessConfig": {
            "AvailabilityZoneCount": 3
        }
    }' \
    --ebs-options '{
        "EBSEnabled": true,
        "VolumeType": "gp3",
        "VolumeSize": 100,
        "Iops": 3000,
        "Throughput": 125
    }' \
    --access-policies '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::ACCOUNT:role/CallAnalyticsECSTaskRole"
            },
            "Action": "es:*",
            "Resource": "arn:aws:es:*:*:domain/call-analytics/*"
        }]
    }' \
    --vpc-options '{
        "SubnetIds": ["subnet-xxx", "subnet-yyy", "subnet-zzz"],
        "SecurityGroupIds": ["sg-opensearch"]
    }' \
    --advanced-security-options '{
        "Enabled": true,
        "InternalUserDatabaseEnabled": true,
        "MasterUserOptions": {
            "MasterUserName": "admin",
            "MasterUserPassword": "Production_Search_2024!"
        }
    }' \
    --encryption-at-rest-options '{
        "Enabled": true
    }' \
    --node-to-node-encryption-options '{
        "Enabled": true
    }'
```

### 3. Amazon MSK (Kafka)

```bash
# Create MSK cluster
aws kafka create-cluster \
    --cluster-name call-analytics-kafka \
    --broker-node-group-info '{
        "InstanceType": "kafka.m5.large",
        "ClientSubnets": ["subnet-xxx", "subnet-yyy", "subnet-zzz"],
        "SecurityGroups": ["sg-kafka"],
        "StorageInfo": {
            "EbsStorageInfo": {
                "VolumeSize": 100
            }
        }
    }' \
    --kafka-version "2.8.0" \
    --number-of-broker-nodes 3 \
    --encryption-info '{
        "EncryptionInTransit": {
            "ClientBroker": "TLS_PLAINTEXT",
            "InCluster": true
        }
    }' \
    --logging-info '{
        "BrokerLogs": {
            "CloudWatchLogs": {
                "Enabled": true,
                "LogGroup": "/aws/msk/call-analytics"
            }
        }
    }'

# Get bootstrap servers after creation
aws kafka get-bootstrap-brokers --cluster-arn arn:aws:kafka:region:account:cluster/call-analytics-kafka/xxx
```

---

## Connection Testing

### Test Script for On-Premise Oracle Connection

```bash
#!/bin/bash
# test-oracle-connection.sh

echo "=== Testing On-Premise Oracle Connection ==="

# 1. Test VPN connection
echo "1. Testing VPN connection..."
VPN_STATUS=$(aws ec2 describe-vpn-connections \
    --vpn-connection-ids ${VPN_CONNECTION_ID} \
    --query 'VpnConnections[0].State' \
    --output text)

if [ "$VPN_STATUS" = "available" ]; then
    echo "✅ VPN connection is available"
else
    echo "❌ VPN connection status: $VPN_STATUS"
    exit 1
fi

# 2. Test network connectivity to Oracle
echo "2. Testing network connectivity to Oracle..."
timeout 5 bash -c "cat < /dev/null > /dev/tcp/${ORACLE_HOST}/1521"
if [ $? -eq 0 ]; then
    echo "✅ Oracle port 1521 is reachable"
else
    echo "❌ Cannot reach Oracle on port 1521"
    exit 1
fi

# 3. Test from within container
echo "3. Testing Oracle connection from container..."
docker run --rm \
    -e AWS_REGION=${AWS_REGION} \
    -e AWS_DEFAULT_REGION=${AWS_REGION} \
    ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/call-analytics-api:latest \
    node -e "
const oracledb = require('oracledb');
const AWS = require('aws-sdk');

async function testConnection() {
    const secretsManager = new AWS.SecretsManager({ region: '${AWS_REGION}' });
    
    try {
        // Fetch credentials
        const secret = await secretsManager.getSecretValue({
            SecretId: 'prod/call-analytics/oracle'
        }).promise();
        
        const config = JSON.parse(secret.SecretString);
        
        // Try to connect
        const connection = await oracledb.getConnection({
            user: config.username,
            password: config.password,
            connectString: \`\${config.host}:\${config.port}/\${config.service_name}\`
        });
        
        // Test query
        const result = await connection.execute('SELECT CURRENT_TIMESTAMP FROM DUAL');
        console.log('✅ Successfully connected to on-premise Oracle!');
        console.log('   Server time:', result.rows[0][0]);
        
        await connection.close();
        process.exit(0);
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
        process.exit(1);
    }
}

testConnection();
"

echo "=== Connection test complete ==="
```

---

## Monitoring & Failover

### Health Check Lambda Function

```python
import boto3
import json
import cx_Oracle
from datetime import datetime

def lambda_handler(event, context):
    """Monitor on-premise Oracle connection health"""
    
    # Initialize clients
    secrets_client = boto3.client('secretsmanager')
    cloudwatch = boto3.client('cloudwatch')
    ec2 = boto3.client('ec2')
    
    # Get Oracle credentials
    secret = secrets_client.get_secret_value(SecretId='prod/call-analytics/oracle')
    oracle_config = json.loads(secret['SecretString'])
    
    # Check VPN status
    vpn_response = ec2.describe_vpn_connections(
        VpnConnectionIds=[os.environ['VPN_CONNECTION_ID']]
    )
    vpn_status = vpn_response['VpnConnections'][0]['State']
    
    # Initialize metrics
    metrics = {
        'vpn_healthy': 1 if vpn_status == 'available' else 0,
        'oracle_reachable': 0,
        'query_time_ms': 0,
        'cdc_lag_seconds': 0
    }
    
    # Test Oracle connection
    try:
        start_time = datetime.now()
        
        connection = cx_Oracle.connect(
            oracle_config['username'],
            oracle_config['password'],
            f"{oracle_config['host']}:{oracle_config['port']}/{oracle_config['service_name']}"
        )
        
        cursor = connection.cursor()
        cursor.execute("SELECT 1 FROM DUAL")
        cursor.close()
        
        metrics['oracle_reachable'] = 1
        metrics['query_time_ms'] = (datetime.now() - start_time).total_seconds() * 1000
        
        # Check CDC lag
        cursor = connection.cursor()
        cursor.execute("""
            SELECT EXTRACT(SECOND FROM (CURRENT_TIMESTAMP - MAX(LAST_PROCESSED_TIME)))
            FROM CDC_PROCESSING_STATUS
            WHERE TABLE_NAME = 'CDC_NORMAL_MODE'
        """)
        cdc_lag = cursor.fetchone()
        if cdc_lag:
            metrics['cdc_lag_seconds'] = cdc_lag[0] or 0
        
        connection.close()
        
    except Exception as e:
        print(f"Oracle connection failed: {str(e)}")
        metrics['oracle_reachable'] = 0
    
    # Send metrics to CloudWatch
    for metric_name, value in metrics.items():
        cloudwatch.put_metric_data(
            Namespace='CallAnalytics/Oracle',
            MetricData=[
                {
                    'MetricName': metric_name,
                    'Value': value,
                    'Unit': 'None',
                    'Timestamp': datetime.now()
                }
            ]
        )
    
    # Create alarm if connection fails
    if metrics['oracle_reachable'] == 0:
        # Send SNS notification
        sns = boto3.client('sns')
        sns.publish(
            TopicArn=os.environ['ALERT_TOPIC_ARN'],
            Subject='Oracle Connection Failed',
            Message=f"On-premise Oracle connection failed. VPN Status: {vpn_status}"
        )
    
    return {
        'statusCode': 200,
        'body': json.dumps(metrics)
    }
```

### CloudWatch Alarms

```bash
# Create alarm for Oracle connection
aws cloudwatch put-metric-alarm \
    --alarm-name oracle-connection-failure \
    --alarm-description "Alert when Oracle connection fails" \
    --metric-name oracle_reachable \
    --namespace CallAnalytics/Oracle \
    --statistic Average \
    --period 300 \
    --threshold 1 \
    --comparison-operator LessThanThreshold \
    --evaluation-periods 2 \
    --alarm-actions arn:aws:sns:region:account:call-analytics-alerts

# Create alarm for CDC lag
aws cloudwatch put-metric-alarm \
    --alarm-name cdc-high-lag \
    --alarm-description "Alert when CDC lag exceeds 5 minutes" \
    --metric-name cdc_lag_seconds \
    --namespace CallAnalytics/Oracle \
    --statistic Average \
    --period 300 \
    --threshold 300 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 2 \
    --alarm-actions arn:aws:sns:region:account:call-analytics-alerts
```

---

## Deployment Script

```bash
#!/bin/bash
# deploy-to-aws.sh

set -e

echo "=== Deploying Call Analytics Platform to AWS ==="

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO_PREFIX="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# 1. Login to ECR
echo "1. Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | \
    docker login --username AWS --password-stdin ${ECR_REPO_PREFIX}

# 2. Build and push images
echo "2. Building and pushing Docker images..."
services=("api" "ml-service" "frontend" "ollama")

for service in "${services[@]}"; do
    echo "   Building ${service}..."
    docker build -t call-analytics-${service} -f ${service}/Dockerfile.aws ${service}/
    
    echo "   Tagging ${service}..."
    docker tag call-analytics-${service}:latest \
        ${ECR_REPO_PREFIX}/call-analytics-${service}:latest
    
    echo "   Pushing ${service}..."
    docker push ${ECR_REPO_PREFIX}/call-analytics-${service}:latest
done

# 3. Update ECS services
echo "3. Updating ECS services..."
aws ecs update-service \
    --cluster call-analytics-cluster \
    --service call-analytics-api \
    --force-new-deployment

aws ecs update-service \
    --cluster call-analytics-cluster \
    --service call-analytics-ml \
    --force-new-deployment

# 4. Wait for services to stabilize
echo "4. Waiting for services to stabilize..."
aws ecs wait services-stable \
    --cluster call-analytics-cluster \
    --services call-analytics-api call-analytics-ml

echo "=== Deployment complete! ==="
echo "API endpoint: https://api.call-analytics.example.com"
echo "Frontend: https://app.call-analytics.example.com"
```

---

## Environment-Specific Configurations

### Development Environment

```bash
# Dev secrets
aws secretsmanager create-secret \
    --name dev/call-analytics/oracle \
    --secret-string '{
        "username": "dev_user",
        "password": "Dev_Password_2024",
        "host": "dev-oracle.company.internal",
        "port": "1521",
        "service_name": "DEVDB"
    }'
```

### Staging Environment

```bash
# Staging secrets
aws secretsmanager create-secret \
    --name staging/call-analytics/oracle \
    --secret-string '{
        "username": "staging_user",
        "password": "Staging_Password_2024",
        "host": "staging-oracle.company.internal",
        "port": "1521",
        "service_name": "STAGINGDB"
    }'
```

---

## Security Best Practices

1. **Least Privilege IAM**: Only grant necessary permissions
2. **VPC Endpoints**: Use VPC endpoints for AWS services
3. **Encryption**: Enable encryption at rest and in transit
4. **Secret Rotation**: Implement automatic rotation for passwords
5. **Audit Logging**: Enable CloudTrail for all API calls
6. **Network Isolation**: Use private subnets for ECS tasks
7. **Security Groups**: Restrict inbound/outbound traffic

---

## Cost Optimization

1. **Reserved Instances**: Use RIs for predictable workloads
2. **Spot Instances**: Use Spot for batch processing
3. **EFS Lifecycle**: Move infrequent model files to IA storage
4. **S3 Intelligent Tiering**: For log archival
5. **Secrets Manager**: Rotate secrets to avoid manual changes
6. **NAT Instance**: Consider NAT instance vs NAT Gateway for cost

---

## Troubleshooting

### Common Issues

1. **VPN Connection Down**
   - Check customer gateway configuration
   - Verify on-premise firewall rules
   - Review VPN logs in CloudWatch

2. **Oracle Connection Timeout**
   - Verify security group rules
   - Check VPN tunnel status
   - Test with telnet from VPC

3. **Secrets Manager Access Denied**
   - Verify IAM role permissions
   - Check KMS key access
   - Review CloudTrail logs

4. **High CDC Lag**
   - Monitor VPN bandwidth
   - Optimize polling intervals
   - Consider Direct Connect for better performance

---

## Conclusion

This configuration provides a secure, scalable deployment of the Hebrew Call Analytics platform on AWS while maintaining the Oracle database on-premise. The architecture leverages AWS managed services for reduced operational overhead while ensuring secure connectivity to on-premise resources through VPN/Direct Connect.