import { Worker, Job } from "bullmq";
import { prismaClient } from "@crm/database";
import { QueueName } from "@crm/shared";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

interface DecayTrackJobData {
  workspaceId: string;
}

const DECAY_RULES: Record<string, number> = {
  raw: -2,
  enriched: -1,
  contacted: -3,
  replied: 0,
  interested: 0,
  not_interested: -5,
};

const MIN_SCORE = 0;
const MAX_SCORE = 100;
const COLD_THRESHOLD = 20;

async function processDecayTrack(job: Job<DecayTrackJobData>) {
  const { workspaceId } = job.data;

  const leads = await prismaClient.lead.findMany({
    where: {
      workspaceId,
      isOptedOut: false,
    },
    select: {
      id: true,
      status: true,
      score: true,
      updatedAt: true,
    },
  });

  let decayed = 0;

  const updates = leads
    .map((lead) => {
      const daysSinceUpdate = Math.floor(
        (Date.now() - lead.updatedAt.getTime()) / (24 * 60 * 60 * 1000)
      );
      if (daysSinceUpdate < 1) return null;
      const decayPerDay = DECAY_RULES[lead.status] ?? -1;
      if (decayPerDay === 0) return null;
      const totalDecay = decayPerDay * daysSinceUpdate;
      const newScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, lead.score + totalDecay));
      if (newScore === lead.score) return null;
      return { id: lead.id, newScore, status: lead.status };
    })
    .filter((u): u is { id: string; newScore: number; status: string } => u !== null);

  if (updates.length) {
    const { Prisma } = require("@prisma/client");
    await prismaClient.$executeRaw`
      UPDATE leads SET score = CASE id
        ${Prisma.join(updates.map((u) => Prisma.sql`WHEN ${u.id}::uuid THEN ${u.newScore}`))}
      END, updated_at = NOW()
      WHERE id IN (${Prisma.join(updates.map((u) => Prisma.sql`${u.id}::uuid`))})
    `;
    decayed = updates.length;

    const staleIds = updates
      .filter((u) => u.newScore <= COLD_THRESHOLD && u.status === "contacted")
      .map((u) => u.id);
    if (staleIds.length) {
      await prismaClient.lead.updateMany({
        where: { id: { in: staleIds } },
        data: { status: "raw" },
      });
    }
  }

  console.log(
    `[decay-tracker] Workspace ${workspaceId}: ${decayed} leads decayed`
  );
}

const worker = new Worker<DecayTrackJobData>(QueueName.DECAY_TRACK, processDecayTrack, {
  connection,
  concurrency: 1,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 60000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

worker.on("completed", (job) => {
  console.log(`[decay-tracker] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[decay-tracker] Failed job ${job?.id}:`, err.message);
});

worker.on("error", (err) => {
  console.error("[decay-tracker] Worker error:", err);
});

console.log("[decay-tracker] Worker started");

process.on("SIGTERM", async () => {
  console.log("[decay-tracker] SIGTERM received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[decay-tracker] SIGINT received, shutting down gracefully...");
  await worker.close();
  await connection.quit();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});
