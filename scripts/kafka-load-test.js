#!/usr/bin/env node

/**
 * Kafka Load Testing Script
 * Hebrew Call Analytics AI Platform
 * 
 * This script performs comprehensive load testing of the Kafka pipeline:
 * - Producer throughput testing
 * - Consumer lag monitoring
 * - End-to-end latency measurement
 * - Error rate monitoring under load
 * - Resource utilization tracking
 * 
 * Usage: node kafka-load-test.js [options]
 */

const { Kafka } = require('kafkajs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Load environment configuration
require('dotenv').config({ path: path.join(__dirname, '../config/.env.kafka') });
require('dotenv').config({ path: path.join(__dirname, '../config/.env.api') });

// Configuration
const CONFIG = {
    kafka: {
        brokers: (process.env.KAFKA_BROKERS || 'kafka:29092').split(','),
        clientId: 'kafka-load-test-client',
        groupId: 'kafka-load-test-group'
    },
    api: {
        baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
        endpoint: '/api/v1'
    },
    topics: {
        cdcRawChanges: process.env.KAFKA_TOPIC_CDC_RAW_CHANGES || 'cdc-raw-changes',
        conversationAssembly: process.env.KAFKA_TOPIC_CONVERSATION_ASSEMBLY || 'conversation-assembly',
        mlProcessing: process.env.KAFKA_TOPIC_ML_PROCESSING || 'ml-processing-queue',
        opensearchIndex: process.env.KAFKA_TOPIC_OPENSEARCH_INDEX || 'opensearch-bulk-index',
        failedRecords: process.env.KAFKA_TOPIC_FAILED_RECORDS || 'failed-records-dlq'
    },
    test: {
        duration: 300, // 5 minutes
        warmupDuration: 30, // 30 seconds
        messageBatchSize: 100,
        messageInterval: 1000, // 1 second between batches
        maxConcurrentProducers: 5,
        sampleCallIds: [],
        reportInterval: 10000 // 10 seconds
    }
};

// Test state
const TEST_STATE = {
    startTime: null,
    endTime: null,
    messagesSent: 0,
    messagesReceived: 0,
    errors: 0,
    latencies: [],
    throughput: [],
    memoryUsage: [],
    activeProducers: 0,
    isRunning: false,
    results: {
        producer: {},
        consumer: {},
        pipeline: {},
        resources: {}
    }
};

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

// Logging functions
const log = {
    info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
    warning: (msg) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
    data: (msg) => console.log(`${colors.cyan}[DATA]${colors.reset} ${msg}`)
};

// Generate sample CDC message
function generateCDCMessage(callId = null) {
    const sampleCallId = callId || `LOAD_TEST_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const owners = ['A', 'C'];
    const hebrewTexts = [
        'שלום, איך אני יכול לעזור לך היום?',
        'יש לי בעיה עם החשבון שלי',
        'בסדר, אני אבדוק את זה עבורך',
        'תודה רבה על העזרה',
        'אין בעד מה, יום טוב!'
    ];
    
    return {
        type: 'cdc-change',
        callId: sampleCallId,
        changeType: 'INSERT',
        tableName: 'VERINT_TEXT_ANALYSIS',
        data: {
            ban: '1234567890',
            subscriberNo: `SUB${Math.floor(Math.random() * 1000000)}`,
            owner: owners[Math.floor(Math.random() * owners.length)],
            text: hebrewTexts[Math.floor(Math.random() * hebrewTexts.length)],
            textTime: new Date(),
            callTime: new Date(),
            changeLogId: Math.floor(Math.random() * 1000000),
            processingTimestamp: new Date()
        },
        metadata: {
            transactionId: `TXN_${Date.now()}`,
            commitTimestamp: new Date(),
            userName: 'LOAD_TEST_USER',
            oracleScn: Math.floor(Math.random() * 1000000).toString()
        },
        timestamp: new Date().toISOString(),
        messageId: `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        source: 'kafka-load-test',
        version: '1.0'
    };
}

// Initialize Kafka client
async function initializeKafka() {
    log.info('Initializing Kafka client...');
    
    const kafka = new Kafka({
        clientId: CONFIG.kafka.clientId,
        brokers: CONFIG.kafka.brokers,
        retry: {
            initialRetryTime: 100,
            retries: 8
        }
    });
    
    const producer = kafka.producer({
        maxInFlightRequests: 1,
        idempotent: true,
        transactionTimeout: 30000
    });
    
    const consumer = kafka.consumer({
        groupId: CONFIG.kafka.groupId,
        sessionTimeout: 25000,
        rebalanceTimeout: 60000,
        heartbeatInterval: 3000
    });
    
    try {
        await producer.connect();
        await consumer.connect();
        
        // Subscribe to topics for monitoring
        await consumer.subscribe({ 
            topics: Object.values(CONFIG.topics),
            fromBeginning: false 
        });
        
        log.success('Kafka client initialized successfully');
        return { producer, consumer };
    } catch (error) {
        log.error(`Failed to initialize Kafka: ${error.message}`);
        process.exit(1);
    }
}

