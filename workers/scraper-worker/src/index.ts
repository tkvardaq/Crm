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
  proxy?: {
    url: string;
    username?: string;
    password?: string;
  };
}

async function processScraper(job: Job<ScraperJobData>) {
  const { url, workspaceId, leadId, companyId, proxy } = job.data;

	const proxyConfig = proxy?.url
		? { url: proxy.url, username: proxy.username, password: proxy.password }
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
    for (const email of emails.slice(0, 10)) {
      await prismaClient.lead.upsert({
        where: { workspaceId_email: { workspaceId, email } },
        create: {
          workspaceId,
          email,
          status: "raw",
          scrapedAttributes: JSON.stringify({ sourceUrl: url }),
        },
        update: {
          scrapedAttributes: JSON.stringify({ sourceUrl: url }),
        },
      });
    }
  }

  console.log(
    `[scraper-worker] Scraped ${url}: ${emails.length} emails found, ${markdown.length} chars content`
  );

  return result;
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
