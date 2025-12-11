import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';
import { redisService } from './services/redis.service';
import { getSQSProducer } from './services/sqs-producer.service';
import { openSearchMLResultsConsumer } from './services/consumers/opensearch-ml-results-consumer.service';
import { getOpenSearchEmbeddingConsumer } from './services/consumers/opensearch-embedding-consumer.service';
import { errorHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/request-logger.middleware';
import routes from './routes';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../config/.env.api') });
dotenv.config({ path: path.join(__dirname, '../../config/.env.oracle') });
dotenv.config({ path: path.join(__dirname, '../../config/.env.sqs') });

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - required for rate limiting behind nginx
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15') * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.'
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'],
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use('/api', limiter);

// Health check endpoint
app.get('/health', async (req, res) => {
  const sqsProducer = getSQSProducer();

  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      api: 'running',
      redis: redisService.isReady() ? 'connected' : 'disconnected',
      sqs: sqsProducer.isHealthy() ? 'connected' : 'disconnected'
    }
  };

  const httpStatus = health.services.redis === 'connected' ? 200 : 503;

  res.status(httpStatus).json(health);
});

// Readiness check
app.get('/ready', async (req, res) => {
  const isReady = redisService.isReady();
  res.status(isReady ? 200 : 503).json({ ready: isReady });
});

// Liveness check
app.get('/alive', (req, res) => {
  res.status(200).json({ alive: true });
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    environment: process.env.NODE_ENV
  };
  res.json(metrics);
});

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'Test route working' });
});

// API routes
const apiPrefix = process.env.API_PREFIX || '/api/v1';
logger.info(`Mounting routes at: ${apiPrefix}`);

// Add health check at API prefix for Docker health check
app.get(`${apiPrefix}/health`, async (req, res) => {
  const sqsProducer = getSQSProducer();

  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      api: 'running',
      redis: redisService.isReady() ? 'connected' : 'disconnected',
      sqs: sqsProducer.isHealthy() ? 'connected' : 'disconnected'
    }
  };

  const httpStatus = health.services.redis === 'connected' ? 200 : 503;

  res.status(httpStatus).json(health);
});

app.use(apiPrefix, routes);

// Catch-all route for debugging
app.use('*', (req, res) => {
  logger.warn('Route not found', { path: req.path, method: req.method, baseUrl: req.baseUrl, originalUrl: req.originalUrl });
  res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
});

// Error handling
app.use(errorHandler);

// Initialize services and start server
async function startServer() {
  try {
    logger.info('Starting Call Analytics API Server...');

    // Redis is auto-connected on instantiation
    logger.info('Redis service initialized');
    
    // Initialize SQS services if enabled
    if (process.env.ENABLE_SQS === 'true' || process.env.ENABLE_KAFKA === 'true') {
      logger.info('Initializing SQS services...');
      
      try {
        // Initialize SQS producer
        const sqsProducer = getSQSProducer();
        await sqsProducer.connect();
        logger.info('SQS producer connected');

        // Start OpenSearch ML Results Consumer
        // This consumer processes 'opensearch_index' messages from ML service
        await openSearchMLResultsConsumer.start();
        logger.info('✅ OpenSearch ML Results consumer started - indexing ML results for Dicta/LLM quick access');

        // Start OpenSearch Embedding Consumer (3-queue architecture)
        // This consumer processes 'EMBEDDING_GENERATED' messages from ML service
        const embeddingConsumer = getOpenSearchEmbeddingConsumer();
        await embeddingConsumer.start();
        logger.info('✅ OpenSearch Embedding consumer started - indexing embeddings for vector search');

        logger.info('📨 Complete 3-Queue Pipeline:');
        logger.info('  1. Oracle CDC → Queue 1 (summary-pipe-queue): conversation data');
        logger.info('  2. ML Service processes → sends 3 messages:');
        logger.info('     a) Queue 2: messageType="ML_PROCESSING_RESULT" → CDC saves to Oracle');
        logger.info('     b) Queue 2: messageType="opensearch_index" → API indexes to OpenSearch');
        logger.info('     c) Queue 3: messageType="EMBEDDING_GENERATED" → API updates embeddings');
        logger.info('  3. Dicta/LLM can query OpenSearch for quick results + vector search');

        // Start error handler consumer - DISABLED to prevent DLQ infinite loops
        // const errorConsumer = getErrorHandlerConsumer();
        // await errorConsumer.start();
        // logger.info('Error handler consumer started');
        logger.info('Error handler consumer DISABLED to prevent infinite DLQ loops');

        logger.info('All SQS consumer services started successfully');
      } catch (sqsError) {
        logger.error('Failed to initialize SQS services:', sqsError);
        // Continue running without SQS if it fails
        if (process.env.SQS_REQUIRED === 'true') {
          throw sqsError;
        }
      }
    }

    app.listen(PORT, () => {
      logger.info(`API Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`API Prefix: ${apiPrefix}`);
      logger.info('🚀 API Server ready - SQS pipeline active');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');

  // Stop SQS services if enabled
  if (process.env.ENABLE_SQS === 'true' || process.env.ENABLE_KAFKA === 'true') {
    try {
      const sqsProducer = getSQSProducer();
      await sqsProducer.disconnect();

      // Stop consumers
      await openSearchMLResultsConsumer.stop();
      const embeddingConsumer = getOpenSearchEmbeddingConsumer();
      await embeddingConsumer.stop();

      logger.info('SQS services stopped');
    } catch (error) {
      logger.error('Error stopping SQS services:', error);
    }
  }

  await redisService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');

  // Stop SQS services if enabled
  if (process.env.ENABLE_SQS === 'true' || process.env.ENABLE_KAFKA === 'true') {
    try {
      const sqsProducer = getSQSProducer();
      await sqsProducer.disconnect();

      // Stop consumers
      await openSearchMLResultsConsumer.stop();
      const embeddingConsumer = getOpenSearchEmbeddingConsumer();
      await embeddingConsumer.stop();

      logger.info('SQS services stopped');
    } catch (error) {
      logger.error('Error stopping SQS services:', error);
    }
  }

  await redisService.disconnect();
  process.exit(0);
});

// Start the server
startServer();