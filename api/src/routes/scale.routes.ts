import { Router } from 'express';
import { ScaleManagementController } from '../controllers/scale-management.controller';
import { customerIsolationMiddleware } from '../middleware/customer-isolation.middleware';

const router = Router();

// Apply customer isolation middleware to all scale routes
router.use(customerIsolationMiddleware);

// ============================================================================
// BATCH PROCESSING ROUTES
// ============================================================================

router.post('/batch/start', ScaleManagementController.startBatchProcessing);
router.get('/batch/status', ScaleManagementController.getBatchProcessingStatus);
router.post('/batch/stop', ScaleManagementController.stopBatchProcessing);

// ============================================================================
// REAL-TIME PROCESSING ROUTES
// ============================================================================

router.post('/realtime/start', ScaleManagementController.startRealTimeProcessing);
router.post('/realtime/stop', ScaleManagementController.stopRealTimeProcessing);
router.get('/realtime/status', ScaleManagementController.getRealTimeStatus);
router.post('/realtime/trigger/:callId', ScaleManagementController.triggerCallProcessing);

// ============================================================================
// VECTOR STORAGE MANAGEMENT
// ============================================================================

router.get('/vector/stats', ScaleManagementController.getVectorStorageStats);
router.post('/vector/optimize', ScaleManagementController.optimizeVectorIndexes);
router.post('/vector/cleanup', ScaleManagementController.cleanupOldVectors);

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

router.get('/cache/metrics', ScaleManagementController.getCacheMetrics);
router.post('/cache/invalidate', ScaleManagementController.invalidateCustomerCache);
router.post('/cache/warmup', ScaleManagementController.warmupCache);
router.post('/cache/cleanup', ScaleManagementController.cleanupCache);
router.post('/cache/reset-metrics', ScaleManagementController.resetCacheMetrics);

// ============================================================================
// SYSTEM MONITORING
// ============================================================================

router.get('/system/status', ScaleManagementController.getSystemStatus);
router.post('/system/maintenance', ScaleManagementController.performMaintenance);

export { router as scaleRoutes };