import { Worker, Job } from "bullmq";
import { prismaClient } from "@crm/database";
import { QueueName } from "@crm/shared";
import { createTransport, generateSpintaxVariant, getWeightedRandomIndex, toSafeHtml } from "@crm/email-engine";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const MAX_RETRY = 3;
const BACKOFF_MS = 5000;

const connection = { url: REDIS_URL, maxRetriesPerRequest: null };

const transportCache = new Map<string, ReturnType<typeof createTransport>>();

function getOrCreateTransport(inbox: { id: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPassEncrypted: string }) {
  if (!transportCache.has(inbox.id)) {
    transportCache.set(inbox.id, createTransport(inbox));
  }
  return transportCache.get(inbox.id)!;
}

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

// Atomically claim one inbox slot (increment count within the SELECT transaction)
	const claimed = await prismaClient.$queryRaw<{ id: string }[]>`
		UPDATE connected_inboxes
		SET daily_sent_count = daily_sent_count + 1
		WHERE workspace_id = ${queueEntry.workspaceId}
		  AND is_active = true
		  AND daily_sent_count < max_daily_limit
		  AND id = (
			SELECT id FROM connected_inboxes
			WHERE workspace_id = ${queueEntry.workspaceId}
			  AND is_active = true
			  AND daily_sent_count < max_daily_limit
			ORDER BY daily_sent_count ASC
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		  )
		RETURNING id
	`;

	if (claimed.length === 0) {
		throw new Error("No available inbox with remaining daily capacity");
	}

	const inbox = await prismaClient.connectedInbox.findUniqueOrThrow({
		where: { id: claimed[0].id },
	});

	const transport = getOrCreateTransport(inbox);
    await transport.sendMail({
      from: inbox.email,
      to: lead.email,
      subject,
      text: body,
      html: toSafeHtml(body),
    });

  await prismaClient.$transaction([
    prismaClient.campaignQueue.update({
      where: { id: campaignQueueId },
      data: { status: "dispatched" },
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
        sentAt: new Date(),
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
  for (const transport of transportCache.values()) {
    try { await transport.close(); } catch {}
  }
  transportCache.clear();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[email-dispatcher] SIGINT received, shutting down gracefully...");
  await worker.close();
  for (const transport of transportCache.values()) {
    try { await transport.close(); } catch {}
  }
  transportCache.clear();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});
