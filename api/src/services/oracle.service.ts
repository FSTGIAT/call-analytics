/**
 * Oracle Service Stub - Oracle runs locally, not in cloud
 * All Oracle operations handled by local oracle-cdc-sqs service
 */

export class OracleService {
    async connect() { return; }
    async executeQuery(query?: any, params?: any) { return []; }
    async executeBatch() { return; }
    async getConnection() { return null; }
    async disconnect() { return; }
    async healthCheck() { return true; }

    // Controller method stubs - actual operations via SQS/CDC
    async getCallTranscriptions(...args: any[]) { return []; }
    async getCallSummaries(...args: any[]) { return []; }
    async saveCallSummary(...args: any[]) { return { success: true }; }
    async saveProcessedCall(...args: any[]) { return { success: true }; }
    async getCallById(...args: any[]) { return null; }
}

export const oracleService = new OracleService();
export default OracleService;