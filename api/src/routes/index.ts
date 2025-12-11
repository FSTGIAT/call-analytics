import { Router } from 'express';
import { authRoutes } from './auth.routes';
import { callsRoutes } from './calls.routes';
import { searchRoutes } from './search.routes';
import { analyticsRoutes } from './analytics.routes';
import { mcpRoutes } from './mcp.routes';
import { scaleRoutes } from './scale.routes';
import { aiRoutes } from './ai.routes';
// Kafka monitoring routes removed - using SQS instead
// CDC routes removed - CDC now runs on-premises
import mcpAdminRoutes from './mcp-admin.routes';
import adminRoutes from './admin.routes';

const router = Router();

// API routes
router.use('/auth', authRoutes);
router.use('/calls', callsRoutes);
router.use('/search', searchRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/mcp', mcpRoutes);
router.use('/scale', scaleRoutes);
router.use('/ai', aiRoutes);
// Kafka monitoring routes removed - replaced with SQS
// CDC routes removed - CDC now runs on-premises
router.use('/admin/mcp', mcpAdminRoutes);
router.use('/admin', adminRoutes);

// API info
router.get('/', (req, res) => {
  res.json({
    name: 'Call Analytics AI Platform API',
    version: '1.0.0',
    endpoints: {
      auth: '/auth',
      calls: '/calls',
      search: '/search',
      analytics: '/analytics',
      mcp: '/mcp',
      scale: '/scale',
      ai: '/ai',
      'admin/mcp': '/admin/mcp',
      admin: '/admin'
    }
  });
});

export default router;