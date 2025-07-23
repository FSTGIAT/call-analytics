import { Router } from 'express';
import { RealtimeCDCController } from '../controllers/realtime-cdc.controller';

const router = Router();

// CDC processes all customers - no customer isolation needed

/**
 * @route POST /api/v1/realtime-cdc/start
 * @desc Start real-time CDC processing
 * @access Private (Customer Isolated)
 */
router.post('/start', RealtimeCDCController.startCDCProcessing);

/**
 * @route POST /api/v1/realtime-cdc/stop
 * @desc Stop real-time CDC processing
 * @access Private (Customer Isolated)
 */
router.post('/stop', RealtimeCDCController.stopCDCProcessing);

/**
 * @route GET /api/v1/realtime-cdc/status
 * @desc Get CDC processing status and statistics
 * @access Private (Customer Isolated)
 */
router.get('/status', RealtimeCDCController.getCDCStatus);

/**
 * @route GET /api/v1/realtime-cdc/statistics
 * @desc Get CDC processing statistics
 * @access Private (Customer Isolated)
 */
router.get('/statistics', RealtimeCDCController.getCDCStatistics);

/**
 * @route POST /api/v1/realtime-cdc/test
 * @desc Test CDC by inserting sample data
 * @access Private (Customer Isolated)
 */
router.post('/test', RealtimeCDCController.testCDC);

/**
 * @route POST /api/v1/realtime-cdc/reset-backfill
 * @desc Reset CDC timestamp to reprocess all data
 * @access Private (Customer Isolated)
 */
router.post('/reset-backfill', RealtimeCDCController.resetForBackfill);

/**
 * @route GET /api/v1/realtime-cdc/changes
 * @desc Get recent CDC changes
 * @access Private (Customer Isolated)
 */
router.get('/changes', RealtimeCDCController.getRecentChanges);

/**
 * @route POST /api/v1/realtime-cdc/historical/enable
 * @desc Enable historical CDC mode for reprocessing old data
 * @access Private (Customer Isolated)
 */
router.post('/historical/enable', RealtimeCDCController.enableHistoricalMode);

/**
 * @route POST /api/v1/realtime-cdc/historical/disable
 * @desc Disable historical CDC mode
 * @access Private (Customer Isolated)
 */
router.post('/historical/disable', RealtimeCDCController.disableHistoricalMode);

/**
 * @route GET /api/v1/realtime-cdc/historical/status
 * @desc Get historical CDC mode status
 * @access Private (Customer Isolated)
 */
router.get('/historical/status', RealtimeCDCController.getHistoricalModeStatus);

export { router as realtimeCDCRoutes };