FROM node:18-alpine

WORKDIR /app

# Install dependencies for Oracle client
RUN apk add --no-cache \
    libaio \
    libnsl \
    libc6-compat \
    wget \
    unzip \
    && (ln -s /lib/libc.musl-x86_64.so.1 /lib/ld-linux-x86-64.so.2 || true)

# Download and install Oracle Instant Client
ENV ORACLE_CLIENT_VERSION=21.12.0.0.0
RUN mkdir -p /opt/oracle \
    && cd /opt/oracle \
    && wget https://download.oracle.com/otn_software/linux/instantclient/2112000/instantclient-basic-linux.x64-21.12.0.0.0dbru.zip \
    && unzip instantclient-basic-linux.x64-21.12.0.0.0dbru.zip \
    && rm instantclient-basic-linux.x64-21.12.0.0.0dbru.zip \
    && mv instantclient_21_12 instantclient

# Set Oracle environment variables
ENV ORACLE_CLIENT_DIR=/opt/oracle/instantclient
ENV LD_LIBRARY_PATH=/opt/oracle/instantclient:${LD_LIBRARY_PATH}
ENV PATH=/opt/oracle/instantclient:${PATH}

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies for building)
RUN npm install

# Copy application files
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Create logs directory
RUN mkdir -p /app/logs

# Expose port
EXPOSE 3000

# Start the application with migration
CMD ["node", "dist/scripts/startup.js"]