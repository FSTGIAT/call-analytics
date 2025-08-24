/**
 * Kafka Message Type Definitions for Call Analytics AI Platform
 * These interfaces define the structure of all messages flowing through Kafka
 */

// Base interface for all Kafka messages
export interface KafkaMessage {
    messageId?: string;
    timestamp?: string;
    type?: string;
    source?: string;
    version?: string;
}

// CDC (Change Data Capture) message from Oracle
export interface CDCChangeEvent extends KafkaMessage {
    type: 'cdc-change';
    callId: string;
    changeType: 'INSERT' | 'UPDATE' | 'DELETE';
    tableName: string;
    data: {
        ban: string;
        subscriberNo: string;
        owner: 'A' | 'C'; // Agent or Customer
        text: string;
        textTime: Date;
        callTime: Date;
        changeLogId?: number;
        processingTimestamp?: Date;
    };
    beforeData?: any; // For UPDATE operations
    metadata: {
        transactionId?: string;
        commitTimestamp?: Date;
        userName?: string;
        oracleScn?: string; // System Change Number
    };
}

// Individual message within a conversation
export interface ConversationMessage {
    messageId: string;
    speaker: 'agent' | 'customer';
    text: string;
    timestamp: Date;
    metadata?: {
        originalOwner?: 'A' | 'C';
        changeLogId?: number;
        processingTimestamp?: Date;
        sequenceNumber?: number;
    };
}

// Complete conversation assembly
export interface ConversationAssembly extends KafkaMessage {
    type: 'conversation-assembly';
    callId: string;
    customerId: string;
    subscriberNo: string;
    messages: ConversationMessage[];
    conversationMetadata: {
        startTime: Date;
        endTime: Date;
        duration: number; // in seconds
        messageCount: number;
        agentMessageCount: number;
        customerMessageCount: number;
        language?: string;
        callDate: Date;
        participants?: {
            agent: string[];
            customer: string[];
        };
    };
}

// ML processing request
export interface MLProcessingRequest extends KafkaMessage {
    type: 'ml-processing-request';
    callId: string;
    customerId: string;
    conversationText: string;
    processingOptions: {
        generateEmbedding: boolean;
        analyzeSentiment: boolean;
        extractEntities: boolean;
        generateSummary: boolean;
        detectLanguage: boolean;
        detectTopics?: boolean;
    };
}

// ML processing result
export interface MLProcessingResult extends KafkaMessage {
    type: 'ml-processing-result';
    callId: string;
    customerId: string;
    subscriberId: string;
    conversationText: string; // Full original conversation text
    embedding: number[]; // 768-dimensional vector for AlephBERT
    sentiment: {
        overall: 'positive' | 'negative' | 'neutral' | 'mixed';
        score: number;
        distribution: {
            positive: number;
            negative: number;
            neutral: number;
        };
    };
    entities?: {
        persons: string[];
        locations: string[];
        organizations: string[];
        phoneNumbers: string[];
        emails: string[];
        custom?: Record<string, string[]>;
    };
    summary?: {
        text: string;
        keyPoints: string[];
        actionItems?: string[];
    };
    language: {
        detected: string;
        confidence: number;
        isHebrew: boolean;
    };
    topics?: {
        primary: string;
        secondary: string[];
        confidence: number;
    };
    classifications?: {
        primary: string;
        secondary: string[];
        all: string[];  // All classifications including primary
        confidence: number;
    };
    conversationContext: {
        messageCount: number;
        duration: number;
        participants: {
            agent: string[];
            customer: string[];
        };
        startTime: Date;
        endTime: Date;
    };
    processingMetadata: {
        mlServiceVersion: string;
        modelUsed: string;
        processingTime: Date;
        confidence: number;
    };
}

// OpenSearch indexing request
export interface OpenSearchIndexRequest extends KafkaMessage {
    type: 'opensearch-index-request';
    callId?: string;
    callIds?: string[];
    customerId?: string;
    indexingStatus?: 'success' | 'failed';
    indexingTimestamp?: Date;
    error?: string;
    metadata?: {
        batchSize?: number;
        processingNode?: string;
        indexPrefix?: string;
        [key: string]: any;
    };
    document?: {
        callId: string;
        customerId: string;
        subscriberNo: string;
        transcriptionText: string;
        transcriptionTextHe?: string; // Hebrew specific field
        embedding: number[];
        sentiment: string;
        sentimentScore: number;
        summary?: string;
        entities?: Record<string, string[]>;
        topics?: string[];
        classifications?: string[];  // Flattened list for search
        classificationsMetadata?: {
            primary: string;
            secondary: string[];
            confidence: number;
        };
        callDate: Date;
        callStartTime: Date;
        callEndTime: Date;
        duration: number;
        messageCount: number;
        agentMessageCount: number;
        customerMessageCount: number;
        language: string;
        metadata?: Record<string, any>;
    };
    indexingOptions?: {
        index: string;
        refresh?: boolean;
        pipeline?: string;
    };
}

