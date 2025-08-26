#!/bin/bash
# Test AWS connectivity and service integration for Call Analytics Platform

set -e

echo "🧪 Testing AWS Connectivity for Call Analytics Platform"

# Configuration
AWS_REGION=${AWS_REGION:-eu-west-1}

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

# Test results tracking
declare -a test_results
total_tests=0
passed_tests=0

# Function to record test result
record_test() {
    local test_name="$1"
    local result="$2"
    local details="$3"
    
    ((total_tests++))
    
    if [[ "$result" = "PASS" ]]; then
        ((passed_tests++))
        log_success "$test_name: PASSED"
        [[ -n "$details" ]] && echo "    $details"
    else
        log_error "$test_name: FAILED"
        [[ -n "$details" ]] && echo "    $details"
    fi
    
    test_results+=("$test_name: $result")
}

# Test AWS credentials
test_aws_credentials() {
    log_info "Testing AWS credentials..."
    
    if aws_identity=$(aws sts get-caller-identity 2>&1); then
        local account_id=$(echo "$aws_identity" | jq -r '.Account' 2>/dev/null || echo "Unknown")
        local user_arn=$(echo "$aws_identity" | jq -r '.Arn' 2>/dev/null || echo "Unknown")
        record_test "AWS Credentials" "PASS" "Account: $account_id, User: $user_arn"
    else
        record_test "AWS Credentials" "FAIL" "Unable to retrieve AWS identity: $aws_identity"
    fi
}

