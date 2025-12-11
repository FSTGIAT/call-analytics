# Zookeeper with AWS Secrets Manager integration
FROM confluentinc/cp-zookeeper:7.4.0

# Install AWS CLI and jq for secrets management
USER root
RUN yum update -y && \
    yum install -y python3-pip jq git && \
    pip3 install --upgrade pip setuptools && \
    pip3 install awscli importlib-metadata && \
    mkdir -p /tmp/confluent-docker-utils && \
    cd /tmp/confluent-docker-utils && \
    echo 'from setuptools import setup, find_packages' > setup.py && \
    echo 'setup(' >> setup.py && \
    echo '    name="confluent-docker-utils",' >> setup.py && \
    echo '    version="0.0.59",' >> setup.py && \
    echo '    packages=find_packages(),' >> setup.py && \
    echo '    entry_points={' >> setup.py && \
    echo '        "console_scripts": [' >> setup.py && \
    echo '            "dub=confluent.docker.utils:main",' >> setup.py && \
    echo '            "cub=confluent.docker.utils:main",' >> setup.py && \
    echo '        ]' >> setup.py && \
    echo '    }' >> setup.py && \
    echo ')' >> setup.py && \
    mkdir -p confluent/docker && \
    echo 'def main(): pass' > confluent/docker/utils.py && \
    touch confluent/__init__.py && \
    touch confluent/docker/__init__.py && \
    pip3 install . && \
    cd / && rm -rf /tmp/confluent-docker-utils && \
    yum clean all

# Copy entrypoint script
COPY entrypoint-zookeeper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint-zookeeper.sh

# Use custom entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint-zookeeper.sh"]