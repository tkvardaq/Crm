import { Worker, Job, Queue } from "bullmq";
import { prismaClient, decrypt } from "@crm/database";
import { QueueName } from "@crm/shared";
import Imap from "imap";
import { simpleParser } from "mailparser";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const aiExtractQueue = new Queue(QueueName.AI_EXTRACT, { connection });
const emailDispatchQueue = new Queue(QueueName.EMAIL_DISPATCH, { connection });

async function closeQueues() {
  await Promise.all([aiExtractQueue.close(), emailDispatchQueue.close()]);
}

interface ImapSyncJobData {
  inboxId: string;
  workspaceId: string;
}

function openImapConnection(inbox: {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassEncrypted: string;
}): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const password = decrypt(inbox.imapPassEncrypted);
    const tlsRejectUnauthorized = process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== "false";
    const imap = new Imap({
      host: inbox.imapHost,
      port: inbox.imapPort,
      user: inbox.imapUser,
      password,
      tls: inbox.imapPort === 993,
      tlsOptions: { rejectUnauthorized: tlsRejectUnauthorized },
    });

    imap.once("ready", () => resolve(imap));
    imap.once("error", (err: Error) => reject(err));
    imap.connect();
  });
}

async function processImapSync(job: Job<ImapSyncJobData>) {
  const { inboxId } = job.data;

  const inbox = await prismaClient.connectedInbox.findFirst({
    where: { id: inboxId, workspaceId },
  });

  if (!inbox || !inbox.isActive) {
    console.log(`[imap-sync] Inbox ${inboxId} not found or inactive, skipping`);
    return;
  }

  const imap = await openImapConnection({
    imapHost: inbox.imapHost,
    imapPort: inbox.imapPort,
    imapUser: inbox.imapUser,
    imapPassEncrypted: inbox.imapPassEncrypted,
  });

  try {
    const box = await new Promise<Imap.Box>((resolve, reject) => {
      imap.openBox("INBOX", false, (err, box) => {
        if (err) reject(err);
        else resolve(box);
      });
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const searchCriteria = ["UNSEEN", ["SINCE", since]];

    const uids = await new Promise<number[]>((resolve, reject) => {
      imap.search(searchCriteria, (err, uids) => {
        if (err) reject(err);
        else resolve(uids || []);
      });
    });

    if (uids.length === 0) {
      console.log(`[imap-sync] No new messages for inbox ${inbox.email}`);
      return;
    }

	const messageFetcher = imap.fetch(uids, { bodies: "" });
	const messages: Promise<void>[] = [];

	messageFetcher.on("message", (msg: any) => {
		const promise = new Promise<void>((resolve, reject) => {
			const bodyChunks: Buffer[] = [];
			msg.on("body", (stream: NodeJS.ReadableStream) => {
				stream.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
				stream.on("end", async () => {
					try {
						const raw = Buffer.concat(bodyChunks).toString("utf8");
						const parsed = await simpleParser(raw);

						if (parsed.headers?.get("x-crm-warmup") === "true") {
							resolve();
							return;
						}

						const fromAddr = parsed.from?.value?.[0]?.address || "";
						const subject = parsed.subject || "";
						const bodyText = parsed.text || "";
						const messageId = parsed.messageId || null;

          const lead = await prismaClient.lead.findFirst({
            where: {
              workspaceId: inbox.workspaceId,
              email: { equals: fromAddr, mode: "insensitive" },
            },
          });

          if (lead) {
            await prismaClient.lead.update({
              where: { id: lead.id, workspaceId: inbox.workspaceId },
              data: { status: "replied" },
            });

            await prismaClient.campaignQueue.updateMany({
              where: {
                leadId: lead.id,
                workspaceId: inbox.workspaceId,
                status: "pending",
              },
              data: { status: "cancelled" },
            });
          }

          const comm = await prismaClient.communicationHistory.create({
            data: {
              workspaceId: inbox.workspaceId,
              leadId: lead?.id ?? null,
              connectedInboxId: inbox.id,
              direction: "inbound",
              channel: "email",
              subject,
              bodyText,
              sentiment: null,
              messageId,
            },
          });

          if (lead) {
            await aiExtractQueue.add("ai-extract", {
              communicationHistoryId: comm.id,
              workspaceId: inbox.workspaceId,
            }, {
              attempts: 2,
              backoff: { type: "exponential", delay: 10000 },
            });
          }

						resolve();
					} catch (err) {
						reject(err);
					}
				});
			});
			msg.once("error", reject);
		});
		messages.push(promise);
	});

	await new Promise<void>((resolve, reject) => {
		messageFetcher.once("error", reject);
		messageFetcher.once("end", resolve);
	});
	const settled = await Promise.allSettled(messages);
	const rejected = settled.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
	if (rejected.length > 0) {
		console.error(`[imap-sync] ${rejected.length} messages failed:`, rejected[0].reason);
	}
    console.log(`[imap-sync] Processed ${uids.length} messages for ${inbox.email}`);
  } finally {
    imap.end();
  }
}

const worker = new Worker<ImapSyncJobData>(QueueName.IMAP_SYNC, processImapSync, {
  connection,
  concurrency: 5,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
});

worker.on("completed", (job) => {
  console.log(`[imap-sync] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[imap-sync] Failed job ${job?.id}:`, err.message);
});

worker.on("error", (err) => {
  console.error("[imap-sync] Worker error:", err);
});

console.log("[imap-sync] Worker started");

process.on("SIGTERM", async () => {
	console.log("[imap-sync] SIGTERM received, shutting down gracefully...");
	await worker.close();
	await closeQueues();
	await connection.quit();
	await prismaClient.$disconnect().catch(() => {});
	process.exit(0);
});

process.on("SIGINT", async () => {
	console.log("[imap-sync] SIGINT received, shutting down gracefully...");
	await worker.close();
	await closeQueues();
	await connection.quit();
	await prismaClient.$disconnect().catch(() => {});
	process.exit(0);
});
