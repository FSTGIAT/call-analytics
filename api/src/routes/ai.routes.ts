import { Router } from 'express';
import { AIController, chatSchema } from '../controllers/ai.controller';
import { validate } from '../middleware/validation.middleware';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// All AI routes require authentication
router.use(authenticateToken);

// Chat endpoint
router.post('/chat', validate(chatSchema), AIController.chat);

// Get conversation history
router.get('/conversations/:conversationId', AIController.getConversationHistory);

export { router as aiRoutes };