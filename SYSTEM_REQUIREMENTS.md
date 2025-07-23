# System Requirements - Call Analytics AI Platform

## Required System Dependencies

The following system packages are required to run the Call Analytics AI Platform:

### Core Dependencies
- **Docker** (>= 20.10.0) - Container runtime
- **Docker Compose** (>= 2.0.0) - Multi-container orchestration
- **jq** (>= 1.6) - JSON processor for Kafka configuration scripts
- **curl** - HTTP client for health checks and API calls
- **wget** - File downloading utility

### Optional Dependencies
- **git** - Version control (for development)
- **make** - Build automation (for development)
- **nodejs** (>= 18) - For local development without Docker
- **python** (>= 3.9) - For ML service local development

## Quick Installation

### Automated Installation
Run the automated installation script:
```bash
./scripts/install-dependencies.sh
```

### Manual Installation

#### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install -y jq curl wget docker.io docker-compose-plugin
```

#### CentOS/RHEL/Fedora
```bash
sudo yum install -y jq curl wget docker docker-compose
```

#### macOS (with Homebrew)
```bash
brew install jq curl wget
# Install Docker Desktop from https://docs.docker.com/desktop/mac/
```

#### Arch Linux
```bash
sudo pacman -S jq curl wget docker docker-compose
```

## Verification

After installation, verify all dependencies:
```bash
# Check versions
jq --version
curl --version
wget --version
docker --version
docker-compose --version

# Test Docker
docker ps
```

## Platform-Specific Notes

### WSL2 (Windows Subsystem for Linux)
- Install Docker Desktop for Windows with WSL2 backend
- Run Linux commands within WSL2 environment
- Ensure Docker integration is enabled in WSL2 settings

### Memory Requirements
- **Minimum**: 8GB RAM
- **Recommended**: 16GB+ RAM for full platform with ML services
- **Storage**: 20GB+ free disk space

### Network Ports
The platform uses the following ports (ensure they're available):
- **3000** - API Server
- **5000** - ML Service
- **8080** - Frontend
- **9092** - Kafka Broker
- **9200** - OpenSearch
- **8088** - Weaviate
- **6379** - Redis
- **1521** - Oracle Database
- **8090** - Kafka UI
- **5601** - OpenSearch Dashboards (optional)

## Troubleshooting

### Common Issues

1. **jq not found error**
   ```bash
   ./scripts/install-dependencies.sh
   ```

2. **Docker permission denied**
   ```bash
   sudo usermod -aG docker $USER
   # Logout and login again
   ```

3. **Port conflicts**
   ```bash
   # Check what's using a port
   sudo netstat -tulpn | grep :9092
   
   # Stop conflicting services or change ports in docker-compose.yml
   ```

4. **Memory issues**
   ```bash
   # Check available memory
   free -h
   
   # Increase Docker memory limit in Docker Desktop settings
   ```

## Development Environment

For development, additional tools are recommended:
```bash
# Node.js development
nvm install 18
npm install -g typescript ts-node nodemon

# Python development  
pip install poetry
poetry install

# Git hooks
npm install -g husky lint-staged
```

## Next Steps

After installing system requirements:
1. Run `./scripts/install-dependencies.sh` to verify installation
2. Start Kafka services: `docker-compose up -d zookeeper kafka`
3. Create topics: `./scripts/init-kafka-topics.sh`
4. Verify setup: `./scripts/kafka-health-check.sh`
5. Build and start API: `docker-compose up -d --build api`