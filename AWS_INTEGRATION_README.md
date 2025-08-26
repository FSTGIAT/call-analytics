# AWS Secrets Manager Integration for Call Analytics Platform

This document provides a comprehensive guide for the AWS Secrets Manager integration that has been implemented for the Call Analytics Platform.

## 🌟 Overview

The Call Analytics Platform has been enhanced with complete AWS Secrets Manager integration, allowing secure credential management in cloud environments while maintaining backward compatibility with local development using `.env` files.

## 📁 Project Structure

```
call-analytics/
├── api/
│   ├── Dockerfile.aws                    # AWS-enabled API Docker image
│   ├── entrypoint-aws.sh                 # AWS secrets loading script
│   └── src/services/secrets.service.ts   # TypeScript AWS secrets client
├── ml-service/
│   ├── Dockerfile.aws                    # AWS-enabled ML Docker image
│   ├── entrypoint-aws.sh                # ML service AWS secrets script
│   └── src/services/aws_secrets_service.py # Python AWS secrets client
├── frontend/
│   ├── Dockerfile.aws                   # AWS-enabled Frontend Docker image
│   └── entrypoint-aws.sh               # Frontend AWS configuration script
├── scripts/
│   ├── setup-complete-aws-integration.sh # Complete AWS setup orchestrator
│   ├── setup-aws-secrets.sh             # Create AWS secrets
│   ├── setup-iam-roles.sh              # Create IAM roles and policies
│   ├── migrate-env-to-secrets.sh       # Migrate .env to AWS Secrets
│   ├── validate-secrets.sh             # Validate AWS secrets configuration
│   ├── test-aws-connectivity.sh        # Test AWS integration
│   └── deploy-to-aws.sh                # Deploy to AWS (ECR + Docker)
├── docker-compose.aws.yml              # AWS-enabled Docker Compose
└── AWS_SECRETS_CONFIG.md               # Detailed AWS configuration guide
```

## 🚀 Quick Start

### 1. Complete Setup (Recommended)

Run the comprehensive setup script that orchestrates the entire process:

```bash
# Interactive setup with confirmations
./scripts/setup-complete-aws-integration.sh

# Automated setup (no prompts)
./scripts/setup-complete-aws-integration.sh --auto
```

### 2. Manual Step-by-Step Setup

If you prefer to run each step manually:

```bash
# 1. Create AWS secrets
./scripts/setup-aws-secrets.sh

# 2. Create IAM roles and policies
./scripts/setup-iam-roles.sh

# 3. Migrate existing environment variables (optional)
./scripts/migrate-env-to-secrets.sh

# 4. Validate the setup
./scripts/validate-secrets.sh

# 5. Test AWS connectivity
./scripts/test-aws-connectivity.sh
```

## 🔐 AWS Secrets Structure

The integration creates the following secrets in AWS Secrets Manager:

### `prod/call-analytics/oracle`
```json
{
  "username": "verint_analytics",
  "password": "your_oracle_password",
  "host": "your-oracle-host.company.internal",
  "port": "1521",
  "service_name": "FREEPDB1",
  "pool_min": "10",
  "pool_max": "50",
  "pool_increment": "5",
  "pool_timeout": "60"
}
```

### `prod/call-analytics/redis`
```json
{
  "host": "redis",
  "port": "6379",
  "password": "your_redis_password",
  "db": "0"
}
```

### `prod/call-analytics/jwt`
```json
{
  "jwt_secret": "your_jwt_secret_key",
  "jwt_expiry": "24h",
  "admin_key": "your_admin_key",
  "admin_username": "admin",
  "admin_password": "your_admin_password",
  "mcp_api_key": "your_mcp_api_key"
}
```

### `prod/call-analytics/ml-service`
```json
{
  "hf_token": "your_huggingface_token",
  "hf_endpoint_url": "https://your-hf-endpoint.aws.endpoints.huggingface.cloud",
  "hf_model_name": "meta-llama/Llama-3.1-70B-Instruct",
  "model_temperature": "0.2",
  "model_max_tokens": "400",
  "request_timeout": "40",
  "default_model": "dictalm2.0-instruct:Q4_K_M",
  "hebrew_model": "dictalm2.0-instruct:Q4_K_M"
}
```

### `prod/call-analytics/opensearch`
```json
{
  "host": "opensearch",
  "port": "9200",
  "username": "admin",
  "password": "your_opensearch_password",
  "url": "http://opensearch:9200"
}
```

### `prod/call-analytics/kafka`
```json
{
  "brokers": "kafka:29092",
  "bootstrap_servers": "kafka:29092",
  "schema_registry": "http://schema-registry:8081"
}
```

## 🔧 Configuration Management

### Environment Detection
The system automatically detects the runtime environment:

- **AWS Environment**: When running in ECS, Lambda, or with AWS credentials available
- **Local Development**: When running locally with `.env` files

### Fallback Strategy
1. **AWS Secrets Manager** (in AWS environments)
2. **Environment Variables** (local development)
3. **Default Values** (where applicable)
4. **Error** (for required values)

### Caching
- Secrets are cached for 5 minutes to reduce API calls
- Cache can be cleared programmatically
- Expired cache values are used as fallback during AWS API failures

