import { LeadStatus, ChannelType, InteractionSentiment, CampaignStatus } from './enums';

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRecord {
  id: string;
  workspaceId: string;
  email: string;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendingDomainRecord {
  id: string;
  workspaceId: string;
  domain: string;
  spfValid: boolean;
  dkimValid: boolean;
  dmarcValid: boolean;
  mxValid: boolean;
  reputationScore: number;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectedInboxRecord {
  id: string;
  workspaceId: string;
  sendingDomainId: string | null;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassEncrypted: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassEncrypted: string;
  oauthTokenJson: Record<string, unknown> | null;
  dailySentCount: number;
  maxDailyLimit: number;
  warmupEnabled: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyRecord {
  id: string;
  workspaceId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  sizeRange: string | null;
  headquarters: string | null;
  techStack: string[];
  firmographicEmbedding: number[] | null;
  extraAttributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadRecord {
  id: string;
  workspaceId: string;
  companyId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  status: LeadStatus;
  score: number;
  scrapedAttributes: Record<string, unknown>;
  bounceVerified: boolean;
  isOptedOut: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignRecord {
  id: string;
  workspaceId: string;
  name: string;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignStepRecord {
  id: string;
  campaignId: string;
  stepNumber: number;
  delayDays: number;
  channel: ChannelType;
  createdAt: Date;
}

export interface VariantTemplateRecord {
  id: string;
  campaignStepId: string;
  variantName: string;
  subjectSpintax: string;
  bodySpintax: string;
  banditWeight: number;
  sentCount: number;
  replyCount: number;
  interestCount: number;
  createdAt: Date;
}

export interface CampaignQueueRecord {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignStepId: string;
  leadId: string;
  scheduledFor: Date;
  attempts: number;
  status: 'pending' | 'processing' | 'dispatched' | 'cancelled';
  createdAt: Date;
}

export interface CommunicationHistoryRecord {
  id: string;
  workspaceId: string;
  leadId: string;
  connectedInboxId: string | null;
  campaignId: string | null;
  direction: 'inbound' | 'outbound';
  channel: ChannelType;
  subject: string | null;
  bodyText: string;
  sentAt: Date;
  sentiment: InteractionSentiment | null;
  messageId: string | null;
}

export interface PipelineStageRecord {
  id: string;
  workspaceId: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
}

export interface DealRecord {
  id: string;
  workspaceId: string;
  leadId: string;
  pipelineStageId: string;
  title: string;
  value: number;
  expectedCloseDate: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}