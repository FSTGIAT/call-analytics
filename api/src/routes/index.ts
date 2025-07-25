import { Router } from 'express';
import { authRoutes } from './auth.routes';
import { callsRoutes } from './calls.routes';
import { searchRoutes } from './search.routes';
import { analyticsRoutes } from './analytics.routes';
import { mcpRoutes } from './mcp.routes';
import { scaleRoutes } from './scale.routes';
import { realtimeCDCRoutes } from './realtime-cdc.routes';
import { aiRoutes } from './ai.routes';
import kafkaMonitoringRoutes from './kafka-monitoring.routes';
import mcpAdminRoutes from './mcp-admin.routes';

const router = Router();

// API routes
router.use('/auth', authRoutes);
router.use('/calls', callsRoutes);
router.use('/search', searchRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/mcp', mcpRoutes);
router.use('/scale', scaleRoutes);
router.use('/realtime-cdc', realtimeCDCRoutes);
router.use('/ai', aiRoutes);
router.use('/kafka', kafkaMonitoringRoutes);
router.use('/admin/mcp', mcpAdminRoutes);

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
      'realtime-cdc': '/realtime-cdc',
      ai: '/ai',
      kafka: '/kafka',
      'admin/mcp': '/admin/mcp'
    }
  });
});

export default router;