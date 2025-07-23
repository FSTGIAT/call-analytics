#!/bin/bash

echo "Setting up environment configuration files..."

# Change to config directory
cd ../config

# Copy all template files
for template in *.template; do
    if [ -f "$template" ]; then
        env_file="${template%.template}"
        if [ ! -f "$env_file" ]; then
            cp "$template" "$env_file"
            echo "Created $env_file from template"
        else
            echo "$env_file already exists, skipping..."
        fi
    fi
done

echo ""
echo "Environment files created. Please edit the following files with your configuration:"
echo "  - config/.env.api"
echo "  - config/.env.oracle"
echo "  - config/.env.ml"
echo "  - config/.env.aws"
echo "  - config/.env.search"
echo "  - config/.env.frontend"
echo ""
echo "Remember: Never commit .env files to version control!"