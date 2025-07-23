#!/bin/bash

# System Dependencies Installation Script for Call Analytics AI Platform
# This script installs required system packages for the platform

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get >/dev/null 2>&1; then
            OS="debian"
        elif command -v yum >/dev/null 2>&1; then
            OS="rhel"
        elif command -v pacman >/dev/null 2>&1; then
            OS="arch"
        else
            OS="unknown"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    else
        OS="unknown"
    fi
    
    log "Detected operating system: $OS"
}

# Install packages based on OS
install_packages() {
    local packages=("$@")
    
    case "$OS" in
        "debian")
            log "Installing packages with apt-get..."
            sudo apt-get update
            sudo apt-get install -y "${packages[@]}"
            ;;
        "rhel")
            log "Installing packages with yum..."
            sudo yum install -y "${packages[@]}"
            ;;
        "arch")
            log "Installing packages with pacman..."
            sudo pacman -S --noconfirm "${packages[@]}"
            ;;
        "macos")
            if command -v brew >/dev/null 2>&1; then
                log "Installing packages with brew..."
                brew install "${packages[@]}"
            else
                error "Homebrew not found. Please install Homebrew first: https://brew.sh/"
                exit 1
            fi
            ;;
        *)
            error "Unsupported operating system: $OSTYPE"
            error "Please install the following packages manually: ${packages[*]}"
            exit 1
            ;;
    esac
}

# Check if package is installed
is_installed() {
    command -v "$1" >/dev/null 2>&1
}

# Install required system dependencies
install_system_dependencies() {
    log "Installing system dependencies for Call Analytics AI Platform..."
    
    local required_packages=()
    
    # Check and add missing packages
    if ! is_installed "jq"; then
        log "jq not found, will install"
        required_packages+=("jq")
    else
        success "jq is already installed"
    fi
    
    if ! is_installed "curl"; then
        log "curl not found, will install"
        required_packages+=("curl")
    else
        success "curl is already installed"
    fi
    
    if ! is_installed "wget"; then
        log "wget not found, will install"
        required_packages+=("wget")
    else
        success "wget is already installed"
    fi
    
    if ! is_installed "docker"; then
        warning "Docker not found. Please install Docker manually: https://docs.docker.com/get-docker/"
    else
        success "Docker is installed"
    fi
    
    if ! command -v docker-compose >/dev/null 2>&1; then
        warning "Docker Compose not found. Please install Docker Compose manually: https://docs.docker.com/compose/install/"
    else
        success "Docker Compose is installed"
    fi
    
    # Install missing packages
    if [ ${#required_packages[@]} -gt 0 ]; then
        log "Installing missing packages: ${required_packages[*]}"
        install_packages "${required_packages[@]}"
        success "System dependencies installed successfully"
    else
        success "All required system dependencies are already installed"
    fi
}

# Verify installations
verify_installations() {
    log "Verifying installations..."
    
    local all_good=true
    
    if is_installed "jq"; then
        success "jq: $(jq --version)"
    else
        error "jq installation failed"
        all_good=false
    fi
    
    if is_installed "curl"; then
        success "curl: $(curl --version | head -1)"
    else
        error "curl installation failed"
        all_good=false
    fi
    
    if is_installed "wget"; then
        success "wget: $(wget --version | head -1)"
    else
        error "wget installation failed"
        all_good=false
    fi
    
    if $all_good; then
        success "All dependencies verified successfully!"
    else
        error "Some dependencies failed to install"
        exit 1
    fi
}

# Main execution
main() {
    log "Starting system dependencies installation..."
    
    detect_os
    install_system_dependencies
    verify_installations
    
    success "System dependencies installation completed!"
    log "You can now run Kafka setup scripts without issues"
}

# Run main function
main "$@"