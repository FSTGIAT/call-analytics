import { Router } from 'express';
import { 
  MCPController, 
  llmRequestSchema, 
  conversationSchema, 
  configUpdateSchema 
} from '../controllers/mcp.controller';
import { validateRequest } from '../middleware/validation.middleware';
import { requireCustomerContext } from '../middleware/customer-isolation.middleware';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware';

const router = Router();

// Apply customer isolation to all routes
router.use(requireCustomerContext);

// Apply rate limiting for MCP endpoints (LLM requests are expensive)
import { mlRateLimit } from '../middleware/rate-limit.middleware';

router.use(mlRateLimit);

/**
 * @route POST /api/mcp/llm/request
 * @desc Process LLM request with smart routing
 * @access Private (Customer Isolated)
 */
router.post(
  '/llm/request',
  MCPController.processLLMRequest
);

/**
 * @route POST /api/mcp/conversations
 * @desc Create a new conversation context
 * @access Private (Customer Isolated)
 */
router.post('/conversations', MCPController.createConversation);

/**
 * @route DELETE /api/mcp/conversations/:conversationId
 * @desc End a conversation and clear context
 * @access Private (Customer Isolated)
 */
router.delete('/conversations/:conversationId', MCPController.endConversation);

/**
 * @route GET /api/mcp/conversations
 * @desc Get active conversations for customer
 * @access Private (Customer Isolated)
 */
router.get('/conversations', MCPController.getActiveConversations);

/**
 * @route GET /api/mcp/routing/stats
 * @desc Get routing and load balancing statistics
 * @access Private (Customer Isolated)
 */
router.get('/routing/stats', MCPController.getRoutingStats);

/**
 * @route POST /api/mcp/routing/test
 * @desc Test smart routing with sample prompts
 * @access Private (Customer Isolated)
 */
router.post('/routing/test', MCPController.testRouting);

/**
 * @route POST /api/mcp/load-balancing/test
 * @desc Test load balancing with concurrent requests
 * @access Private (Customer Isolated)
 */
router.post('/load-balancing/test', MCPController.testLoadBalancing);

/**
 * @route GET /api/mcp/health
 * @desc Check MCP client and LLM services health
 * @access Private (Customer Isolated)
 */
router.get('/health', MCPController.healthCheck);

/**
 * @route GET /api/mcp/config
 * @desc Get current MCP configuration
 * @access Private (Customer Isolated)
 */
router.get('/config', MCPController.getConfig);

/**
 * @route PUT /api/mcp/config
 * @desc Update MCP configuration
 * @access Private (Customer Isolated)
 */
router.put(
  '/config',
  validateRequest(configUpdateSchema),
  MCPController.updateConfig
);

export { router as mcpRoutes };