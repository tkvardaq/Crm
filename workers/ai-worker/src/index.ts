import { Worker, Job } from "bullmq";
import { prismaClient } from "@crm/database";
import { QueueName, InteractionSentiment } from "@crm/shared";
import { NVIDIANimClient } from "@crm/ai-client";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

interface AiExtractJobData {
  communicationHistoryId: string;
  workspaceId: string;
}

const EXTRACTION_PROMPT = `You are an AI assistant analyzing an email reply from a sales lead. 
Determine the sentiment/intent of the reply. Respond with exactly one of:
- "positive" - the lead is interested or wants to learn more
- "neutral" - the lead is neither interested nor disinterested (e.g., asking a question, acknowledging)
- "negative" - the lead is not interested or declining
- "oof" - the lead is out of office / auto-reply
- "unsubscribe" - the lead wants to opt out

Also extract any key information mentioned (budget, timeline, decision makers, pain points).

Respond in this exact JSON format:
{"sentiment": "positive|neutral|negative|oof|unsubscribe", "keyInfo": "brief summary of key information, or null"}`;

async function processAiExtract(job: Job<AiExtractJobData>) {
  const { communicationHistoryId, workspaceId } = job.data;

  const comm = await prismaClient.communicationHistory.findFirst({
    where: { id: communicationHistoryId, workspaceId },
  });

  if (!comm) {
    console.log(`[ai-worker] Communication ${communicationHistoryId} not found, skipping`);
    return;
  }

  if (comm.direction !== "inbound" || comm.sentiment) {
    return;
  }

  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) {
    console.warn("[ai-worker] NIM_API_KEY not set — skipping AI extraction for this job.");
    return;
  }

  const client = new NVIDIANimClient({
    apiKey,
    baseURL: process.env.NIM_BASE_URL,
  });

  const emailContent = `Subject: ${comm.subject || "(no subject)"}\n\nBody:\n${comm.bodyText}`;

  const response = await client.chatCompletion("meta/llama-3.1-8b-instruct", [
    { role: "system", content: EXTRACTION_PROMPT },
    { role: "user", content: emailContent },
  ]);

  const content = response.choices?.[0]?.message?.content || "";
  let parsed: { sentiment: string; keyInfo: string | null };

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.log(`[ai-worker] Failed to parse AI response for ${communicationHistoryId}`);
    parsed = { sentiment: "neutral", keyInfo: null };
  }

  const validSentiments = ["positive", "neutral", "negative", "oof", "unsubscribe"];
  const sentiment = validSentiments.includes(parsed.sentiment)
    ? parsed.sentiment
    : "neutral";

  await prismaClient.communicationHistory.update({
    where: { id: communicationHistoryId },
    data: { sentiment },
  });

  if (comm.leadId) {
    if (sentiment === "positive") {
      await prismaClient.lead.update({
        where: { id: comm.leadId, workspaceId },
        data: { status: "interested" },
      });
    } else if (sentiment === "negative") {
      await prismaClient.lead.update({
        where: { id: comm.leadId, workspaceId },
        data: { status: "not_interested" },
      });
      await prismaClient.campaignQueue.updateMany({
        where: { leadId: comm.leadId, workspaceId, status: "pending" },
        data: { status: "cancelled" },
      });
    } else if (sentiment === "unsubscribe") {
      await prismaClient.lead.update({
        where: { id: comm.leadId, workspaceId },
        data: { isOptedOut: true },
      });
      await prismaClient.campaignQueue.updateMany({
        where: { leadId: comm.leadId, workspaceId, status: "pending" },
        data: { status: "cancelled" },
      });
    } else if (sentiment === "oof") {
      const pendingEntries = await prismaClient.campaignQueue.findMany({
        where: { leadId: comm.leadId, workspaceId, status: "pending" },
        select: { id: true, scheduledFor: true },
      });
      const threeDays = 3 * 24 * 60 * 60 * 1000;
      for (const entry of pendingEntries) {
        const newDate = new Date(
          (entry.scheduledFor ? new Date(entry.scheduledFor).getTime() : Date.now()) + threeDays
        );
        await prismaClient.campaignQueue.update({
          where: { id: entry.id, workspaceId },
          data: { scheduledFor: newDate },
        });
      }
    }
  }

  console.log(
    `[ai-worker] Extracted sentiment="${sentiment}" for communication ${communicationHistoryId}`
  );
}

const worker = new Worker<AiExtractJobData>(QueueName.AI_EXTRACT, processAiExtract, {
  connection,
  concurrency: 5,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
});

worker.on("completed", (job) => {
  console.log(`[ai-worker] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[ai-worker] Failed job ${job?.id}:`, err.message);
});

worker.on("error", (err) => {
  console.error("[ai-worker] Worker error:", err);
});

console.log("[ai-worker] Worker started");

process.on("SIGTERM", async () => {
  console.log("[ai-worker] SIGTERM received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[ai-worker] SIGINT received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});
