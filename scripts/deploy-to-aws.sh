#!/bin/bash
# Deploy Call Analytics Platform to AWS
# This script builds, pushes images to ECR, and deploys to ECS/Docker

set -e

echo "🚀 Deploying Call Analytics Platform to AWS"

# Configuration
AWS_REGION=${AWS_REGION:-eu-west-1}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
ECR_REPO_PREFIX="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
SERVICES=("api" "ml-service" "frontend")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install AWS CLI first."
        exit 1
    fi
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Please install Docker first."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured or expired."
        echo "Please run: aws configure or set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN"
        exit 1
    fi
    
    # Check Docker daemon
    if ! docker info &> /dev/null; then
        log_error "Docker daemon not running. Please start Docker."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Setup ECR repositories
setup_ecr_repos() {
    log_info "Setting up ECR repositories..."
    
    for service in "${SERVICES[@]}"; do
        local repo_name="call-analytics-${service}"
        
        # Create repository if it doesn't exist
        if ! aws ecr describe-repositories --repository-names "$repo_name" --region "$AWS_REGION" &> /dev/null; then
            log_info "Creating ECR repository: $repo_name"
            aws ecr create-repository \
                --repository-name "$repo_name" \
                --region "$AWS_REGION" \
                --image-scanning-configuration scanOnPush=true \
                --encryption-configuration encryptionType=AES256
            log_success "Created ECR repository: $repo_name"
        else
            log_info "ECR repository already exists: $repo_name"
        fi
    done
}

# Login to ECR
ecr_login() {
    log_info "Logging into ECR..."
    aws ecr get-login-password --region "$AWS_REGION" | \
        docker login --username AWS --password-stdin "$ECR_REPO_PREFIX"
    log_success "ECR login successful"
}

# Build and push Docker images
build_and_push() {
    log_info "Building and pushing Docker images..."
    
    for service in "${SERVICES[@]}"; do
        local service_dir="$service"
        local image_name="call-analytics-${service}"
        local local_tag="${image_name}:latest"
        local remote_tag="${ECR_REPO_PREFIX}/${image_name}:latest"
        local versioned_tag="${ECR_REPO_PREFIX}/${image_name}:$(date +%Y%m%d-%H%M%S)"
        
        log_info "Building $service..."
        
        # Build with AWS Dockerfile
        if [[ -f "${service_dir}/Dockerfile.aws" ]]; then
            docker build -t "$local_tag" -f "${service_dir}/Dockerfile.aws" "${service_dir}/"
        else
            log_warning "Dockerfile.aws not found for $service, using regular Dockerfile"
            docker build -t "$local_tag" "${service_dir}/"
        fi
        
        log_success "Built $service"
        
        # Tag for ECR
        docker tag "$local_tag" "$remote_tag"
        docker tag "$local_tag" "$versioned_tag"
        
        # Push to ECR
        log_info "Pushing $service to ECR..."
        docker push "$remote_tag"
        docker push "$versioned_tag"
        
        log_success "Pushed $service to ECR"
        log_info "  Latest: $remote_tag"
        log_info "  Versioned: $versioned_tag"
    done
}

# Deploy using docker-compose (for testing/staging)
deploy_docker_compose() {
    log_info "Deploying using docker-compose..."
    
    # Export environment variables for docker-compose
    export AWS_ACCOUNT_ID
    export AWS_REGION
    export COMPOSE_PROJECT_NAME="call-analytics-aws"
    
    # Stop existing services
    if docker-compose -f docker-compose.aws.yml ps &> /dev/null; then
        log_info "Stopping existing services..."
        docker-compose -f docker-compose.aws.yml down
    fi
    
    # Pull latest images
    log_info "Pulling latest images..."
    docker-compose -f docker-compose.aws.yml pull
    
    # Start services
    log_info "Starting services..."
    docker-compose -f docker-compose.aws.yml up -d
    
    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    sleep 30
    
    # Check service health
    check_service_health
    
    log_success "Docker Compose deployment completed"
}

