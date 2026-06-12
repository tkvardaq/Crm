import { z } from 'zod';
import { LeadStatus, ChannelType, CampaignStatus } from './enums';

export const workspaceSchema = z.object({
  name: z.string().min(1).max(255),
});

export const sendingDomainSchema = z.object({
  domain: z.string().min(3).max(255).regex(/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/, 'Invalid domain format'),
});

export const connectedInboxSchema = z.object({
  email: z.string().email(),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().min(1),
  smtpPass: z.string().min(1),
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapUser: z.string().min(1),
  imapPass: z.string().min(1),
  maxDailyLimit: z.number().int().min(1).max(500).default(50),
  warmupEnabled: z.boolean().default(true),
  sendingDomainId: z.string().uuid().nullable().optional(),
});

export const leadSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  linkedinUrl: z.string().url().max(500).optional(),
  companyId: z.string().uuid().nullable().optional(),
  status: z.enum(Object.values(LeadStatus) as [string, ...string[]]).optional(),
});

export const leadCreateSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  linkedinUrl: z.string().url().max(500).optional(),
  companyId: z.string().uuid().nullable().optional(),
});

export const companySchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().max(255).optional(),
  industry: z.string().max(255).optional(),
  sizeRange: z.string().max(50).optional(),
  headquarters: z.string().max(255).optional(),
  techStack: z.array(z.string()).optional(),
});

export const campaignSchema = z.object({
  name: z.string().min(1).max(255),
  status: z.enum(Object.values(CampaignStatus) as [string, ...string[]]).optional(),
  steps: z.array(z.object({
    delayDays: z.number().int().min(0).optional().default(3),
    channel: z.enum(Object.values(ChannelType) as [string, ...string[]]).optional().default(ChannelType.EMAIL),
    variants: z.array(z.object({
      variantName: z.string().max(50).optional().default('A'),
      subject: z.string().optional(),
      subjectSpintax: z.string().optional(),
      body: z.string().optional(),
      bodySpintax: z.string().optional(),
      bodyTemplate: z.string().optional(),
      variantLabel: z.string().optional(),
    })).optional(),
  })).optional(),
});

export const campaignLaunchSchema = z.object({
  leadIds: z.array(z.string().uuid()).optional().default([]),
  listId: z.string().uuid().nullable().optional(),
});

export const campaignStepSchema = z.object({
  stepNumber: z.number().int().min(1),
  delayDays: z.number().int().min(0).default(3),
  channel: z.enum(Object.values(ChannelType) as [string, ...string[]]).default(ChannelType.EMAIL),
});

export const variantTemplateSchema = z.object({
  variantName: z.string().min(1).max(50),
  subjectSpintax: z.string().min(1),
  bodySpintax: z.string().min(1),
});

export const pipelineStageSchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
});

export const dealSchema = z.object({
  leadId: z.string().uuid(),
  pipelineStageId: z.string().uuid(),
  title: z.string().min(1).max(255),
  value: z.number().min(0).default(0),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});

export const dealCreateSchema = z.object({
  leadId: z.string().uuid(),
  pipelineStageId: z.string().uuid(),
  title: z.string().min(1).max(255),
  value: z.number().min(0).default(0),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});

export const moveDealSchema = z.object({
  destinationStageId: z.string().uuid(),
});

export const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  workspaceName: z.string().min(1).max(255),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});
