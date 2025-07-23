import { Response } from 'express';
import Joi from 'joi';
import { AuthenticatedRequest } from '../middleware/customer-isolation.middleware';
import { CacheUtils, cacheKeys } from '../utils/cache.utils';
import { logger } from '../utils/logger';
import { openSearchService } from '../services/opensearch.service';
import { mlService } from '../services/ml.service';
import { oracleService } from '../services/oracle.service';

// Validation schemas
export const analyticsQuerySchema = Joi.object({
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
  granularity: Joi.string().valid('hour', 'day', 'week', 'month').default('day'),
  filters: Joi.object({
    language: Joi.string(),
    sentiment: Joi.string().valid('positive', 'negative', 'neutral'),
    callType: Joi.string(),
    agentId: Joi.string(),
    hasProducts: Joi.boolean()
  })
});

export const trendAnalysisSchema = Joi.object({
  metric: Joi.string().valid('call_volume', 'sentiment', 'duration', 'resolution_rate').required(),
  dateFrom: Joi.date().iso().required(),
  dateTo: Joi.date().iso().required(),
  groupBy: Joi.string().valid('hour', 'day', 'week').default('day')
});

export const comparisonSchema = Joi.object({
  period1: Joi.object({
    dateFrom: Joi.date().iso().required(),
    dateTo: Joi.date().iso().required()
  }).required(),
  period2: Joi.object({
    dateFrom: Joi.date().iso().required(),
    dateTo: Joi.date().iso().required()
  }).required(),
  metrics: Joi.array().items(
    Joi.string().valid('call_volume', 'avg_duration', 'sentiment_distribution', 'resolution_rate')
  ).min(1).required()
});

