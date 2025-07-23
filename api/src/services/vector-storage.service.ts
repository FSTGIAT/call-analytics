import { logger } from '../utils/logger';
import { CustomerContext } from '../types/customer';
import axios from 'axios';

export interface VectorStorageConfig {
  host: string;
  port: string;
  scheme: string;
  className: string;
  replicationFactor: number;
  shardCount: number;
  maxObjects: number;
  batchSize: number;
}

export interface VectorSearchOptions {
  certainty?: number;
  distance?: number;
  limit?: number;
  offset?: number;
  where?: any;
  includeVector?: boolean;
}

export interface VectorObject {
  id?: string;
  properties: {
    text: string;
    callId: string;
    customerId: string;
    subscriberId?: string;
    callDate?: string;
    language?: string;
    messageCount?: number;
    processed?: boolean;
  };
  vector?: number[];
}

export interface SearchResult {
  id: string;
  properties: any;
  vector?: number[];
  certainty?: number;
  distance?: number;
}

export class VectorStorageService {
  private config: VectorStorageConfig;
  private baseUrl: string;

  constructor() {
    this.config = {
      host: process.env.WEAVIATE_HOST || 'weaviate',
      port: process.env.WEAVIATE_PORT || '8080',
      scheme: process.env.WEAVIATE_SCHEME || 'http',
      className: process.env.WEAVIATE_CLASS_NAME || 'CallTranscription',
      replicationFactor: parseInt(process.env.WEAVIATE_REPLICATION_FACTOR || '1'),
      shardCount: parseInt(process.env.WEAVIATE_SHARD_COUNT || '3'),
      maxObjects: parseInt(process.env.WEAVIATE_MAX_OBJECTS || '10000000'), // 10M objects
      batchSize: parseInt(process.env.WEAVIATE_BATCH_SIZE || '100')
    };

    this.baseUrl = `${this.config.scheme}://${this.config.host}:${this.config.port}`;
    
    logger.info('Vector Storage Service initialized', {
      baseUrl: this.baseUrl,
      className: this.config.className
    });
  }

  async initializeSchema(): Promise<void> {
    try {
      // Check if class already exists
      const classExists = await this.checkClassExists();
      
      if (classExists) {
        logger.info(`Class ${this.config.className} already exists`);
        return;
      }

      // Create the class schema
      const classSchema = {
        class: this.config.className,
        description: 'Hebrew call transcriptions with vector embeddings for semantic search',
        vectorizer: 'text2vec-transformers',
        moduleConfig: {
          'text2vec-transformers': {
            poolingStrategy: 'masked_mean',
            vectorizeClassName: false
          }
        },
        properties: [
          {
            name: 'text',
            dataType: ['text'],
            description: 'Full conversation text in Hebrew',
            moduleConfig: {
              'text2vec-transformers': {
                skip: false,
                vectorizePropertyName: false
              }
            }
          },
          {
            name: 'callId',
            dataType: ['string'],
            description: 'Unique call identifier from Verint',
            moduleConfig: {
              'text2vec-transformers': {
                skip: true
              }
            }
          },
          {
            name: 'customerId',
            dataType: ['string'],
            description: 'Customer BAN from Verint',
            moduleConfig: {
              'text2vec-transformers': {
                skip: true
              }
            }
          },
          {
            name: 'subscriberId',
            dataType: ['string'],
            description: 'Subscriber phone number',
            moduleConfig: {
              'text2vec-transformers': {
                skip: true
              }
            }
          },
          {
            name: 'callDate',
            dataType: ['date'],
            description: 'When the call occurred'
          },
          {
            name: 'language',
            dataType: ['string'],
            description: 'Call language (he, en, ar, ru)'
          },
          {
            name: 'messageCount',
            dataType: ['int'],
            description: 'Number of messages in the conversation'
          },
          {
            name: 'processed',
            dataType: ['boolean'],
            description: 'Whether the call has been processed by AI'
          }
        ],
        replicationConfig: {
          factor: this.config.replicationFactor
        },
        shardingConfig: {
          virtualPerPhysical: 128,
          desiredCount: this.config.shardCount,
          desiredVirtualCount: this.config.shardCount * 128
        },
        vectorIndexConfig: {
          skip: false,
          cleanupIntervalSeconds: 300,
          maxConnections: 64,
          efConstruction: 128,
          ef: -1,
          vectorCacheMaxObjects: 1000000
        }
      };

      const response = await axios.post(`${this.baseUrl}/v1/schema`, classSchema);
      
      logger.info(`Created Weaviate class: ${this.config.className}`, {
        class: response.data
      });

    } catch (error) {
      logger.error('Failed to initialize Weaviate schema:', error);
      throw error;
    }
  }

