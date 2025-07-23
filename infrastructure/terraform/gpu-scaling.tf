# Terraform configuration for AWS GPU scaling
# Handles 10TB VERINT_TEXT_ANALYSIS processing

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Variables
variable "environment" {
  description = "Environment (dev/staging/prod)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "call-analytics"
}

# =============================================================================
# SageMaker GPU Endpoints
# =============================================================================

# IAM role for SageMaker
resource "aws_iam_role" "sagemaker_execution_role" {
  name = "${var.project_name}-sagemaker-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "sagemaker.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "sagemaker_execution_policy" {
  role       = aws_iam_role.sagemaker_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSageMakerFullAccess"
}

# SageMaker model for embeddings
resource "aws_sagemaker_model" "embedding_gpu_model" {
  name               = "${var.project_name}-embedding-gpu-model"
  execution_role_arn = aws_iam_role.sagemaker_execution_role.arn

  primary_container {
    image = "763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:1.13.1-gpu-py39-cu117-ubuntu20.04-ec2"
    
    model_data_url = "s3://${aws_s3_bucket.model_artifacts.bucket}/embedding-model.tar.gz"
    
    environment = {
      SAGEMAKER_PROGRAM       = "inference.py"
      SAGEMAKER_SUBMIT_DIRECTORY = "/opt/ml/code"
      USE_GPU                 = "true"
      EMBEDDING_MODEL_NAME    = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
      BATCH_SIZE             = "256"
      MAX_LENGTH             = "512"
    }
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
    Component   = "ml-embedding"
  }
}

# SageMaker endpoint configuration
resource "aws_sagemaker_endpoint_configuration" "embedding_gpu_config" {
  name = "${var.project_name}-embedding-gpu-config"

  production_variants {
    variant_name           = "primary"
    model_name            = aws_sagemaker_model.embedding_gpu_model.name
    initial_instance_count = 3
    instance_type         = "ml.g4dn.2xlarge"
    
    initial_weight = 100
  }

  async_inference_config {
    output_config {
      s3_output_path = "s3://${aws_s3_bucket.inference_results.bucket}/async-inference/"
    }

    client_config {
      max_concurrent_invocations_per_instance = 10
    }
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# SageMaker endpoint with auto-scaling
resource "aws_sagemaker_endpoint" "embedding_gpu_endpoint" {
  name                 = "${var.project_name}-embedding-gpu-endpoint"
  endpoint_config_name = aws_sagemaker_endpoint_configuration.embedding_gpu_config.name

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Auto-scaling for SageMaker endpoint
resource "aws_appautoscaling_target" "sagemaker_target" {
  max_capacity       = 20
  min_capacity       = 3
  resource_id        = "endpoint/${aws_sagemaker_endpoint.embedding_gpu_endpoint.name}/variant/primary"
  scalable_dimension = "sagemaker:variant:DesiredInstanceCount"
  service_namespace  = "sagemaker"
}

resource "aws_appautoscaling_policy" "sagemaker_scaling_policy" {
  name               = "${var.project_name}-sagemaker-scaling-policy"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.sagemaker_target.resource_id
  scalable_dimension = aws_appautoscaling_target.sagemaker_target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.sagemaker_target.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value = 70.0

    predefined_metric_specification {
      predefined_metric_type = "SageMakerVariantInvocationsPerInstance"
    }

    scale_out_cooldown = 300
    scale_in_cooldown  = 900
  }
}

# =============================================================================
# ECS GPU Cluster
# =============================================================================

# ECS cluster
resource "aws_ecs_cluster" "gpu_cluster" {
  name = "${var.project_name}-gpu-cluster"

  capacity_providers = ["gpu-capacity-provider"]

  default_capacity_provider_strategy {
    capacity_provider = "gpu-capacity-provider"
    weight           = 100
  }

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Launch template for GPU instances
resource "aws_launch_template" "gpu_launch_template" {
  name_prefix   = "${var.project_name}-gpu-"
  image_id      = "ami-0c9b35c9a8d3d8ad1"  # ECS GPU-optimized AMI
  instance_type = "g4dn.xlarge"

  vpc_security_group_ids = [aws_security_group.ecs_gpu.id]

  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    cluster_name = aws_ecs_cluster.gpu_cluster.name
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name        = "${var.project_name}-gpu-instance"
      Environment = var.environment
      Project     = var.project_name
    }
  }
}

# Auto Scaling Group for GPU instances
resource "aws_autoscaling_group" "gpu_asg" {
  name                = "${var.project_name}-gpu-asg"
  vpc_zone_identifier = data.aws_subnets.private.ids
  target_group_arns   = []
  health_check_type   = "ECS"

  min_size         = 2
  max_size         = 20
  desired_capacity = 5

  launch_template {
    id      = aws_launch_template.gpu_launch_template.id
    version = "$Latest"
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = true
    propagate_at_launch = false
  }

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }
}

# ECS Capacity Provider
resource "aws_ecs_capacity_provider" "gpu_capacity_provider" {
  name = "gpu-capacity-provider"

  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.gpu_asg.arn
    managed_termination_protection = "ENABLED"

    managed_scaling {
      maximum_scaling_step_size = 10
      minimum_scaling_step_size = 1
      status                    = "ENABLED"
      target_capacity           = 80
    }
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# =============================================================================
# AWS Batch for Large-Scale Processing
# =============================================================================

# Batch compute environment
resource "aws_batch_compute_environment" "gpu_compute_env" {
  compute_environment_name = "${var.project_name}-gpu-compute-env"
  type                    = "MANAGED"
  state                   = "ENABLED"

  compute_resources {
    type               = "EC2"
    allocation_strategy = "BEST_FIT_PROGRESSIVE"
    
    min_vcpus     = 0
    max_vcpus     = 2000
    desired_vcpus = 100

    instance_types = ["g4dn.xlarge", "g4dn.2xlarge", "g5.xlarge", "g5.2xlarge"]
    
    security_group_ids = [aws_security_group.batch_gpu.id]
    subnets           = data.aws_subnets.private.ids
    
    instance_role = aws_iam_instance_profile.ecs_instance_profile.arn
    
    tags = {
      Environment = var.environment
      Project     = var.project_name
      Component   = "batch-gpu"
    }
  }

  service_role = aws_iam_role.batch_service_role.arn
}

# Batch job queue
resource "aws_batch_job_queue" "gpu_job_queue" {
  name     = "${var.project_name}-gpu-job-queue"
  state    = "ENABLED"
  priority = 1

  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.gpu_compute_env.arn
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# =============================================================================
# Monitoring and Alerting
# =============================================================================

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "gpu_processing" {
  name              = "/aws/call-analytics/gpu-processing"
  retention_in_days = 30

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# CloudWatch alarms for cost control
resource "aws_cloudwatch_metric_alarm" "high_cost_alarm" {
  alarm_name          = "${var.project_name}-high-cost-alarm"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = "86400"  # 24 hours
  statistic           = "Maximum"
  threshold           = "200"    # $200/day
  alarm_description   = "This metric monitors daily AWS costs"
  alarm_actions       = [aws_sns_topic.cost_alerts.arn]

  dimensions = {
    Currency = "USD"
  }
}

# SNS topic for alerts
resource "aws_sns_topic" "cost_alerts" {
  name = "${var.project_name}-cost-alerts"
}

# =============================================================================
# S3 Buckets
# =============================================================================

resource "aws_s3_bucket" "model_artifacts" {
  bucket = "${var.project_name}-model-artifacts-${random_string.bucket_suffix.result}"
}

resource "aws_s3_bucket" "inference_results" {
  bucket = "${var.project_name}-inference-results-${random_string.bucket_suffix.result}"
}

resource "random_string" "bucket_suffix" {
  length  = 8
  special = false
  upper   = false
}

# =============================================================================
# Security Groups
# =============================================================================

resource "aws_security_group" "ecs_gpu" {
  name_prefix = "${var.project_name}-ecs-gpu-"
  vpc_id      = data.aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_security_group" "batch_gpu" {
  name_prefix = "${var.project_name}-batch-gpu-"
  vpc_id      = data.aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# =============================================================================
# Data Sources
# =============================================================================

data "aws_vpc" "main" {
  default = true
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }
}

# =============================================================================
# Outputs
# =============================================================================

output "sagemaker_endpoint_name" {
  value = aws_sagemaker_endpoint.embedding_gpu_endpoint.name
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.gpu_cluster.name
}

output "batch_job_queue_arn" {
  value = aws_batch_job_queue.gpu_job_queue.arn
}