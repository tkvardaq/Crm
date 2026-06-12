import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { Queue } from "bullmq";
import { QueueName } from "@crm/shared";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function parseRedisUrl(url: string) {
	try {
		const parsed = new URL(url);
		return {
			host: parsed.hostname || "localhost",
			port: Number(parsed.port) || 6379,
			password: parsed.password || undefined,
			db: parsed.pathname ? Number(parsed.pathname.slice(1)) || 0 : 0,
		};
	} catch {
		return { host: "localhost", port: 6379, password: undefined, db: 0 };
	}
}

export async function POST(req: NextRequest) {
	const authHeader = req.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;
	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

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
			{ attempts: 2, backoff: { type: "exponential", delay: 60000 } }
		);
	}

	await warmupQueue.close();

	return NextResponse.json({
		message: "Daily reset complete",
		inboxesReset: resetResult.count,
		warmupJobsQueued: inboxes.length,
	});
}
