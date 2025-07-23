export interface CustomerContext {
  customerId: string;
  subscriberIds?: string[];
  tenantId?: string;
  tier?: string;
  startDate?: string;
  endDate?: string;
}

export interface Customer {
  customerId: string;
  customerName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subscriber {
  subscriberId: string;
  customerId: string;
  phoneNumber: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
}

export interface CallTranscription {
  callId: string;
  customerId: string;
  subscriberId: string;
  callDate: Date;
  durationSeconds: number;
  transcriptionText: string;
  language: string;
  agentId?: string;
  callType: string;
}

export interface CallSummary {
  callId: string;
  customerId: string;
  summaryText: string;
  keyPoints: string[];
  sentiment: 'positive' | 'negative' | 'neutral';
  productsMentioned: string[];
  actionItems: string[];
  createdAt: Date;
}