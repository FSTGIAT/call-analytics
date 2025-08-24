import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// All admin routes require authentication
router.use(authenticateToken);

// Admin check middleware (only allow admin users)
const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
};

// Apply admin check to all routes
router.use(requireAdmin);

/**
 * @route GET /api/admin/classifications
 * @desc Get all call classifications
 * @access Admin only
 */
router.get('/classifications', AdminController.getClassifications);

/**
 * @route POST /api/admin/classifications
 * @desc Add new classification
 * @access Admin only
 * @body { classification: string }
 */
router.post('/classifications', AdminController.addClassification);

/**
 * @route DELETE /api/admin/classifications
 * @desc Remove classification
 * @access Admin only
 * @body { classification: string }
 */
router.delete('/classifications', AdminController.removeClassification);

/**
 * @route PUT /api/admin/classifications
 * @desc Update entire classifications list
 * @access Admin only
 * @body { classifications: string[] }
 */
router.put('/classifications', AdminController.updateClassifications);

/**
 * @route POST /api/admin/classifications/reload
 * @desc Trigger ML service to reload classifications
 * @access Admin only
 */
router.post('/classifications/reload', AdminController.reloadMLClassifications);

/**
 * @route POST /api/admin/circuit-breaker/reset
 * @desc Reset conversation assembly circuit breaker
 * @access Admin only
 */
router.post('/circuit-breaker/reset', AdminController.resetCircuitBreaker);

export default router;