# Check service health
check_service_health() {
    log_info "Checking service health..."
    
    local services_healthy=true
    
    # Check API health
    if curl -f -s http://localhost:3000/api/v1/health > /dev/null 2>&1; then
        log_success "API service is healthy"
    else
        log_error "API service is not healthy"
        services_healthy=false
    fi
    
    # Check ML service health
    if curl -f -s http://localhost:5000/health > /dev/null 2>&1; then
        log_success "ML service is healthy"
    else
        log_error "ML service is not healthy"
        services_healthy=false
    fi
    
    # Check Frontend
    if curl -f -s http://localhost:8080/ > /dev/null 2>&1; then
        log_success "Frontend is healthy"
    else
        log_error "Frontend is not healthy"
        services_healthy=false
    fi
    
    if [[ "$services_healthy" = false ]]; then
        log_warning "Some services are not healthy. Check logs with:"
        echo "  docker-compose -f docker-compose.aws.yml logs [service-name]"
    fi
}

# Create ECS task definitions (optional)
create_ecs_task_definitions() {
    if [[ "${DEPLOY_TO_ECS:-false}" = "true" ]]; then
        log_info "Creating ECS task definitions..."
        
        # This would create actual ECS task definitions
        # For now, we'll just create the JSON files
        
        local task_def_dir="./infrastructure/ecs"
        mkdir -p "$task_def_dir"
        
        # Generate task definition for API
        cat > "${task_def_dir}/api-task-definition.json" <<EOF
{
  "family": "call-analytics-api",
  "taskRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/CallAnalyticsECSTaskRole",
  "executionRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/CallAnalyticsECSExecutionRole",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "${ECR_REPO_PREFIX}/call-analytics-api:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "AWS_REGION", "value": "${AWS_REGION}"}
      ],
      "secrets": [
        {
          "name": "ORACLE_CONFIG",
          "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:prod/call-analytics/oracle"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/call-analytics-api",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF
        
        log_success "Created ECS task definitions in ${task_def_dir}/"
    fi
}

# Show deployment status
show_deployment_status() {
    log_info "Deployment Status:"
    echo "==================="
    echo "🌍 AWS Region: $AWS_REGION"
    echo "🏢 AWS Account: $AWS_ACCOUNT_ID"
    echo "📦 ECR Registry: $ECR_REPO_PREFIX"
    echo ""
    echo "🔗 Access URLs:"
    echo "   API: http://localhost:3000/api/v1/health"
    echo "   ML Service: http://localhost:5000/health"
    echo "   Frontend: http://localhost:8080/"
    echo ""
    echo "🐳 Docker Commands:"
    echo "   View logs: docker-compose -f docker-compose.aws.yml logs -f [service]"
    echo "   Stop: docker-compose -f docker-compose.aws.yml down"
    echo "   Restart: docker-compose -f docker-compose.aws.yml restart [service]"
    echo ""
}

# Cleanup function
cleanup() {
    log_info "Cleaning up temporary files..."
    # Remove any temporary files created during deployment
}

# Main execution
main() {
    # Change to script directory
    cd "$(dirname "$0")/.."
    
    echo "📂 Working directory: $(pwd)"
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --ecs)
                DEPLOY_TO_ECS=true
                shift
                ;;
            --help)
                echo "Usage: $0 [OPTIONS]"
                echo "Options:"
                echo "  --skip-build    Skip building Docker images"
                echo "  --ecs          Create ECS task definitions"
                echo "  --help         Show this help message"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    # Execute deployment steps
    check_prerequisites
    setup_ecr_repos
    ecr_login
    
    if [[ "${SKIP_BUILD:-false}" != "true" ]]; then
        build_and_push
    else
        log_warning "Skipping Docker build (--skip-build flag provided)"
    fi
    
    deploy_docker_compose
    create_ecs_task_definitions
    show_deployment_status
    cleanup
    
    log_success "🎉 Deployment completed successfully!"
    
    # Trap cleanup on exit
    trap cleanup EXIT
}

# Run main function
main "$@"