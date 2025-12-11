"""
CloudWatch Metrics Service for ML Pipeline Monitoring
Uses Embedded Metric Format (EMF) to send metrics through CloudWatch Logs.

This approach works in private subnets with only a CloudWatch Logs VPC endpoint,
without needing a separate CloudWatch Monitoring endpoint.

Phase 1 Metrics:
- CallsProcessed, CallsSuccessful, CallsFailed
- ProcessingTime, LLMProcessingTime, TokenUsagePercent
- SentimentPositive, SentimentNegative, SentimentNeutral
- JSONParseErrors, SQSMessagesSent, SQSMessagesFailed
"""

import os
import json
import time
import threading
from datetime import datetime
from typing import Dict, List, Optional
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)

# EMF logger - separate from main logger to avoid interference
emf_logger = logging.getLogger('aws_emf')
emf_logger.setLevel(logging.INFO)


class CloudWatchMetricsService:
    """
    Singleton service for emitting CloudWatch metrics via EMF.
    Uses CloudWatch Logs (Embedded Metric Format) instead of direct put_metric_data API.
    This works through the existing logs VPC endpoint.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self.enabled = os.getenv('ENABLE_CLOUDWATCH_METRICS', 'true').lower() == 'true'
        self.namespace = os.getenv('CLOUDWATCH_NAMESPACE', 'CallAnalytics/MLService')
        self.environment = os.getenv('ENVIRONMENT', 'prod')
        self.flush_interval = int(os.getenv('METRICS_FLUSH_INTERVAL', '60'))

        # Metric buffer for batching
        self._metrics_buffer: Dict[str, List[Dict]] = defaultdict(list)
        self._buffer_lock = threading.Lock()

        # Statistics aggregation for health endpoint
        self._stats = defaultdict(lambda: {'sum': 0, 'count': 0, 'min': float('inf'), 'max': float('-inf')})
        self._total_emitted = 0

        if self.enabled:
            self._start_flush_thread()
            logger.info(f"CloudWatch EMF metrics enabled: namespace={self.namespace}, env={self.environment}")
            logger.info("Using Embedded Metric Format (EMF) via CloudWatch Logs - no monitoring endpoint needed")
        else:
            logger.info("CloudWatch metrics disabled (ENABLE_CLOUDWATCH_METRICS != true)")

        self._initialized = True

    def put_metric(
        self,
        metric_name: str,
        value: float,
        unit: str = 'Count',
        dimensions: Optional[Dict[str, str]] = None
    ):
        """
        Add a metric to the buffer for batched EMF emission.

        Args:
            metric_name: Name of the metric (e.g., 'CallsProcessed')
            value: Metric value
            unit: CloudWatch unit ('Count', 'Milliseconds', 'Percent', 'Bytes')
            dimensions: Optional extra dimensions for filtering
        """
        if not self.enabled:
            return

        with self._buffer_lock:
            # Store metric with its unit
            self._metrics_buffer[metric_name].append({
                'value': value,
                'unit': unit,
                'timestamp': datetime.utcnow().isoformat(),
                'dimensions': dimensions or {}
            })

            # Update statistics for health endpoint
            self._stats[metric_name]['sum'] += value
            self._stats[metric_name]['count'] += 1
            self._stats[metric_name]['min'] = min(self._stats[metric_name]['min'], value)
            self._stats[metric_name]['max'] = max(self._stats[metric_name]['max'], value)

    def put_metric_immediate(
        self,
        metric_name: str,
        value: float,
        unit: str = 'Count',
        dimensions: Optional[Dict[str, str]] = None
    ):
        """Send a metric immediately via EMF (for critical metrics that can't wait)."""
        if not self.enabled:
            return

        self._emit_emf_log(metric_name, value, unit, dimensions)

    def _build_emf_log(self, metrics_batch: Dict[str, List[Dict]]) -> str:
        """
        Build an EMF-formatted log line for CloudWatch.

        EMF format allows CloudWatch to automatically extract metrics from log entries.
        Reference: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
        """
        # Aggregate metrics by name
        metric_definitions = []
        metric_values = {}

        for metric_name, entries in metrics_batch.items():
            if not entries:
                continue

            # Get the unit from first entry (assume consistent units per metric)
            unit = entries[0]['unit']

            # For Count metrics, sum them up
            # For timing metrics, use average
            if unit == 'Count':
                total = sum(e['value'] for e in entries)
                metric_values[metric_name] = total
            else:
                # For Milliseconds, Percent - use average
                avg = sum(e['value'] for e in entries) / len(entries)
                metric_values[metric_name] = round(avg, 2)

            metric_definitions.append({
                'Name': metric_name,
                'Unit': unit
            })

        if not metric_definitions:
            return None

        # Build EMF structure
        emf_log = {
            '_aws': {
                'Timestamp': int(datetime.utcnow().timestamp() * 1000),
                'CloudWatchMetrics': [
                    {
                        'Namespace': self.namespace,
                        'Dimensions': [['Environment']],
                        'Metrics': metric_definitions
                    }
                ]
            },
            'Environment': self.environment,
            **metric_values
        }

        return json.dumps(emf_log)

    def _emit_emf_log(self, metric_name: str, value: float, unit: str, dimensions: Optional[Dict[str, str]] = None):
        """Emit a single metric via EMF log format."""
        emf_log = {
            '_aws': {
                'Timestamp': int(datetime.utcnow().timestamp() * 1000),
                'CloudWatchMetrics': [
                    {
                        'Namespace': self.namespace,
                        'Dimensions': [['Environment']],
                        'Metrics': [{'Name': metric_name, 'Unit': unit}]
                    }
                ]
            },
            'Environment': self.environment,
            metric_name: value
        }

        # Print to stdout - CloudWatch Logs picks this up automatically
        print(json.dumps(emf_log), flush=True)
        self._total_emitted += 1

    def _start_flush_thread(self):
        """Start background thread to flush metrics periodically."""
        def flush_loop():
            while True:
                time.sleep(self.flush_interval)
                self._flush_metrics()

        thread = threading.Thread(target=flush_loop, daemon=True, name='cloudwatch-emf-flush')
        thread.start()
        logger.info(f"EMF metrics flush thread started (interval: {self.flush_interval}s)")

    def _flush_metrics(self):
        """Flush buffered metrics to CloudWatch via EMF log."""
        with self._buffer_lock:
            if not self._metrics_buffer:
                return

            metrics_to_send = dict(self._metrics_buffer)
            self._metrics_buffer.clear()

        # Count total metrics
        total_count = sum(len(v) for v in metrics_to_send.values())

        if total_count == 0:
            return

        # Build and emit EMF log
        emf_log = self._build_emf_log(metrics_to_send)
        if emf_log:
            # Print to stdout - CloudWatch Logs captures this automatically
            print(emf_log, flush=True)
            self._total_emitted += total_count
            logger.info(f"Flushed {total_count} metrics via EMF to namespace={self.namespace}")

    def get_stats(self) -> Dict:
        """Get current statistics summary (for health/debug endpoints)."""
        with self._buffer_lock:
            stats_copy = {k: dict(v) for k, v in self._stats.items()}
            return {
                'enabled': self.enabled,
                'namespace': self.namespace,
                'environment': self.environment,
                'method': 'EMF (Embedded Metric Format)',
                'buffer_size': sum(len(v) for v in self._metrics_buffer.values()),
                'flush_interval': self.flush_interval,
                'total_emitted': self._total_emitted,
                'metrics_summary': stats_copy
            }

    def flush_now(self):
        """Force immediate flush of all buffered metrics."""
        self._flush_metrics()


# Singleton instance - import this in other modules
cloudwatch_metrics = CloudWatchMetricsService()
