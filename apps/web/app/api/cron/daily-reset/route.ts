import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { Queue } from "bullmq";
import { QueueName } from "@crm/shared";
import { parseRedisUrl } from "@crm/shared";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export async function POST(req: NextRequest) {
	const authHeader = req.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;
	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const todayKey = `crm:cron:daily-reset:${new Date().toISOString().slice(0, 10)}`;
	const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
	try {
		const acquired = await redis.set(todayKey, "1", "EX", 86400, "NX");
		if (!acquired) return NextResponse.json({ message: "Already reset today" });

		const resetResult = await prismaClient.connectedInbox.updateMany({
			where: { isActive: true },
			data: { dailySentCount: 0 },
		});

		const inboxes = await prismaClient.connectedInbox.findMany({
			where: { warmupEnabled: true, isActive: true },
			select: { id: true },
		});

		const redisOpts = parseRedisUrl(REDIS_URL);
		const warmupQueue = new Queue(QueueName.WARMUP, { connection: redisOpts });

		for (const inbox of inboxes) {
			await warmupQueue.add(
				"warmup-daily",
				{ inboxId: inbox.id },
				{
					jobId: `warmup-${inbox.id}-${todayKey}`,
					attempts: 2,
					backoff: { type: "exponential", delay: 60000 },
				}
			);
		}

		await warmupQueue.close();

		return NextResponse.json({
			message: "Daily reset complete",
			inboxesReset: resetResult.count,
			warmupJobsQueued: inboxes.length,
		});
	} finally {
		await redis.quit();
	}
}
