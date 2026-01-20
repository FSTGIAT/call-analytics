"""
SQS Producer Service for ML Processing Results
Sends ML processing results back to SQS for CDC service to pick up and save to Oracle
"""
import boto3
import json
import logging
from typing import Dict, Any, Optional
from datetime import datetime
import os

# Import CloudWatch metrics service
from .cloudwatch_metrics_service import cloudwatch_metrics

logger = logging.getLogger(__name__)

class SQSProducerService:
    """Service for sending messages to SQS queues"""

    def __init__(self, queue_url: Optional[str] = None, dlq_url: Optional[str] = None):
        """
        Initialize the SQS producer service

        Args:
            queue_url: The SQS queue URL for successful ML results (defaults to environment variable)
            dlq_url: The Dead Letter Queue URL for failed messages
        """
        # Send successful ML results to the COMPLETE queue (CDC reads from here)
        self.queue_url = queue_url or os.getenv('SQS_COMPLETE_QUEUE_URL',
            'https://sqs.eu-west-1.amazonaws.com/320708867194/summary-pipe-complete')

        self.dlq_url = dlq_url or os.getenv('SQS_COMPLETE_DLQ_URL',
            'https://sqs.eu-west-1.amazonaws.com/320708867194/summary-pipe-complete-dlq')

        # Initialize SQS client
        self.sqs_client = boto3.client('sqs', region_name='eu-west-1')
        logger.info(f"SQS Producer initialized with queue URL: {self.queue_url}")
        logger.info(f"DLQ URL configured: {self.dlq_url}")

        # Metrics
        self.messages_sent = 0
        self.messages_failed = 0
        self.dlq_messages_sent = 0

    async def send_ml_result(self, ml_result: Dict[str, Any]) -> bool:
        """
        Send ML processing result back to SQS for CDC service

        Args:
            ml_result: Dictionary containing ML processing results
                - callId: The call ID
                - summary: The generated summary text
                - sentiment: Sentiment analysis results
                - classification: Classification results
                - confidence: Confidence scores
                - processing_time: Processing time in ms

        Returns:
            Boolean indicating success
        """
        try:
            # Ensure we have a call ID
            call_id = ml_result.get('callId', 'UNKNOWN')

            # Build the message for CDC service
            message_body = {
                'messageType': 'ML_PROCESSING_RESULT',  # CDC service looks for this
                'callId': call_id,
                'summary': ml_result.get('summary', ''),
                'sentiment': ml_result.get('sentiment', {
                    'overall': 'neutral',
                    'score': 0.5
                }),
                'classification': ml_result.get('classification', {
                    'primary': 'general_inquiry',
                    'all': []
                }),
                'classifications': ml_result.get('classifications', []),  # Array format
                'confidence': ml_result.get('confidence', 0.0),
                'keyPoints': ml_result.get('keyPoints', []),
                'actionItems': ml_result.get('actionItems', []),
                'processingTime': ml_result.get('processingTime', 0),
                'timestamp': datetime.utcnow().isoformat(),
                'source': 'ml-service',
                'version': '1.0',
                # New fields for CONVERSATION_SUMMARY table
                'products': ml_result.get('products', '[]'),  # JSON string for Oracle CLOB
                'customer_satisfaction': ml_result.get('customer_satisfaction', 3),  # 1-5 rating
                'unresolved_issues': ml_result.get('unresolved_issues', ''),  # Text description
                'action_items': ml_result.get('action_items', '[]'),  # JSON string for Oracle CLOB
                # Churn detection (independent of classification)
                'is_churn': ml_result.get('is_churn', False),
                'churn_confidence': ml_result.get('churn_confidence', 0.0),
            }

            # Send to SQS
            response = self.sqs_client.send_message(
                QueueUrl=self.queue_url,
                MessageBody=json.dumps(message_body, ensure_ascii=False),
                MessageAttributes={
                    'messageType': {
                        'DataType': 'String',
                        'StringValue': 'ML_PROCESSING_RESULT'
                    },
                    'callId': {
                        'DataType': 'String',
                        'StringValue': call_id
                    },
                    'source': {
                        'DataType': 'String',
                        'StringValue': 'ml-service'
                    },
                    'contentType': {
                        'DataType': 'String',
                        'StringValue': 'application/json'
                    }
                }
            )

            self.messages_sent += 1
            # === CloudWatch Metrics: SQS Message Sent ===
            cloudwatch_metrics.put_metric('SQSMessagesSent', 1)
            logger.info(f"✅ ML result sent to SQS for call {call_id}, MessageId: {response['MessageId']}")
            logger.info(f"📦 SQS message includes: products={message_body.get('products')}, "
                       f"action_items={message_body.get('action_items')}, "
                       f"customer_satisfaction={message_body.get('customer_satisfaction')}, "
                       f"unresolved_issues={message_body.get('unresolved_issues')}")
            return True

        except Exception as e:
            self.messages_failed += 1
            # === CloudWatch Metrics: SQS Message Failed ===
            cloudwatch_metrics.put_metric('SQSMessagesFailed', 1)
            logger.error(f"❌ Failed to send ML result to SQS: {e}")

            # Send to DLQ for monitoring
            await self._send_to_dlq(message_body, f"ml_result send failed: {str(e)}")

            return False

    async def send_to_opensearch_queue(self, ml_result: Dict[str, Any]) -> bool:
        """
        Send ML result for OpenSearch indexing (future implementation)

        Args:
            ml_result: ML processing results for indexing

        Returns:
            Boolean indicating success
        """
        try:
            # For now, we'll send to the same queue with different message type
            # In future, this could go to a dedicated OpenSearch queue

            call_id = ml_result.get('callId', 'UNKNOWN')

            message_body = {
                'messageType': 'opensearch_index',
                'callId': call_id,
                'indexName': 'call-summaries',
                'document': {
                    'callId': call_id,
                    'summary': ml_result.get('summary', ''),
                    'sentiment': ml_result.get('sentiment', {}),
                    'classifications': ml_result.get('classifications', []),
                    'keyPoints': ml_result.get('keyPoints', []),
                    'timestamp': datetime.utcnow().isoformat(),
                    'language': ml_result.get('language', 'hebrew')
                }
            }

            response = self.sqs_client.send_message(
                QueueUrl=self.queue_url,
                MessageBody=json.dumps(message_body, ensure_ascii=False),
                MessageAttributes={
                    'messageType': {
                        'DataType': 'String',
                        'StringValue': 'opensearch_index'
                    },
                    'callId': {
                        'DataType': 'String',
                        'StringValue': call_id
                    }
                }
            )

            logger.info(f"✅ OpenSearch index request sent for call {call_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to send OpenSearch index request: {e}")

            # Send to DLQ for monitoring
            await self._send_to_dlq(message_body, f"opensearch_index send failed: {str(e)}")

            return False

    async def send_embedding(self, call_id: str, embedding: list, summary_text: str) -> bool:
        """
        Send embedding to dedicated embedding queue for vector indexing

        Args:
            call_id: The call ID
            embedding: The 768-dimensional embedding vector from AlephBERT
            summary_text: The summary text that was embedded

        Returns:
            Boolean indicating success
        """
        # Define the embedding queue URL
        embedding_queue_url = os.getenv('SQS_EMBEDDING_QUEUE_URL',
            'https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue')

        # Initialize message_body early for error handling
        message_body = None

        try:
            # Validate embedding is a list or convert it
            if not isinstance(embedding, list):
                logger.warning(f"Embedding is not a list, type: {type(embedding)}")
                if hasattr(embedding, 'tolist'):
                    embedding = embedding.tolist()
                else:
                    embedding = list(embedding)

            embedding_dimensions = len(embedding) if embedding else 0

            message_body = {
                'messageType': 'EMBEDDING_GENERATED',
                'callId': call_id,
                'embedding': embedding,  # 768-dimensional vector
                'summaryText': summary_text,
                'model': 'alephbert',
                'embeddingDimensions': embedding_dimensions,
                'timestamp': datetime.utcnow().isoformat(),
                'source': 'ml-service',
                'version': '1.0'
            }

            # Send to the dedicated embedding queue
            response = self.sqs_client.send_message(
                QueueUrl=embedding_queue_url,
                MessageBody=json.dumps(message_body, ensure_ascii=False),
                MessageAttributes={
                    'messageType': {
                        'DataType': 'String',
                        'StringValue': 'EMBEDDING_GENERATED'
                    },
                    'callId': {
                        'DataType': 'String',
                        'StringValue': call_id
                    },
                    'source': {
                        'DataType': 'String',
                        'StringValue': 'ml-service'
                    },
                    'model': {
                        'DataType': 'String',
                        'StringValue': 'alephbert'
                    }
                }
            )

            logger.info(f"✅ Embedding sent to queue for call {call_id}, "
                       f"Dimensions: {embedding_dimensions}, MessageId: {response['MessageId']}")
            return True

        except Exception as e:
            logger.error(f"❌ Failed to send embedding to queue: {e}")

            # Send to embedding DLQ
            embedding_dlq_url = os.getenv('SQS_EMBEDDING_DLQ_URL',
                'https://sqs.eu-west-1.amazonaws.com/320708867194/embedding-pipe-queue-dlq')

            try:
                # Create a safe DLQ message even if message_body wasn't created
                dlq_message = {
                    'originalMessage': message_body if message_body else {
                        'callId': call_id,
                        'summaryText': summary_text[:100] if summary_text else '',
                        'error': 'Failed to create message body'
                    },
                    'errorReason': f"embedding send failed: {str(e)}",
                    'failedAt': datetime.utcnow().isoformat(),
                    'source': 'ml-service-embedding-producer',
                    'callId': call_id
                }

                self.sqs_client.send_message(
                    QueueUrl=embedding_dlq_url,
                    MessageBody=json.dumps(dlq_message, ensure_ascii=False)
                )
                logger.info(f"📨 Failed embedding sent to DLQ for call {call_id}")
            except Exception as dlq_error:
                logger.error(f"❌ CRITICAL: Failed to send embedding to DLQ: {dlq_error}")

            return False

    async def _send_to_dlq(self, original_message: Dict[str, Any], error_reason: str) -> bool:
        """
        Send failed message to Dead Letter Queue for monitoring

        Args:
            original_message: The original message that failed
            error_reason: Reason for failure

        Returns:
            Boolean indicating if DLQ send was successful
        """
        try:
            dlq_message = {
                'originalMessage': original_message,
                'errorReason': error_reason,
                'failedAt': datetime.utcnow().isoformat(),
                'source': 'ml-service-sqs-producer',
                'callId': original_message.get('callId', 'UNKNOWN')
            }

            response = self.sqs_client.send_message(
                QueueUrl=self.dlq_url,
                MessageBody=json.dumps(dlq_message, ensure_ascii=False),
                MessageAttributes={
                    'errorType': {
                        'DataType': 'String',
                        'StringValue': 'sqs_send_failure'
                    },
                    'callId': {
                        'DataType': 'String',
                        'StringValue': original_message.get('callId', 'UNKNOWN')
                    },
                    'failedAt': {
                        'DataType': 'String',
                        'StringValue': datetime.utcnow().isoformat()
                    }
                }
            )

            self.dlq_messages_sent += 1
            logger.info(f"📨 Failed message sent to DLQ: {response['MessageId']}")
            return True

        except Exception as dlq_error:
            logger.error(f"❌ CRITICAL: Failed to send to DLQ: {dlq_error}")
            # Can't do much if DLQ send fails - just log it
            return False

    def get_metrics(self) -> Dict[str, Any]:
        """Get producer metrics"""
        return {
            'messages_sent': self.messages_sent,
            'messages_failed': self.messages_failed,
            'dlq_messages_sent': self.dlq_messages_sent,
            'queue_url': self.queue_url,
            'dlq_url': self.dlq_url
        }

    def health_check(self) -> Dict[str, Any]:
        """Check health of SQS producer"""
        try:
            # Try to get queue attributes as a health check
            response = self.sqs_client.get_queue_attributes(
                QueueUrl=self.queue_url,
                AttributeNames=['ApproximateNumberOfMessages']
            )

            return {
                'status': 'healthy',
                'queue_url': self.queue_url,
                'metrics': self.get_metrics(),
                'queue_messages': response['Attributes'].get('ApproximateNumberOfMessages', 0)
            }
        except Exception as e:
            logger.error(f"SQS Producer health check failed: {e}")
            return {
                'status': 'unhealthy',
                'error': str(e),
                'metrics': self.get_metrics()
            }

# Create singleton instance
_sqs_producer_instance = None

def get_sqs_producer() -> SQSProducerService:
    """Get or create the SQS producer singleton"""
    global _sqs_producer_instance
    if _sqs_producer_instance is None:
        _sqs_producer_instance = SQSProducerService()
    return _sqs_producer_instance