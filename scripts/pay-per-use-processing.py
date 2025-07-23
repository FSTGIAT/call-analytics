#!/usr/bin/env python3
"""
Pay-Per-Use SageMaker Processing for 10TB VERINT_TEXT_ANALYSIS
Only pay when actually processing data - $0 when idle
"""

import boto3
import json
import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any
import time

logger = logging.getLogger(__name__)

class PayPerUseProcessor:
    """SageMaker processor that only charges when actively processing"""
    
    def __init__(self):
        self.sagemaker = boto3.client('sagemaker')
        self.sagemaker_runtime = boto3.client('sagemaker-runtime')
        self.s3 = boto3.client('s3')
        
        # Configuration
        self.config = {
            'serverless_endpoint': 'call-analytics-embedding-serverless',
            'batch_job_prefix': 'verint-embedding-batch',
            'async_endpoint': 'call-analytics-async-inference',
            'results_bucket': 'call-analytics-results',
            'cost_threshold_per_hour': 50  # $50/hour max
        }
        
        # Cost tracking
        self.session_cost = 0.0
        self.total_requests = 0
        self.processing_start_time = None
    
    async def process_small_batch_serverless(self, texts: List[str]) -> Dict[str, Any]:
        """
        Process small batches using Serverless Inference
        💰 Cost: ~$0.20 per 1000 requests + compute time
        ⏱️  Billing: Only when processing (seconds-level billing)
        """
        
        if not texts:
            return {'embeddings': [], 'cost': 0.0}
        
        start_time = time.time()
        self.processing_start_time = start_time
        
        try:
            # Prepare payload
            payload = {
                'texts': texts,
                'normalize': True,
                'batch_size': min(len(texts), 100)
            }
            
            logger.info(f"🚀 Starting serverless processing for {len(texts)} texts")
            logger.info(f"💰 Cost: ~${len(texts) * 0.0002:.4f} (pay-per-request)")
            
            # Call serverless endpoint - ONLY PAY WHEN THIS RUNS
            response = self.sagemaker_runtime.invoke_endpoint(
                EndpointName=self.config['serverless_endpoint'],
                ContentType='application/json',
                Body=json.dumps(payload)
            )
            
            # Parse response
            result = json.loads(response['Body'].read())
            processing_time = time.time() - start_time
            
            # Calculate actual cost (pay-per-use)
            request_cost = len(texts) * 0.0002  # $0.0002 per request
            compute_cost = processing_time * 0.002  # ~$0.002 per second compute
            total_cost = request_cost + compute_cost
            
            self.session_cost += total_cost
            self.total_requests += len(texts)
            
            logger.info(f"✅ Completed in {processing_time:.2f}s")
            logger.info(f"💰 Actual cost: ${total_cost:.4f} (request: ${request_cost:.4f} + compute: ${compute_cost:.4f})")
            logger.info(f"📊 Session total: ${self.session_cost:.2f}")
            
            return {
                'embeddings': result['embeddings'],
                'processing_time': processing_time,
                'cost': total_cost,
                'billing_model': 'pay_per_request'
            }
            
        except Exception as e:
            logger.error(f"❌ Serverless processing failed: {e}")
            raise
    
    async def process_large_batch_transform(self, data_s3_uri: str, output_s3_uri: str) -> Dict[str, Any]:
        """
        Process large datasets using Batch Transform
        💰 Cost: Only during job execution (~$0.94/hour per instance)
        ⏱️  Billing: Only when job is running (minute-level billing)
        """
        
        job_name = f"{self.config['batch_job_prefix']}-{int(time.time())}"
        
        try:
            logger.info(f"🚀 Starting batch transform job: {job_name}")
            logger.info(f"💰 Cost: $0 until job starts, then ~$0.94/hour per instance")
            
            # Create batch transform job - ONLY PAY WHEN JOB RUNS
            response = self.sagemaker.create_transform_job(
                TransformJobName=job_name,
                ModelName='embedding-batch-model',
                
                TransformInput={
                    'DataSource': {
                        'S3DataSource': {
                            'S3DataType': 'S3Prefix',
                            'S3Uri': data_s3_uri
                        }
                    },
                    'ContentType': 'application/jsonlines',
                    'SplitType': 'Line'
                },
                
                TransformOutput={
                    'S3OutputPath': output_s3_uri,
                    'Accept': 'application/json',
                    'AssembleWith': 'Line'
                },
                
                TransformResources={
                    'InstanceType': 'ml.g4dn.2xlarge',
                    'InstanceCount': 1  # Start with 1, can scale
                },
                
                # Auto-shutdown when complete
                StoppingCondition={
                    'MaxRuntimeInSeconds': 3600  # 1 hour max
                }
            )
            
            # Monitor job until completion
            job_status = await self._monitor_transform_job(job_name)
            
            if job_status['status'] == 'Completed':
                # Calculate cost based on actual runtime
                runtime_hours = job_status['runtime_seconds'] / 3600
                job_cost = runtime_hours * 0.94  # $0.94/hour for g4dn.2xlarge
                
                logger.info(f"✅ Batch job completed in {runtime_hours:.2f} hours")
                logger.info(f"💰 Actual cost: ${job_cost:.2f} (only paid for runtime)")
                
                return {
                    'job_name': job_name,
                    'status': 'Completed',
                    'runtime_hours': runtime_hours,
                    'cost': job_cost,
                    'output_location': output_s3_uri,
                    'billing_model': 'pay_per_job_runtime'
                }
            else:
                raise Exception(f"Batch job failed: {job_status}")
                
        except Exception as e:
            logger.error(f"❌ Batch transform failed: {e}")
            raise
    
    async def process_async_inference(self, texts: List[str]) -> Dict[str, Any]:
        """
        Process using Async Inference with auto-scaling to zero
        💰 Cost: Only during processing, auto-scales to $0 when idle
        ⏱️  Billing: Per-second billing, minimum 1 minute
        """
        
        if not texts:
            return {'embeddings': [], 'cost': 0.0}
        
        start_time = time.time()
        
        try:
            # Upload data to S3 for async processing
            input_key = f"async-input/{int(time.time())}.json"
            input_data = {'texts': texts, 'batch_size': 256}
            
            self.s3.put_object(
                Bucket=self.config['results_bucket'],
                Key=input_key,
                Body=json.dumps(input_data),
                ContentType='application/json'
            )
            
            input_uri = f"s3://{self.config['results_bucket']}/{input_key}"
            
            logger.info(f"🚀 Starting async processing for {len(texts)} texts")
            logger.info(f"💰 Cost: $0 until processing starts, auto-scales to $0 when done")
            
            # Start async inference - ONLY PAY DURING PROCESSING
            response = self.sagemaker_runtime.invoke_endpoint_async(
                EndpointName=self.config['async_endpoint'],
                InputLocation=input_uri
            )
            
            # Monitor until completion
            output_location = response['OutputLocation']
            result = await self._wait_for_async_result(output_location)
            
            processing_time = time.time() - start_time
            
            # Calculate cost (pay only for processing time)
            # Minimum 1 minute billing, then per-second
            billing_minutes = max(1, processing_time / 60)
            processing_cost = billing_minutes * (0.94 / 60)  # $0.94/hour = $0.0157/minute
            
            logger.info(f"✅ Async processing completed in {processing_time:.2f}s")
            logger.info(f"💰 Actual cost: ${processing_cost:.4f} (only paid for processing time)")
            
            return {
                'embeddings': result['embeddings'],
                'processing_time': processing_time,
                'cost': processing_cost,
                'output_location': output_location,
                'billing_model': 'pay_per_processing_time'
            }
            
        except Exception as e:
            logger.error(f"❌ Async processing failed: {e}")
            raise
    
    async def smart_process_oracle_data(self, oracle_query: str) -> Dict[str, Any]:
        """
        Intelligently choose processing method based on data size
        Optimizes for minimum cost with pay-per-use models
        """
        
        # Get data size estimate
        count_query = f"SELECT COUNT(*) as total FROM ({oracle_query})"
        record_count = await self._execute_oracle_query(count_query)
        
        logger.info(f"📊 Processing {record_count:,} records from Oracle")
        
        # Choose optimal method based on size
        if record_count < 1000:
            # Small: Use Serverless (pay per request)
            logger.info("🎯 Using Serverless Inference (pay-per-request)")
            estimated_cost = record_count * 0.0003
            
            # Get data and process
            data = await self._execute_oracle_query(oracle_query)
            texts = [row['TEXT'] for row in data]
            result = await self.process_small_batch_serverless(texts)
            
        elif record_count < 50000:
            # Medium: Use Async (pay for processing time)
            logger.info("🎯 Using Async Inference (pay-per-processing-time)")
            estimated_cost = (record_count / 1000) * 0.5  # ~$0.50 per 1k records
            
            data = await self._execute_oracle_query(oracle_query)
            texts = [row['TEXT'] for row in data]
            result = await self.process_async_inference(texts)
            
        else:
            # Large: Use Batch Transform (pay for job runtime)
            logger.info("🎯 Using Batch Transform (pay-per-job-runtime)")
            estimated_hours = record_count / 50000  # ~50k records per hour
            estimated_cost = estimated_hours * 0.94
            
            # Export Oracle data to S3
            data_s3_uri = await self._export_oracle_to_s3(oracle_query)
            output_s3_uri = f"s3://{self.config['results_bucket']}/batch-output/"
            
            result = await self.process_large_batch_transform(data_s3_uri, output_s3_uri)
        
        logger.info(f"💰 Estimated cost: ${estimated_cost:.2f}")
        logger.info(f"💰 Actual cost: ${result['cost']:.2f}")
        logger.info(f"💡 Savings: ${estimated_cost - result['cost']:.2f}")
        
        return result
    
    async def _monitor_transform_job(self, job_name: str) -> Dict[str, Any]:
        """Monitor batch transform job until completion"""
        
        start_time = time.time()
        
        while True:
            response = self.sagemaker.describe_transform_job(TransformJobName=job_name)
            status = response['TransformJobStatus']
            
            if status in ['Completed', 'Failed', 'Stopped']:
                runtime_seconds = time.time() - start_time
                
                return {
                    'status': status,
                    'runtime_seconds': runtime_seconds,
                    'details': response
                }
            
            logger.info(f"⏳ Batch job {job_name} status: {status}")
            await asyncio.sleep(30)  # Check every 30 seconds
    
    async def _wait_for_async_result(self, output_location: str) -> Dict[str, Any]:
        """Wait for async inference result"""
        
        # Extract bucket and key from S3 URI
        bucket = output_location.split('/')[2]
        key = '/'.join(output_location.split('/')[3:])
        
        while True:
            try:
                # Check if result is ready
                response = self.s3.get_object(Bucket=bucket, Key=key)
                result = json.loads(response['Body'].read())
                return result
                
            except self.s3.exceptions.NoSuchKey:
                # Result not ready yet
                await asyncio.sleep(10)
                continue
    
    def get_cost_summary(self) -> Dict[str, Any]:
        """Get detailed cost breakdown"""
        
        if self.processing_start_time:
            session_duration = time.time() - self.processing_start_time
        else:
            session_duration = 0
        
        return {
            'total_session_cost': self.session_cost,
            'total_requests_processed': self.total_requests,
            'cost_per_request': self.session_cost / max(1, self.total_requests),
            'session_duration_minutes': session_duration / 60,
            'cost_per_minute': self.session_cost / max(1, session_duration / 60),
            'billing_model': 'pay_per_use',
            'idle_cost': 0.0,  # Zero cost when idle! ✅
            'projected_10tb_cost': self._estimate_10tb_cost()
        }
    
    def _estimate_10tb_cost(self) -> Dict[str, float]:
        """Estimate cost for processing entire 10TB dataset"""
        
        # Assume 100M records in 10TB
        total_records = 100_000_000
        
        if self.total_requests > 0:
            cost_per_record = self.session_cost / self.total_requests
        else:
            cost_per_record = 0.0003  # Conservative estimate
        
        return {
            'total_records': total_records,
            'cost_per_record': cost_per_record,
            'total_cost_estimate': total_records * cost_per_record,
            'monthly_incremental_cost': 50000 * cost_per_record,  # 50k new records/day
            'note': 'Only pay when processing - $0 when idle'
        }

# Example usage
async def main():
    processor = PayPerUseProcessor()
    
    # Example: Process recent Oracle data
    oracle_query = """
        SELECT CALL_ID, BAN, TEXT, CALL_TIME 
        FROM VERINT_TEXT_ANALYSIS 
        WHERE CALL_TIME >= SYSDATE - 1
        ORDER BY CALL_ID
    """
    
    try:
        # Smart processing - chooses optimal method
        result = await processor.smart_process_oracle_data(oracle_query)
        
        logger.info(f"✅ Processing completed: {result}")
        
        # Get cost summary
        cost_summary = processor.get_cost_summary()
        logger.info(f"💰 Cost Summary: {cost_summary}")
        
        logger.info(f"🎯 Key Benefit: $0 cost when idle - only pay when processing!")
        
    except Exception as e:
        logger.error(f"❌ Processing failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())