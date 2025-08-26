#!/bin/bash
# AWS-aware entrypoint for Call Analytics Frontend

set -e

echo "🚀 Starting Call Analytics Frontend (AWS Mode)"

# Function to get secret from AWS Secrets Manager
get_secret() {
    local secret_name=$1
    local json_key=${2:-""}
    
    if [[ -z "$secret_name" ]]; then
        echo ""
        return 1
    fi
    
    local secret_value
    secret_value=$(aws secretsmanager get-secret-value \
        --secret-id "$secret_name" \
        --query SecretString \
        --output text 2>/dev/null) || {
        echo ""
        return 1
    }
    
    if [[ -n "$json_key" ]]; then
        echo "$secret_value" | jq -r ".$json_key" 2>/dev/null || echo ""
    else
        echo "$secret_value"
    fi
}

# Configure runtime environment
echo "🔧 Configuring runtime environment..."

# Set default API URLs if not provided at build time
API_URL=${VUE_APP_API_URL:-"https://api.call-analytics.your-domain.com"}
WS_URL=${VUE_APP_WS_URL:-"wss://api.call-analytics.your-domain.com"}

# Only fetch secrets if running in AWS and not ECS (ECS injects secrets)
if [[ -z "$ECS_CONTAINER_METADATA_URI_V4" ]] && command -v aws >/dev/null 2>&1; then
    echo "📡 Checking for AWS configuration updates..."
    
    # Test AWS connectivity
    if aws sts get-caller-identity >/dev/null 2>&1; then
        echo "✅ AWS credentials validated"
        
        # Note: Frontend typically doesn't need secrets, but we can fetch
        # any configuration that might be needed for runtime updates
        echo "ℹ️  AWS secrets available if needed for runtime configuration"
    else
        echo "ℹ️  AWS credentials not available, using build-time configuration"
    fi
else
    if [[ -n "$ECS_CONTAINER_METADATA_URI_V4" ]]; then
        echo "🐳 Running in ECS - using container configuration"
    else
        echo "🏠 Running locally - using build-time configuration"
    fi
fi

# Create runtime configuration file for dynamic API endpoints
echo "📝 Creating runtime configuration..."

cat > /usr/share/nginx/html/config.js <<EOF
// Runtime configuration for Call Analytics Frontend
window.APP_CONFIG = {
  API_URL: '${API_URL}',
  WS_URL: '${WS_URL}',
  ENVIRONMENT: '${VUE_APP_ENVIRONMENT:-production}',
  BUILD_TIME: '$(date -Iseconds)',
  VERSION: '1.0.0'
};

console.log('Frontend configuration loaded:', window.APP_CONFIG);
EOF

# Update nginx configuration with proper headers
cat > /tmp/nginx_headers.conf <<EOF
# Security headers
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# CORS headers for API communication
add_header Access-Control-Allow-Origin "*" always;
add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
add_header Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization" always;

# Cache control
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

location /config.js {
    expires epoch;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
EOF

# Update index.html to include runtime configuration
if [[ -f "/usr/share/nginx/html/index.html" ]]; then
    # Add config.js script to head section if not already present
    if ! grep -q "config.js" /usr/share/nginx/html/index.html; then
        sed -i 's|</head>|  <script src="./config.js"></script>\n  </head>|' /usr/share/nginx/html/index.html
        echo "✅ Added runtime configuration script to index.html"
    fi
fi

# Log startup information
echo "🌍 Environment: ${VUE_APP_ENVIRONMENT:-production}"
echo "🌐 API URL: $API_URL"
echo "🔌 WebSocket URL: $WS_URL"
echo "🏠 Document Root: /usr/share/nginx/html"

# Show nginx configuration
echo "📋 Nginx configuration:"
nginx -t

echo "⚡ Starting Nginx..."
exec "$@"