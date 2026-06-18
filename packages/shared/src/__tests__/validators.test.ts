import { describe, it, expect } from 'vitest';
import {
  workspaceSchema,
  sendingDomainSchema,
  connectedInboxSchema,
  leadSchema,
  leadCreateSchema,
  companySchema,
  campaignSchema,
  campaignLaunchSchema,
  campaignStepSchema,
  variantTemplateSchema,
  pipelineStageSchema,
  dealSchema,
  dealCreateSchema,
  moveDealSchema,
  authSchema,
  registerSchema,
} from '../validators';
import { LeadStatus, ChannelType, CampaignStatus } from '../enums';

describe('Validators', () => {
  describe('workspaceSchema', () => {
    it('validates valid workspace name', () => {
      const result = workspaceSchema.safeParse({ name: 'Acme Corp' });
      expect(result.success).toBe(true);
    });

    it('rejects empty name', () => {
      const result = workspaceSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects name too long', () => {
      const result = workspaceSchema.safeParse({ name: 'a'.repeat(256) });
      expect(result.success).toBe(false);
    });
  });

  describe('sendingDomainSchema', () => {
    it('validates valid domain', () => {
      const result = sendingDomainSchema.safeParse({ domain: 'example.com' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid domain format', () => {
      const result = sendingDomainSchema.safeParse({ domain: 'not-a-domain' });
      expect(result.success).toBe(false);
    });

    it('rejects domain too short', () => {
      const result = sendingDomainSchema.safeParse({ domain: 'a.b' });
      expect(result.success).toBe(false);
    });
  });

  describe('connectedInboxSchema', () => {
    const validInbox = {
      email: 'test@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'test@example.com',
      smtpPass: 'password123',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'test@example.com',
      imapPass: 'password123',
      maxDailyLimit: 50,
      warmupEnabled: true,
      sendingDomainId: null,
    };

    it('validates valid inbox', () => {
      const result = connectedInboxSchema.safeParse(validInbox);
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = connectedInboxSchema.safeParse({ ...validInbox, email: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects smtpPort out of range', () => {
      const result = connectedInboxSchema.safeParse({ ...validInbox, smtpPort: 70000 });
      expect(result.success).toBe(false);
    });

    it('defaults smtpPort to 587', () => {
      const { smtpPort, ...rest } = validInbox;
      const result = connectedInboxSchema.safeParse(rest);
      expect(result.success).toBe(true);
      expect(result.data.smtpPort).toBe(587);
    });

    it('defaults imapPort to 993', () => {
      const { imapPort, ...rest } = validInbox;
      const result = connectedInboxSchema.safeParse(rest);
      expect(result.success).toBe(true);
      expect(result.data.imapPort).toBe(993);
    });

    it('defaults maxDailyLimit to 50', () => {
      const { maxDailyLimit, ...rest } = validInbox;
      const result = connectedInboxSchema.safeParse(rest);
      expect(result.success).toBe(true);
      expect(result.data.maxDailyLimit).toBe(50);
    });

    it('defaults warmupEnabled to true', () => {
      const { warmupEnabled, ...rest } = validInbox;
      const result = connectedInboxSchema.safeParse(rest);
      expect(result.success).toBe(true);
      expect(result.data.warmupEnabled).toBe(true);
    });
  });

  describe('leadSchema / leadCreateSchema', () => {
    const validLead = {
      email: 'lead@example.com',
      firstName: 'John',
      lastName: 'Doe',
      phone: '+1234567890',
      linkedinUrl: 'https://linkedin.com/in/johndoe',
      companyId: '00000000-0000-0000-0000-000000000001',
      status: LeadStatus.RAW,
    };

    it('validates valid lead', () => {
      const result = leadSchema.safeParse(validLead);
      expect(result.success).toBe(true);
    });

    it('leadCreateSchema does not require status', () => {
      const { status, ...rest } = validLead;
      const result = leadCreateSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = leadSchema.safeParse({ ...validLead, email: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid linkedinUrl', () => {
      const result = leadSchema.safeParse({ ...validLead, linkedinUrl: 'not-a-url' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid companyId UUID', () => {
      const result = leadSchema.safeParse({ ...validLead, companyId: 'not-uuid' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid lead status', () => {
      const result = leadSchema.safeParse({ ...validLead, status: 'invalid_status' });
      expect(result.success).toBe(false);
    });

    it('accepts all valid lead statuses', () => {
      for (const status of Object.values(LeadStatus)) {
        const result = leadSchema.safeParse({ ...validLead, status });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('companySchema', () => {
    const validCompany = {
      name: 'Acme Inc',
      domain: 'acme.com',
      industry: 'Technology',
      sizeRange: '51-200',
      headquarters: 'San Francisco, CA',
      techStack: ['React', 'Node.js', 'PostgreSQL'],
    };

    it('validates valid company', () => {
      const result = companySchema.safeParse(validCompany);
      expect(result.success).toBe(true);
    });

    it('rejects empty name', () => {
      const result = companySchema.safeParse({ ...validCompany, name: '' });
      expect(result.success).toBe(false);
    });

    it('accepts optional fields', () => {
      const result = companySchema.safeParse({ name: 'Minimal Co' });
      expect(result.success).toBe(true);
    });
  });

  describe('campaignSchema', () => {
    const validCampaign = {
      name: 'Q4 Outreach',
      status: CampaignStatus.DRAFT,
      steps: [
        {
          delayDays: 3,
          channel: ChannelType.EMAIL,
          variants: [
            { variantName: 'A', subjectSpintax: 'Hello {{firstName}}', bodySpintax: 'Hi {{firstName}}, ...' },
            { variantName: 'B', subjectSpintax: 'Hi {{firstName}}', bodySpintax: 'Hello {{firstName}}, ...' },
          ],
        },
      ],
    };

    it('validates valid campaign', () => {
      const result = campaignSchema.safeParse(validCampaign);
      expect(result.success).toBe(true);
    });

    it('defaults status to draft', () => {
      const { status, ...rest } = validCampaign;
      const result = campaignSchema.safeParse(rest);
      expect(result.success).toBe(true);
      expect(result.data.status).toBe(CampaignStatus.DRAFT);
    });

    it('defaults step delayDays to 3', () => {
      const steps = [{ channel: ChannelType.EMAIL }];
      const result = campaignSchema.safeParse({ ...validCampaign, steps });
      expect(result.success).toBe(true);
      expect(result.data.steps[0].delayDays).toBe(3);
    });

    it('defaults step channel to email', () => {
      const steps = [{ delayDays: 5 }];
      const result = campaignSchema.safeParse({ ...validCampaign, steps });
      expect(result.success).toBe(true);
      expect(result.data.steps[0].channel).toBe(ChannelType.EMAIL);
    });

    it('rejects invalid campaign status', () => {
      const result = campaignSchema.safeParse({ ...validCampaign, status: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('campaignLaunchSchema', () => {
    it('validates valid launch', () => {
      const result = campaignLaunchSchema.safeParse({
        leadIds: ['00000000-0000-0000-0000-000000000001'],
        listId: '00000000-0000-0000-0000-000000000002',
      });
      expect(result.success).toBe(true);
    });

    it('defaults empty leadIds', () => {
      const result = campaignLaunchSchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data.leadIds).toEqual([]);
    });
  });

  describe('campaignStepSchema', () => {
    it('validates valid step', () => {
      const result = campaignStepSchema.safeParse({
        stepNumber: 1,
        delayDays: 5,
        channel: ChannelType.EMAIL,
      });
      expect(result.success).toBe(true);
    });

    it('requires stepNumber', () => {
      const result = campaignStepSchema.safeParse({ delayDays: 3 });
      expect(result.success).toBe(false);
    });
  });

  describe('variantTemplateSchema', () => {
    it('validates valid variant', () => {
      const result = variantTemplateSchema.safeParse({
        variantName: 'A',
        subjectSpintax: 'Hello {{firstName}}',
        bodySpintax: 'Hi {{firstName}}, ...',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty subjectSpintax', () => {
      const result = variantTemplateSchema.safeParse({
        variantName: 'A',
        subjectSpintax: '',
        bodySpintax: 'Hi',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('pipelineStageSchema', () => {
    it('validates valid stage', () => {
      const result = pipelineStageSchema.safeParse({ name: 'Qualified', sortOrder: 1 });
      expect(result.success).toBe(true);
    });

    it('rejects negative sortOrder', () => {
      const result = pipelineStageSchema.safeParse({ name: 'Test', sortOrder: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe('dealSchema / dealCreateSchema', () => {
    const validDeal = {
      leadId: '00000000-0000-0000-0000-000000000001',
      pipelineStageId: '00000000-0000-0000-0000-000000000002',
      title: 'Enterprise Deal',
      value: 50000,
      expectedCloseDate: '2024-12-31',
      notes: 'Negotiating terms',
    };

    it('validates valid deal', () => {
      const result = dealSchema.safeParse(validDeal);
      expect(result.success).toBe(true);
    });

    it('defaults value to 0', () => {
      const { value, ...rest } = validDeal;
      const result = dealSchema.safeParse(rest);
      expect(result.success).toBe(true);
      expect(result.data.value).toBe(0);
    });

    it('rejects negative value', () => {
      const result = dealSchema.safeParse({ ...validDeal, value: -100 });
      expect(result.success).toBe(false);
    });
  });

  describe('moveDealSchema', () => {
    it('validates valid move', () => {
      const result = moveDealSchema.safeParse({ destinationStageId: '00000000-0000-0000-0000-000000000003' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid UUID', () => {
      const result = moveDealSchema.safeParse({ destinationStageId: 'not-uuid' });
      expect(result.success).toBe(false);
    });
  });

  describe('authSchema', () => {
    it('validates valid credentials', () => {
      const result = authSchema.safeParse({ email: 'user@example.com', password: 'password123' });
      expect(result.success).toBe(true);
    });

    it('rejects short password', () => {
      const result = authSchema.safeParse({ email: 'user@example.com', password: 'short' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid email', () => {
      const result = authSchema.safeParse({ email: 'invalid', password: 'password123' });
      expect(result.success).toBe(false);
    });
  });

  describe('registerSchema', () => {
    it('validates valid registration', () => {
      const result = registerSchema.safeParse({
        email: 'new@example.com',
        password: 'password123',
        workspaceName: 'New Company',
        firstName: 'John',
        lastName: 'Doe',
      });
      expect(result.success).toBe(true);
    });

    it('requires workspaceName', () => {
      const result = registerSchema.safeParse({
        email: 'new@example.com',
        password: 'password123',
      });
      expect(result.success).toBe(false);
    });
  });
});