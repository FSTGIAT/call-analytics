import { Router } from 'express';
import { AnalyticsController, analyticsQuerySchema, trendAnalysisSchema, comparisonSchema } from '../controllers/analytics.controller';
import { validateRequest } from '../middleware/validation.middleware';
import { requireCustomerContext } from '../middleware/customer-isolation.middleware';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware';

const router = Router();

// Apply customer isolation to all routes
router.use(requireCustomerContext);

// Apply rate limiting for analytics endpoints (more generous limits)
import { analyticsRateLimit } from '../middleware/rate-limit.middleware';

router.use(analyticsRateLimit);

/**
 * @route GET /api/analytics/overview
 * @desc Get analytics overview for a date range
 * @access Private (Customer Isolated)
 */
router.get('/overview', AnalyticsController.getOverview);

/**
 * @route POST /api/analytics/trends
 * @desc Get trend analysis for specific metrics
 * @access Private (Customer Isolated)
 */
router.post(
  '/trends',
  validateRequest(trendAnalysisSchema),
  AnalyticsController.getTrends
);

/**
 * @route POST /api/analytics/comparison
 * @desc Compare metrics between two time periods
 * @access Private (Customer Isolated)
 */
router.post(
  '/comparison',
  validateRequest(comparisonSchema),
  AnalyticsController.getComparison
);

/**
 * @route GET /api/analytics/topics
 * @desc Get top topics and product mentions
 * @access Private (Customer Isolated)
 */
router.get('/topics', AnalyticsController.getTopics);

/**
 * @route GET /api/analytics/agents
 * @desc Get agent performance metrics
 * @access Private (Customer Isolated)
 */
router.get('/agents', AnalyticsController.getAgentPerformance);

/**
 * @route GET /api/analytics/realtime
 * @desc Get real-time statistics (last 24h)
 * @access Private (Customer Isolated)
 */
router.get('/realtime', AnalyticsController.getRealTimeStats);

/**
 * @route GET /api/analytics/export
 * @desc Export analytics data in various formats
 * @access Private (Customer Isolated)
 */
router.get('/export', AnalyticsController.exportData);

export { router as analyticsRoutes };