import { Router } from 'express';
import { CallsController, callQuerySchema, summarySchema, callIngestSchema } from '../controllers/calls.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { customerIsolationMiddleware, validateSubscriberAccess } from '../middleware/customer-isolation.middleware';
import { validate, validateQuery } from '../middleware/validation.middleware';

const router = Router();

// All routes require authentication and customer isolation
router.use(authenticateToken);
router.use(customerIsolationMiddleware);

// Call transcription routes
router.get('/transcriptions', validateQuery(callQuerySchema), CallsController.getTranscriptions);
router.get('/transcriptions/:callId', CallsController.getTranscription);

// Call summary routes
router.get('/summaries/:callId', CallsController.getSummary);
router.post('/summaries', validate(summarySchema), CallsController.createSummary);

// Call processing routes - NEW AI PIPELINE
router.post('/ingest', validate(callIngestSchema), CallsController.ingestCall);
router.post('/ingest/batch', CallsController.ingestBatch);

// Statistics
router.get('/stats', CallsController.getCallStats);

// Subscriber-specific routes
router.get('/subscriber/:subscriberId', validateSubscriberAccess, CallsController.getTranscriptions);

export { router as callsRoutes };