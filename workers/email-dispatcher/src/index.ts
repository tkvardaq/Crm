import { Worker, Job } from "bullmq";
import { prismaClient } from "@crm/database";
import { QueueName } from "@crm/shared";
import { createTransport, generateSpintaxVariant, getWeightedRandomIndex } from "@crm/email-engine";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const MAX_RETRY = 3;
const BACKOFF_MS = 5000;

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

async function processEmailDispatch(job: Job) {
  const { campaignQueueId } = job.data;

  const queueEntry = await prismaClient.campaignQueue.findUnique({
    where: { id: campaignQueueId },
    include: {
      lead: {
        include: { company: true },
      },
      campaignStep: {
        include: {
          variants: true,
          campaign: true,
        },
      },
    },
  });

  if (!queueEntry || queueEntry.status === "cancelled") {
    return;
  }

  const skipStatuses = ["replied", "interested", "not_interested"];
  if (queueEntry.lead.isOptedOut || skipStatuses.includes(queueEntry.lead.status)) {
    await prismaClient.campaignQueue.update({
      where: { id: campaignQueueId },
      data: { status: "cancelled" },
    });
    return;
  }

  const step = queueEntry.campaignStep;
  const variants = step.variants;

  if (!variants || variants.length === 0) {
    throw new Error(`No variants found for campaign step ${step.id}`);
  }

  const weights = variants.map((v) => v.banditWeight);
  const selectedIdx = getWeightedRandomIndex(weights);
  const variant = variants[selectedIdx];

  const lead = queueEntry.lead;
  const companyName = lead.company?.name || "";
  const templateVars = {
    firstName: lead.firstName || "",
    lastName: lead.lastName || "",
    email: lead.email,
    company: companyName,
  };

  const subject = generateSpintaxVariant(variant.subjectSpintax, templateVars);

  const body = generateSpintaxVariant(variant.bodySpintax, templateVars);

	const allInboxes = await prismaClient.connectedInbox.findMany({
		where: {
			workspaceId: queueEntry.workspaceId,
			isActive: true,
		},
		orderBy: { dailySentCount: "asc" },
	});
	const inboxes = allInboxes.filter(i => i.dailySentCount < i.maxDailyLimit).slice(0, 1);

  if (inboxes.length === 0) {
    throw new Error("No available inbox with remaining daily capacity");
  }

  const inbox = inboxes[0];

	let transport;
  try {
    transport = createTransport({
      smtpHost: inbox.smtpHost,
      smtpPort: inbox.smtpPort,
      smtpUser: inbox.smtpUser,
      smtpPassEncrypted: inbox.smtpPassEncrypted,
    });

    await transport.sendMail({
      from: inbox.email,
      to: lead.email,
      subject,
      text: body,
      html: body.replace(/\n/g, "<br>"),
    });
  } finally {
    if (transport) {
      try { await transport.close(); } catch {}
    }
  }

  await prismaClient.$transaction([
    prismaClient.campaignQueue.update({
      where: { id: campaignQueueId },
      data: { status: "dispatched" },
    }),
    prismaClient.connectedInbox.update({
      where: { id: inbox.id },
      data: { dailySentCount: { increment: 1 } },
    }),
    prismaClient.lead.update({
      where: { id: lead.id },
      data: { status: "contacted" },
    }),
    prismaClient.variantTemplate.update({
      where: { id: variant.id },
      data: { sentCount: { increment: 1 } },
    }),
    prismaClient.communicationHistory.create({
      data: {
        workspaceId: queueEntry.workspaceId,
        leadId: lead.id,
        connectedInboxId: inbox.id,
        campaignId: queueEntry.campaignId,
        direction: "outbound",
        channel: "email",
        subject,
        bodyText: body,
        sentiment: null,
      },
    }),
  ]);
}

const worker = new Worker(QueueName.EMAIL_DISPATCH, processEmailDispatch, {
  connection,
  concurrency: 10,
  limiter: {
    max: 50,
    duration: 1000,
  },
  defaultJobOptions: {
    attempts: MAX_RETRY,
    backoff: {
      type: "exponential",
      delay: BACKOFF_MS,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

worker.on("completed", (job) => {
  console.log(`[email-dispatcher] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[email-dispatcher] Failed job ${job?.id}:`, err.message);
});

worker.on("error", (err) => {
  console.error("[email-dispatcher] Worker error:", err);
});

console.log("[email-dispatcher] Worker started");

process.on("SIGTERM", async () => {
  console.log("[email-dispatcher] SIGTERM received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[email-dispatcher] SIGINT received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});
