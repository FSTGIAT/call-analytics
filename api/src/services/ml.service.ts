import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { logger } from '../utils/logger';
import { CustomerContext } from '../types/customer';

export interface MLServiceConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  retryDelay: number;
}

export interface CallProcessingOptions {
  enableEmbeddings?: boolean;
  enableLLM?: boolean;
  enableVectorStorage?: boolean;
  timeout?: number;
}

export interface SearchOptions {
  limit?: number;
  certainty?: number;
  includeEmbeddings?: boolean;
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    callType?: string;
    language?: string;
  };
}

export interface MLProcessingResult {
  success: boolean;
  callId: string;
  processingTime: number;
  results: {
    preprocessing?: any;
    embedding?: any;
    llmAnalysis?: any;
    vectorStorage?: any;
    productAnalysis?: any;
  };
  errors: string[];
}

export interface IntelligentSearchResult {
  success: boolean;
  query: string;
  processedQuery: string;
  results: any[];
  totalFound: number;
  processingTime: number;
  searchDetails?: any;
  error?: string;
}

export class MLService {
  private client: AxiosInstance;
  private config: MLServiceConfig;

  constructor() {
    this.config = {
      baseUrl: process.env.ML_SERVICE_URL || 'http://ml-service:5000',
      timeout: parseInt(process.env.ML_SERVICE_TIMEOUT || '60000'),
      retries: parseInt(process.env.ML_SERVICE_RETRIES || '3'),
      retryDelay: parseInt(process.env.ML_SERVICE_RETRY_DELAY || '1000')
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });

    // Add request/response interceptors
    this.setupInterceptors();

