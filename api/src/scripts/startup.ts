import { migrateData } from './migrate-opensearch';
import { redisService } from '../services/redis.service';
import { openSearchService } from '../services/opensearch.service';
import { vectorStorageService } from '../services/vector-storage.service';
import { secretsService } from '../services/secrets.service';

async function startup() {
  console.log('🚀 Starting Call Analytics API...');
  
  try {
    // 1. Validate environment variables
    console.log('🔍 Validating environment...');
    validateEnvironment();
    
    // 2. Initialize services
    console.log('🔧 Initializing services...');
    await initializeServices();
    
    // 3. Wait for services to be ready
    console.log('⏳ Waiting for services to be ready...');
    await waitForServices();
    
    // 4. Initialize schemas (OpenSearch only)
    console.log('🏗️  Initializing OpenSearch schemas...');
    // Note: OpenSearch schemas are initialized via migration scripts
    
    // 5. Run migration if enabled
    const autoMigrate = process.env.AUTO_MIGRATE === 'true';
    if (autoMigrate) {
      console.log('🔄 Auto-migration enabled, starting OpenSearch migration...');
      const migrationSuccess = await migrateData();
      
      if (migrationSuccess) {
        console.log('✅ OpenSearch migration completed successfully');
      } else {
        console.log('⚠️  OpenSearch migration failed, but continuing with API startup');
      }
    } else {
      console.log('⏭️  Auto-migration disabled, skipping OpenSearch migration');
    }

    // 6. Start the API server
    console.log('🌐 Starting API server...');
    require('../index'); // This will start the Express server
    
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

function validateEnvironment() {
  console.log('🔍 [STARTUP] Starting environment validation...');
  
  // Check AWS environment indicators
  const awsEnvVars = {
    AWS_EXECUTION_ENV: process.env.AWS_EXECUTION_ENV,
    AWS_LAMBDA_RUNTIME_API: process.env.AWS_LAMBDA_RUNTIME_API,
    ECS_CONTAINER_METADATA_URI_V4: process.env.ECS_CONTAINER_METADATA_URI_V4,
    AWS_REGION: process.env.AWS_REGION,
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
    NODE_ENV: process.env.NODE_ENV
  };
  
  console.log('🔍 [STARTUP] Environment variables check:', awsEnvVars);
  
  // Skip environment validation in AWS mode - secrets will be loaded from AWS Secrets Manager
  if (secretsService.isAWSEnvironment()) {
    console.log('🔐 [STARTUP] AWS environment detected - using AWS Secrets Manager for configuration');
    console.log('🔐 [STARTUP] Skipping local environment variable validation');
    return;
  }
  
  console.log('🔍 [STARTUP] Local environment detected - validating required environment variables...');

  // Validate environment variables for local development
  const required = [
    'OPENSEARCH_URL', 'REDIS_HOST'
  ];
  
  const localEnvVars = {};
  for (const envVar of required) {
    localEnvVars[envVar] = process.env[envVar] || 'undefined';
    if (!process.env[envVar]) {
      console.error(`🔍 [STARTUP] ❌ Missing required environment variable: ${envVar}`);
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
  
  console.log('🔍 [STARTUP] Local environment variables found:', localEnvVars);
  console.log('🔍 [STARTUP] ✅ Environment validation completed');
}

async function initializeServices() {
  console.log('🔧 [STARTUP] Starting service initialization...');

  try {
    console.log('🔴 [STARTUP] Initializing Redis service...');
    // Redis initializes automatically on import, but let's check if it's ready
    const redisReady = redisService.isReady();
    console.log(`🔴 [STARTUP] Redis ready status: ${redisReady}`);
    console.log('🔴 [STARTUP] ✅ Redis service initialization completed');
  } catch (error) {
    console.error('🔴 [STARTUP] ❌ Redis service check failed:', error);
    // Don't throw error for Redis since it might still be connecting
  }

  console.log('🔧 [STARTUP] ✅ All services initialization completed');
}

async function waitForServices() {
  console.log('⏳ [STARTUP] Starting service readiness checks...');

  const services = [
    { name: 'Redis', check: () => Promise.resolve(redisService.isReady()) },
    { name: 'OpenSearch', check: () => openSearchService.healthCheck() }
  ];
  
  for (const service of services) {
    console.log(`⏳ [STARTUP] Checking ${service.name} readiness...`);
    let attempts = 0;
    const maxAttempts = 30;
    const checkInterval = 2000; // 2 seconds
    
    while (attempts < maxAttempts) {
      try {
        const startTime = Date.now();
        const isReady = await service.check();
        const checkTime = Date.now() - startTime;
        
        if (isReady) {
          console.log(`⏳ [STARTUP] ✅ ${service.name} is ready (check took ${checkTime}ms)`);
          break;
        } else {
          console.log(`⏳ [STARTUP] ⏸️ ${service.name} not ready yet (attempt ${attempts + 1}/${maxAttempts})`);
        }
      } catch (error) {
        console.log(`⏳ [STARTUP] ⚠️ ${service.name} health check failed (attempt ${attempts + 1}/${maxAttempts}):`, error.message);
      }
      
      attempts++;
      if (attempts >= maxAttempts) {
        const totalWaitTime = maxAttempts * checkInterval / 1000;
        console.error(`⏳ [STARTUP] ❌ ${service.name} is not ready after ${totalWaitTime} seconds`);
        throw new Error(`${service.name} is not ready after ${totalWaitTime} seconds`);
      }
      
      console.log(`⏳ [STARTUP] Waiting ${checkInterval / 1000}s before next ${service.name} check...`);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }
  
  console.log('⏳ [STARTUP] ✅ All services readiness checks completed');
}

// Run startup
startup();