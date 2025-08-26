#!/bin/bash
# Complete AWS Integration Setup for Call Analytics Platform
# This script orchestrates the entire AWS integration process

set -e

echo "🚀 Complete AWS Integration Setup for Call Analytics Platform"
echo "============================================================"

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
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

log_step() {
    echo -e "${PURPLE}🔹 $1${NC}"
}

# Check if script exists and is executable
check_script() {
    local script_path="$1"
    local script_name="$2"
    
    if [[ -f "$script_path" && -x "$script_path" ]]; then
        return 0
    else
        log_error "Script not found or not executable: $script_name"
        return 1
    fi
}

# Execute script with error handling
execute_script() {
    local script_path="$1"
    local script_name="$2"
    local skip_on_error="${3:-false}"
    
    log_step "Executing: $script_name"
    
    if ! check_script "$script_path" "$script_name"; then
        if [[ "$skip_on_error" = "true" ]]; then
            log_warning "Skipping $script_name (not available)"
            return 0
        else
            return 1
        fi
    fi
    
    if "$script_path"; then
        log_success "Completed: $script_name"
    else
        local exit_code=$?
        log_error "Failed: $script_name (exit code: $exit_code)"
        if [[ "$skip_on_error" = "true" ]]; then
            log_warning "Continuing despite error..."
            return 0
        else
            return $exit_code
        fi
    fi
}

# Display welcome message
show_welcome() {
    echo ""
    echo "Welcome to the Call Analytics AWS Integration Setup!"
    echo ""
    echo "This script will:"
    echo "  1. ✨ Create AWS Secrets Manager secrets"
    echo "  2. 👤 Set up IAM roles and policies"
    echo "  3. 📝 Migrate existing environment variables"
    echo "  4. ✅ Validate the complete setup"
    echo "  5. 🧪 Test AWS connectivity and integration"
    echo ""
    echo "Prerequisites:"
    echo "  • AWS CLI installed and configured"
    echo "  • Appropriate AWS credentials set"
    echo "  • Docker installed (for optional deployment)"
    echo ""
    
    read -p "Do you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
    echo ""
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing_deps=()
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        missing_deps+=("AWS CLI")
    fi
    
    # Check jq for JSON processing
    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq (JSON processor)")
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        missing_deps+=("AWS credentials (run 'aws configure' or set environment variables)")
    fi
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing prerequisites:"
        for dep in "${missing_deps[@]}"; do
            echo "  • $dep"
        done
        echo ""
        echo "Please install missing dependencies and try again."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Show current AWS context
show_aws_context() {
    log_info "AWS Configuration:"
    
    local aws_identity
    if aws_identity=$(aws sts get-caller-identity 2>/dev/null); then
        local account_id=$(echo "$aws_identity" | jq -r '.Account')
        local user_arn=$(echo "$aws_identity" | jq -r '.Arn')
        local region=${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "eu-west-1")}
        
        echo "  📊 Account ID: $account_id"
        echo "  👤 User/Role: $user_arn"
        echo "  🌍 Region: $region"
        echo ""
        
        export AWS_REGION="$region"
        export AWS_DEFAULT_REGION="$region"
        export AWS_ACCOUNT_ID="$account_id"
    else
        log_error "Cannot retrieve AWS identity"
        exit 1
    fi
}

