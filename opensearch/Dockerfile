# OpenSearch with AWS Secrets Manager integration and Hebrew Language Support
FROM opensearchproject/opensearch:2.11.1

# Set environment variables
ENV OPENSEARCH_JAVA_OPTS="-Xms1g -Xmx3g"
ENV DISABLE_INSTALL_DEMO_CONFIG=true
ENV DISABLE_SECURITY_PLUGIN=true

# Create user with proper permissions
USER root

# Install AWS CLI and jq for secrets management
RUN yum update -y && \
    yum install -y python3-pip jq --allowerasing && \
    pip3 install awscli && \
    yum clean all

# Create necessary directories
RUN mkdir -p /usr/share/opensearch/config/custom \
    && mkdir -p /usr/share/opensearch/logs \
    && chown -R opensearch:opensearch /usr/share/opensearch/config/custom \
    && chown -R opensearch:opensearch /usr/share/opensearch/logs

# Copy custom OpenSearch configuration
COPY config/opensearch/opensearch.yml /usr/share/opensearch/config/opensearch.yml
COPY config/opensearch/index-templates.json /usr/share/opensearch/config/index-templates.json

# Create a startup script to initialize Hebrew templates
COPY opensearch/init-hebrew-templates.sh /usr/share/opensearch/bin/init-hebrew-templates.sh
RUN chmod +x /usr/share/opensearch/bin/init-hebrew-templates.sh

# Copy AWS Secrets Manager integrated entrypoint
COPY opensearch/entrypoint-opensearch.sh /usr/local/bin/

# Set proper permissions on config files while still root
RUN chown opensearch:opensearch /usr/share/opensearch/config/opensearch.yml \
    && chown opensearch:opensearch /usr/share/opensearch/config/index-templates.json \
    && chmod +x /usr/local/bin/entrypoint-opensearch.sh

# Switch back to opensearch user
USER opensearch

# Expose ports
EXPOSE 9200 9600

# Health check for Hebrew-enabled OpenSearch
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD curl -f http://localhost:9200/_cluster/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint-opensearch.sh"]