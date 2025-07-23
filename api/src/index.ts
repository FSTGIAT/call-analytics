import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';
import { oracleService } from './services/oracle.service';
import { redisService } from './services/redis.service';
import { realtimeCDCService } from './services/realtime-cdc.service';
import { getKafkaProducer } from './services/kafka-producer.service';
import { getKafkaCDCProducer } from './services/kafka-cdc-producer.service';
import { errorHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/request-logger.middleware';
import routes from './routes';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../config/.env.api') });
dotenv.config({ path: path.join(__dirname, '../../config/.env.oracle') });
dotenv.config({ path: path.join(__dirname, '../../config/.env.kafka') });

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
  const kafkaProducer = getKafkaProducer();
  const kafkaCDCProducer = getKafkaCDCProducer();
  
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      api: 'running',
      redis: redisService.isReady() ? 'connected' : 'disconnected',
      oracle: await oracleService.healthCheck() ? 'connected' : 'disconnected',
      kafka: kafkaProducer.isHealthy() ? 'connected' : 'disconnected',
      kafkaCDC: kafkaCDCProducer.isHealthy() ? 'running' : 'stopped'
    }
  };
  
  const httpStatus = health.services.redis === 'connected' && 
                     health.services.oracle === 'connected' ? 200 : 503;
  
  res.status(httpStatus).json(health);
});

// Readiness check
app.get('/ready', async (req, res) => {
  const isReady = redisService.isReady() && await oracleService.healthCheck();
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
    
    // Connect to Oracle
    logger.info('Connecting to Oracle Database...');
    await oracleService.connect();
    logger.info('Oracle Database connected');
    
    // Redis is auto-connected on instantiation
    logger.info('Redis service initialized');
    
    // Initialize Kafka services if enabled
    if (process.env.ENABLE_KAFKA === 'true') {
      logger.info('Initializing Kafka services...');
      
      try {
        // Initialize Kafka producer
        const kafkaProducer = getKafkaProducer();
        await kafkaProducer.connect();
        logger.info('Kafka producer connected');
        
        // Start Kafka CDC producer if enabled
        if (process.env.ENABLE_KAFKA_CDC === 'true') {
          const kafkaCDCProducer = getKafkaCDCProducer();
          await kafkaCDCProducer.start();
          logger.info('Kafka CDC producer started - running in parallel with existing CDC');
        }

        // Initialize and start Kafka consumer services
        const { getConversationAssemblyConsumer } = require('./services/consumers/conversation-assembly-consumer.service');
        const { getMLProcessingConsumer } = require('./services/consumers/ml-processing-consumer.service');
        const { getOpenSearchIndexingConsumer } = require('./services/consumers/opensearch-indexing-consumer.service');
        const { getErrorHandlerConsumer } = require('./services/consumers/error-handler-consumer.service');

        // Start conversation assembly consumer
        const conversationConsumer = getConversationAssemblyConsumer();
        await conversationConsumer.start();
        logger.info('Conversation assembly consumer started');

        // Start ML processing consumer
        const mlConsumer = getMLProcessingConsumer();
        await mlConsumer.start();
        logger.info('ML processing consumer started');

        // Start OpenSearch indexing consumer
        const opensearchConsumer = getOpenSearchIndexingConsumer();
        await opensearchConsumer.start();
        logger.info('OpenSearch indexing consumer started');

        // Start error handler consumer
        const errorConsumer = getErrorHandlerConsumer();
        await errorConsumer.start();
        logger.info('Error handler consumer started');

        logger.info('All Kafka consumer services started successfully');
      } catch (kafkaError) {
        logger.error('Failed to initialize Kafka services:', kafkaError);
        // Continue running without Kafka if it fails
        if (process.env.KAFKA_REQUIRED === 'true') {
          throw kafkaError;
        }
      }
    }
    
    // Start CDC service automatically
    logger.info('Starting Real-time CDC Service...');
    await realtimeCDCService.start();
    logger.info('CDC Service started - monitoring Oracle for changes');
    
    app.listen(PORT, () => {
      logger.info(`API Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`API Prefix: ${apiPrefix}`);
      logger.info('🔄 CDC is running - Oracle → Weaviate sync active');
      if (process.env.ENABLE_KAFKA_CDC === 'true') {
        logger.info('🚀 Kafka CDC is running - Oracle → Kafka pipeline active');
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  
  // Stop all services
  realtimeCDCService.stop();
  
  // Stop Kafka services if enabled
  if (process.env.ENABLE_KAFKA === 'true') {
    try {
      const kafkaCDCProducer = getKafkaCDCProducer();
      await kafkaCDCProducer.stop();
      
      const kafkaProducer = getKafkaProducer();
      await kafkaProducer.disconnect();
    } catch (error) {
      logger.error('Error stopping Kafka services:', error);
    }
  }
  
  await oracleService.disconnect();
  await redisService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  
  // Stop Kafka services if enabled
  if (process.env.ENABLE_KAFKA === 'true') {
    try {
      const kafkaCDCProducer = getKafkaCDCProducer();
      await kafkaCDCProducer.stop();
      
      const kafkaProducer = getKafkaProducer();
      await kafkaProducer.disconnect();
    } catch (error) {
      logger.error('Error stopping Kafka services:', error);
    }
  }
  
  await oracleService.disconnect();
  await redisService.disconnect();
  process.exit(0);
});

// Start the server
startServer();