# Main setup process
run_setup() {
    cd "$PROJECT_DIR"
    
    echo "📂 Working directory: $PROJECT_DIR"
    echo ""
    
    # Step 1: Create AWS Secrets
    echo "🔐 Step 1: Setting up AWS Secrets Manager"
    echo "========================================"
    execute_script "$SCRIPT_DIR/setup-aws-secrets.sh" "AWS Secrets Setup"
    echo ""
    
    # Step 2: Create IAM Roles
    echo "👤 Step 2: Setting up IAM Roles and Policies"
    echo "==========================================="
    execute_script "$SCRIPT_DIR/setup-iam-roles.sh" "IAM Roles Setup"
    echo ""
    
    # Step 3: Migrate Environment Variables (optional)
    echo "📋 Step 3: Migrating Environment Variables"
    echo "========================================="
    log_info "This will read existing .env files and update AWS secrets"
    read -p "Do you want to migrate environment variables from .env files? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        execute_script "$SCRIPT_DIR/migrate-env-to-secrets.sh" "Environment Migration" true
    else
        log_warning "Skipping environment variable migration"
    fi
    echo ""
    
    # Step 4: Validate Setup
    echo "✅ Step 4: Validating AWS Configuration"
    echo "======================================"
    execute_script "$SCRIPT_DIR/validate-secrets.sh" "Configuration Validation" true
    echo ""
    
    # Step 5: Test Connectivity
    echo "🧪 Step 5: Testing AWS Connectivity"
    echo "=================================="
    execute_script "$SCRIPT_DIR/test-aws-connectivity.sh" "Connectivity Testing" true
    echo ""
}

# Show next steps
show_next_steps() {
    echo "🎉 AWS Integration Setup Complete!"
    echo "================================="
    echo ""
    echo "🔧 Next Steps:"
    echo "1. Review and update any placeholder values in AWS Secrets Manager:"
    echo "   • HuggingFace tokens"
    echo "   • Production passwords"
    echo "   • Oracle connection details"
    echo ""
    echo "2. Test the integration:"
    echo "   ./scripts/test-aws-connectivity.sh"
    echo ""
    echo "3. Deploy to AWS:"
    echo "   ./scripts/deploy-to-aws.sh"
    echo ""
    echo "4. Optional: Set up production environment:"
    echo "   • Configure VPN/Direct Connect for Oracle"
    echo "   • Set up AWS managed services (MSK, OpenSearch, ElastiCache)"
    echo "   • Create ECS cluster and services"
    echo ""
    echo "📚 Documentation:"
    echo "   • AWS configuration: ./AWS_SECRETS_CONFIG.md"
    echo "   • Production setup: ./PRODUCTION_ARCHITECTURE_2SERVER.md"
    echo ""
    echo "🔗 Useful Commands:"
    echo "   • View secrets: aws secretsmanager list-secrets"
    echo "   • Update secret: aws secretsmanager update-secret --secret-id [name] --secret-string '{\"key\":\"value\"}'"
    echo "   • Test deployment: docker-compose -f docker-compose.aws.yml up"
    echo ""
}

# Cleanup function
cleanup() {
    log_info "Cleaning up temporary files..."
    # Remove any temporary files created during setup
}

# Error handling
handle_error() {
    local exit_code=$?
    log_error "Setup failed with exit code: $exit_code"
    echo ""
    echo "🔧 Troubleshooting:"
    echo "   • Check AWS credentials: aws sts get-caller-identity"
    echo "   • Verify permissions: aws iam list-roles --query 'Roles[?contains(RoleName, \`CallAnalytics\`)].RoleName'"
    echo "   • Check secrets: aws secretsmanager list-secrets --query 'SecretList[?contains(Name, \`call-analytics\`)].Name'"
    echo "   • Review logs above for specific error messages"
    echo ""
    cleanup
    exit $exit_code
}

# Main execution
main() {
    # Set up error handling
    trap handle_error ERR
    trap cleanup EXIT
    
    # Parse command line arguments
    local auto_mode=false
    local skip_confirmations=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --auto)
                auto_mode=true
                skip_confirmations=true
                shift
                ;;
            --yes)
                skip_confirmations=true
                shift
                ;;
            --help)
                echo "Usage: $0 [OPTIONS]"
                echo "Options:"
                echo "  --auto    Run in automatic mode (skip all confirmations)"
                echo "  --yes     Skip confirmations but still show prompts"
                echo "  --help    Show this help message"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    # Show welcome message (unless in auto mode)
    if [[ "$auto_mode" != "true" ]]; then
        show_welcome
    fi
    
    # Check prerequisites
    check_prerequisites
    
    # Show AWS context
    show_aws_context
    
    # Run the setup process
    run_setup
    
    # Show next steps
    show_next_steps
    
    log_success "Setup completed successfully! 🎊"
}

# Run main function
main "$@"