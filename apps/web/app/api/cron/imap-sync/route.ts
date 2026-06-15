import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { Queue } from "bullmq";
import { QueueName } from "@crm/shared";
import { parseRedisUrl } from "@crm/shared";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export async function POST(req: NextRequest) {
	const authHeader = req.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;
	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const inboxes = await prismaClient.connectedInbox.findMany({
		where: { isActive: true },
		select: { id: true, workspaceId: true },
	});

	const redisOpts = parseRedisUrl(REDIS_URL);
	const imapQueue = new Queue(QueueName.IMAP_SYNC, { connection: redisOpts });

	for (const inbox of inboxes) {
		await imapQueue.add(
			"sync-inbox",
			{ inboxId: inbox.id, workspaceId: inbox.workspaceId },
			{ attempts: 3, backoff: { type: "exponential", delay: 10000 } }
		);
	}

	await imapQueue.close();

	return NextResponse.json({
		message: "IMAP sync triggered",
		inboxesQueued: inboxes.length,
	});
}
