#!/bin/bash
# Script to create IAM roles and policies for Call Analytics ECS tasks
# Run with: AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx ./setup-iam-roles.sh

set -e

echo "=== Setting up IAM Roles for Call Analytics ECS Tasks ==="

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install AWS CLI first."
    exit 1
fi

# Set default region if not set
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-eu-west-1}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "🔍 AWS Account ID: $AWS_ACCOUNT_ID"
echo "🌍 AWS Region: $AWS_DEFAULT_REGION"

# 1. Create ECS Task Trust Policy
echo "📝 Creating ECS task trust policy..."
cat > /tmp/ecs-trust-policy.json <<EOF
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

# 2. Create the ECS Task Role
echo "👤 Creating CallAnalyticsECSTaskRole..."
aws iam create-role \
    --role-name CallAnalyticsECSTaskRole \
    --assume-role-policy-document file:///tmp/ecs-trust-policy.json \
    --description "Role for Call Analytics ECS tasks to access AWS services" \
    2>/dev/null || echo "⚠️  Role already exists"

# 3. Create Secrets Manager Access Policy
echo "🔐 Creating Secrets Manager access policy..."
cat > /tmp/secrets-manager-policy.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret"
            ],
            "Resource": [
                "arn:aws:secretsmanager:${AWS_DEFAULT_REGION}:${AWS_ACCOUNT_ID}:secret:prod/call-analytics/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt"
            ],
            "Resource": [
                "arn:aws:kms:${AWS_DEFAULT_REGION}:${AWS_ACCOUNT_ID}:key/*"
            ],
            "Condition": {
                "StringEquals": {
                    "kms:ViaService": "secretsmanager.${AWS_DEFAULT_REGION}.amazonaws.com"
                }
            }
        }
    ]
}
EOF

# 4. Attach Secrets Manager policy to role
echo "🔗 Attaching Secrets Manager policy to role..."
aws iam put-role-policy \
    --role-name CallAnalyticsECSTaskRole \
    --policy-name SecretsManagerAccess \
    --policy-document file:///tmp/secrets-manager-policy.json

# 5. Create CloudWatch Logs Policy
echo "📊 Creating CloudWatch Logs access policy..."
cat > /tmp/cloudwatch-logs-policy.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams"
            ],
            "Resource": [
                "arn:aws:logs:${AWS_DEFAULT_REGION}:${AWS_ACCOUNT_ID}:log-group:/ecs/call-analytics*",
                "arn:aws:logs:${AWS_DEFAULT_REGION}:${AWS_ACCOUNT_ID}:log-group:/aws/ecs/call-analytics*"
            ]
        }
    ]
}
EOF

# 6. Attach CloudWatch Logs policy to role
echo "🔗 Attaching CloudWatch Logs policy to role..."
aws iam put-role-policy \
    --role-name CallAnalyticsECSTaskRole \
    --policy-name CloudWatchLogsAccess \
    --policy-document file:///tmp/cloudwatch-logs-policy.json

# 7. Create ECS Execution Role if it doesn't exist
echo "⚙️ Creating ECS Task Execution Role..."
aws iam create-role \
    --role-name CallAnalyticsECSExecutionRole \
    --assume-role-policy-document file:///tmp/ecs-trust-policy.json \
    --description "Role for ECS task execution (pulling images, logging)" \
    2>/dev/null || echo "⚠️  Execution role already exists"

# 8. Attach managed policies to execution role
echo "🔗 Attaching managed policies to execution role..."
aws iam attach-role-policy \
    --role-name CallAnalyticsECSExecutionRole \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy \
    2>/dev/null || echo "⚠️  Policy already attached"

# 9. Add ECR access to execution role
echo "🐳 Adding ECR access to execution role..."
cat > /tmp/ecr-policy.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage"
            ],
            "Resource": "*"
        }
    ]
}
EOF

aws iam put-role-policy \
    --role-name CallAnalyticsECSExecutionRole \
    --policy-name ECRAccess \
    --policy-document file:///tmp/ecr-policy.json

# 10. Create CloudWatch Log Groups
echo "📊 Creating CloudWatch Log Groups..."
aws logs create-log-group --log-group-name /ecs/call-analytics-api 2>/dev/null || echo "⚠️  Log group already exists"
aws logs create-log-group --log-group-name /ecs/call-analytics-ml 2>/dev/null || echo "⚠️  Log group already exists"
aws logs create-log-group --log-group-name /ecs/call-analytics-frontend 2>/dev/null || echo "⚠️  Log group already exists"

# Set log retention (optional)
aws logs put-retention-policy --log-group-name /ecs/call-analytics-api --retention-in-days 30 2>/dev/null || true
aws logs put-retention-policy --log-group-name /ecs/call-analytics-ml --retention-in-days 30 2>/dev/null || true
aws logs put-retention-policy --log-group-name /ecs/call-analytics-frontend --retention-in-days 30 2>/dev/null || true

# Cleanup temp files
rm -f /tmp/ecs-trust-policy.json /tmp/secrets-manager-policy.json /tmp/cloudwatch-logs-policy.json /tmp/ecr-policy.json

echo ""
echo "✅ IAM Roles setup completed!"
echo ""
echo "📋 Created resources:"
echo "   • CallAnalyticsECSTaskRole       - Main task role with secrets access"
echo "   • CallAnalyticsECSExecutionRole  - Execution role for ECS tasks"
echo "   • CloudWatch Log Groups          - For application logging"
echo ""
echo "🔧 Role ARNs:"
echo "   Task Role ARN:      arn:aws:iam::${AWS_ACCOUNT_ID}:role/CallAnalyticsECSTaskRole"
echo "   Execution Role ARN: arn:aws:iam::${AWS_ACCOUNT_ID}:role/CallAnalyticsECSExecutionRole"
echo ""
echo "💡 These ARNs will be used in your ECS task definitions and docker-compose.aws.yml"