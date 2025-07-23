import { Router } from 'express';
import { SearchController, searchSchema } from '../controllers/search.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { customerIsolationMiddleware } from '../middleware/customer-isolation.middleware';
import { validate } from '../middleware/validation.middleware';

const router = Router();

// All routes require authentication and customer isolation
router.use(authenticateToken);
router.use(customerIsolationMiddleware);

// Search routes
router.post('/', validate(searchSchema), SearchController.search);
router.get('/suggest', SearchController.suggest);

// NEW: Semantic search routes
router.post('/semantic', SearchController.semanticSearch);
router.post('/chat', SearchController.chatWithCalls);

export { router as searchRoutes };