import { logger } from '../utils/logger';
import { oracleService } from './oracle.service';
import { vectorStorageService } from './vector-storage.service';
import { openSearchService } from './opensearch.service';

interface AnalyticsQuery {
  type: 'count' | 'sum' | 'avg' | 'list' | 'trend' | 'distribution' | 'peak_hours' | 'sentiment';
  timeframe?: 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
  metric?: string;
  groupBy?: string;
  filters?: {
    sentiment?: string;
    callType?: string;
    agentId?: string;
    minDuration?: number;
    maxDuration?: number;
  };
  customDateRange?: {
    startDate: Date;
    endDate: Date;
  };
}

interface AnalyticsResult {
  success: boolean;
  data?: any;
  message: string;
  error?: string;
  metadata?: {
    query: string;
    executionTime: number;
    rowCount?: number;
  };
}

export class AIAnalyticsService {

  /**
   * Execute analytics query with robust error handling
   */
  static async executeAnalyticsQuery(
    query: AnalyticsQuery,
    customerContext?: any
  ): Promise<AnalyticsResult> {
    const startTime = Date.now();
    let executedQuery = '';

    try {
      logger.info('Executing analytics query', { query, customerContext });

      // Get date range
      const dateRange = this.getDateRange(query.timeframe || 'today', query.customDateRange);

      // Route to appropriate handler
      switch (query.type) {
        case 'count':
          return await this.executeCountQuery(dateRange, query.filters, customerContext);
        
        case 'avg':
          return await this.executeAverageQuery(dateRange, query.filters, customerContext);
        
        case 'distribution':
          return await this.executeDistributionQuery(dateRange, query.filters, customerContext);
        
        case 'peak_hours':
          return await this.executePeakHoursQuery(dateRange, query.filters, customerContext);
        
        case 'sentiment':
          return await this.executeSentimentQuery(dateRange, query.filters, customerContext);
        
        case 'list':
          return await this.executeListQuery(dateRange, query.filters, customerContext);
        
        case 'trend':
          return await this.executeTrendQuery(dateRange, query.filters, customerContext);
        
        default:
          return {
            success: false,
            message: 'סוג שאילתה לא נתמך',
            error: `Unsupported query type: ${query.type}`,
          };
      }
    } catch (error) {
      logger.error('Analytics query error:', error);
      return {
        success: false,
        message: 'אירעה שגיאה בביצוע השאילתה',
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          query: executedQuery,
          executionTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Execute count query
   */
  private static async executeCountQuery(
    dateRange: { startDate: Date; endDate: Date },
    filters?: AnalyticsQuery['filters'],
    customerContext?: any
  ): Promise<AnalyticsResult> {
    const query = `
      SELECT COUNT(*) as total_calls
      FROM VERINT_TEXT_ANALYSIS
      WHERE CALL_TIME >= :startDate
        AND CALL_TIME < :endDate
        ${customerContext?.customerId && !customerContext.isAdmin ? 'AND CUSTOMER_ID = :customerId' : ''}
        ${filters?.sentiment ? 'AND SENTIMENT = :sentiment' : ''}
        ${filters?.callType ? 'AND CALL_TYPE = :callType' : ''}
        ${filters?.minDuration ? 'AND DURATION_SECONDS >= :minDuration' : ''}
        ${filters?.maxDuration ? 'AND DURATION_SECONDS <= :maxDuration' : ''}
    `;

    const bindings = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(customerContext?.customerId && !customerContext.isAdmin ? { customerId: customerContext.customerId } : {}),
      ...(filters?.sentiment ? { sentiment: filters.sentiment } : {}),
      ...(filters?.callType ? { callType: filters.callType } : {}),
      ...(filters?.minDuration ? { minDuration: filters.minDuration } : {}),
      ...(filters?.maxDuration ? { maxDuration: filters.maxDuration } : {}),
    };

    const result = await oracleService.executeQuery(query, bindings);
    const count = result?.[0]?.TOTAL_CALLS || 0;

    return {
      success: true,
      data: { count },
      message: `נמצאו ${count} שיחות בתקופה המבוקשת`,
      metadata: {
        query,
        executionTime: 0,
        rowCount: 1,
      },
    };
  }

  /**
   * Execute average duration query
   */
  private static async executeAverageQuery(
    dateRange: { startDate: Date; endDate: Date },
    filters?: AnalyticsQuery['filters'],
    customerContext?: any
  ): Promise<AnalyticsResult> {
    const query = `
      SELECT 
        AVG(DURATION_SECONDS) as avg_duration,
        MIN(DURATION_SECONDS) as min_duration,
        MAX(DURATION_SECONDS) as max_duration,
        COUNT(*) as total_calls
      FROM VERINT_TEXT_ANALYSIS
      WHERE CALL_TIME >= :startDate
        AND CALL_TIME < :endDate
        ${customerContext?.customerId && !customerContext.isAdmin ? 'AND CUSTOMER_ID = :customerId' : ''}
        ${filters?.sentiment ? 'AND SENTIMENT = :sentiment' : ''}
    `;

    const bindings = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(customerContext?.customerId && !customerContext.isAdmin ? { customerId: customerContext.customerId } : {}),
      ...(filters?.sentiment ? { sentiment: filters.sentiment } : {}),
    };

    const result = await oracleService.executeQuery(query, bindings);
    const avgDuration = Math.round(result?.[0]?.AVG_DURATION || 0);
    const minDuration = Math.round(result?.[0]?.MIN_DURATION || 0);
    const maxDuration = Math.round(result?.[0]?.MAX_DURATION || 0);
    const totalCalls = result?.[0]?.TOTAL_CALLS || 0;

    const formatDuration = (seconds: number) => {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${minutes} דקות ו-${secs} שניות`;
    };

    return {
      success: true,
      data: {
        average: avgDuration,
        minimum: minDuration,
        maximum: maxDuration,
        totalCalls,
      },
      message: `משך שיחה ממוצע: ${formatDuration(avgDuration)}\nקצרה ביותר: ${formatDuration(minDuration)}\nארוכה ביותר: ${formatDuration(maxDuration)}\nסה"כ ${totalCalls} שיחות`,
      metadata: {
        query,
        executionTime: 0,
        rowCount: 1,
      },
    };
  }

  /**
   * Execute sentiment distribution query
   */
  private static async executeSentimentQuery(
    dateRange: { startDate: Date; endDate: Date },
    filters?: AnalyticsQuery['filters'],
    customerContext?: any
  ): Promise<AnalyticsResult> {
    const query = `
      SELECT 
        SENTIMENT,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
      FROM VERINT_TEXT_ANALYSIS
      WHERE CALL_TIME >= :startDate
        AND CALL_TIME < :endDate
        ${customerContext?.customerId && !customerContext.isAdmin ? 'AND CUSTOMER_ID = :customerId' : ''}
      GROUP BY SENTIMENT
      ORDER BY count DESC
    `;

    const bindings = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(customerContext?.customerId && !customerContext.isAdmin ? { customerId: customerContext.customerId } : {}),
    };

    const result = await oracleService.executeQuery(query, bindings);
    
    if (!result || result.length === 0) {
      return {
        success: true,
        data: { distribution: [] },
        message: 'לא נמצאו נתוני סנטימנט לתקופה המבוקשת',
        metadata: { query, executionTime: 0, rowCount: 0 },
      };
    }

    let message = 'התפלגות סנטימנט:\n';
    const distribution = result.map((row: any) => {
      const sentimentDisplay = {
        'positive': 'חיובי',
        'negative': 'שלילי',
        'neutral': 'ניטרלי',
      }[row.SENTIMENT] || row.SENTIMENT;
      
      message += `• ${sentimentDisplay}: ${row.COUNT} שיחות (${row.PERCENTAGE}%)\n`;
      
      return {
        sentiment: row.SENTIMENT,
        count: row.COUNT,
        percentage: row.PERCENTAGE,
      };
    });

    return {
      success: true,
      data: { distribution },
      message,
      metadata: {
        query,
        executionTime: 0,
        rowCount: result.length,
      },
    };
  }

