// This file now proxies to SQS implementation for backward compatibility
import { logger } from '../utils/logger';
import { getSQSProducer } from './sqs-producer.service';
import { 
    KafkaMessage, 
    CDCChangeEvent, 
    ConversationAssembly, 
    MLProcessingResult,
    OpenSearchIndexRequest,
    ProcessingMetric
} from '../types/kafka-messages';

// Using SQS implementation with Kafka-compatible interface
export class KafkaProducerService {
    private sqsProducer = getSQSProducer();

    constructor() {
        logger.info('🔄 Initializing message producer (SQS mode)...');
    }

    get connected(): boolean {
        return this.sqsProducer.connected;
    }

    async connect(): Promise<void> {
        return this.sqsProducer.connect();
    }

    async disconnect(): Promise<void> {
        return this.sqsProducer.disconnect();
    }

    async sendCDCChange(change: CDCChangeEvent): Promise<void> {
        return this.sqsProducer.sendCDCChange(change);
    }

    async sendConversationAssembly(conversation: ConversationAssembly): Promise<void> {
        return this.sqsProducer.sendConversationAssembly(conversation);
    }

    async sendMLProcessingResult(result: MLProcessingResult): Promise<void> {
        return this.sqsProducer.sendMLProcessingResult(result);
    }

    async sendOpenSearchIndexRequest(request: OpenSearchIndexRequest): Promise<void> {
        return this.sqsProducer.sendOpenSearchIndexRequest(request);
    }

    async sendToDeadLetterQueue(originalTopic: string, originalMessage: any, error: string): Promise<void> {
        return this.sqsProducer.sendToDeadLetterQueue(originalTopic, originalMessage, error);
    }

    async sendProcessingMetric(metric: ProcessingMetric): Promise<void> {
        return this.sqsProducer.sendProcessingMetric(metric);
    }

    async sendBatch<T extends KafkaMessage>(
        topic: string,
        messages: Array<{ key: string; message: T }>
    ): Promise<void> {
        return this.sqsProducer.sendBatch(topic, messages);
    }

    async flush(): Promise<void> {
        return this.sqsProducer.flush();
    }

    getMetrics() {
        return this.sqsProducer.getMetrics();
    }

    isHealthy(): boolean {
        return this.sqsProducer.isHealthy();
    }

    async healthCheck() {
        return this.sqsProducer.healthCheck();
    }

    // For backward compatibility with topic creation
    async ensureTopicsExist(): Promise<void> {
        logger.info('Topics/queues managed by SQS - no creation needed');
        return Promise.resolve();
    }
}

// Singleton instance
let kafkaProducerInstance: KafkaProducerService | null = null;

export const getKafkaProducer = (): KafkaProducerService => {
    if (!kafkaProducerInstance) {
        kafkaProducerInstance = new KafkaProducerService();
    }
    return kafkaProducerInstance;
};

export default KafkaProducerService;