  private async checkClassExists(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/v1/schema/${this.config.className}`);
      return response.status === 200;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  async storeVector(vectorObject: VectorObject): Promise<string> {
    try {
      const response = await axios.post(`${this.baseUrl}/v1/objects`, {
        class: this.config.className,
        properties: vectorObject.properties,
        vector: vectorObject.vector
      });

      logger.debug(`Stored vector for call ${vectorObject.properties.callId}`, {
        id: response.data.id
      });

      return response.data.id;
    } catch (error) {
      logger.error('Failed to store vector:', error);
      throw error;
    }
  }

  async storeBatch(vectorObjects: VectorObject[]): Promise<{ successes: number; errors: any[] }> {
    if (vectorObjects.length === 0) {
      return { successes: 0, errors: [] };
    }

    try {
      const batchData = {
        objects: vectorObjects.map(obj => ({
          class: this.config.className,
          properties: obj.properties,
          vector: obj.vector
        }))
      };

      const response = await axios.post(`${this.baseUrl}/v1/batch/objects`, batchData);
      
      let successes = 0;
      const errors: any[] = [];

      if (response.data && Array.isArray(response.data)) {
        response.data.forEach((result, index) => {
          if (result.result && result.result.status === 'SUCCESS') {
            successes++;
          } else {
            errors.push({
              index,
              callId: vectorObjects[index]?.properties.callId,
              error: result.result?.errors || 'Unknown error'
            });
          }
        });
      }

      logger.info(`Batch storage completed: ${successes} successes, ${errors.length} errors`);
      
      return { successes, errors };
    } catch (error) {
      logger.error('Failed to store batch:', error);
      throw error;
    }
  }

  async searchSimilar(
    query: string,
    customerContext: CustomerContext,
    options: VectorSearchOptions = {}
  ): Promise<SearchResult[]> {
    try {
      const {
        certainty = 0.7,
        limit = 10,
        offset = 0,
        includeVector = false
      } = options;

      // Build where filter for customer isolation
      let whereFilter: any = null;
      
      // Only filter by customerId if it's provided (non-admin users)
      logger.debug('Building where filter', { 
        customerId: customerContext.customerId
      });
      
      if (customerContext.customerId) {
        whereFilter = {
          operator: 'Equal',
          path: ['customerId'],
          valueString: customerContext.customerId
        };
      }

      // Add subscriber filter if specified
      if (customerContext.subscriberIds && customerContext.subscriberIds.length > 0) {
        // For multiple subscribers, use Or operator
        if (customerContext.subscriberIds.length === 1) {
          // Create new filter with And operator
          const originalFilter = { ...whereFilter };
          whereFilter = {
            operator: 'And',
            operands: [
              originalFilter,
              {
                operator: 'Equal',
                path: ['subscriberId'],
                valueString: customerContext.subscriberIds[0]
              }
            ]
          };
        } else {
          const subscriberFilters = customerContext.subscriberIds.map(id => ({
            operator: 'Equal',
            path: ['subscriberId'],
            valueString: id
          }));
          
          // Create new filter with And operator
          const originalFilter = { ...whereFilter };
          whereFilter = {
            operator: 'And',
            operands: [
              originalFilter,
              {
                operator: 'Or',
                operands: subscriberFilters
              }
            ]
          };
        }
      }

      // Build proper GraphQL where clause
      const whereClause = whereFilter ? this.buildGraphQLWhere(whereFilter) : '';
      
      const graphqlQuery = `{
        Get {
          ${this.config.className}(
            nearText: {
              concepts: ["${query}"]
              certainty: ${certainty}
            }
            ${whereClause}
            limit: ${limit}
            offset: ${offset}
          ) {
            transcriptionText
            callId
            customerId
            subscriberId
            callDate
            language
            durationSeconds
            agentId
            callType
            sentiment
            productsMentioned
            keyPoints
            ${includeVector ? '_additional { vector certainty }' : '_additional { certainty }'}
          }
        }
      }`;

      const cleanQuery = graphqlQuery.replace(/\n\s*/g, ' ');
      logger.debug('Vector search GraphQL query:', cleanQuery);
      logger.debug('Where clause built:', whereClause);
      
      const response = await axios.post(`${this.baseUrl}/v1/graphql`, {
        query: cleanQuery
      });

      const results = response.data?.data?.Get?.[this.config.className] || [];
      
      return results.map((result: any) => ({
        id: result.id || '',
        properties: {
          transcriptionText: result.transcriptionText,
          text: result.transcriptionText, // For backward compatibility
          callId: result.callId,
          customerId: result.customerId,
          subscriberId: result.subscriberId,
          callDate: result.callDate,
          language: result.language,
          durationSeconds: result.durationSeconds,
          agentId: result.agentId,
          callType: result.callType,
          sentiment: result.sentiment || 'neutral',
          productsMentioned: result.productsMentioned || [],
          keyPoints: result.keyPoints || [],
          // Set default values for fields that don't exist in schema but are expected by the API
          callTime: result.callDate, // Use callDate as fallback
          summary: '', // Empty summary - not in schema
          actionItems: [] // Empty array - not in schema
        },
        certainty: result._additional?.certainty,
        vector: includeVector ? result._additional?.vector : undefined
      }));

    } catch (error) {
      logger.error('Vector search failed:', {
        error: error instanceof Error ? error.message : String(error),
        query: query.substring(0, 100),
        customerContext: {
          customerId: customerContext.customerId,
          role: customerContext.customerId ? 'user' : 'admin'
        }
      });
      // Return empty results instead of throwing to prevent system crashes
      return [];
    }
  }

  private buildGraphQLWhere(whereFilter: any): string {
    // For admin users with no customerId, return empty string to search all data
    if (!whereFilter || whereFilter === null || whereFilter === undefined) {
      logger.debug('Admin user search - no customer filter applied');
      return '';
    }
    
    if (whereFilter.operator === 'Equal') {
      return `where: {path: ["${whereFilter.path[0]}"], operator: Equal, valueString: "${whereFilter.valueString}"}`;
    }
    
    if (whereFilter.operator === 'And' && whereFilter.operands) {
      const operands = whereFilter.operands.map((operand: any) => {
        if (operand.operator === 'Equal') {
          return `{path: ["${operand.path[0]}"], operator: Equal, valueString: "${operand.valueString}"}`;
        }
        if (operand.operator === 'Or' && operand.operands) {
          const subOperands = operand.operands.map((subOp: any) => 
            `{path: ["${subOp.path[0]}"], operator: Equal, valueString: "${subOp.valueString}"}`
          ).join(', ');
          return `{operator: Or, operands: [${subOperands}]}`;
        }
        return '';
      }).filter(Boolean).join(', ');
      
      return `where: {operator: And, operands: [${operands}]}`;
    }
    
    return '';
  }

  async deleteVector(id: string): Promise<boolean> {
    try {
      await axios.delete(`${this.baseUrl}/v1/objects/${this.config.className}/${id}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete vector ${id}:`, error);
      return false;
    }
  }

  async deleteByCallId(callId: string, customerId: string): Promise<number> {
    try {
      // First, find objects to delete
      const whereFilter = {
        operator: 'And',
        operands: [
          {
            operator: 'Equal',
            path: ['callId'],
            valueString: callId
          },
          {
            operator: 'Equal',
            path: ['customerId'],
            valueString: customerId
          }
        ]
      };

      const graphqlQuery = `{
        Get {
          ${this.config.className}(
            where: ${JSON.stringify(whereFilter).replace(/"/g, '\\"')}
          ) {
            _additional { id }
          }
        }
      }`;

      const response = await axios.post(`${this.baseUrl}/v1/graphql`, {
        query: graphqlQuery.replace(/\n\s*/g, ' ')
      });

      const objects = response.data?.data?.Get?.[this.config.className] || [];
      
      // Delete each object
      let deletedCount = 0;
      for (const obj of objects) {
        if (await this.deleteVector(obj._additional.id)) {
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      logger.error(`Failed to delete vectors for call ${callId}:`, error);
      return 0;
    }
  }

  async getStorageStats(): Promise<any> {
    try {
      // Get class statistics
      const classResponse = await axios.get(`${this.baseUrl}/v1/schema/${this.config.className}`);
      
      // Get object count
      const countQuery = `{
        Aggregate {
          ${this.config.className} {
            meta {
              count
            }
          }
        }
      }`;

      const countResponse = await axios.post(`${this.baseUrl}/v1/graphql`, {
        query: countQuery
      });

      const totalObjects = countResponse.data?.data?.Aggregate?.[this.config.className]?.[0]?.meta?.count || 0;

      // Get cluster nodes info
      const nodesResponse = await axios.get(`${this.baseUrl}/v1/nodes`);

      return {
        className: this.config.className,
        totalObjects,
        maxCapacity: this.config.maxObjects,
        utilizationPercentage: (totalObjects / this.config.maxObjects) * 100,
        replicationFactor: this.config.replicationFactor,
        shardCount: this.config.shardCount,
        nodes: nodesResponse.data?.nodes || [],
        lastUpdated: new Date()
      };
    } catch (error) {
      logger.error('Failed to get storage stats:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/v1/meta`);
      return response.status === 200;
    } catch (error) {
      logger.error('Vector storage health check failed:', error);
      return false;
    }
  }