// Producer load test
async function runProducerLoadTest(producer) {
    log.info('Starting producer load test...');
    
    const startTime = performance.now();
    let messageCount = 0;
    let errorCount = 0;
    
    // Warm-up phase
    log.info(`Warming up for ${CONFIG.test.warmupDuration} seconds...`);
    const warmupEnd = Date.now() + (CONFIG.test.warmupDuration * 1000);
    
    while (Date.now() < warmupEnd) {
        try {
            const messages = [];
            for (let i = 0; i < 10; i++) {
                messages.push({
                    key: `warmup-${i}`,
                    value: JSON.stringify(generateCDCMessage())
                });
            }
            
            await producer.send({
                topic: CONFIG.topics.cdcRawChanges,
                messages
            });
            
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            log.warning(`Warmup error: ${error.message}`);
        }
    }
    
    log.success('Warmup completed, starting load test...');
    
    // Main load test
    const testEndTime = Date.now() + (CONFIG.test.duration * 1000);
    const producers = [];
    
    // Start multiple concurrent producers
    for (let i = 0; i < CONFIG.test.maxConcurrentProducers; i++) {
        const producerPromise = runProducerWorker(producer, i, testEndTime);
        producers.push(producerPromise);
        TEST_STATE.activeProducers++;
    }
    
    // Wait for all producers to complete
    const results = await Promise.allSettled(producers);
    
    // Aggregate results
    let totalMessages = 0;
    let totalErrors = 0;
    
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            totalMessages += result.value.messages;
            totalErrors += result.value.errors;
            log.data(`Producer ${index}: ${result.value.messages} messages, ${result.value.errors} errors`);
        } else {
            log.error(`Producer ${index} failed: ${result.reason}`);
            totalErrors++;
        }
    });
    
    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000;
    const throughput = totalMessages / duration;
    
    TEST_STATE.results.producer = {
        duration,
        totalMessages,
        totalErrors,
        throughput: Math.round(throughput * 100) / 100,
        errorRate: totalMessages > 0 ? (totalErrors / totalMessages) * 100 : 0
    };
    
    log.success(`Producer test completed: ${totalMessages} messages in ${duration.toFixed(2)}s (${throughput.toFixed(2)} msg/s)`);
    
    return TEST_STATE.results.producer;
}

// Individual producer worker
async function runProducerWorker(producer, workerId, endTime) {
    let messageCount = 0;
    let errorCount = 0;
    
    while (Date.now() < endTime) {
        try {
            const messages = [];
            
            // Generate batch of messages
            for (let i = 0; i < CONFIG.test.messageBatchSize; i++) {
                const callId = `WORKER_${workerId}_${Date.now()}_${i}`;
                messages.push({
                    key: callId,
                    value: JSON.stringify(generateCDCMessage(callId)),
                    timestamp: Date.now().toString()
                });
            }
            
            const sendStart = performance.now();
            await producer.send({
                topic: CONFIG.topics.cdcRawChanges,
                messages
            });
            const sendEnd = performance.now();
            
            messageCount += messages.length;
            TEST_STATE.messagesSent += messages.length;
            
            // Record latency
            const latency = sendEnd - sendStart;
            TEST_STATE.latencies.push(latency);
            
            // Wait between batches
            await new Promise(resolve => setTimeout(resolve, CONFIG.test.messageInterval));
            
        } catch (error) {
            errorCount++;
            TEST_STATE.errors++;
            log.warning(`Producer ${workerId} error: ${error.message}`);
        }
    }
    
    TEST_STATE.activeProducers--;
    return { messages: messageCount, errors: errorCount };
}

// Consumer monitoring
async function monitorConsumers(consumer) {
    log.info('Starting consumer monitoring...');
    
    let processedMessages = 0;
    const consumerLatencies = [];
    
    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            try {
                const receiveTime = performance.now();
                const messageTimestamp = parseInt(message.timestamp);
                const latency = receiveTime - messageTimestamp;
                
                consumerLatencies.push(latency);
                processedMessages++;
                TEST_STATE.messagesReceived++;
                
                // Only log periodically to avoid spam
                if (processedMessages % 1000 === 0) {
                    log.data(`Processed ${processedMessages} messages from ${topic}`);
                }
                
            } catch (error) {
                TEST_STATE.errors++;
                log.warning(`Consumer processing error: ${error.message}`);
            }
        }
    });
    
    TEST_STATE.results.consumer = {
        processedMessages,
        avgLatency: consumerLatencies.length > 0 ? 
            consumerLatencies.reduce((a, b) => a + b, 0) / consumerLatencies.length : 0,
        maxLatency: Math.max(...consumerLatencies, 0),
        minLatency: Math.min(...consumerLatencies, Infinity)
    };
    
    return TEST_STATE.results.consumer;
}

