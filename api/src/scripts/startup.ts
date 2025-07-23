import { migrateData } from './migrate-opensearch';
import { oracleService } from '../services/oracle.service';
import { redisService } from '../services/redis.service';
import { openSearchService } from '../services/opensearch.service';
import { vectorStorageService } from '../services/vector-storage.service';
import { realtimeCDCService } from '../services/realtime-cdc.service';

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
    
    // 6. Start CDC service
    console.log('📡 Starting CDC service...');
    await realtimeCDCService.start();
    
    // 7. Start the API server
    console.log('🌐 Starting API server...');
    require('../index'); // This will start the Express server
    
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

function validateEnvironment() {
  const required = [
    'ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_HOST',
    'OPENSEARCH_URL', 'REDIS_HOST'
  ];
  
  for (const envVar of required) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
}

async function initializeServices() {
  console.log('  Initializing Oracle service...');
  await oracleService.connect();
  
  console.log('  Initializing Redis service...');
  // Redis initializes automatically on import
  
  console.log('  Services initialized');
}

async function waitForServices() {
  const services = [
    { name: 'Oracle', check: () => oracleService.healthCheck() },
    { name: 'Redis', check: () => Promise.resolve(redisService.isReady()) },
    { name: 'OpenSearch', check: () => openSearchService.healthCheck() }
  ];
  
  for (const service of services) {
    console.log(`  Checking ${service.name}...`);
    let attempts = 0;
    while (attempts < 30) {
      try {
        const isReady = await service.check();
        if (isReady) {
          console.log(`  ✅ ${service.name} is ready`);
          break;
        }
      } catch (error) {
        // Service not ready yet
      }
      
      attempts++;
      if (attempts >= 30) {
        throw new Error(`${service.name} is not ready after 60 seconds`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Run startup
startup();