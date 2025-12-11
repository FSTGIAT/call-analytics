# Schema Registry with AWS Secrets Manager integration
FROM confluentinc/cp-schema-registry:7.4.0

# Install AWS CLI and jq for secrets management
USER root
RUN yum update -y && \
    yum install -y python3-pip jq --allowerasing && \
    pip3 install awscli && \
    yum clean all

# Copy entrypoint script
COPY schema-registry/entrypoint-schema-registry.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint-schema-registry.sh

# Use custom entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint-schema-registry.sh"]