// Monitor API and pipeline health during test
async function monitorPipeline() {
    log.info('Starting pipeline monitoring...');
    
    const apiEndpoint = `${CONFIG.api.baseUrl}${CONFIG.api.endpoint}`;
    const healthChecks = [];
    const metricsSnapshots = [];
    
    const monitorInterval = setInterval(async () => {
        if (!TEST_STATE.isRunning) {
            clearInterval(monitorInterval);
            return;
        }
        
        try {
            // Health check
            const healthResponse = await axios.get(`${apiEndpoint}/kafka/health`, { timeout: 5000 });
            healthChecks.push({
                timestamp: new Date().toISOString(),
                status: healthResponse.data.overall,
                services: healthResponse.data.services
            });
            
            // Metrics
            const metricsResponse = await axios.get(`${apiEndpoint}/kafka/metrics`, { timeout: 5000 });
            metricsSnapshots.push({
                timestamp: new Date().toISOString(),
                metrics: metricsResponse.data
            });
            
            // Consumer lag
            const lagResponse = await axios.get(`${apiEndpoint}/kafka/consumer-lag`, { timeout: 5000 });
            
            log.data(`Pipeline status: ${healthResponse.data.overall}, Total throughput: ${metricsResponse.data.aggregated.throughputMps} msg/s`);
            
        } catch (error) {
            log.warning(`Pipeline monitoring error: ${error.message}`);
        }
    }, CONFIG.test.reportInterval);
    
    // Store monitoring data
    TEST_STATE.results.pipeline = {
        healthChecks,
        metricsSnapshots
    };
}

// Monitor system resources
async function monitorResources() {
    log.info('Starting resource monitoring...');
    
    const resourceSnapshots = [];
    
    const resourceInterval = setInterval(() => {
        if (!TEST_STATE.isRunning) {
            clearInterval(resourceInterval);
            return;
        }
        
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        resourceSnapshots.push({
            timestamp: new Date().toISOString(),
            memory: {
                rss: memUsage.rss,
                heapTotal: memUsage.heapTotal,
                heapUsed: memUsage.heapUsed,
                external: memUsage.external
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            }
        });
        
        TEST_STATE.memoryUsage.push(memUsage.heapUsed);
        
    }, 1000); // Every second
    
    TEST_STATE.results.resources = {
        snapshots: resourceSnapshots
    };
}

