import { Worker, Job, Queue } from "bullmq";
import { prismaClient, decrypt } from "@crm/database";
import { QueueName } from "@crm/shared";
import { createTransport, generateSpintaxVariant } from "@crm/email-engine";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

interface WarmupJobData {
  inboxId: string;
}

const WARMUP_SCHEDULE = [
  { day: 1, count: 5 },
  { day: 2, count: 10 },
  { day: 3, count: 15 },
  { day: 4, count: 20 },
  { day: 5, count: 25 },
  { day: 6, count: 30 },
  { day: 7, count: 35 },
  { day: 8, count: 40 },
  { day: 9, count: 45 },
  { day: 10, count: 50 },
];

const WARMUP_REPLY_TEMPLATES = [
  { subject: "Re: Quick question", body: "Thanks for reaching out! I'll take a look." },
  { subject: "Re: Following up", body: "Appreciate the follow-up. Let me get back to you." },
  { subject: "Re: Introduction", body: "Great to hear from you! Let's connect soon." },
  { subject: "Re: Collaboration", body: "This sounds interesting. Can we discuss further?" },
  { subject: "Re: Meeting request", body: "I'm available this week. Let me check my calendar." },
];

async function processWarmup(job: Job<WarmupJobData>) {
  const { inboxId } = job.data;

  const inbox = await prismaClient.connectedInbox.findUnique({
    where: { id: inboxId },
  });

  if (!inbox || !inbox.isActive || !inbox.warmupEnabled) {
    console.log(`[warmup] Inbox ${inboxId} not eligible, skipping`);
    return;
  }

  const daysSinceCreation = Math.floor(
    (Date.now() - inbox.createdAt.getTime()) / (24 * 60 * 60 * 1000)
  );

  const scheduleEntry = WARMUP_SCHEDULE.find(
    (entry) => entry.day === Math.min(daysSinceCreation + 1, 10)
  );
  const dailyTarget = scheduleEntry?.count || 50;

  const remainingToday = Math.max(0, dailyTarget - inbox.dailySentCount);

  if (remainingToday <= 0) {
    console.log(`[warmup] Inbox ${inbox.email} already at daily limit`);
    return;
  }

  const otherWarmupInboxes = await prismaClient.connectedInbox.findMany({
    where: {
      workspaceId: inbox.workspaceId,
      warmupEnabled: true,
      isActive: true,
      id: { not: inbox.id },
    },
  });

  if (otherWarmupInboxes.length === 0) {
    console.log(`[warmup] No other warmup inboxes for ${inbox.email}, skipping`);
    return;
  }

  const sendCount = Math.min(remainingToday, otherWarmupInboxes.length);
  const recipients = otherWarmupInboxes.slice(0, sendCount);

  const transport = createTransport({
    smtpHost: inbox.smtpHost,
    smtpPort: inbox.smtpPort,
    smtpUser: inbox.smtpUser,
    smtpPassEncrypted: inbox.smtpPassEncrypted,
  });

  let successCount = 0;
  try {
    for (const recipient of recipients) {
      const template =
        WARMUP_REPLY_TEMPLATES[Math.floor(Math.random() * WARMUP_REPLY_TEMPLATES.length)];

      try {
        await transport.sendMail({
          from: inbox.email,
          to: recipient.email,
          subject: template.subject,
          text: template.body,
          html: template.body.replace(/\n/g, "<br>"),
          headers: {
            "X-CRM-Warmup": "true",
          },
        });
        successCount++;
      } catch (err) {
        console.error(`[warmup] Failed to send to ${recipient.email}:`, err);
      }
    }
  } finally {
    await transport.close();
  }

  await prismaClient.connectedInbox.update({
    where: { id: inbox.id },
    data: {
      dailySentCount: { increment: successCount },
    },
  });

  console.log(`[warmup] Sent ${successCount}/${sendCount} warmup emails for ${inbox.email}`);
}

const worker = new Worker<WarmupJobData>(QueueName.WARMUP, processWarmup, {
  connection,
  concurrency: 3,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 60000,
    },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 1000 },
  },
});

worker.on("completed", (job) => {
  console.log(`[warmup] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[warmup] Failed job ${job?.id}:`, err.message);
});

worker.on("error", (err) => {
  console.error("[warmup] Worker error:", err);
});

console.log("[warmup] Worker started");

process.on("SIGTERM", async () => {
	console.log("[warmup] SIGTERM received, shutting down gracefully...");
	await worker.close();
	await connection.quit();
	await prismaClient.$disconnect().catch(() => {});
	process.exit(0);
});

process.on("SIGINT", async () => {
	console.log("[warmup] SIGINT received, shutting down gracefully...");
	await worker.close();
	await connection.quit();
	await prismaClient.$disconnect().catch(() => {});
	process.exit(0);
});