  // Maintenance operations
  async optimizeIndexes(): Promise<void> {
    try {
      // Trigger HNSW index optimization
      await axios.post(`${this.baseUrl}/v1/schema/${this.config.className}/shards/_rebuild`);
      logger.info('Vector indexes optimization triggered');
    } catch (error) {
      logger.error('Failed to optimize indexes:', error);
      throw error;
    }
  }

  async cleanupOldVectors(olderThanDays: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const whereFilter = {
        operator: 'LessThan',
        path: ['callDate'],
        valueDate: cutoffDate.toISOString()
      };

      // Count objects to be deleted
      const countQuery = `{
        Aggregate {
          ${this.config.className}(
            where: ${JSON.stringify(whereFilter).replace(/"/g, '\\"')}
          ) {
            meta {
              count
            }
          }
        }
      }`;

      const countResponse = await axios.post(`${this.baseUrl}/v1/graphql`, {
        query: countQuery
      });

      const objectsToDelete = countResponse.data?.data?.Aggregate?.[this.config.className]?.[0]?.meta?.count || 0;

      if (objectsToDelete === 0) {
        return 0;
      }

      // Delete old objects
      const deleteResponse = await axios.delete(`${this.baseUrl}/v1/objects`, {
        data: {
          class: this.config.className,
          where: whereFilter
        }
      });

      logger.info(`Cleaned up ${objectsToDelete} old vectors`);
      return objectsToDelete;
    } catch (error) {
      logger.error('Failed to cleanup old vectors:', error);
      throw error;
    }
  }
}

export const vectorStorageService = new VectorStorageService();