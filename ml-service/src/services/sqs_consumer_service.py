import json
import time
import logging
import threading
import asyncio
import inspect
from typing import Dict, Any, Optional, Callable, List
from datetime import datetime
import boto3
from botocore.exceptions import ClientError, BotoCoreError

logger = logging.getLogger(__name__)


class SQSConsumerService:
    """
    AWS SQS Consumer Service for ML Processing
    Replaces Kafka consumer with SQS-based message consumption
    """
    
    def __init__(self, 
                 queue_url: str = None,
                 region_name: str = 'eu-west-1',
                 max_messages: int = 10,
                 visibility_timeout: int = 300,
                 wait_time_seconds: int = 20,
                 message_processor: Optional[Callable] = None):
        """
        Initialize SQS Consumer
        
        Args:
            queue_url: The SQS queue URL (default: Myque1)
            region_name: AWS region
            max_messages: Max messages to receive per poll
            visibility_timeout: Message visibility timeout in seconds
            wait_time_seconds: Long polling wait time
            message_processor: Callback function to process messages
        """
        # Default to the provided queue
        self.queue_url = queue_url or 'https://sqs.eu-west-1.amazonaws.com/320708867194/summary-pipe-queue'
        self.region_name = region_name
        self.max_messages = min(max_messages, 10)  # SQS max is 10
        self.visibility_timeout = visibility_timeout
        self.wait_time_seconds = wait_time_seconds
        self.message_processor = message_processor
        
        # Initialize SQS client
        self.sqs_client = boto3.client('sqs', region_name=self.region_name)
        
        # Consumer state
        self.is_running = False
        self.consumer_thread = None
        self.processed_count = 0
        self.failed_count = 0
        self.last_error = None
        
        logger.info(f"SQS Consumer initialized for queue: {self.queue_url}")
    
    def start(self):
        """Start consuming messages from SQS"""
        if self.is_running:
            logger.warning("Consumer is already running")
            return True
        
        try:
            self.is_running = True
            self.consumer_thread = threading.Thread(target=self._consume_loop, daemon=True)
            self.consumer_thread.start()
            logger.info("SQS Consumer started")
            
            # Give thread a moment to start and check for immediate failures
            time.sleep(0.5)
            
            if self.consumer_thread.is_alive():
                return True
            else:
                logger.error("SQS Consumer thread failed to start")
                self.is_running = False
                return False
                
        except Exception as e:
            logger.error(f"Failed to start SQS Consumer: {e}")
            self.is_running = False
            return False
    
    def stop(self):
        """Stop consuming messages"""
        if not self.is_running:
            logger.warning("Consumer is not running")
            return
        
        self.is_running = False
        if self.consumer_thread:
            self.consumer_thread.join(timeout=30)
        logger.info("SQS Consumer stopped")
    
    def _consume_loop(self):
        """Main consumption loop"""
        logger.info("Starting SQS consumption loop")
        
        while self.is_running:
            try:
                # Receive messages from SQS
                response = self.sqs_client.receive_message(
                    QueueUrl=self.queue_url,
                    MaxNumberOfMessages=self.max_messages,
                    VisibilityTimeout=self.visibility_timeout,
                    WaitTimeSeconds=self.wait_time_seconds,
                    MessageAttributeNames=['All'],
                    AttributeNames=['All']
                )
                
                messages = response.get('Messages', [])
                
                if messages:
                    logger.debug(f"Received {len(messages)} messages from SQS")
                    self._process_messages(messages)
                
            except ClientError as e:
                error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                logger.error(f"AWS Client Error: {error_code} - {e}")
                self.last_error = str(e)
                time.sleep(5)  # Wait before retrying
                
            except Exception as e:
                logger.error(f"Error in consumption loop: {e}")
                self.last_error = str(e)
                time.sleep(5)  # Wait before retrying
    
    def _process_messages(self, messages: List[Dict[str, Any]]):
        """Process a batch of messages"""
        for message in messages:
            try:
                # Extract message body
                body = json.loads(message.get('Body', '{}'))
                message_id = message.get('MessageId')
                receipt_handle = message.get('ReceiptHandle')
                
                logger.debug(f"Processing message {message_id}")
                
                # Process the message
                if self.message_processor:
                    # Check if processor is async
                    if inspect.iscoroutinefunction(self.message_processor):
                        # Run async processor in event loop
                        loop = None
                        try:
                            loop = asyncio.get_event_loop()
                        except RuntimeError:
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                        
                        result = loop.run_until_complete(self.message_processor(body))
                    else:
                        # Run sync processor
                        result = self.message_processor(body)
                    
                    if result:
                        # Delete message on successful processing
                        self.sqs_client.delete_message(
                            QueueUrl=self.queue_url,
                            ReceiptHandle=receipt_handle
                        )
                        
                        self.processed_count += 1
                        logger.info(f"Successfully processed message {message_id}")
                    else:
                        logger.warning(f"Message processor returned False for message {message_id}")
                        self.failed_count += 1
                else:
                    logger.warning("No message processor configured")
                
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse message JSON: {e}")
                self.failed_count += 1
                
            except Exception as e:
                logger.error(f"Failed to process message: {e}")
                self.failed_count += 1
                self.last_error = str(e)
    
    def send_message(self, message: Dict[str, Any], queue_url: str = None) -> Optional[str]:
        """
        Send a message to SQS queue
        
        Args:
            message: Message to send
            queue_url: Target queue URL (uses default if not specified)
            
        Returns:
            Message ID if successful, None otherwise
        """
        target_queue = queue_url or self.queue_url
        
        try:
            response = self.sqs_client.send_message(
                QueueUrl=target_queue,
                MessageBody=json.dumps(message),
                MessageAttributes={
                    'source': {
                        'StringValue': 'ml-service',
                        'DataType': 'String'
                    },
                    'timestamp': {
                        'StringValue': datetime.utcnow().isoformat(),
                        'DataType': 'String'
                    }
                }
            )
            
            message_id = response.get('MessageId')
            logger.info(f"Sent message {message_id} to queue")
            return message_id
            
        except Exception as e:
            logger.error(f"Failed to send message to SQS: {e}")
            return None
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get consumer metrics"""
        return {
            'is_running': self.is_running,
            'processed_count': self.processed_count,
            'failed_count': self.failed_count,
            'last_error': self.last_error,
            'queue_url': self.queue_url
        }
    
    def health_check(self) -> Dict[str, Any]:
        """Check consumer health"""
        try:
            # Try to get queue attributes
            response = self.sqs_client.get_queue_attributes(
                QueueUrl=self.queue_url,
                AttributeNames=['ApproximateNumberOfMessages']
            )
            
            return {
                'status': 'healthy' if self.is_running else 'stopped',
                'queue_depth': response['Attributes'].get('ApproximateNumberOfMessages', '0'),
                'metrics': self.get_metrics()
            }
            
        except Exception as e:
            return {
                'status': 'unhealthy',
                'error': str(e),
                'metrics': self.get_metrics()
            }


# Compatibility wrapper for Kafka consumer
class KafkaConsumerService(SQSConsumerService):
    """
    Compatibility wrapper to maintain Kafka consumer interface
    while using SQS backend
    """
    
    def __init__(self, 
                 bootstrap_servers: str = None,
                 group_id: str = None,
                 topics: List[str] = None,
                 **kwargs):
        """
        Initialize with Kafka-like parameters but use SQS
        
        Args:
            bootstrap_servers: Ignored (for compatibility)
            group_id: Ignored (for compatibility)
            topics: List of topics (first one used as queue name)
        """
        logger.info("Kafka consumer migrated to SQS implementation")
        
        # Map Kafka topic to SQS queue
        queue_name = topics[0] if topics else 'ml-processing-queue'
        
        # Initialize SQS consumer
        super().__init__(**kwargs)
        
        self.topics = topics or []
        self.group_id = group_id or 'ml-processing-group'
    
    def subscribe(self, topics: List[str]):
        """Compatibility method for Kafka subscribe"""
        self.topics = topics
        logger.info(f"Subscribed to topics (SQS mode): {topics}")
    
    def poll(self, timeout_ms: int = 1000) -> Dict[str, Any]:
        """Compatibility method for Kafka poll"""
        logger.warning("Poll method called - use start() for SQS consumer")
        return {}
    
    def commit(self):
        """Compatibility method for Kafka commit"""
        logger.debug("Commit not needed in SQS mode (messages auto-deleted)")
    
    def close(self):
        """Compatibility method for Kafka close"""
        self.stop()


# Example usage for ML processing
def create_ml_consumer(message_processor: Callable) -> SQSConsumerService:
    """
    Create an SQS consumer for ML processing
    
    Args:
        message_processor: Function to process messages
        
    Returns:
        Configured SQS consumer
    """
    consumer = SQSConsumerService(
        queue_url='https://sqs.eu-west-1.amazonaws.com/320708867194/summary-pipe-queue',
        region_name='eu-west-1',
        max_messages=5,  # Process 5 messages at a time
        visibility_timeout=600,  # 10 minutes for ML processing
        wait_time_seconds=20,  # Long polling
        message_processor=message_processor
    )
    
    return consumer