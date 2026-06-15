import { Worker, Job } from "bullmq";
import { prismaClient } from "@crm/database";
import { QueueName } from "@crm/shared";
import { scrapeUrl, fetchRawHtml, extractEmails, extractMeta } from "@crm/scraper";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

interface ScraperJobData {
  url: string;
  workspaceId: string;
  leadId?: string;
  companyId?: string;
  scrapeJobId?: string;
  mode?: "single" | "crawl" | "sitemap";
  maxPages?: number;
  autoEnrich?: boolean;
  proxy?: {
    url: string;
    username?: string;
    password?: string;
  };
}

const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;

function assertSafeUrl(raw: string): void {
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new Error(`Invalid URL: ${raw}`); }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  if (BLOCKED.test(parsed.hostname))
    throw new Error(`Blocked internal host: ${parsed.hostname}`);
}

async function processScraper(job: Job<ScraperJobData>) {
  const { url, workspaceId, leadId, companyId, scrapeJobId, autoEnrich = false } = job.data;
  assertSafeUrl(url);

  if (scrapeJobId) {
    await prismaClient.scrapeJob.update({
      where: { id: scrapeJobId, workspaceId },
      data: { status: "running" },
    }).catch(() => {});
  }

  const enrichmentQueue = new Queue(QueueName.ENRICHMENT, { connection });

  try {
    const proxyConfig = job.data.proxy?.url
      ? { url: job.data.proxy.url, username: job.data.proxy.username, password: job.data.proxy.password }
      : undefined;

    const html = await fetchRawHtml(url, proxyConfig);
    const emails = extractEmails(html);
    const meta = extractMeta(html);
    const markdown = await scrapeUrl(url, proxyConfig);

    const result: Record<string, unknown> = {
      url,
      markdown: markdown.substring(0, 50000),
      emails,
      meta,
      scrapedAt: new Date().toISOString(),
    };

    let leadsCreated = 0;

    if (leadId) {
      await prismaClient.lead.update({
        where: { id: leadId, workspaceId },
        data: {
          scrapedAttributes: JSON.stringify(result),
          status: "enriched",
        },
      });
    }

    if (companyId) {
      const company = await prismaClient.company.findFirst({
        where: { id: companyId, workspaceId },
      });
      if (company) {
        let extraAttrs: Record<string, unknown> = {};
        if (company.extraAttributes) {
          try {
            extraAttrs = typeof company.extraAttributes === "string"
              ? JSON.parse(company.extraAttributes)
              : company.extraAttributes;
          } catch {
            extraAttrs = {};
          }
        }
        await prismaClient.company.update({
          where: { id: companyId },
          data: {
            extraAttributes: JSON.stringify({
              ...extraAttrs,
              scrapedMeta: meta,
              scrapedAt: new Date().toISOString(),
            }),
          },
        });
      }
    }

    if (!leadId && !companyId && emails.length > 0) {
      const emailsToProcess = emails.slice(0, 10);
      for (const email of emailsToProcess) {
        const lead = await prismaClient.lead.upsert({
          where: { workspaceId_email: { workspaceId, email } },
          create: {
            workspaceId,
            email,
            status: "raw",
            scrapeJobId: scrapeJobId ?? null,
            scrapedAttributes: JSON.stringify({ sourceUrl: url }),
          },
          update: {
            scrapeJobId: scrapeJobId ?? undefined,
            scrapedAttributes: JSON.stringify({ sourceUrl: url }),
          },
        });
        leadsCreated++;

        if (autoEnrich) {
          await enrichmentQueue.add("enrich", {
            leadId: lead.id,
            workspaceId,
            enrichByEmail: true,
            enrichByDomain: true,
          }, {
            jobId: `enrich-${lead.id}`,
            attempts: 2,
            backoff: { type: "exponential", delay: 10000 },
          });
        }
      }
    }

    if (scrapeJobId) {
      await prismaClient.scrapeJob.update({
        where: { id: scrapeJobId, workspaceId },
        data: {
          status: "completed",
          leadsFound: leadsCreated,
          pagesScraped: 1,
          completedAt: new Date(),
        },
      }).catch(() => {});
    }

    console.log(
      `[scraper-worker] Scraped ${url}: ${emails.length} emails found, ${markdown.length} chars content`
    );

    return result;
  } catch (err: any) {
    if (scrapeJobId) {
      await prismaClient.scrapeJob.update({
        where: { id: scrapeJobId, workspaceId },
        data: { status: "failed", error: err.message },
      }).catch(() => {});
    }
    throw err;
  } finally {
    await enrichmentQueue.close();
  }
}

const worker = new Worker<ScraperJobData>(QueueName.SCRAPER, processScraper, {
  connection,
  concurrency: 3,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 30000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
    timeout: 60000,
  },
});

worker.on("completed", (job) => {
  console.log(`[scraper-worker] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[scraper-worker] Failed job ${job?.id}:`, err.message);
});

worker.on("error", (err) => {
  console.error("[scraper-worker] Worker error:", err);
});

console.log("[scraper-worker] Worker started");

process.on("SIGTERM", async () => {
  console.log("[scraper-worker] SIGTERM received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[scraper-worker] SIGINT received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});