// Processing metric for monitoring
export interface ProcessingMetric extends KafkaMessage {
    type: 'processing-metric';
    consumerGroup: string;
    topic: string;
    partition: number;
    offset: string;
    status: 'success' | 'failure' | 'retry' | 'dlq';
    processingTimeMs: number;
    retryCount?: number;
    errorMessage?: string;
    stage?: 'cdc' | 'assembly' | 'ml-processing' | 'indexing' | 'error-handling';
    metadata?: Record<string, any>;
}

// Dead letter queue message
export interface DeadLetterMessage extends KafkaMessage {
    type: 'dead-letter-message';
    originalTopic: string;
    originalMessage: any;
    error: string;
    errorStack?: string;
    processingAttempts: number;
    kafkaContext?: {
        partition: number;
        offset: string;
        timestamp: string;
        key: string | null;
        headers: Record<string, string>;
    };
    retryMetadata?: {
        firstAttemptTime: Date;
        lastAttemptTime: Date;
        retryDelays: number[];
    };
}

// Health check message
export interface HealthCheckMessage extends KafkaMessage {
    type: 'health-check';
    service: string;
    status: 'healthy' | 'unhealthy' | 'degraded';
    checks: {
        kafka: boolean;
        database: boolean;
        opensearch: boolean;
        mlService: boolean;
    };
    metrics?: {
        uptime: number;
        memoryUsage: number;
        cpuUsage: number;
        activeConnections: number;
    };
}

// Batch processing request
export interface BatchProcessingRequest extends KafkaMessage {
    type: 'batch-processing-request';
    batchId: string;
    callIds: string[];
    customerId?: string;
    dateRange?: {
        startDate: Date;
        endDate: Date;
    };
    processingOptions: {
        parallel: boolean;
        maxConcurrency: number;
        priority: 'low' | 'normal' | 'high';
    };
}

// Analytics event
export interface AnalyticsEvent extends KafkaMessage {
    type: 'analytics-event';
    eventName: string;
    eventCategory: 'search' | 'chat' | 'export' | 'view' | 'action';
    userId?: string;
    customerId?: string;
    properties: Record<string, any>;
    context: {
        userAgent?: string;
        ip?: string;
        sessionId?: string;
        referrer?: string;
    };
}

// Type guards for message validation
export const iscdcChangeEvent = (msg: any): msg is CDCChangeEvent => 
    msg?.type === 'cdc-change' && msg?.callId && msg?.changeType;

export const isConversationAssembly = (msg: any): msg is ConversationAssembly =>
    msg?.type === 'conversation-assembly' && msg?.callId && Array.isArray(msg?.messages);

export const isMLProcessingResult = (msg: any): msg is MLProcessingResult =>
    msg?.type === 'ml-processing-result' && msg?.callId && Array.isArray(msg?.embedding);

export const isOpenSearchIndexRequest = (msg: any): msg is OpenSearchIndexRequest =>
    msg?.type === 'opensearch-index-request' && msg?.callId && msg?.document;

export const isProcessingMetric = (msg: any): msg is ProcessingMetric =>
    msg?.type === 'processing-metric' && msg?.consumerGroup && msg?.status;

export const isDeadLetterMessage = (msg: any): msg is DeadLetterMessage =>
    msg?.type === 'dead-letter-message' && msg?.originalTopic && msg?.error;

// Message factory helpers
export const createCDCChangeEvent = (
    callId: string,
    changeType: CDCChangeEvent['changeType'],
    data: CDCChangeEvent['data']
): CDCChangeEvent => ({
    type: 'cdc-change',
    callId,
    changeType,
    tableName: 'VERINT_TEXT_ANALYSIS',
    data,
    metadata: {
        commitTimestamp: new Date()
    },
    timestamp: new Date().toISOString()
});

export const createProcessingMetric = (
    consumerGroup: string,
    topic: string,
    partition: number,
    offset: string,
    status: ProcessingMetric['status'],
    processingTimeMs: number
): ProcessingMetric => ({
    type: 'processing-metric',
    consumerGroup,
    topic,
    partition,
    offset,
    status,
    processingTimeMs,
    timestamp: new Date().toISOString()
});

// Kafka headers interface
export interface KafkaHeaders {
    'content-type': string;
    'encoding': string;
    'source': string;
    'message-type': string;
    'correlation-id'?: string;
    'customer-id'?: string;
    'retry-count'?: string;
    'original-timestamp'?: string;
}