## 🐳 Deployment

### Local Testing with AWS Secrets
```bash
# Deploy using AWS-enabled Docker Compose
export AWS_ACCOUNT_ID=811287567672
export AWS_REGION=eu-west-1
docker-compose -f docker-compose.aws.yml up -d
```

### Production Deployment
```bash
# Build, push to ECR, and deploy
./scripts/deploy-to-aws.sh

# Skip building if images already exist
./scripts/deploy-to-aws.sh --skip-build

# Create ECS task definitions
./scripts/deploy-to-aws.sh --ecs
```

## 👤 IAM Roles and Permissions

The setup creates two main IAM roles:

### `CallAnalyticsECSTaskRole`
- **Purpose**: Main application runtime permissions
- **Permissions**:
  - Secrets Manager: `GetSecretValue`, `DescribeSecret`
  - KMS: `Decrypt` (for encrypted secrets)
  - CloudWatch Logs: Write access

### `CallAnalyticsECSExecutionRole`
- **Purpose**: Container execution permissions
- **Permissions**:
  - ECR: Pull Docker images
  - CloudWatch Logs: Create log streams
  - ECS: Task execution

## 🧪 Testing and Validation

### Connectivity Testing
```bash
# Test all AWS integrations
./scripts/test-aws-connectivity.sh
```

### Secret Validation
```bash
# Validate secret structure and content
./scripts/validate-secrets.sh
```

### Application Health Checks
```bash
# Check if services are responding
curl http://localhost:3000/api/v1/health  # API
curl http://localhost:5000/health         # ML Service
curl http://localhost:8080/               # Frontend
```

## 🔨 Development Workflow

### Local Development
1. Use existing `.env` files for local development
2. No changes required - services automatically detect environment
3. AWS secrets are ignored when running locally

### AWS Development
1. Set AWS credentials: `aws configure` or environment variables
2. Run setup scripts to create secrets
3. Use `docker-compose.aws.yml` for AWS-like local testing

### Production Deployment
1. Ensure all secrets have production values (no placeholders)
2. Run connectivity tests
3. Deploy using deployment scripts

## 📊 Monitoring

### CloudWatch Logs
- API logs: `/ecs/call-analytics-api`
- ML Service logs: `/ecs/call-analytics-ml`
- Frontend logs: `/ecs/call-analytics-frontend`

### Health Checks
- All services include health check endpoints
- Docker containers have built-in health checks
- AWS Load Balancer can use health checks for routing

## 🔒 Security Best Practices

### Implemented Security Measures
1. **Least Privilege**: IAM roles have minimal required permissions
2. **Encryption**: All secrets encrypted at rest with AWS KMS
3. **Network Security**: VPC isolation for AWS resources
4. **Access Logging**: CloudTrail logs all secret access
5. **Rotation Ready**: Secrets structure supports automatic rotation

### Additional Recommendations
1. Enable automatic secret rotation for database passwords
2. Use VPC endpoints for Secrets Manager access
3. Implement network ACLs for additional security
4. Regular security audits of IAM permissions

## 🆘 Troubleshooting

### Common Issues

#### AWS Credentials Not Found
```bash
# Check AWS credentials
aws sts get-caller-identity

# Configure AWS CLI
aws configure
```

#### Secret Not Found
```bash
# List all secrets
aws secretsmanager list-secrets --query 'SecretList[?contains(Name, `call-analytics`)].Name'

# Create missing secrets
./scripts/setup-aws-secrets.sh
```

#### Permission Denied
```bash
# Check IAM roles
aws iam list-roles --query 'Roles[?contains(RoleName, `CallAnalytics`)].RoleName'

# Create missing roles
./scripts/setup-iam-roles.sh
```

#### Service Not Starting
```bash
# Check logs
docker-compose -f docker-compose.aws.yml logs [service-name]

# Test individual service
docker run --rm -it [image-name] /bin/bash
```

## 📚 Additional Resources

- **AWS Secrets Manager Documentation**: [AWS Docs](https://docs.aws.amazon.com/secretsmanager/)
- **ECS Task Roles**: [AWS ECS IAM Roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
- **Docker Secrets**: [Docker Secrets Documentation](https://docs.docker.com/engine/swarm/secrets/)

## 🔄 Updates and Maintenance

### Updating Secrets
```bash
# Update a specific secret
aws secretsmanager update-secret \
  --secret-id prod/call-analytics/oracle \
  --secret-string '{"username":"new_user","password":"new_password",...}'
```

### Rotating Credentials
1. Update secret in AWS Secrets Manager
2. Clear application cache (if needed)
3. Restart services to pick up new values

### Version Management
- Docker images are tagged with timestamps
- ECR repositories maintain image history
- Rollback available through ECR image tags

---

## 🎉 Congratulations!

Your Call Analytics Platform is now fully integrated with AWS Secrets Manager! The system provides:

- ✅ Secure credential management
- ✅ Environment-aware configuration
- ✅ Backward compatibility
- ✅ Production-ready deployment
- ✅ Comprehensive monitoring
- ✅ Automated testing

For production deployment with Oracle on-premise connectivity, refer to the detailed `AWS_SECRETS_CONFIG.md` documentation.