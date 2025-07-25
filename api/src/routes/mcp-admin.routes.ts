import { Router } from 'express';
import { mcpAdminController } from '../controllers/mcp-admin.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// All MCP admin routes require authentication
router.use(authenticateToken);

// GET /api/v1/admin/mcp/metrics - Get current routing metrics
router.get('/metrics', mcpAdminController.getMetrics.bind(mcpAdminController));

// POST /api/v1/admin/mcp/reset-metrics - Reset routing metrics
router.post('/reset-metrics', mcpAdminController.resetMetrics.bind(mcpAdminController));

// POST /api/v1/admin/mcp/force-local - Force local LLM mode
router.post('/force-local', mcpAdminController.setForceLocal.bind(mcpAdminController));

// GET /api/v1/admin/mcp/health - Detailed health check
router.get('/health', mcpAdminController.getHealthDetails.bind(mcpAdminController));

export default router;