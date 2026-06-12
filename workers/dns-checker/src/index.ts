import { Worker, Job } from "bullmq";
import { prismaClient } from "@crm/database";
import { QueueName } from "@crm/shared";
import dns from "dns";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

interface DnsCheckJobData {
  domainId: string;
  workspaceId: string;
}

function resolveTxt(domain: string): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    dns.resolveTxt(domain, (err, records) => {
      if (err) reject(err);
      else resolve(records || []);
    });
  });
}

function resolveMx(domain: string): Promise<dns.MxRecord[]> {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, records) => {
      if (err) reject(err);
      else resolve(records || []);
    });
  });
}

async function checkSPF(domain: string): Promise<boolean> {
  try {
    const records = await resolveTxt(domain);
    const flat = records.map((r) => r.join(""));
    return flat.some((r) => r.startsWith("v=spf1"));
  } catch {
    return false;
  }
}

async function checkDKIM(domain: string): Promise<boolean> {
  const selectors = ["default", "google", "mail", "selector1", "selector2"];
  for (const selector of selectors) {
    try {
      const records = await resolveTxt(`${selector}._domainkey.${domain}`);
      const flat = records.map((r) => r.join(""));
      if (flat.some((r) => r.includes("v=DKIM1") || r.includes("k=rsa"))) {
        return true;
      }
    } catch {
      // Selector not found, try next
    }
  }
  return false;
}

async function checkDMARC(domain: string): Promise<boolean> {
  try {
    const records = await resolveTxt(`_dmarc.${domain}`);
    const flat = records.map((r) => r.join(""));
    return flat.some((r) => r.startsWith("v=DMARC1"));
  } catch {
    return false;
  }
}

async function checkMX(domain: string): Promise<boolean> {
  try {
    const records = await resolveMx(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

async function processDnsCheck(job: Job<DnsCheckJobData>) {
  const { domainId, workspaceId } = job.data;

  const sendingDomain = await prismaClient.sendingDomain.findFirst({
    where: { id: domainId, workspaceId },
  });

  if (!sendingDomain) {
    console.log(`[dns-checker] Domain ${domainId} not found, skipping`);
    return;
  }

  const domain = sendingDomain.domain;

  const [spfValid, dkimValid, dmarcValid, mxValid] = await Promise.all([
    checkSPF(domain),
    checkDKIM(domain),
    checkDMARC(domain),
    checkMX(domain),
  ]);

  const allValid = spfValid && dkimValid && dmarcValid && mxValid;
  const reputationScore = allValid
    ? 100
    : Math.max(0, [spfValid, dkimValid, dmarcValid, mxValid].filter(Boolean).length * 25);

  await prismaClient.sendingDomain.update({
    where: { id: domainId },
    data: {
      spfValid,
      dkimValid,
      dmarcValid,
      mxValid,
      reputationScore,
      lastCheckedAt: new Date(),
    },
  });

  console.log(
    `[dns-checker] ${domain}: SPF=${spfValid} DKIM=${dkimValid} DMARC=${dmarcValid} MX=${mxValid} score=${reputationScore}`
  );
}

const worker = new Worker<DnsCheckJobData>(QueueName.DNS_CHECK, processDnsCheck, {
  connection,
  concurrency: 5,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 30000,
    },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 1000 },
  },
});

worker.on("completed", (job) => {
  console.log(`[dns-checker] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[dns-checker] Failed job ${job?.id}:`, err.message);
});

worker.on("error", (err) => {
  console.error("[dns-checker] Worker error:", err);
});

console.log("[dns-checker] Worker started");

process.on("SIGTERM", async () => {
  console.log("[dns-checker] SIGTERM received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[dns-checker] SIGINT received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});