  /**
   * Execute peak hours query
   */
  private static async executePeakHoursQuery(
    dateRange: { startDate: Date; endDate: Date },
    filters?: AnalyticsQuery['filters'],
    customerContext?: any
  ): Promise<AnalyticsResult> {
    const query = `
      SELECT 
        EXTRACT(HOUR FROM CALL_TIME) as hour,
        COUNT(*) as call_count
      FROM VERINT_TEXT_ANALYSIS
      WHERE CALL_TIME >= :startDate
        AND CALL_TIME < :endDate
        ${customerContext?.customerId && !customerContext.isAdmin ? 'AND CUSTOMER_ID = :customerId' : ''}
      GROUP BY EXTRACT(HOUR FROM CALL_TIME)
      ORDER BY call_count DESC
      FETCH FIRST 5 ROWS ONLY
    `;

    const bindings = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(customerContext?.customerId && !customerContext.isAdmin ? { customerId: customerContext.customerId } : {}),
    };

    const result = await oracleService.executeQuery(query, bindings);
    
    if (!result || result.length === 0) {
      return {
        success: true,
        data: { peakHours: [] },
        message: 'לא נמצאו נתונים לתקופה המבוקשת',
        metadata: { query, executionTime: 0, rowCount: 0 },
      };
    }

    let message = 'שעות השיא (5 המובילות):\n';
    const peakHours = result.map((row: any) => {
      const hour = row.HOUR;
      const nextHour = (hour + 1) % 24;
      message += `• ${hour}:00-${nextHour}:00 - ${row.CALL_COUNT} שיחות\n`;
      
      return {
        hour: row.HOUR,
        callCount: row.CALL_COUNT,
      };
    });

