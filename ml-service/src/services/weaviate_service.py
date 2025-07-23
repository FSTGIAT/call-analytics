import os
import json
import logging
import asyncio
import aiohttp
from typing import List, Dict, Optional, Any
from datetime import datetime
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class WeaviateConfig:
    host: str
    port: int
    scheme: str
    timeout: int


class WeaviateService:
    """
    Service for interacting with Weaviate vector database.
    Handles call transcription storage and semantic search.
    """
    
    def __init__(self):
        self.config = WeaviateConfig(
            host=os.getenv('WEAVIATE_HOST', 'weaviate'),
            port=int(os.getenv('WEAVIATE_PORT', '8080')),
            scheme=os.getenv('WEAVIATE_SCHEME', 'http'),
            timeout=int(os.getenv('WEAVIATE_TIMEOUT', '30'))
        )
        
        self.base_url = f"{self.config.scheme}://{self.config.host}:{self.config.port}"
        
        # Schema definitions
        self.call_transcription_schema = {
            "class": "CallTranscription",
            "description": "Call transcription with embeddings for semantic search",
            "vectorizer": "text2vec-transformers",
            "moduleConfig": {
                "text2vec-transformers": {
                    "poolingStrategy": "masked_mean",
                    "vectorizeClassName": False
                }
            },
            "properties": [
                {
                    "name": "callId",
                    "dataType": ["string"],
                    "description": "Unique call identifier",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "customerId", 
                    "dataType": ["string"],
                    "description": "Customer identifier for isolation",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "subscriberId",
                    "dataType": ["string"], 
                    "description": "Subscriber identifier",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "transcriptionText",
                    "dataType": ["text"],
                    "description": "Call transcription content",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "vectorizePropertyName": False
                        }
                    }
                },
                {
                    "name": "language",
                    "dataType": ["string"],
                    "description": "Transcription language",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "callDate",
                    "dataType": ["date"],
                    "description": "Call timestamp",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "durationSeconds",
                    "dataType": ["int"],
                    "description": "Call duration in seconds",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "agentId",
                    "dataType": ["string"],
                    "description": "Agent identifier",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "callType",
                    "dataType": ["string"],
                    "description": "Type of call",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "sentiment",
                    "dataType": ["string"],
                    "description": "Call sentiment analysis",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "productsMentioned",
                    "dataType": ["string[]"],
                    "description": "Products mentioned in call",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "skip": True
                        }
                    }
                },
                {
                    "name": "keyPoints",
                    "dataType": ["string[]"],
                    "description": "Key points from call summary",
                    "moduleConfig": {
                        "text2vec-transformers": {
                            "vectorizePropertyName": False
                        }
                    }
                }
            ]
        }
        
        logger.info(f"Weaviate service initialized: {self.base_url}")
    
    async def health_check(self) -> bool:
        """Check if Weaviate is available."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.base_url}/v1/meta",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as response:
                    return response.status == 200
        except Exception as e:
            logger.error(f"Weaviate health check failed: {e}")
            return False
    
    async def create_schema(self) -> bool:
        """Create the CallTranscription schema if it doesn't exist."""
        try:
            async with aiohttp.ClientSession() as session:
                # Check if schema exists
                async with session.get(
                    f"{self.base_url}/v1/schema/CallTranscription"
                ) as response:
                    if response.status == 200:
                        logger.info("CallTranscription schema already exists")
                        return True
                
                # Create schema
                async with session.post(
                    f"{self.base_url}/v1/schema",
                    json=self.call_transcription_schema,
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status == 200:
                        logger.info("CallTranscription schema created successfully")
                        return True
                    else:
                        error_text = await response.text()
                        logger.error(f"Failed to create schema: {response.status} - {error_text}")
                        return False
                        
        except Exception as e:
            logger.error(f"Error creating schema: {e}")
            return False
    
    async def add_transcription(self, transcription_data: Dict) -> bool:
        """Add a call transcription to Weaviate."""
        try:
            # Ensure schema exists
            await self.create_schema()
            
            # Prepare data for Weaviate
            weaviate_object = {
                "class": "CallTranscription",
                "properties": {
                    "callId": transcription_data.get("callId"),
                    "customerId": transcription_data.get("customerId"), 
                    "subscriberId": transcription_data.get("subscriberId"),
                    "transcriptionText": transcription_data.get("transcriptionText"),
                    "language": transcription_data.get("language", "he"),
                    "callDate": transcription_data.get("callDate"),
                    "durationSeconds": transcription_data.get("durationSeconds"),
                    "agentId": transcription_data.get("agentId"),
                    "callType": transcription_data.get("callType"),
                    "sentiment": transcription_data.get("sentiment"),
                    "productsMentioned": transcription_data.get("productsMentioned", []),
                    "keyPoints": transcription_data.get("keyPoints", [])
                }
            }
            
            # Add retry logic for connectivity issues
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    timeout = aiohttp.ClientTimeout(total=self.config.timeout)
                    async with aiohttp.ClientSession(timeout=timeout) as session:
                        async with session.post(
                            f"{self.base_url}/v1/objects",
                            json=weaviate_object,
                            headers={'Content-Type': 'application/json'}
                        ) as response:
                            if response.status == 200:
                                result = await response.json()
                                logger.info(f"✅ Added transcription {transcription_data.get('callId')} to Weaviate (attempt {attempt + 1})")
                                return True
                            else:
                                error_text = await response.text()
                                logger.error(f"❌ Failed to add transcription: {response.status} - {error_text}")
                                if attempt == max_retries - 1:
                                    return False
                                
                except aiohttp.ClientError as e:
                    logger.warning(f"⚠️ Weaviate connection error (attempt {attempt + 1}/{max_retries}): {e}")
                    if attempt == max_retries - 1:
                        return False
                    await asyncio.sleep(1)  # Brief delay before retry
                        
        except Exception as e:
            logger.error(f"Error adding transcription: {e}")
            return False
    
    async def batch_add_transcriptions(self, transcriptions: List[Dict]) -> Dict:
        """Add multiple transcriptions in batch."""
        try:
            # Ensure schema exists
            await self.create_schema()
            
            # Prepare batch objects
            batch_objects = []
            for transcription in transcriptions:
                weaviate_object = {
                    "class": "CallTranscription",
                    "properties": {
                        "callId": transcription.get("callId"),
                        "customerId": transcription.get("customerId"),
                        "subscriberId": transcription.get("subscriberId"), 
                        "transcriptionText": transcription.get("transcriptionText"),
                        "language": transcription.get("language", "he"),
                        "callDate": transcription.get("callDate"),
                        "durationSeconds": transcription.get("durationSeconds"),
                        "agentId": transcription.get("agentId"),
                        "callType": transcription.get("callType"),
                        "sentiment": transcription.get("sentiment"),
                        "productsMentioned": transcription.get("productsMentioned", []),
                        "keyPoints": transcription.get("keyPoints", [])
                    }
                }
                batch_objects.append(weaviate_object)
            
            # Send batch request
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/v1/batch/objects",
                    json={"objects": batch_objects},
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        successful = len([obj for obj in result if obj.get("result", {}).get("status") == "SUCCESS"])
                        
                        logger.info(f"Batch added {successful}/{len(transcriptions)} transcriptions")
                        
                        return {
                            "success": True,
                            "total": len(transcriptions),
                            "successful": successful,
                            "errors": len(transcriptions) - successful
                        }
                    else:
                        error_text = await response.text()
                        logger.error(f"Batch add failed: {response.status} - {error_text}")
                        return {
                            "success": False,
                            "error": error_text
                        }
                        
        except Exception as e:
            logger.error(f"Error in batch add: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def semantic_search(
        self, 
        query: str, 
        customer_id: Optional[str] = None,
        limit: int = 10,
        certainty: float = 0.7,
        filters: Optional[Dict] = None
    ) -> List[Dict]:
        """Perform semantic search on call transcriptions."""
        try:
            # Build GraphQL query
            where_clause = {
                "operator": "And",
                "operands": []
            }
            
            # Only add customer_id filter if provided
            if customer_id:
                where_clause["operands"].append({
                    "path": ["customerId"],
                    "operator": "Equal", 
                    "valueString": customer_id
                })
            
            # Add additional filters
            if filters:
                if filters.get("language"):
                    where_clause["operands"].append({
                        "path": ["language"],
                        "operator": "Equal",
                        "valueString": filters["language"]
                    })
                
                if filters.get("call_type"):
                    where_clause["operands"].append({
                        "path": ["callType"],
                        "operator": "Equal",
                        "valueString": filters["call_type"]
                    })
                
                if filters.get("date_from"):
                    where_clause["operands"].append({
                        "path": ["callDate"],
                        "operator": "GreaterThanEqual",
                        "valueDate": filters["date_from"]
                    })
                
                if filters.get("date_to"):
                    where_clause["operands"].append({
                        "path": ["callDate"],
                        "operator": "LessThanEqual", 
                        "valueDate": filters["date_to"]
                    })
            
            # Build proper GraphQL where clause
            def build_graphql_where(clause):
                if not clause.get("operands"):
                    return ""
                
                operands = []
                for operand in clause["operands"]:
                    path = operand["path"][0]
                    operator = operand["operator"]
                    
                    if "valueString" in operand:
                        operands.append(f'{{path: ["{path}"], operator: {operator}, valueString: "{operand["valueString"]}"}}')
                    elif "valueDate" in operand:
                        operands.append(f'{{path: ["{path}"], operator: {operator}, valueDate: "{operand["valueDate"]}"}}')
                    elif "valueInt" in operand:
                        operands.append(f'{{path: ["{path}"], operator: {operator}, valueInt: {operand["valueInt"]}}}')
                    else:
                        continue
                
                if len(operands) == 1:
                    return f'where: {operands[0]}'
                elif len(operands) > 1:
                    operands_str = ", ".join(operands)
                    return f'where: {{operator: And, operands: [{operands_str}]}}'
                return ""
            
            where_filter = build_graphql_where(where_clause)
            
            graphql_query = {
                "query": f"""
                {{
                    Get {{
                        CallTranscription(
                            {where_filter}
                            nearText: {{
                                concepts: ["{query}"]
                                certainty: {certainty}
                            }}
                            limit: {limit}
                        ) {{
                            callId
                            customerId
                            subscriberId
                            transcriptionText
                            language
                            callDate
                            durationSeconds
                            _additional {{
                                certainty
                                distance
                            }}
                        }}
                    }}
                }}
                """
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/v1/graphql",
                    json=graphql_query,
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        
                        if "errors" in result:
                            logger.error(f"GraphQL errors: {result['errors']}")
                            return []
                        
                        transcriptions = result.get("data", {}).get("Get", {}).get("CallTranscription", [])
                        
                        # Format results
                        formatted_results = []
                        for trans in transcriptions:
                            additional = trans.get("_additional", {})
                            formatted_results.append({
                                **trans,
                                "similarity_score": additional.get("certainty", 0),
                                "distance": additional.get("distance", 1)
                            })
                        
                        return formatted_results
                    
                    else:
                        error_text = await response.text()
                        logger.error(f"Semantic search failed: {response.status} - {error_text}")
                        return []
                        
        except Exception as e:
            logger.error(f"Error in semantic search: {e}")
            return []
    
    async def get_transcription_by_id(self, call_id: str, customer_id: Optional[str] = None) -> Optional[Dict]:
        """Get specific transcription by call ID."""
        try:
            # Build where clause with optional customer_id filter
            where_operands = [{
                "path": ["callId"],
                "operator": "Equal",
                "valueString": call_id
            }]
            
            if customer_id:
                where_operands.append({
                    "path": ["customerId"],
                    "operator": "Equal",
                    "valueString": customer_id
                })
            
            # Build proper GraphQL where clause
            def build_simple_where(operands):
                if len(operands) == 1:
                    op = operands[0]
                    if "valueString" in op:
                        return f'where: {{path: ["{op["path"][0]}"], operator: {op["operator"]}, valueString: "{op["valueString"]}"}}'
                elif len(operands) > 1:
                    formatted_operands = []
                    for op in operands:
                        if "valueString" in op:
                            formatted_operands.append(f'{{path: ["{op["path"][0]}"], operator: {op["operator"]}, valueString: "{op["valueString"]}"}}')
                    operands_str = ", ".join(formatted_operands)
                    return f'where: {{operator: And, operands: [{operands_str}]}}'
                return ""
            
            where_filter = build_simple_where(where_operands)
            
            graphql_query = {
                "query": f"""
                {{
                    Get {{
                        CallTranscription(
                            {where_filter}
                        ) {{
                            callId
                            customerId
                            subscriberId
                            transcriptionText
                            language
                            callDate
                            durationSeconds
                            agentId
                            callType
                            sentiment
                            productsMentioned
                            keyPoints
                        }}
                    }}
                }}
                """
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/v1/graphql",
                    json=graphql_query,
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        transcriptions = result.get("data", {}).get("Get", {}).get("CallTranscription", [])
                        return transcriptions[0] if transcriptions else None
                    else:
                        return None
                        
        except Exception as e:
            logger.error(f"Error getting transcription by ID: {e}")
            return None
    
    async def delete_transcription(self, call_id: str, customer_id: Optional[str] = None) -> bool:
        """Delete a transcription by call ID."""
        try:
            # First, find the object
            transcription = await self.get_transcription_by_id(call_id, customer_id)
            if not transcription:
                return False
            
            # Delete using GraphQL
            # Note: This is a simplified approach. In production, you'd want to get the UUID first
            logger.warning("Delete transcription not fully implemented - requires object UUID")
            return False
            
        except Exception as e:
            logger.error(f"Error deleting transcription: {e}")
            return False
    
    async def get_stats(self) -> Dict:
        """Get Weaviate statistics."""
        try:
            async with aiohttp.ClientSession() as session:
                # Get object count
                async with session.get(f"{self.base_url}/v1/objects") as response:
                    if response.status == 200:
                        result = await response.json()
                        total_objects = result.get("totalResults", 0)
                    else:
                        total_objects = 0
                
                # Get schema info
                async with session.get(f"{self.base_url}/v1/schema") as response:
                    if response.status == 200:
                        schema = await response.json()
                        classes = [cls["class"] for cls in schema.get("classes", [])]
                    else:
                        classes = []
                
                return {
                    "connected": True,
                    "total_objects": total_objects,
                    "classes": classes,
                    "base_url": self.base_url
                }
                
        except Exception as e:
            logger.error(f"Error getting Weaviate stats: {e}")
            return {
                "connected": False,
                "error": str(e),
                "base_url": self.base_url
            }


# Singleton instance
weaviate_service = WeaviateService()