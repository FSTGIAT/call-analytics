#!/bin/bash

# Production Setup Script for Call Analytics AI Platform
# This script helps prepare the environment for production deployment

set -e

echo "==================================="
echo "Call Analytics AI Platform"
echo "Production Setup Script"
echo "==================================="

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo "This script should not be run as root for security reasons."
   exit 1
fi

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "Checking prerequisites..."
MISSING_DEPS=()

if ! command_exists docker; then
    MISSING_DEPS+=("docker")
fi

if ! command_exists docker-compose; then
    MISSING_DEPS+=("docker-compose")
fi

if ! command_exists openssl; then
    MISSING_DEPS+=("openssl")
fi

if [ ${#MISSING_DEPS[@]} -ne 0 ]; then
    echo "Missing dependencies: ${MISSING_DEPS[*]}"
    echo "Please install the missing dependencies and run this script again."
    exit 1
fi

# Create necessary directories
echo "Creating directory structure..."
mkdir -p config/production
mkdir -p config/ssl
mkdir -p scripts/backup
mkdir -p logs
mkdir -p data/oracle
mkdir -p data/redis
mkdir -p data/opensearch
mkdir -p data/weaviate

# Generate SSL certificates for local development
if [ ! -f config/ssl/server.key ]; then
    echo "Generating SSL certificates..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout config/ssl/server.key \
        -out config/ssl/server.crt \
        -subj "/C=US/ST=State/L=City/O=CallAnalytics/CN=localhost"
fi

# Create .env file from template if it doesn't exist
if [ ! -f .env ]; then
    if [ -f config/.env.example ]; then
        echo "Creating .env file from template..."
        cp config/.env.example .env
        echo "IMPORTANT: Please edit .env file and add your configuration values"
    else
        echo "ERROR: config/.env.example not found"
        exit 1
    fi
fi

# Generate secure passwords if not set
echo "Checking for secure passwords..."
if grep -q "your_secure_password_here" .env; then
    echo "Generating secure passwords..."
    
    # Generate random passwords
    ORACLE_PWD=$(openssl rand -base64 32)
    REDIS_PWD=$(openssl rand -base64 32)
    OPENSEARCH_PWD=$(openssl rand -base64 32)
    JWT_SECRET=$(openssl rand -base64 64)
    API_KEY_SECRET=$(openssl rand -base64 32)
    
    # Update .env file (backup first)
    cp .env .env.backup
    
    # Replace placeholders
    sed -i "s/your_secure_password_here/$ORACLE_PWD/g" .env
    sed -i "s/your-redis-password-here/$REDIS_PWD/g" .env
    sed -i "s/your-opensearch-password-here/$OPENSEARCH_PWD/g" .env
    sed -i "s/your-very-long-random-jwt-secret-key-here/$JWT_SECRET/g" .env
    sed -i "s/your-api-key-secret-here/$API_KEY_SECRET/g" .env
    
    echo "Passwords generated and saved to .env file"
    echo "Backup of original .env saved as .env.backup"
fi

# Create docker-compose override for production
cat > docker-compose.prod.yml <<EOF
version: '3.8'

services:
  api:
    restart: always
    environment:
      - NODE_ENV=production
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  frontend:
    restart: always
    environment:
      - NODE_ENV=production
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  oracle:
    restart: always
    volumes:
      - ./data/oracle:/opt/oracle/oradata
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  redis:
    restart: always
    command: redis-server --requirepass \${REDIS_PASSWORD}
    volumes:
      - ./data/redis:/data
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  opensearch:
    restart: always
    environment:
      - plugins.security.disabled=false
      - OPENSEARCH_INITIAL_ADMIN_PASSWORD=\${OPENSEARCH_PASSWORD}
    volumes:
      - ./data/opensearch:/usr/share/opensearch/data
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  weaviate:
    restart: always
    volumes:
      - ./data/weaviate:/var/lib/weaviate
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./config/production/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./config/ssl:/etc/nginx/ssl:ro
    depends_on:
      - api
      - frontend
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
EOF

# Create nginx configuration
cat > config/production/nginx.conf <<EOF
events {
    worker_connections 1024;
}

http {
    upstream api {
        server api:3000;
    }

    upstream frontend {
        server frontend:8080;
    }

    server {
        listen 80;
        server_name localhost;
        return 301 https://\$server_name\$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name localhost;

        ssl_certificate /etc/nginx/ssl/server.crt;
        ssl_certificate_key /etc/nginx/ssl/server.key;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        # Frontend
        location / {
            proxy_pass http://frontend;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        # API
        location /api/ {
            proxy_pass http://api;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        # WebSocket support
        location /ws {
            proxy_pass http://api;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
EOF

# Create backup script
cat > scripts/backup/backup-all.sh <<EOF
#!/bin/bash
# Backup script for Call Analytics AI Platform

set -e

BACKUP_DIR="/backups/\$(date +%Y%m%d_%H%M%S)"
mkdir -p "\$BACKUP_DIR"

echo "Starting backup to \$BACKUP_DIR"

# Backup Oracle
echo "Backing up Oracle database..."
docker exec oracle rman target / <<RMAN
BACKUP DATABASE PLUS ARCHIVELOG;
RMAN

# Backup Redis
echo "Backing up Redis..."
docker exec redis redis-cli --rdb "\$BACKUP_DIR/redis.rdb" BGSAVE

# Backup OpenSearch
echo "Backing up OpenSearch..."
# Add OpenSearch snapshot commands here

# Backup application data
echo "Backing up application data..."
tar -czf "\$BACKUP_DIR/app-data.tar.gz" data/

echo "Backup completed successfully"
EOF

chmod +x scripts/backup/backup-all.sh

# Create health check script
cat > scripts/health-check.sh <<EOF
#!/bin/bash
# Health check script for all services

echo "Checking service health..."

# Check API
API_HEALTH=\$(curl -s http://localhost:3000/api/v1/health | jq -r '.status')
echo "API: \$API_HEALTH"

# Check Redis
REDIS_HEALTH=\$(docker exec redis redis-cli ping)
echo "Redis: \$REDIS_HEALTH"

# Check Oracle
ORACLE_HEALTH=\$(docker exec oracle sqlplus -s / as sysdba <<SQL
SET HEADING OFF
SELECT 'HEALTHY' FROM dual;
EXIT;
SQL
)
echo "Oracle: \$ORACLE_HEALTH"

# Check OpenSearch
OPENSEARCH_HEALTH=\$(curl -s http://localhost:9200/_cluster/health | jq -r '.status')
echo "OpenSearch: \$OPENSEARCH_HEALTH"
EOF

chmod +x scripts/health-check.sh

echo ""
echo "==================================="
echo "Production setup completed!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Edit .env file with your production values"
echo "2. Review docker-compose.prod.yml"
echo "3. Review nginx configuration in config/production/nginx.conf"
echo "4. Run: docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
echo "5. Set up monitoring and alerting"
echo "6. Configure automated backups"
echo "7. Run security audit"
echo ""
echo "IMPORTANT: Keep your .env file secure and never commit it to git!"