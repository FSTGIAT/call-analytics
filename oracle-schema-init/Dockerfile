# Oracle Schema Initialization Container
FROM node:18-alpine

# Install Oracle Instant Client and dependencies
RUN apk add --no-cache \
    libaio \
    libnsl \
    libc6-compat \
    curl \
    unzip \
    && rm -rf /var/cache/apk/*

# Install Oracle Instant Client
WORKDIR /opt/oracle
RUN curl -o instantclient-basic-linux.x64-21.12.0.0.0dbru.zip \
    https://download.oracle.com/otn_software/linux/instantclient/2112000/instantclient-basic-linux.x64-21.12.0.0.0dbru.zip \
    && unzip instantclient-basic-linux.x64-21.12.0.0.0dbru.zip \
    && rm instantclient-basic-linux.x64-21.12.0.0.0dbru.zip \
    && ln -s /opt/oracle/instantclient_21_12 /opt/oracle/instantclient

# Set Oracle environment variables
ENV LD_LIBRARY_PATH=/opt/oracle/instantclient:$LD_LIBRARY_PATH
ENV ORACLE_CLIENT_DIR=/opt/oracle/instantclient

# Create app directory
WORKDIR /app

# Install oracledb package
RUN npm init -y && npm install oracledb

# Copy schema files and initialization script
COPY oracle/init/01-init-schema.sql ./01-init-schema.sql
COPY oracle-schema-init/init-schema.js ./init-schema.js

# Default command
CMD ["node", "init-schema.js"]