export class AnalyticsController {
  static async getOverview(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { dateFrom, dateTo, filters } = req.query as any;
      const customerContext = req.customerContext!;
      
      // Generate cache key
      const cacheKey = cacheKeys.analytics.overview(
        customerContext.customerId,
        CacheUtils.generateHashKey({ dateFrom, dateTo, filters })
      );
      
      // Try cache first
      const cached = await CacheUtils.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      
      // Get aggregated data from OpenSearch
      const searchQuery = {
        query: '*',
        filters: {
          dateFrom,
          dateTo,
          ...filters
        },
        size: 0 // Only aggregations
      };
      
      const aggregations = [
        { field: 'callDate', type: 'date_histogram', interval: 'day' },
        { field: 'sentiment', type: 'terms' },
        { field: 'callType', type: 'terms' },
        { field: 'language', type: 'terms' },
        { field: 'durationSeconds', type: 'avg' },
        { field: 'callId', type: 'cardinality' }
      ] as any[];
      
      const analyticsData = await openSearchService.searchWithAggregations(
        customerContext,
        'transcriptions',
        searchQuery,
        aggregations
      );
      
      // Process aggregations into overview format
      const overview = {
        total_calls: analyticsData.aggregations?.callId_cardinality?.value || 0,
        avg_duration: Math.round(analyticsData.aggregations?.durationSeconds_avg?.value || 0),
        sentiment_distribution: this.processBuckets(analyticsData.aggregations?.sentiment_terms?.buckets || []),
        call_types: this.processBuckets(analyticsData.aggregations?.callType_terms?.buckets || []),
        languages: this.processBuckets(analyticsData.aggregations?.language_terms?.buckets || []),
        daily_volume: this.processDateHistogram(analyticsData.aggregations?.callDate_histogram?.buckets || []),
        period: { dateFrom, dateTo },
        generated_at: new Date().toISOString()
      };
      
      // Cache for 15 minutes
      await CacheUtils.set(cacheKey, overview, 900);
      
      res.json(overview);
    } catch (error) {
      logger.error('Analytics overview error:', error);
      res.status(500).json({ 
        error: 'Failed to generate analytics overview',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getTrends(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { metric, dateFrom, dateTo, groupBy } = req.body;
      const customerContext = req.customerContext!;
      
      logger.info(`Generating trend analysis for ${metric} from ${dateFrom} to ${dateTo}`);
      
      const searchQuery = {
        query: '*',
        filters: { dateFrom, dateTo },
        size: 0
      };
      
      let aggregations: any[] = [];
      
      switch (metric) {
        case 'call_volume':
          aggregations = [
            { field: 'callDate', type: 'date_histogram', interval: groupBy },
            { field: 'callId', type: 'cardinality' }
          ];
          break;
          
        case 'sentiment':
          aggregations = [
            { field: 'callDate', type: 'date_histogram', interval: groupBy },
            { field: 'sentiment', type: 'terms' }
          ];
          break;
          
        case 'duration':
          aggregations = [
            { field: 'callDate', type: 'date_histogram', interval: groupBy },
            { field: 'durationSeconds', type: 'avg' }
          ];
          break;
          
        case 'resolution_rate':
          aggregations = [
            { field: 'callDate', type: 'date_histogram', interval: groupBy },
            { field: 'summary.issue_resolved', type: 'terms' }
          ];
          break;
      }
      
      const trendData = await openSearchService.searchWithAggregations(
        customerContext,
        'transcriptions',
        searchQuery,
        aggregations
      );
      
      const trends = this.processTrendData(trendData.aggregations, metric, groupBy);
      
      res.json({
        metric,
        period: { dateFrom, dateTo },
        groupBy,
        trends,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Trend analysis error:', error);
      res.status(500).json({ 
        error: 'Failed to generate trend analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getComparison(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { period1, period2, metrics } = req.body;
      const customerContext = req.customerContext!;
      
      logger.info(`Comparing periods: ${JSON.stringify(period1)} vs ${JSON.stringify(period2)}`);
      
      // Get data for both periods
      const [data1, data2] = await Promise.all([
        this.getPeriodData(customerContext, period1, metrics),
        this.getPeriodData(customerContext, period2, metrics)
      ]);
      
      // Calculate comparisons
      const comparison = {
        period1: { ...period1, data: data1 },
        period2: { ...period2, data: data2 },
        changes: this.calculateChanges(data1, data2, metrics),
        generated_at: new Date().toISOString()
      };
      
      res.json(comparison);
    } catch (error) {
      logger.error('Comparison analysis error:', error);
      res.status(500).json({ 
        error: 'Failed to generate comparison',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getTopics(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { dateFrom, dateTo, limit = 20 } = req.query as any;
      const customerContext = req.customerContext!;
      
      // Get most mentioned products and topics
      const searchQuery = {
        query: '*',
        filters: { dateFrom, dateTo },
        size: 0
      };
      
      const aggregations = [
        { field: 'productsMentioned', type: 'terms', size: limit },
        { field: 'keyPoints', type: 'terms', size: limit },
        { field: 'entities.value', type: 'terms', size: limit }
      ] as any[];
      
      const topicsData = await openSearchService.searchWithAggregations(
        customerContext,
        'transcriptions',
        searchQuery,
        aggregations
      );
      
      const topics = {
        products: this.processBuckets(topicsData.aggregations?.productsMentioned_terms?.buckets || []),
        key_points: this.processBuckets(topicsData.aggregations?.keyPoints_terms?.buckets || []),
        entities: this.processBuckets(topicsData.aggregations?.['entities.value_terms']?.buckets || []),
        period: { dateFrom, dateTo },
        generated_at: new Date().toISOString()
      };
      
      res.json(topics);
    } catch (error) {
      logger.error('Topics analysis error:', error);
      res.status(500).json({ 
        error: 'Failed to generate topics analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getAgentPerformance(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { dateFrom, dateTo, agentId } = req.query as any;
      const customerContext = req.customerContext!;
      
      const searchQuery = {
        query: '*',
        filters: { 
          dateFrom, 
          dateTo,
          ...(agentId && { agentId })
        },
        size: 0
      };
      
      const aggregations = [
        { field: 'agentId', type: 'terms', size: 50 },
        { field: 'sentiment', type: 'terms' },
        { field: 'durationSeconds', type: 'avg' },
        { field: 'summary.issue_resolved', type: 'terms' }
      ] as any[];
      
      const performanceData = await openSearchService.searchWithAggregations(
        customerContext,
        'transcriptions',
        searchQuery,
        aggregations
      );
      
      // Process agent performance metrics
      const agents = performanceData.aggregations?.agentId_terms?.buckets?.map((bucket: any) => ({
        agentId: bucket.key,
        call_count: bucket.doc_count,
        // Additional per-agent metrics would require sub-aggregations
      })) || [];
      
      const performance = {
        agents,
        overall_sentiment: this.processBuckets(performanceData.aggregations?.sentiment_terms?.buckets || []),
        avg_duration: Math.round(performanceData.aggregations?.durationSeconds_avg?.value || 0),
        resolution_rate: this.calculateResolutionRate(performanceData.aggregations?.['summary.issue_resolved_terms']?.buckets || []),
        period: { dateFrom, dateTo },
        generated_at: new Date().toISOString()
      };
      
      res.json(performance);
    } catch (error) {
      logger.error('Agent performance error:', error);
      res.status(500).json({ 
        error: 'Failed to generate agent performance',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async getRealTimeStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const customerContext = req.customerContext!;
      
      // Get stats for the last 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();
      
      const searchQuery = {
        query: '*',
        filters: { 
          dateFrom: oneDayAgo,
          dateTo: now
        },
        size: 0
      };
      
      const aggregations = [
        { field: 'callDate', type: 'date_histogram', interval: 'hour' },
        { field: 'sentiment', type: 'terms' },
        { field: 'callId', type: 'cardinality' }
      ] as any[];
      
      const realtimeData = await openSearchService.searchWithAggregations(
        customerContext,
        'transcriptions',
        searchQuery,
        aggregations
      );
      
      // Also get ML service stats
      const mlStats = await mlService.getMLStats();
      
      const stats = {
        last_24h: {
          total_calls: realtimeData.aggregations?.callId_cardinality?.value || 0,
          sentiment_distribution: this.processBuckets(realtimeData.aggregations?.sentiment_terms?.buckets || []),
          hourly_volume: this.processDateHistogram(realtimeData.aggregations?.callDate_histogram?.buckets || [])
        },
        ml_pipeline: mlStats,
        timestamp: now
      };
      
      res.json(stats);
    } catch (error) {
      logger.error('Real-time stats error:', error);
      res.status(500).json({ 
        error: 'Failed to get real-time statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  static async exportData(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { dateFrom, dateTo, format = 'json', filters } = req.query as any;
      const customerContext = req.customerContext!;
      
      logger.info(`Exporting data from ${dateFrom} to ${dateTo} in ${format} format`);
      
      const searchQuery = {
        query: '*',
        filters: { dateFrom, dateTo, ...filters },
        size: 10000 // Large export
      };
      
      const exportData = await openSearchService.search(
        customerContext,
        'transcriptions',
        searchQuery
      );
      
      if (format === 'csv') {
        const csv = this.convertToCSV(exportData.results);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="call-analytics-${dateFrom}-to-${dateTo}.csv"`);
        res.send(csv);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="call-analytics-${dateFrom}-to-${dateTo}.json"`);
        res.json({
          export_info: {
            period: { dateFrom, dateTo },
            total_records: exportData.total,
            exported_records: exportData.results.length,
            generated_at: new Date().toISOString()
          },
          data: exportData.results
        });
      }
    } catch (error) {
      logger.error('Data export error:', error);
      res.status(500).json({ 
        error: 'Failed to export data',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Helper methods
  private static processBuckets(buckets: any[]): Array<{ key: string; count: number; percentage?: number }> {
    const total = buckets.reduce((sum, bucket) => sum + bucket.doc_count, 0);
    
    return buckets.map(bucket => ({
      key: bucket.key,
      count: bucket.doc_count,
      percentage: total > 0 ? Math.round((bucket.doc_count / total) * 100) : 0
    }));
  }

  private static processDateHistogram(buckets: any[]): Array<{ date: string; count: number }> {
    return buckets.map(bucket => ({
      date: bucket.key_as_string || bucket.key,
      count: bucket.doc_count
    }));
  }

  private static processTrendData(aggregations: any, metric: string, groupBy: string): any[] {
    const histogramKey = `callDate_histogram`;
    const buckets = aggregations?.[histogramKey]?.buckets || [];
    
    return buckets.map((bucket: any) => ({
      date: bucket.key_as_string || bucket.key,
      value: this.extractMetricValue(bucket, metric)
    }));
  }

  private static extractMetricValue(bucket: any, metric: string): number {
    switch (metric) {
      case 'call_volume':
        return bucket.doc_count;
      case 'duration':
        return Math.round(bucket.durationSeconds_avg?.value || 0);
      case 'sentiment':
        return bucket.sentiment_terms?.buckets?.[0]?.doc_count || 0;
      case 'resolution_rate':
        const resolved = bucket['summary.issue_resolved_terms']?.buckets?.find((b: any) => b.key === true);
        return resolved ? Math.round((resolved.doc_count / bucket.doc_count) * 100) : 0;
      default:
        return bucket.doc_count;
    }
  }

  private static async getPeriodData(customerContext: any, period: any, metrics: string[]): Promise<any> {
    const searchQuery = {
      query: '*',
      filters: period,
      size: 0
    };
    
    const aggregations = [
      { field: 'callId', type: 'cardinality' },
      { field: 'durationSeconds', type: 'avg' },
      { field: 'sentiment', type: 'terms' },
      { field: 'summary.issue_resolved', type: 'terms' }
    ] as any[];
    
    const data = await openSearchService.searchWithAggregations(
      customerContext,
      'transcriptions',
      searchQuery,
      aggregations
    );
    
    return {
      call_volume: data.aggregations?.callId_cardinality?.value || 0,
      avg_duration: Math.round(data.aggregations?.durationSeconds_avg?.value || 0),
      sentiment_distribution: this.processBuckets(data.aggregations?.sentiment_terms?.buckets || []),
      resolution_rate: this.calculateResolutionRate(data.aggregations?.['summary.issue_resolved_terms']?.buckets || [])
    };
  }

  private static calculateChanges(data1: any, data2: any, metrics: string[]): any {
    const changes: any = {};
    
    metrics.forEach(metric => {
      if (metric === 'call_volume') {
        const change = data2.call_volume - data1.call_volume;
        const percentage = data1.call_volume > 0 ? Math.round((change / data1.call_volume) * 100) : 0;
        changes.call_volume = { absolute: change, percentage };
      }
      
      if (metric === 'avg_duration') {
        const change = data2.avg_duration - data1.avg_duration;
        const percentage = data1.avg_duration > 0 ? Math.round((change / data1.avg_duration) * 100) : 0;
        changes.avg_duration = { absolute: change, percentage };
      }
      
      // Add more metric comparisons as needed
    });
    
    return changes;
  }

  private static calculateResolutionRate(buckets: any[]): number {
    const total = buckets.reduce((sum, bucket) => sum + bucket.doc_count, 0);
    const resolved = buckets.find(bucket => bucket.key === true)?.doc_count || 0;
    
    return total > 0 ? Math.round((resolved / total) * 100) : 0;
  }

  private static convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvHeaders = headers.join(',');
    
    const csvRows = data.map(row => 
      headers.map(header => {
        const value = row[header];
        // Escape CSV values
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    );
    
    return [csvHeaders, ...csvRows].join('\n');
  }
}