import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prismaClient } from '@crm/database';
import bcrypt from 'bcryptjs';
import { createClient } from 'ioredis';

const TEST_DB_URL = 'postgresql://admin:test@localhost:5432/crm_db?schema=public';
const TEST_REDIS_URL = 'redis://localhost:6379';

let redis: ReturnType<typeof createClient>;

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.FERNET_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.NEXTAUTH_SECRET = 'test-secret-min-32-chars-long';
  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.LEGACY_SALT = 'test-legacy-salt';
  
  redis = createClient(TEST_REDIS_URL);
  await redis.connect();
});

afterAll(async () => {
  await redis?.quit();
  await prismaClient.$disconnect();
});

describe('API Integration Tests', () => {
  let testWorkspaceId: string;
  let testUserId: string;
  let authToken: string;

  beforeAll(async () => {
    // Clean up test data
    await prismaClient.user.deleteMany({ where: { email: 'test@integration.com' } });
    await prismaClient.workspace.deleteMany({ where: { name: 'Test Workspace' } });

    // Create test workspace
    const workspace = await prismaClient.workspace.create({
      data: { name: 'Test Workspace' },
    });
    testWorkspaceId = workspace.id;

    // Create test user
    const passwordHash = await bcrypt.hash('testpassword123', 12);
    const user = await prismaClient.user.create({
      data: {
        email: 'test@integration.com',
        passwordHash,
        workspaceId: testWorkspaceId,
        firstName: 'Test',
        lastName: 'User',
        role: 'admin',
      },
    });
    testUserId = user.id;

    // Create default pipeline stages
    await prismaClient.pipelineStage.createMany({
      data: [
        { workspaceId: testWorkspaceId, name: 'New', sortOrder: 0 },
        { workspaceId: testWorkspaceId, name: 'Qualified', sortOrder: 1 },
        { workspaceId: testWorkspaceId, name: 'Closed', sortOrder: 2 },
      ],
    });
  });

  describe('Auth', () => {
    it('registers new user', async () => {
      const res = await fetch('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@test.com',
          password: 'password123',
          workspaceName: 'New Test Workspace',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.user).toBeDefined();
    });

    it('signs in existing user', async () => {
      const res = await fetch('http://localhost:3000/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@integration.com',
          password: 'testpassword123',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user).toBeDefined();
      authToken = res.headers.get('set-cookie') || '';
    });
  });

  describe('Leads API', () => {
    it('creates lead', async () => {
      const res = await fetch('http://localhost:3000/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authToken },
        body: JSON.stringify({
          email: 'lead1@test.com',
          firstName: 'John',
          lastName: 'Doe',
          companyId: null,
        }),
      });
      expect([200, 201]).toContain(res.status);
      const data = await res.json();
      expect(data.id).toBeDefined();
    });

    it('lists leads', async () => {
      const res = await fetch('http://localhost:3000/api/leads', {
        headers: { Cookie: authToken },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('gets lead by id', async () => {
      const createRes = await fetch('http://localhost:3000/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authToken },
        body: JSON.stringify({ email: 'lead2@test.com' }),
      });
      const lead = await createRes.json();

      const res = await fetch(`http://localhost:3000/api/leads/${lead.id}`, {
        headers: { Cookie: authToken },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(lead.id);
    });
  });

  describe('Campaigns API', () => {
    it('creates campaign with steps', async () => {
      const res = await fetch('http://localhost:3000/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authToken },
        body: JSON.stringify({
          name: 'Test Campaign',
          steps: [
            {
              delayDays: 1,
              channel: 'email',
              variants: [{ variantName: 'A', subjectSpintax: 'Hello {{firstName}}', bodySpintax: 'Body' }],
            },
          ],
        }),
      });
      expect([200, 201]).toContain(res.status);
      const data = await res.json();
      expect(data.id).toBeDefined();
    });

    it('lists campaigns', async () => {
      const res = await fetch('http://localhost:3000/api/campaigns', {
        headers: { Cookie: authToken },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Inboxes API', () => {
    it('creates connected inbox', async () => {
      const res = await fetch('http://localhost:3000/api/inboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authToken },
        body: JSON.stringify({
          email: 'sender@test.com',
          smtpHost: 'smtp.test.com',
          smtpPort: 587,
          smtpUser: 'sender@test.com',
          smtpPass: 'password',
          imapHost: 'imap.test.com',
          imapPort: 993,
          imapUser: 'sender@test.com',
          imapPass: 'password',
        }),
      });
      expect([200, 201]).toContain(res.status);
    });

    it('lists inboxes', async () => {
      const res = await fetch('http://localhost:3000/api/inboxes', {
        headers: { Cookie: authToken },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Pipeline API', () => {
    it('lists pipeline stages', async () => {
      const res = await fetch('http://localhost:3000/api/pipeline-stages', {
        headers: { Cookie: authToken },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('Companies API', () => {
    it('creates company', async () => {
      const res = await fetch('http://localhost:3000/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authToken },
        body: JSON.stringify({
          name: 'Test Company',
          domain: 'test.com',
        }),
      });
      expect([200, 201]).toContain(res.status);
    });
  });
});