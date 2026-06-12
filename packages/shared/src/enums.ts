export const LeadStatus = {
  RAW: 'raw',
  ENRICHED: 'enriched',
  CONTACTED: 'contacted',
  REPLIED: 'replied',
  INTERESTED: 'interested',
  NOT_INTERESTED: 'not_interested',
} as const;

export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

export const ChannelType = {
  EMAIL: 'email',
  LINKEDIN: 'linkedin',
} as const;

export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const InteractionSentiment = {
  POSITIVE: 'positive',
  NEUTRAL: 'neutral',
  NEGATIVE: 'negative',
  OOF: 'oof',
  UNSUBSCRIBE: 'unsubscribe',
} as const;

export type InteractionSentiment = (typeof InteractionSentiment)[keyof typeof InteractionSentiment];

export const CampaignStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
} as const;

export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const JobStatus = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const QueueName = {
  EMAIL_DISPATCH: 'email-dispatch',
  IMAP_SYNC: 'imap-sync',
  SCRAPER: 'scraper',
  ENRICHMENT: 'enrichment',
  AI_EXTRACT: 'ai-extract',
  WARMUP: 'warmup',
  DNS_CHECK: 'dns-check',
  DECAY_TRACK: 'decay-track',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

export const AdapterMode = {
  MOCK: 'mock',
  LIVE: 'live',
} as const;

export type AdapterMode = (typeof AdapterMode)[keyof typeof AdapterMode];