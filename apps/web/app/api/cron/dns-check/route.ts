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

	const domains = await prismaClient.sendingDomain.findMany({
		select: { id: true, workspaceId: true },
	});

	const redisOpts = parseRedisUrl(REDIS_URL);
	const dnsQueue = new Queue(QueueName.DNS_CHECK, { connection: redisOpts });

	for (const domain of domains) {
		await dnsQueue.add(
			"check-dns",
			{ domainId: domain.id, workspaceId: domain.workspaceId },
			{ attempts: 2, backoff: { type: "exponential", delay: 30000 } }
		);
	}

	await dnsQueue.close();

	return NextResponse.json({
		message: "DNS check triggered",
		domainsQueued: domains.length,
	});
}
