import { Client } from '@opensearch-project/opensearch';
import { logger } from '../utils/logger';
import { CustomerContext } from '../types/customer';

export interface OpenSearchConfig {
  node: string;
  auth?: {
    username: string;
    password: string;
  };
  ssl?: {
    rejectUnauthorized: boolean;
  };
}

export interface SearchQuery {
  query: string;
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    language?: string;
    sentiment?: string;
    callType?: string;
    agentId?: string;
  };
  size?: number;
  from?: number;
  sort?: Array<{ [field: string]: 'asc' | 'desc' }>;
  aggs?: any;
}

export interface SearchResponse {
  total: number;
  results: any[];
  aggregations?: any;
  took: number;
}

export interface AggregationQuery {
  field: string;
  type: 'terms' | 'date_histogram' | 'range' | 'avg' | 'sum' | 'cardinality';
  size?: number;
  interval?: string;
  ranges?: Array<{ from?: number; to?: number; key?: string }>;
}

export class OpenSearchService {
  private client: Client;
  private config: OpenSearchConfig;
  private indexPrefix: string;

  constructor() {
    this.config = {
      node: process.env.OPENSEARCH_HOST 
        ? `http://${process.env.OPENSEARCH_HOST}:${process.env.OPENSEARCH_PORT || 9200}`
        : 'http://localhost:9200',
      ssl: {
        rejectUnauthorized: false
      }
    };

    this.indexPrefix = process.env.OPENSEARCH_INDEX_PREFIX || 'call-analytics';

    this.client = new Client(this.config);
    
    logger.info(`OpenSearch client initialized: ${this.config.node}`);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.cluster.health();
      return response.body.status === 'green' || response.body.status === 'yellow';
    } catch (error) {
      logger.error('OpenSearch health check failed:', error);
      return false;
    }
  }

  async createIndexForCustomer(customerContext: CustomerContext, indexType: 'transcriptions' | 'summaries'): Promise<boolean> {
    try {
      const indexName = this.getIndexName(customerContext.customerId, indexType);
      
      const exists = await this.client.indices.exists({ index: indexName });
      
      if (exists.body) {
        logger.info(`Index ${indexName} already exists`);
        return true;
      }

      const templateName = `${indexType}_template`;
      const settings = this.getIndexSettings(indexType);
      const mappings = this.getIndexMappings(indexType);

      await this.client.indices.create({
        index: indexName,
        body: {
          settings,
          mappings
        }
      });

      logger.info(`Created index: ${indexName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to create index for customer ${customerContext.customerId}:`, error);
      return false;
    }
  }

  async indexDocumentForCustomer(
    customerContext: CustomerContext,
    indexType: 'transcriptions' | 'summaries',
    document: any,
    documentId?: string
  ): Promise<boolean> {
    try {
      const indexName = this.getIndexName(customerContext.customerId, indexType);
      
      // Ensure index exists
      await this.createIndexForCustomer(customerContext, indexType);

      // Add customer isolation and timestamp
      const indexDoc = {
        ...document,
        customerId: customerContext.customerId,
        indexedAt: new Date().toISOString()
      };

      const params: any = {
        index: indexName,
        body: indexDoc
      };

      if (documentId) {
        params.id = documentId;
      }

      const response = await this.client.index(params);
      
      logger.debug(`Indexed document in ${indexName}: ${response.body._id}`);
      return true;
    } catch (error) {
      logger.error(`Failed to index document:`, error);
      return false;
    }
  }

  async bulkIndexForCustomer(
    customerContext: CustomerContext,
    indexType: 'transcriptions' | 'summaries',
    documents: any[]
  ): Promise<{ success: number; errors: number }> {
    try {
      const indexName = this.getIndexName(customerContext.customerId, indexType);
      
      // Ensure index exists
      await this.createIndexForCustomer(customerContext, indexType);

      const body: any[] = [];
      
      documents.forEach(doc => {
        body.push({
          index: {
            _index: indexName,
            _id: doc.callId || undefined
          }
        });
        
        body.push({
          ...doc,
          customerId: customerContext.customerId,
          indexedAt: new Date().toISOString()
        });
      });

      const response = await this.client.bulk({ body });
      
      const errors = response.body.items.filter((item: any) => 
        item.index && item.index.error
      ).length;
      
      const success = documents.length - errors;
      
      logger.info(`Bulk indexed ${success} documents, ${errors} errors`);
      return { success, errors };
    } catch (error) {
      logger.error('Bulk indexing failed:', error);
      return { success: 0, errors: documents.length };
    }
  }

  async search(
    customerContext: CustomerContext,
    indexType: 'transcriptions' | 'summaries',
    searchQuery: SearchQuery
  ): Promise<SearchResponse> {
    try {
      const indexName = this.getIndexName(customerContext.customerId, indexType);
      
      logger.info('🔍 OpenSearch search called', {
        customerId: customerContext.customerId,
        indexType,
        indexName,
        queryText: searchQuery.query,
        searchQuerySize: searchQuery.size,
        // CRITICAL DEBUG
        customerContextFull: JSON.stringify(customerContext),
        indexNameUsed: indexName,
        willSearchIndex: `${this.indexPrefix}-${customerContext.customerId ? customerContext.customerId.toLowerCase() : '*'}-${indexType}`
      });
      
      const query = this.buildSearchQuery(searchQuery, customerContext);
      
      logger.info('🔧 OpenSearch query built', {
        indexName,
        query: JSON.stringify(query),
        searchQuery: JSON.stringify(searchQuery)
      });
      
      const searchParams = {
        index: indexName,
        body: {
          query,
          size: searchQuery.size || 20,
          from: searchQuery.from || 0,
          sort: searchQuery.sort || [{ indexedAt: { order: 'desc' as const } }],
          ...(searchQuery.aggs && { aggs: searchQuery.aggs }),
          highlight: {
            fields: {
              transcriptionText: {
                pre_tags: ['<mark>'],
                post_tags: ['</mark>'],
                fragment_size: 150,
                number_of_fragments: 3
              },
              processedText: {
                pre_tags: ['<mark>'],
                post_tags: ['</mark>'],
                fragment_size: 150,
                number_of_fragments: 2
              }
            }
          }
        }
      };

      const response = await this.client.search(searchParams);
      
      // CRITICAL DEBUG: Log raw OpenSearch response
      logger.info('🔍 OpenSearch RAW response', {
        totalHits: response.body.hits.total,
        hitsCount: response.body.hits.hits.length,
        firstHit: response.body.hits.hits[0] ? {
          index: response.body.hits.hits[0]._index,
          id: response.body.hits.hits[0]._id,
          hasSource: !!response.body.hits.hits[0]._source,
          sourceKeys: response.body.hits.hits[0]._source ? Object.keys(response.body.hits.hits[0]._source) : []
        } : null,
        searchParams: JSON.stringify(searchParams)
      });
      
      const results = response.body.hits.hits.map((hit: any) => ({
        ...hit._source,
        _score: hit._score,
        highlights: hit.highlight
      }));

      return {
        total: typeof response.body.hits.total === 'number' ? response.body.hits.total : response.body.hits.total?.value || 0,
        results,
        took: response.body.took,
        aggregations: response.body.aggregations
      };
    } catch (error) {
      logger.error('Search failed:', error);
      return {
        total: 0,
        results: [],
        took: 0
      };
    }
  }

  async searchWithAggregations(
    customerContext: CustomerContext,
    indexType: 'transcriptions' | 'summaries',
    searchQuery: SearchQuery,
    aggregations: AggregationQuery[]
  ): Promise<SearchResponse> {
    try {
      const indexName = this.getIndexName(customerContext.customerId, indexType);
      
      const query = this.buildSearchQuery(searchQuery, customerContext);
      const aggs = this.buildAggregations(aggregations);
      
      const searchParams = {
        index: indexName,
        body: {
          query,
          size: searchQuery.size || 20,
          from: searchQuery.from || 0,
          sort: searchQuery.sort || [{ indexedAt: { order: 'desc' as const } }],
          aggs
        }
      };

      const response = await this.client.search(searchParams);
      
      const results = response.body.hits.hits
        .filter((hit: any) => hit._score >= 0.1) // Filter out very low relevance scores
        .map((hit: any) => ({
          ...hit._source,
          _score: hit._score
        }));

      return {
        total: typeof response.body.hits.total === 'number' ? response.body.hits.total : response.body.hits.total?.value || 0,
        results,
        aggregations: response.body.aggregations,
        took: response.body.took
      };
    } catch (error) {
      logger.error('Aggregation search failed:', error);
      return {
        total: 0,
        results: [],
        took: 0
      };
    }
  }

  async suggest(
    customerContext: CustomerContext,
    indexType: 'transcriptions' | 'summaries',
    prefix: string,
    field: string = 'transcriptionText'
  ): Promise<string[]> {
    try {
      const indexName = this.getIndexName(customerContext.customerId, indexType);
      
      const response = await this.client.search({
        index: indexName,
        body: {
          suggest: {
            text: prefix,
            simple_phrase: {
              phrase: {
                field: field,
                size: 5,
                gram_size: 3,
                direct_generator: [{
                  field: field,
                  suggest_mode: 'popular'
                }]
              }
            }
          },
          query: {
            term: { customerId: customerContext.customerId }
          }
        }
      });

      const suggestions = response.body.suggest?.simple_phrase?.[0]?.options;
      return Array.isArray(suggestions) ? suggestions.map((option: any) => option.text) : [];
    } catch (error) {
      logger.error('Suggestion failed:', error);
      return [];
    }
  }

  async deleteDocument(
    customerContext: CustomerContext,
    indexType: 'transcriptions' | 'summaries',
    documentId: string
  ): Promise<boolean> {
    try {
      const indexName = this.getIndexName(customerContext.customerId, indexType);
      
      await this.client.delete({
        index: indexName,
        id: documentId
      });

      logger.info(`Deleted document ${documentId} from ${indexName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete document ${documentId}:`, error);
      return false;
    }
  }

  /**
   * Semantic/vector search using embeddings
   */
  async vectorSearch(
    customerContext: CustomerContext,
    indexType: 'transcriptions' | 'summaries',
    queryEmbedding: number[],
    size: number = 10,
    minScore: number = 0.7
  ): Promise<SearchResponse> {
    try {
      const indexName = this.getIndexName(customerContext.customerId, indexType);
      
      const searchParams = {
        index: indexName,
        body: {
          size,
          min_score: minScore,
          query: {
            bool: {
              must: [
                {
                  term: { customerId: customerContext.customerId }
                },
                {
                  knn: {
                    embedding: {
                      vector: queryEmbedding,
                      k: size
                    }
                  }
                }
              ]
            }
          }
        }
      };

      const response = await this.client.search(searchParams);
      
      const results = response.body.hits.hits.map((hit: any) => ({
        ...hit._source,
        _score: hit._score
      }));

      logger.debug(`Vector search returned ${results.length} results for customer ${customerContext.customerId}`);

      return {
        total: typeof response.body.hits.total === 'number' ? response.body.hits.total : response.body.hits.total?.value || 0,
        results,
        aggregations: response.body.aggregations,
        took: response.body.took
      };
    } catch (error) {
      logger.error('Vector search failed:', error);
      return {
        total: 0,
        results: [],
        took: 0
      };
    }
  }

  /**
   * Hybrid search: combines keyword and vector search
   */
  async hybridSearch(
    customerContext: CustomerContext,
    indexType: 'transcriptions' | 'summaries',
    searchQuery: SearchQuery,
    queryEmbedding?: number[],
    vectorWeight: number = 0.5
  ): Promise<SearchResponse> {
    try {
      const indexName = this.getIndexName(customerContext.customerId, indexType);
      
      const mustClauses: any[] = [
        { term: { customerId: customerContext.customerId } }
      ];

      // Add keyword search if query provided
      if (searchQuery.query && searchQuery.query !== '*') {
        mustClauses.push({
          multi_match: {
            query: searchQuery.query,
            fields: [
              'transcriptionText^2',
              'transcriptionText.multilingual^1.5',
              'processedText^1.2',
              'keyPoints^1.8',
              'entities.value^1.0'
            ],
            type: 'best_fields',
            fuzziness: 'AUTO'
          }
        });
      }

      // Add vector search if embedding provided
      if (queryEmbedding && queryEmbedding.length === 768) {
        mustClauses.push({
          knn: {
            embedding: {
              vector: queryEmbedding,
              k: searchQuery.size || 20,
              boost: vectorWeight
            }
          }
        });
      }

      const searchParams = {
        index: indexName,
        body: {
          size: searchQuery.size || 20,
          from: searchQuery.from || 0,
          query: {
            bool: {
              must: mustClauses
            }
          },
          sort: searchQuery.sort || [{ '_score': { order: 'desc' as const } }, { 'indexedAt': { order: 'desc' as const } }]
        }
      };

      const response = await this.client.search(searchParams);
      
      const results = response.body.hits.hits
        .filter((hit: any) => hit._score >= 0.1)
        .map((hit: any) => ({
          ...hit._source,
          _score: hit._score
        }));

      logger.debug(`Hybrid search returned ${results.length} results for customer ${customerContext.customerId}`);

      return {
        total: typeof response.body.hits.total === 'number' ? response.body.hits.total : response.body.hits.total?.value || 0,
        results,
        aggregations: response.body.aggregations,
        took: response.body.took
      };
    } catch (error) {
      logger.error('Hybrid search failed:', error);
      return {
        total: 0,
        results: [],
        took: 0
      };
    }
  }

  async getStats(customerContext?: CustomerContext): Promise<any> {
    try {
      const indexPattern = customerContext 
        ? this.getIndexName(customerContext.customerId, '*')
        : `${this.indexPrefix}-*`;

      const [clusterStats, indexStats] = await Promise.all([
        this.client.cluster.stats(),
        this.client.indices.stats({ index: indexPattern })
      ]);

      return {
        cluster: {
          status: clusterStats.body.status,
          nodes: clusterStats.body.nodes?.count || 0,
          indices: clusterStats.body.indices?.count || 0,
          shards: clusterStats.body.indices?.shards || {}
        },
        indices: indexStats.body.indices || {},
        health: await this.healthCheck()
      };
    } catch (error) {
      logger.error('Failed to get OpenSearch stats:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private getIndexName(customerId: string | null, indexType: string): string {
    // Handle null customerId for admin users - search ALL customer indices for complete business view
    if (!customerId) {
      return `${this.indexPrefix}-*-${indexType}`;
    }
    return `${this.indexPrefix}-${customerId.toLowerCase()}-${indexType}`;
  }

  private buildSearchQuery(searchQuery: SearchQuery, customerContext: CustomerContext): any {
    const mustClauses = [];
    
    // Only add customer filter if customerId is provided (not for admin users)
    if (customerContext.customerId) {
      mustClauses.push({ term: { customerId: customerContext.customerId } });
    }

    if (searchQuery.query && searchQuery.query !== '*') {
      mustClauses.push({
        multi_match: {
          query: searchQuery.query,
          fields: [
            'transcriptionText^2',
            'transcriptionText.multilingual',
            'processedText^1.5',
            'keyPoints',
            'summary.main_points'
          ],
          fuzziness: 'AUTO',
          operator: 'or'
        }
      } as any);
    } else if (searchQuery.query === '*') {
      // For wildcard queries, use match_all to find all documents
      mustClauses.push({ match_all: {} });
    }

    const filterClauses: any[] = [];

    if (searchQuery.filters) {
      const { dateFrom, dateTo, language, sentiment, callType, agentId } = searchQuery.filters;

      if (dateFrom || dateTo) {
        const range: any = { callDate: {} };
        if (dateFrom) range.callDate.gte = dateFrom;
        if (dateTo) range.callDate.lte = dateTo;
        filterClauses.push({ range });
      }

      if (language) {
        filterClauses.push({ term: { language } });
      }

      if (sentiment) {
        filterClauses.push({ term: { sentiment } });
      }

      if (callType) {
        filterClauses.push({ term: { callType } });
      }

      if (agentId) {
        filterClauses.push({ term: { agentId } });
      }
    }

    return {
      bool: {
        must: mustClauses,
        filter: filterClauses
      }
    };
  }

  private buildAggregations(aggregations: AggregationQuery[]): any {
    const aggs: any = {};

    aggregations.forEach(agg => {
      switch (agg.type) {
        case 'terms':
          aggs[`${agg.field}_terms`] = {
            terms: {
              field: agg.field,
              size: agg.size || 10
            }
          };
          break;

        case 'date_histogram':
          aggs[`${agg.field}_histogram`] = {
            date_histogram: {
              field: agg.field,
              calendar_interval: agg.interval || 'day'
            }
          };
          break;

        case 'range':
          aggs[`${agg.field}_range`] = {
            range: {
              field: agg.field,
              ranges: agg.ranges || []
            }
          };
          break;

        case 'avg':
          aggs[`${agg.field}_avg`] = {
            avg: { field: agg.field }
          };
          break;

        case 'sum':
          aggs[`${agg.field}_sum`] = {
            sum: { field: agg.field }
          };
          break;

        case 'cardinality':
          aggs[`${agg.field}_cardinality`] = {
            cardinality: { field: agg.field }
          };
          break;
      }
    });

    return aggs;
  }

  private getIndexSettings(indexType: string): any {
    return {
      number_of_shards: 1,
      number_of_replicas: 0,
      analysis: {
        analyzer: {
          hebrew_analyzer: {
            type: 'custom',
            tokenizer: 'standard',
            filter: [
              'lowercase',
              'basic_hebrew_stop',
              'asciifolding'
            ]
          },
          hebrew_search_analyzer: {
            type: 'custom',
            tokenizer: 'standard',
            filter: [
              'lowercase',
              'basic_hebrew_stop',
              'asciifolding'
            ]
          },
          multilingual_analyzer: {
            type: 'custom',
            tokenizer: 'standard',
            filter: [
              'lowercase',
              'stop',
              'asciifolding'
            ]
          }
        },
        filter: {
          basic_hebrew_stop: {
            type: 'stop',
            stopwords: [
              // Minimal stopwords - let DictaLM handle Hebrew naturally
              'של', 'את', 'על', 'עם', 'כל', 'זה', 'לא', 'אני', 'הוא', 'היא'
            ]
          }
        }
      }
    };
  }

  private getIndexMappings(indexType: string): any {
    const baseMapping = {
      properties: {
        callId: { type: 'keyword', index: true },
        customerId: { type: 'keyword', index: true },
        subscriberId: { type: 'keyword', index: true },
        language: { type: 'keyword', index: true },
        callDate: {
          type: 'date',
          format: 'yyyy-MM-dd\'T\'HH:mm:ss\'Z\'||yyyy-MM-dd\'T\'HH:mm:ssZ||yyyy-MM-dd||epoch_millis'
        },
        indexedAt: { type: 'date' }
      }
    };

    if (indexType === 'transcriptions') {
      return {
        ...baseMapping,
        properties: {
          ...baseMapping.properties,
          transcriptionText: {
            type: 'text',
            analyzer: 'hebrew_analyzer',
            search_analyzer: 'hebrew_search_analyzer',
            fields: {
              raw: { type: 'keyword' },
              multilingual: {
                type: 'text',
                analyzer: 'multilingual_analyzer'
              }
            }
          },
          processedText: {
            type: 'text',
            analyzer: 'hebrew_analyzer',
            search_analyzer: 'hebrew_search_analyzer'
          },
          durationSeconds: { type: 'integer' },
          agentId: { type: 'keyword', index: true },
          callType: { type: 'keyword', index: true },
          sentiment: { type: 'keyword', index: true },
          productsMentioned: { type: 'keyword', index: true },
          keyPoints: {
            type: 'text',
            analyzer: 'hebrew_analyzer',
            search_analyzer: 'hebrew_search_analyzer'
          },
          // Vector embeddings for semantic search (AlephBERT Hebrew model)
          embedding: {
            type: 'knn_vector',
            dimension: 768,
            method: {
              name: 'hnsw',
              space_type: 'l2',
              engine: 'lucene'
            }
          },
          embeddingModel: { type: 'keyword', index: true },
          entities: {
            type: 'nested',
            properties: {
              type: { type: 'keyword' },
              value: { type: 'keyword' },
              confidence: { type: 'float' }
            }
          },
          phoneNumbers: { type: 'keyword', index: true },
          summary: {
            type: 'object',
            properties: {
              main_points: {
                type: 'text',
                analyzer: 'hebrew_analyzer'
              },
              customer_satisfaction: { type: 'keyword' },
              issue_resolved: { type: 'boolean' },
              followup_required: { type: 'boolean' }
            }
          }
        }
      };
    } else {
      // summaries mapping
      return {
        ...baseMapping,
        properties: {
          ...baseMapping.properties,
          summaryText: {
            type: 'text',
            analyzer: 'hebrew_analyzer'
          },
          keyTopics: { type: 'keyword', index: true },
          sentiment: { type: 'keyword', index: true },
          urgency: { type: 'keyword', index: true },
          createdAt: { type: 'date' }
        }
      };
    }
  }

  // Additional methods for Kafka consumer compatibility
  async indexExists(indexName: string): Promise<boolean> {
    try {
      const response = await this.client.indices.exists({ index: indexName });
      return response.body;
    } catch (error) {
      logger.error(`Failed to check if index exists: ${indexName}`, error);
      return false;
    }
  }

  async createIndex(indexName: string, indexConfig: any): Promise<void> {
    try {
      await this.client.indices.create({
        index: indexName,
        body: indexConfig
      });
      logger.info(`Created index: ${indexName}`);
    } catch (error) {
      logger.error(`Failed to create index: ${indexName}`, error);
      throw error;
    }
  }

  // Overload the existing indexDocument method for Kafka consumer compatibility
  async indexDocument(
    indexNameOrCustomerContext: string | CustomerContext,
    documentIdOrIndexType?: string | ('transcriptions' | 'summaries'),
    documentOrDocument?: any,
    documentId?: string
  ): Promise<boolean | void> {
    // If first parameter is a string, this is the new signature for Kafka consumers
    if (typeof indexNameOrCustomerContext === 'string') {
      const indexName = indexNameOrCustomerContext;
      const docId = documentIdOrIndexType as string;
      const document = documentOrDocument;
      
      try {
        await this.client.index({
          index: indexName,
          id: docId,
          body: document
        });
        logger.debug(`Indexed document ${docId} in ${indexName}`);
        return;
      } catch (error) {
        logger.error(`Failed to index document ${docId} in ${indexName}`, error);
        throw error;
      }
    } else {
      // Original signature for existing code
      const customerContext = indexNameOrCustomerContext;
      const indexType = documentIdOrIndexType as 'transcriptions' | 'summaries';
      const document = documentOrDocument;
      const docId = documentId;
      
      try {
        const indexName = this.getIndexName(customerContext.customerId, indexType);
        
        // Ensure index exists
        await this.createIndexForCustomer(customerContext, indexType);

        // Add customer isolation and timestamp
        const indexDoc = {
          ...document,
          customerId: customerContext.customerId,
          indexedAt: new Date().toISOString()
        };

        const params: any = {
          index: indexName,
          body: indexDoc
        };

        if (docId) {
          params.id = docId;
        }

        const response = await this.client.index(params);
        
        logger.debug(`Indexed document in ${indexName}: ${response.body._id}`);
        return true;
      } catch (error) {
        logger.error(`Failed to index document:`, error);
        return false;
      }
    }
  }

  // Overload the existing bulkIndex method for Kafka consumer compatibility
  async bulkIndex(
    operationsOrCustomerContext: any[] | CustomerContext,
    indexType?: 'transcriptions' | 'summaries',
    documents?: any[]
  ): Promise<void | { success: number; errors: number }> {
    // If first parameter is an array, this is the new signature for Kafka consumers
    if (Array.isArray(operationsOrCustomerContext)) {
      const operations = operationsOrCustomerContext;
      
      try {
        const response = await this.client.bulk({
          body: operations,
          refresh: true  // Force immediate refresh to see documents
        });
        
        // Log the full response for debugging
        logger.debug('Bulk response details', {
          took: response.body.took,
          errors: response.body.errors,
          itemCount: response.body.items?.length,
          firstItem: response.body.items?.[0]
        });
        
        if (response.body.errors) {
          const failures = response.body.items.filter((item: any) => 
            item.index?.error || item.create?.error || item.update?.error
          );
          logger.warn('Bulk indexing had errors', { failures });
        }
        
        logger.debug(`Bulk indexed ${operations.length / 2} documents`);
        return;
      } catch (error) {
        logger.error('Bulk indexing failed', error);
        throw error;
      }
    } else {
      // Original signature for existing code
      const customerContext = operationsOrCustomerContext;
      const docs = documents!;
      
      try {
        const indexName = this.getIndexName(customerContext.customerId, indexType!);
        
        // Ensure index exists
        await this.createIndexForCustomer(customerContext, indexType!);

        const body: any[] = [];
        
        docs.forEach(doc => {
          const indexDoc = {
            ...doc,
            customerId: customerContext.customerId,
            indexedAt: new Date().toISOString()
          };

          body.push({
            index: {
              _index: indexName,
              _id: doc.id || undefined
            }
          });
          body.push(indexDoc);
        });

        const response = await this.client.bulk({ body });
        
        let successCount = 0;
        let errorCount = 0;

        if (response.body.items) {
          response.body.items.forEach((item: any) => {
            if (item.index?.error) {
              errorCount++;
            } else {
              successCount++;
            }
          });
        }

        if (errorCount > 0) {
          logger.warn(`Bulk indexing completed with errors`, {
            success: successCount,
            errors: errorCount
          });
        }

        logger.info(`Bulk indexed ${successCount} documents with ${errorCount} errors`);
        return { success: successCount, errors: errorCount };
      } catch (error) {
        logger.error('Bulk indexing failed:', error);
        throw error;
      }
    }
  }

  /**
   * Validate if a customer has any actual conversation data
   * Returns the count of conversations for the customer
   */
  async validateCustomerDataExists(customerId: string): Promise<{ exists: boolean; count: number }> {
    try {
      const indexName = this.getIndexName(customerId, 'transcriptions');
      
      // Check if index exists first
      const indexExists = await this.client.indices.exists({ index: indexName });
      if (!indexExists.body) {
        logger.info(`Customer ${customerId} has no index - no data exists`);
        return { exists: false, count: 0 };
      }
      
      // Check document count in the index
      const countResponse = await this.client.count({
        index: indexName,
        body: {
          query: {
            bool: {
              must: [
                { term: { customerId: customerId } }
              ]
            }
          }
        }
      });
      
      const documentCount = countResponse.body.count || 0;
      
      logger.info(`Customer ${customerId} data validation`, {
        indexExists: true,
        documentCount,
        hasData: documentCount > 0
      });
      
      return {
        exists: documentCount > 0,
        count: documentCount
      };
      
    } catch (error) {
      logger.error(`Failed to validate customer ${customerId} data:`, error);
      return { exists: false, count: 0 };
    }
  }

  /**
   * Validate if a call ID exists across all customer indices
   * Returns the customer ID and count if found
   */
  async validateCallIdExists(callId: string): Promise<{ exists: boolean; count: number; customerId?: string }> {
    try {
      // Search across all transcription indices for the call ID
      const searchResponse = await this.client.search({
        index: `${this.indexPrefix}-*-transcriptions`,
        body: {
          query: {
            bool: {
              must: [
                { term: { 'callId': callId } }
              ]
            }
          },
          size: 1,
          _source: ['customerId', 'callId']
        }
      });
      
      const hits = searchResponse.body.hits;
      const documentCount = typeof hits.total === 'object' ? hits.total.value : hits.total || 0;
      
      if (documentCount > 0 && hits.hits.length > 0) {
        const firstHit = hits.hits[0];
        const customerId = firstHit._source?.customerId;
        
        logger.info(`Call ID ${callId} validation passed`, {
          documentCount,
          customerId,
          hasData: documentCount > 0
        });
        
        return {
          exists: true,
          count: documentCount,
          customerId: customerId
        };
      } else {
        logger.info(`Call ID ${callId} not found in any customer index`);
        return { exists: false, count: 0 };
      }
      
    } catch (error) {
      logger.error(`Failed to validate call ID ${callId}:`, error);
      return { exists: false, count: 0 };
    }
  }

  /**
   * Search for a specific call ID across all customer indices
   */
  async searchByCallId(callId: string): Promise<SearchResponse> {
    try {
      const searchResponse = await this.client.search({
        index: `${this.indexPrefix}-*-transcriptions`,
        body: {
          query: {
            bool: {
              must: [
                { term: { 'callId': callId } }
              ]
            }
          },
          size: 10,
          sort: [{ indexedAt: 'desc' }]
        }
      });
      
      const hits = searchResponse.body.hits;
      const results = hits.hits.map((hit: any) => ({
        ...hit._source,
        score: hit._score
      }));
      
      const totalHits = typeof hits.total === 'object' ? hits.total.value : hits.total || 0;
      
      logger.info(`Call ID search for ${callId}`, {
        totalHits,
        resultsCount: results.length,
        took: searchResponse.body.took
      });
      
      return {
        total: totalHits,
        results: results,
        took: searchResponse.body.took || 0
      };
      
    } catch (error) {
      logger.error(`Failed to search by call ID ${callId}:`, error);
      return {
        total: 0,
        results: [],
        took: 0
      };
    }
  }
}

export const openSearchService = new OpenSearchService();