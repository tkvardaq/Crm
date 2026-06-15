import { Worker, Job } from "bullmq";
import { prismaClient } from "@crm/database";
import { QueueName } from "@crm/shared";
import {
  WaterfallEnrichmentService,
  MockEnrichmentAdapter,
  DnsEnrichmentAdapter,
  GitHubEnrichmentAdapter,
  ClearbitLogoAdapter,
  WebsiteAiAdapter,
} from "@crm/enrichment";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const allowMock = process.env.ADAPTER_MODE === "mock";

interface EnrichmentJobData {
  leadId: string;
  workspaceId: string;
  enrichByEmail?: boolean;
  enrichByDomain?: boolean;
}

let cachedService: WaterfallEnrichmentService | null = null;

function getEnrichmentService(): WaterfallEnrichmentService {
  if (cachedService) return cachedService;
  cachedService = buildEnrichmentService();
  return cachedService;
}

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    throw;
  }
}

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[enrichment-worker] ${msg}`, meta ?? ""),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[enrichment-worker] ${msg}`, meta ?? ""),
};

function buildEnrichmentService(): WaterfallEnrichmentService {
  const service = new WaterfallEnrichmentService(allowMock);

  if (process.env.APOLLO_API_KEY) {
    service.addAdapter({
      mode: "live",
      async enrichByDomain(domain: string) {
        const res = await fetchWithTimeout(
          `https://api.apollo.io/v1/organizations/enrich?domain=${domain}`,
          8000,
          { headers: { "X-Api-Key": process.env.APOLLO_API_KEY! } }
        );
        const data = await res.json();
        return {
          company: data.organization?.name,
          confidence: data.organization ? 0.8 : 0,
          source: "apollo",
        };
      },
      async enrichByEmail(email: string) {
        const res = await fetchWithTimeout(
          `https://api.apollo.io/v1/people/match?email=${email}`,
          8000,
          { headers: { "X-Api-Key": process.env.APOLLO_API_KEY! } }
        );
        const data = await res.json();
        return {
          firstName: data.person?.first_name,
          lastName: data.person?.last_name,
          title: data.person?.title,
          company: data.person?.organization?.name,
          confidence: data.person ? 0.85 : 0,
          source: "apollo",
        };
      },
      async verifyEmail(email: string) {
        return true;
      },
    });
  }

  if (process.env.HUNTER_API_KEY) {
    service.addAdapter({
      mode: "live",
      async enrichByDomain(domain: string) {
        const res = await fetchWithTimeout(
          `https://api.hunter.io/v2/domain-search?domain=${domain}`,
          8000,
          { headers: { "Authorization": `Bearer ${process.env.HUNTER_API_KEY}` } }
        );
        const data = await res.json();
        return {
          company: data.data?.organization,
          confidence: data.data?.emails?.length > 0 ? 0.75 : 0,
          source: "hunter",
        };
      },
      async enrichByEmail(email: string) {
        const res = await fetchWithTimeout(
          `https://api.hunter.io/v2/email-verifier?email=${email}`,
          8000,
          { headers: { "Authorization": `Bearer ${process.env.HUNTER_API_KEY}` } }
        );
        const data = await res.json();
        return {
          confidence: data.data?.result === "deliverable" ? 0.9 : 0.3,
          source: "hunter",
        };
      },
      async verifyEmail(email: string) {
        const res = await fetchWithTimeout(
          `https://api.hunter.io/v2/email-verifier?email=${email}`,
          8000,
          { headers: { "Authorization": `Bearer ${process.env.HUNTER_API_KEY}` } }
        );
        const data = await res.json();
        return data.data?.result === "deliverable";
      },
    });
  }

  service.addAdapter(new GitHubEnrichmentAdapter());
  service.addAdapter(new DnsEnrichmentAdapter());
  service.addAdapter(new ClearbitLogoAdapter());

if (process.env.NIM_API_KEY) {
    service.addAdapter(new WebsiteAiAdapter(process.env.NIM_API_KEY));
  }

  if (allowMock) {
    service.addAdapter(new MockEnrichmentAdapter());
  }

  return service;
}

async function processEnrichment(job: Job<EnrichmentJobData>) {
  const { leadId, workspaceId, enrichByEmail = true, enrichByDomain = true } = job.data;

  const lead = await prismaClient.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: { company: true },
  });

  if (!lead) {
    console.log(`[enrichment-worker] Lead ${leadId} not found, skipping`);
    return;
  }

  const service = getEnrichmentService();
  const updateData: Record<string, unknown> = {};

  if (enrichByEmail && lead.email) {
    const result = await service.enrichByEmail(lead.email);
    if (result.firstName && !lead.firstName) updateData.firstName = result.firstName;
    if (result.lastName && !lead.lastName) updateData.lastName = result.lastName;
    if (result.phone && !lead.phone) updateData.phone = result.phone;
    if (result.linkedinUrl && !lead.linkedinUrl) updateData.linkedinUrl = result.linkedinUrl;
    if (result.confidence > 0.6) {
      updateData.bounceVerified = true;
      updateData.status = "enriched";
    }
  }

  if (enrichByDomain) {
    const domain = lead.company?.domain || lead.email?.split("@")[1];
    if (domain) {
      const result = await service.enrichByDomain(domain);
      if (result.company) {
        if (!lead.company) {
          const company = await prismaClient.company.upsert({
            where: { workspaceId_domain: { workspaceId, domain } },
            create: { workspaceId, name: result.company, domain },
            update: {},
          });
          updateData.companyId = company.id;
        } else if (!lead.company.name) {
          await prismaClient.company.update({
            where: { id: lead.company.id },
            data: { name: result.company },
          });
        }
      }
    }
  }

  if (Object.keys(updateData).length > 0) {
    await prismaClient.lead.update({
      where: { id: leadId },
      data: updateData,
    });
  }

  logger.info(`Enriched lead ${lead.email}: ${Object.keys(updateData).length} fields updated`);
}

const worker = new Worker<EnrichmentJobData>(QueueName.ENRICHMENT, processEnrichment, {
  connection,
  concurrency: 5,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 15000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
});

worker.on("completed", (job) => {
  console.log(`[enrichment-worker] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[enrichment-worker] Failed job ${job?.id}:`, err.message);
});

worker.on("error", (err) => {
  console.error("[enrichment-worker] Worker error:", err);
});

console.log("[enrichment-worker] Worker started");

process.on("SIGTERM", async () => {
  console.log("[enrichment-worker] SIGTERM received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[enrichment-worker] SIGINT received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});