    return {
      success: true,
      data: { peakHours },
      message,
      metadata: {
        query,
        executionTime: 0,
        rowCount: result.length,
      },
    };
  }

  /**
   * Execute list query (top issues/topics)
   */
  private static async executeListQuery(
    dateRange: { startDate: Date; endDate: Date },
    filters?: AnalyticsQuery['filters'],
    customerContext?: any
  ): Promise<AnalyticsResult> {
    // First, try to get data from vector search for better semantic understanding
    try {
      const vectorResults = await vectorStorageService.searchSimilar(
        'בעיות נפוצות תקלות עיקריות',
        customerContext,
        { limit: 10, certainty: 0.6 }
      );

      if (vectorResults && vectorResults.length > 0) {
        // Analyze common themes in transcriptions
        const themes: Map<string, number> = new Map();
        const keywords = [
          'אינטרנט', 'חיבור', 'מהירות', 'ניתוק', 'תקלה',
          'חשבון', 'חיוב', 'תשלום', 'החזר', 'כסף',
          'שירות', 'תמיכה', 'טכנאי', 'ביקור', 'תיקון'
        ];

        vectorResults.forEach(result => {
          const text = result.properties.transcriptionText || '';
          keywords.forEach(keyword => {
            if (text.includes(keyword)) {
              themes.set(keyword, (themes.get(keyword) || 0) + 1);
            }
          });
        });

        const topThemes = Array.from(themes.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        if (topThemes.length > 0) {
          let message = 'הנושאים העיקריים בשיחות:\n';
          topThemes.forEach(([theme, count], idx) => {
            message += `${idx + 1}. ${theme} - מופיע ב-${count} שיחות\n`;
          });

          return {
            success: true,
            data: { themes: topThemes },
            message,
            metadata: {
              query: 'vector search',
              executionTime: 0,
              rowCount: topThemes.length,
            },
          };
        }
      }
    } catch (error) {
      logger.warn('Vector search failed, falling back to SQL', error);
    }

    // Fallback to SQL query
    const query = `
      SELECT 
        CALL_TYPE,
        COUNT(*) as count
      FROM VERINT_TEXT_ANALYSIS
      WHERE CALL_TIME >= :startDate
        AND CALL_TIME < :endDate
        ${customerContext?.customerId && !customerContext.isAdmin ? 'AND CUSTOMER_ID = :customerId' : ''}
      GROUP BY CALL_TYPE
      ORDER BY count DESC
      FETCH FIRST 5 ROWS ONLY
    `;

    const bindings = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(customerContext?.customerId && !customerContext.isAdmin ? { customerId: customerContext.customerId } : {}),
    };

    const result = await oracleService.executeQuery(query, bindings);
    
    if (!result || result.length === 0) {
      return {
        success: true,
        data: { topics: [] },
        message: 'לא נמצאו נתונים לתקופה המבוקשת',
        metadata: { query, executionTime: 0, rowCount: 0 },
      };
    }

    let message = 'סוגי הפניות העיקריים:\n';
    result.forEach((row: any, idx: number) => {
      message += `${idx + 1}. ${row.CALL_TYPE || 'לא מוגדר'} - ${row.COUNT} שיחות\n`;
    });

    return {
      success: true,
      data: { topics: result },
      message,
      metadata: {
        query,
        executionTime: 0,
        rowCount: result.length,
      },
    };
  }

  /**
   * Execute trend comparison query
   */
  private static async executeTrendQuery(
    dateRange: { startDate: Date; endDate: Date },
    filters?: AnalyticsQuery['filters'],
    customerContext?: any
  ): Promise<AnalyticsResult> {
    // Calculate previous period
    const periodLength = dateRange.endDate.getTime() - dateRange.startDate.getTime();
    const previousStart = new Date(dateRange.startDate.getTime() - periodLength);
    const previousEnd = dateRange.startDate;

    // Get counts for both periods
    const currentQuery = `
      SELECT COUNT(*) as count FROM VERINT_TEXT_ANALYSIS
      WHERE CALL_TIME >= :startDate AND CALL_TIME < :endDate
      ${customerContext?.customerId && !customerContext.isAdmin ? 'AND CUSTOMER_ID = :customerId' : ''}
    `;

    const previousQuery = `
      SELECT COUNT(*) as count FROM VERINT_TEXT_ANALYSIS
      WHERE CALL_TIME >= :startDate AND CALL_TIME < :endDate
      ${customerContext?.customerId && !customerContext.isAdmin ? 'AND CUSTOMER_ID = :customerId' : ''}
    `;

    const currentBindings = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(customerContext?.customerId && !customerContext.isAdmin ? { customerId: customerContext.customerId } : {}),
    };

    const previousBindings = {
      startDate: previousStart,
      endDate: previousEnd,
      ...(customerContext?.customerId && !customerContext.isAdmin ? { customerId: customerContext.customerId } : {}),
    };

    const [currentResult, previousResult] = await Promise.all([
      oracleService.executeQuery(currentQuery, currentBindings),
      oracleService.executeQuery(previousQuery, previousBindings),
    ]);

    const currentCount = currentResult?.[0]?.COUNT || 0;
    const previousCount = previousResult?.[0]?.COUNT || 0;

    const change = currentCount - previousCount;
    const changePercent = previousCount > 0 ? Math.round((change / previousCount) * 100) : 0;

    let message: string;
    let trend: 'up' | 'down' | 'stable';

    if (change > 0) {
      trend = 'up';
      message = `📈 עלייה של ${changePercent}% במספר השיחות\n`;
      message += `תקופה נוכחית: ${currentCount} שיחות\n`;
      message += `תקופה קודמת: ${previousCount} שיחות`;
    } else if (change < 0) {
      trend = 'down';
      message = `📉 ירידה של ${Math.abs(changePercent)}% במספר השיחות\n`;
      message += `תקופה נוכחית: ${currentCount} שיחות\n`;
      message += `תקופה קודמת: ${previousCount} שיחות`;
    } else {
      trend = 'stable';
      message = `➡️ מספר השיחות נשאר יציב (${currentCount} שיחות)`;
    }

    return {
      success: true,
      data: {
        currentCount,
        previousCount,
        change,
        changePercent,
        trend,
      },
      message,
      metadata: {
        query: currentQuery,
        executionTime: 0,
        rowCount: 2,
      },
    };
  }

  /**
   * Execute distribution query
   */
  private static async executeDistributionQuery(
    dateRange: { startDate: Date; endDate: Date },
    filters?: AnalyticsQuery['filters'],
    customerContext?: any
  ): Promise<AnalyticsResult> {
    const query = `
      SELECT 
        CALL_TYPE,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
      FROM VERINT_TEXT_ANALYSIS
      WHERE CALL_TIME >= :startDate
        AND CALL_TIME < :endDate
        ${customerContext?.customerId && !customerContext.isAdmin ? 'AND CUSTOMER_ID = :customerId' : ''}
      GROUP BY CALL_TYPE
      ORDER BY count DESC
    `;

    const bindings = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(customerContext?.customerId && !customerContext.isAdmin ? { customerId: customerContext.customerId } : {}),
    };

    const result = await oracleService.executeQuery(query, bindings);
    
    if (!result || result.length === 0) {
      return {
        success: true,
        data: { distribution: [] },
        message: 'לא נמצאו נתונים לתקופה המבוקשת',
        metadata: { query, executionTime: 0, rowCount: 0 },
      };
    }

    let message = 'התפלגות סוגי שיחות:\n';
    const distribution = result.map((row: any) => {
      message += `• ${row.CALL_TYPE || 'לא מוגדר'}: ${row.COUNT} (${row.PERCENTAGE}%)\n`;
      return {
        type: row.CALL_TYPE,
        count: row.COUNT,
        percentage: row.PERCENTAGE,
      };
    });

    return {
      success: true,
      data: { distribution },
      message,
      metadata: {
        query,
        executionTime: 0,
        rowCount: result.length,
      },
    };
  }

  /**
   * Get date range based on timeframe
   */
  private static getDateRange(
    timeframe: string,
    customRange?: { startDate: Date; endDate: Date }
  ): { startDate: Date; endDate: Date } {
    if (customRange) {
      return customRange;
    }

    const now = new Date();
    let startDate: Date;
    let endDate = new Date(now);

    switch (timeframe) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
        break;
      
      case 'yesterday':
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 1);
        break;
      
      case 'week':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      
      case 'month':
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
        break;
      
      case 'quarter':
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 3);
        break;
      
      case 'year':
        startDate = new Date(now);
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      
      default:
        // Default to today
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
    }

    return { startDate, endDate };
  }

  /**
   * Format analytics result for AI response
   */
  static formatAnalyticsForAI(result: AnalyticsResult): string {
    if (!result.success) {
      return `לא הצלחתי לבצע את השאילתה: ${result.error || result.message}`;
    }

    return result.message;
  }

  /**
   * Get analytics context for AI response - removed pattern detection
   * LLM now handles intent detection naturally
   */
  static async getAnalyticsContext(
    message: string,
    customerContext?: any
  ): Promise<string | null> {
    // Pattern detection removed - LLM handles intent detection naturally
    logger.debug('Analytics context skipped - LLM handles intent detection naturally');
    return null;
  }
}

export const aiAnalyticsService = new AIAnalyticsService();