    logger.info(`ML Service client initialized: ${this.config.baseUrl}`);
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`ML Service request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('ML Service request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`ML Service response: ${response.status} ${response.config.url}`);
        return response;
      },
      async (error) => {
        logger.error('ML Service response error:', error.message);
        
        // Retry logic
        const config = error.config;
        if (!config._retry && config._retryCount < this.config.retries) {
          config._retryCount = config._retryCount || 0;
          config._retryCount++;
          
          logger.info(`Retrying ML Service request (${config._retryCount}/${this.config.retries})`);
          
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
          return this.client(config);
        }
        
        return Promise.reject(error);
      }
    );
  }

  async healthCheck(): Promise<any> {
    try {
      const response = await this.client.get('/health');
      return response.data;
    } catch (error) {
      logger.error('ML Service health check failed:', error);
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async processCall(
    callData: any,
    customerContext: CustomerContext,
    options?: CallProcessingOptions
  ): Promise<MLProcessingResult> {
    try {
      const requestData = {
        call_data: callData,
        customer_context: {
          customerId: customerContext.customerId,
          subscriberIds: customerContext.subscriberIds
        },
        options
      };

      const response = await this.client.post('/pipeline/process-call', requestData);
      return response.data;
    } catch (error) {
      logger.error('ML call processing failed:', error);
      
      return {
        success: false,
        callId: callData.callId || 'unknown',
        processingTime: 0,
        results: {},
        errors: [error instanceof Error ? error.message : 'Processing failed']
      };
    }
  }

  async processBatch(
    callsData: any[],
    customerContext: CustomerContext,
    options?: CallProcessingOptions
  ): Promise<{ batchResults: MLProcessingResult[]; summary: any }> {
    try {
      const requestData = {
        calls_data: callsData,
        customer_context: {
          customerId: customerContext.customerId,
          subscriberIds: customerContext.subscriberIds
        },
        options
      };

      const response = await this.client.post('/pipeline/process-batch', requestData);
      return response.data;
    } catch (error) {
      logger.error('ML batch processing failed:', error);
      
      // Return error results for all calls
      const errorResults = callsData.map(call => ({
        success: false,
        callId: call.callId || 'unknown',
        processingTime: 0,
        results: {},
        errors: [error instanceof Error ? error.message : 'Batch processing failed']
      }));

      return {
        batchResults: errorResults,
        summary: {
          totalCalls: callsData.length,
          successful: 0,
          failed: callsData.length,
          totalErrors: callsData.length,
          avgProcessingTime: 0
        }
      };
    }
  }

  async intelligentSearch(
    query: string,
    customerContext: CustomerContext,
    searchOptions?: SearchOptions
  ): Promise<IntelligentSearchResult> {
    try {
      const requestData = {
        query,
        customer_context: {
          customerId: customerContext.customerId,
          subscriberIds: customerContext.subscriberIds
        },
        search_options: searchOptions
      };

      const response = await this.client.post('/pipeline/intelligent-search', requestData);
      return response.data;
    } catch (error) {
      logger.error('Intelligent search failed:', error);
      
      return {
        success: false,
        query,
        processedQuery: query,
        results: [],
        totalFound: 0,
        processingTime: 0,
        error: error instanceof Error ? error.message : 'Search failed'
      };
    }
  }

  async generateEmbedding(text: string, preprocess: boolean = true): Promise<any> {
    try {
      const response = await this.client.post('/embeddings/generate', {
        text,
        preprocess
      });
      return response.data;
    } catch (error) {
      logger.error('Embedding generation failed:', error);
      throw error;
    }
  }

  async generateBatchEmbeddings(texts: string[], preprocess: boolean = true): Promise<any> {
    try {
      const response = await this.client.post('/embeddings/batch', {
        texts,
        preprocess
      });
      return response.data;
    } catch (error) {
      logger.error('Batch embedding generation failed:', error);
      throw error;
    }
  }

  async semanticSearch(
    query: string,
    customerId: string,
    options?: {
      limit?: number;
      certainty?: number;
      filters?: any;
    }
  ): Promise<any> {
    try {
      const response = await this.client.post('/vector/search', {
        query,
        customer_id: customerId,
        ...options
      });
      return response.data;
    } catch (error) {
      logger.error('Semantic search failed:', error);
      throw error;
    }
  }

  async summarizeCall(
    transcription: string,
    language: string = 'hebrew',
    preferLocal: boolean = true
  ): Promise<any> {
    try {
      const response = await this.client.post('/llm/summarize', {
        transcription,
        language,
        prefer_local: preferLocal
      });
      return response.data;
    } catch (error) {
      logger.error('Call summarization failed:', error);
      throw error;
    }
  }

  async processHebrewText(text: string): Promise<any> {
    try {
      const response = await this.client.post('/hebrew/preprocess', {
        text
      });
      return response.data;
    } catch (error) {
      logger.error('Hebrew text processing failed:', error);
      throw error;
    }
  }

  async addToVectorDatabase(transcriptionData: any): Promise<boolean> {
    try {
      const response = await this.client.post('/vector/add', {
        transcription_data: transcriptionData
      });
      return response.data.success || false;
    } catch (error) {
      logger.error('Vector database add failed:', error);
      return false;
    }
  }

  async batchAddToVectorDatabase(transcriptions: any[]): Promise<any> {
    try {
      const response = await this.client.post('/vector/batch-add', {
        transcriptions
      });
      return response.data;
    } catch (error) {
      logger.error('Vector database batch add failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Batch add failed'
      };
    }
  }

  async getMLStats(): Promise<any> {
    try {
      const [pipelineStats, embeddingStats, llmStats, vectorStats] = await Promise.all([
        this.client.get('/pipeline/stats'),
        this.client.get('/embeddings/stats'),
        this.client.get('/llm/stats'),
        this.client.get('/vector/stats')
      ]);

      return {
        pipeline: pipelineStats.data,
        embeddings: embeddingStats.data,
        llm: llmStats.data,
        vector: vectorStats.data
      };
    } catch (error) {
      logger.error('Failed to get ML stats:', error);
      return {
        error: error instanceof Error ? error.message : 'Stats retrieval failed'
      };
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const health = await this.healthCheck();
      return health.status === 'healthy';
    } catch (error) {
      return false;
    }
  }

  // Convenience methods for common operations
  async processCallWithDefaults(
    callData: any,
    customerContext: CustomerContext
  ): Promise<MLProcessingResult> {
    return this.processCall(callData, customerContext, {
      enableEmbeddings: true,
      enableLLM: true,
      enableVectorStorage: true
    });
  }

  async searchSimilarCalls(
    query: string,
    customerContext: CustomerContext,
    limit: number = 10
  ): Promise<any[]> {
    const searchResult = await this.intelligentSearch(query, customerContext, {
      limit,
      certainty: 0.7
    });
    
    return searchResult.success ? searchResult.results : [];
  }

  async analyzeCallSentiment(transcription: string): Promise<string> {
    try {
      const summary = await this.summarizeCall(transcription, 'hebrew');
      return summary.success ? summary.summary?.sentiment || 'neutral' : 'neutral';
    } catch (error) {
      logger.error('Sentiment analysis failed:', error);
      return 'neutral';
    }
  }

  async extractProductMentions(transcription: string): Promise<string[]> {
    try {
      const summary = await this.summarizeCall(transcription, 'hebrew');
      return summary.success ? summary.summary?.products_mentioned || [] : [];
    } catch (error) {
      logger.error('Product extraction failed:', error);
      return [];
    }
  }
}

export const mlService = new MLService();