// Generate comprehensive test report
function generateReport() {
    log.info('Generating test report...');
    
    const report = {
        testConfiguration: CONFIG,
        testExecution: {
            startTime: TEST_STATE.startTime,
            endTime: TEST_STATE.endTime,
            duration: TEST_STATE.endTime - TEST_STATE.startTime,
            totalMessagesSent: TEST_STATE.messagesSent,
            totalMessagesReceived: TEST_STATE.messagesReceived,
            totalErrors: TEST_STATE.errors
        },
        results: TEST_STATE.results,
        summary: {
            producerThroughput: TEST_STATE.results.producer?.throughput || 0,
            consumerLatency: TEST_STATE.results.consumer?.avgLatency || 0,
            errorRate: TEST_STATE.errors > 0 ? (TEST_STATE.errors / TEST_STATE.messagesSent) * 100 : 0,
            successRate: TEST_STATE.messagesSent > 0 ? ((TEST_STATE.messagesSent - TEST_STATE.errors) / TEST_STATE.messagesSent) * 100 : 0
        },
        recommendations: generateRecommendations()
    };
    
    // Calculate statistics
    if (TEST_STATE.latencies.length > 0) {
        const sortedLatencies = TEST_STATE.latencies.sort((a, b) => a - b);
        report.latencyStats = {
            min: sortedLatencies[0],
            max: sortedLatencies[sortedLatencies.length - 1],
            avg: sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length,
            p50: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)],
            p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)],
            p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)]
        };
    }
    
    // Save report to file
    const reportPath = path.join(__dirname, `kafka-load-test-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    log.success(`Test report saved to: ${reportPath}`);
    
    // Print summary
    console.log('\n=== LOAD TEST SUMMARY ===');
    console.log(`Duration: ${((TEST_STATE.endTime - TEST_STATE.startTime) / 1000).toFixed(2)} seconds`);
    console.log(`Messages Sent: ${TEST_STATE.messagesSent}`);
    console.log(`Messages Received: ${TEST_STATE.messagesReceived}`);
    console.log(`Errors: ${TEST_STATE.errors}`);
    console.log(`Producer Throughput: ${(report.results.producer?.throughput || 0).toFixed(2)} msg/s`);
    console.log(`Consumer Avg Latency: ${(report.results.consumer?.avgLatency || 0).toFixed(2)} ms`);
    console.log(`Success Rate: ${report.summary.successRate.toFixed(2)}%`);
    
    if (report.latencyStats) {
        console.log('\n=== LATENCY STATISTICS ===');
        console.log(`Min: ${report.latencyStats.min.toFixed(2)} ms`);
        console.log(`Max: ${report.latencyStats.max.toFixed(2)} ms`);
        console.log(`Avg: ${report.latencyStats.avg.toFixed(2)} ms`);
        console.log(`P95: ${report.latencyStats.p95.toFixed(2)} ms`);
        console.log(`P99: ${report.latencyStats.p99.toFixed(2)} ms`);
    }
    
    return report;
}

// Generate performance recommendations
function generateRecommendations() {
    const recommendations = [];
    
    if (TEST_STATE.results.producer?.throughput < 100) {
        recommendations.push({
            type: 'performance',
            severity: 'medium',
            message: 'Producer throughput is low. Consider increasing batch size or reducing message interval.'
        });
    }
    
    if (TEST_STATE.results.consumer?.avgLatency > 1000) {
        recommendations.push({
            type: 'latency',
            severity: 'high',
            message: 'Consumer latency is high. Check ML service performance and OpenSearch indexing speed.'
        });
    }
    
    if (TEST_STATE.errors > TEST_STATE.messagesSent * 0.01) {
        recommendations.push({
            type: 'reliability',
            severity: 'high',
            message: 'Error rate is above 1%. Investigate error patterns and implement better retry mechanisms.'
        });
    }
    
    const avgMemory = TEST_STATE.memoryUsage.reduce((a, b) => a + b, 0) / TEST_STATE.memoryUsage.length;
    if (avgMemory > 500 * 1024 * 1024) { // 500MB
        recommendations.push({
            type: 'resources',
            severity: 'medium',
            message: 'High memory usage detected. Consider memory optimization or scaling.'
        });
    }
    
    return recommendations;
}

// Main test execution
async function runLoadTest() {
    try {
        log.info('Starting Kafka Load Test...');
        TEST_STATE.startTime = Date.now();
        TEST_STATE.isRunning = true;
        
        // Initialize Kafka
        const { producer, consumer } = await initializeKafka();
        
        // Start monitoring
        const monitoringPromises = [
            monitorPipeline(),
            monitorResources()
        ];
        
        // Start consumer monitoring (don't await, let it run in background)
        monitorConsumers(consumer);
        
        // Run producer load test
        await runProducerLoadTest(producer);
        
        // Let consumers catch up
        log.info('Waiting for consumers to process remaining messages...');
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
        
        TEST_STATE.endTime = Date.now();
        TEST_STATE.isRunning = false;
        
        // Cleanup
        await producer.disconnect();
        await consumer.disconnect();
        
        // Generate and display report
        const report = generateReport();
        
        log.success('Load test completed successfully!');
        
        // Exit with appropriate code
        process.exit(report.summary.successRate > 95 ? 0 : 1);
        
    } catch (error) {
        log.error(`Load test failed: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--duration':
                CONFIG.test.duration = parseInt(args[++i]);
                break;
            case '--batch-size':
                CONFIG.test.messageBatchSize = parseInt(args[++i]);
                break;
            case '--producers':
                CONFIG.test.maxConcurrentProducers = parseInt(args[++i]);
                break;
            case '--interval':
                CONFIG.test.messageInterval = parseInt(args[++i]);
                break;
            case '--help':
                console.log(`
Kafka Load Test Script

Usage: node kafka-load-test.js [options]

Options:
  --duration <seconds>     Test duration in seconds (default: 300)
  --batch-size <number>    Messages per batch (default: 100)
  --producers <number>     Concurrent producers (default: 5)
  --interval <ms>          Interval between batches in ms (default: 1000)
  --help                   Show this help message

Examples:
  node kafka-load-test.js                          # Default test
  node kafka-load-test.js --duration 600           # 10-minute test
  node kafka-load-test.js --batch-size 50 --producers 10  # Custom config
                `);
                process.exit(0);
            default:
                log.warning(`Unknown argument: ${args[i]}`);
        }
    }
}

// Handle process termination
process.on('SIGINT', () => {
    log.warning('Test interrupted by user');
    TEST_STATE.isRunning = false;
    TEST_STATE.endTime = Date.now();
    
    // Give some time for cleanup
    setTimeout(() => {
        if (TEST_STATE.startTime) {
            generateReport();
        }
        process.exit(1);
    }, 2000);
});

process.on('SIGTERM', () => {
    log.warning('Test terminated');
    TEST_STATE.isRunning = false;
    TEST_STATE.endTime = Date.now();
    process.exit(1);
});

// Start the test
if (require.main === module) {
    parseArgs();
    runLoadTest();
}