# Test Secrets Manager access
test_secrets_manager() {
    log_info "Testing Secrets Manager access..."
    
    local secrets=("prod/call-analytics/oracle" "prod/call-analytics/redis" "prod/call-analytics/jwt" "prod/call-analytics/ml-service" "prod/call-analytics/opensearch" "prod/call-analytics/kafka")
    local failed_secrets=()
    local success_count=0
    
    for secret in "${secrets[@]}"; do
        if aws secretsmanager describe-secret --secret-id "$secret" --region "$AWS_REGION" &> /dev/null; then
            ((success_count++))
        else
            failed_secrets+=("$secret")
        fi
    done
    
    if [[ $success_count -eq ${#secrets[@]} ]]; then
        record_test "Secrets Manager Access" "PASS" "All ${#secrets[@]} secrets accessible"
    else
        record_test "Secrets Manager Access" "FAIL" "Missing secrets: ${failed_secrets[*]}"
    fi
}

# Test secret content validation
test_secret_content() {
    log_info "Testing secret content validation..."
    
    local validation_errors=()
    
    # Test Oracle secret structure
    if oracle_secret=$(aws secretsmanager get-secret-value --secret-id "prod/call-analytics/oracle" --query SecretString --output text 2>/dev/null); then
        if echo "$oracle_secret" | jq -e '.username, .password, .host, .port, .service_name' &> /dev/null; then
            log_info "  Oracle secret structure: OK"
        else
            validation_errors+=("Oracle secret missing required fields")
        fi
    else
        validation_errors+=("Cannot retrieve Oracle secret")
    fi
    
    # Test ML service secret structure
    if ml_secret=$(aws secretsmanager get-secret-value --secret-id "prod/call-analytics/ml-service" --query SecretString --output text 2>/dev/null); then
        if echo "$ml_secret" | jq -e '.hf_token' &> /dev/null; then
            local hf_token=$(echo "$ml_secret" | jq -r '.hf_token')
            if [[ "$hf_token" = "YOUR_HUGGINGFACE_TOKEN_HERE" ]]; then
                validation_errors+=("HuggingFace token is placeholder value")
            else
                log_info "  ML service secret structure: OK"
            fi
        else
            validation_errors+=("ML secret missing HuggingFace token")
        fi
    else
        validation_errors+=("Cannot retrieve ML service secret")
    fi
    
    if [[ ${#validation_errors[@]} -eq 0 ]]; then
        record_test "Secret Content Validation" "PASS" "All secrets have valid content"
    else
        record_test "Secret Content Validation" "FAIL" "${validation_errors[*]}"
    fi
}

# Test IAM permissions
test_iam_permissions() {
    log_info "Testing IAM permissions..."
    
    local permission_errors=()
    
    # Test Secrets Manager permissions
    if aws secretsmanager list-secrets --max-items 1 &> /dev/null; then
        log_info "  Secrets Manager list permission: OK"
    else
        permission_errors+=("Cannot list secrets")
    fi
    
    # Test ECR permissions
    if aws ecr describe-repositories --max-items 1 &> /dev/null; then
        log_info "  ECR describe permission: OK"
    else
        permission_errors+=("Cannot describe ECR repositories")
    fi
    
    # Test CloudWatch Logs permissions
    if aws logs describe-log-groups --max-items 1 &> /dev/null; then
        log_info "  CloudWatch Logs permission: OK"
    else
        permission_errors+=("Cannot describe log groups")
    fi
    
    if [[ ${#permission_errors[@]} -eq 0 ]]; then
        record_test "IAM Permissions" "PASS" "All required permissions available"
    else
        record_test "IAM Permissions" "FAIL" "${permission_errors[*]}"
    fi
}

# Test ECR repositories
test_ecr_repositories() {
    log_info "Testing ECR repositories..."
    
    local services=("api" "ml-service" "frontend")
    local missing_repos=()
    local existing_count=0
    
    for service in "${services[@]}"; do
        local repo_name="call-analytics-${service}"
        if aws ecr describe-repositories --repository-names "$repo_name" --region "$AWS_REGION" &> /dev/null; then
            ((existing_count++))
            log_info "  Repository exists: $repo_name"
        else
            missing_repos+=("$repo_name")
        fi
    done
    
    if [[ $existing_count -eq ${#services[@]} ]]; then
        record_test "ECR Repositories" "PASS" "All ${#services[@]} repositories exist"
    else
        record_test "ECR Repositories" "FAIL" "Missing repositories: ${missing_repos[*]}"
    fi
}

# Test Oracle connectivity (if possible)
test_oracle_connectivity() {
    log_info "Testing Oracle connectivity..."
    
    # This would require the Oracle client and network access
    # For now, we'll just validate the connection string format
    if oracle_secret=$(aws secretsmanager get-secret-value --secret-id "prod/call-analytics/oracle" --query SecretString --output text 2>/dev/null); then
        local host=$(echo "$oracle_secret" | jq -r '.host')
        local port=$(echo "$oracle_secret" | jq -r '.port')
        local service=$(echo "$oracle_secret" | jq -r '.service_name')
        
        if [[ "$host" != "null" && "$port" != "null" && "$service" != "null" ]]; then
            # Test if host is resolvable (basic connectivity test)
            if timeout 5 bash -c "cat < /dev/null > /dev/tcp/$host/$port" 2>/dev/null; then
                record_test "Oracle Connectivity" "PASS" "Can connect to $host:$port"
            else
                record_test "Oracle Connectivity" "FAIL" "Cannot connect to $host:$port (network/firewall)"
            fi
        else
            record_test "Oracle Connectivity" "FAIL" "Invalid Oracle configuration"
        fi
    else
        record_test "Oracle Connectivity" "FAIL" "Cannot retrieve Oracle configuration"
    fi
}

# Test application endpoints
test_application_endpoints() {
    log_info "Testing application endpoints..."
    
    local endpoints=(
        "http://localhost:3000/api/v1/health:API Health"
        "http://localhost:5000/health:ML Service Health"
        "http://localhost:8080/:Frontend"
    )
    
    local endpoint_results=()
    
    for endpoint_info in "${endpoints[@]}"; do
        local endpoint=$(echo "$endpoint_info" | cut -d':' -f1)
        local name=$(echo "$endpoint_info" | cut -d':' -f2)
        
        if curl -f -s "$endpoint" -m 10 &> /dev/null; then
            endpoint_results+=("$name: OK")
            log_info "  $name: Responding"
        else
            endpoint_results+=("$name: FAIL")
            log_warning "  $name: Not responding (service may not be running)"
        fi
    done
    
    # This test is informational - services might not be running
    record_test "Application Endpoints" "INFO" "${endpoint_results[*]}"
}

# Test AWS managed services connectivity
test_aws_services() {
    log_info "Testing AWS managed services connectivity..."
    
    local service_tests=()
    
    # Test if we can reach AWS services
    local services_to_test=(
        "secretsmanager.${AWS_REGION}.amazonaws.com:Secrets Manager"
        "ecr.${AWS_REGION}.amazonaws.com:ECR"
        "logs.${AWS_REGION}.amazonaws.com:CloudWatch Logs"
    )
    
    for service_info in "${services_to_test[@]}"; do
        local endpoint=$(echo "$service_info" | cut -d':' -f1)
        local name=$(echo "$service_info" | cut -d':' -f2)
        
        if timeout 5 bash -c "cat < /dev/null > /dev/tcp/$endpoint/443" 2>/dev/null; then
            service_tests+=("$name: OK")
        else
            service_tests+=("$name: FAIL")
        fi
    done
    
    record_test "AWS Services Connectivity" "INFO" "${service_tests[*]}"
}

# Generate detailed report
generate_report() {
    echo ""
    echo "📊 Test Report"
    echo "=============="
    echo "Total Tests: $total_tests"
    echo "Passed: $passed_tests"
    echo "Failed: $((total_tests - passed_tests))"
    echo "Success Rate: $(( (passed_tests * 100) / total_tests ))%"
    echo ""
    
    echo "📋 Detailed Results:"
    echo "==================="
    for result in "${test_results[@]}"; do
        echo "  $result"
    done
    echo ""
    
    if [[ $passed_tests -eq $total_tests ]]; then
        log_success "🎉 All tests passed! AWS integration is ready."
        return 0
    else
        log_warning "⚠️  Some tests failed. Review the issues above before proceeding."
        echo ""
        echo "🔧 Common Solutions:"
        echo "   • Run setup-aws-secrets.sh to create missing secrets"
        echo "   • Run setup-iam-roles.sh to create missing IAM roles"
        echo "   • Update placeholder values in secrets"
        echo "   • Check AWS credentials and permissions"
        echo "   • Verify network connectivity"
        return 1
    fi
}

# Main execution
main() {
    echo "🌍 AWS Region: $AWS_REGION"
    echo "📅 Test Date: $(date)"
    echo ""
    
    # Run all tests
    test_aws_credentials
    test_secrets_manager
    test_secret_content
    test_iam_permissions
    test_ecr_repositories
    test_oracle_connectivity
    test_application_endpoints
    test_aws_services
    
    # Generate final report
    generate_report
}

# Run main function
main "$@"