import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prismaClient } from "@crm/database";
import { Queue } from "bullmq";
import { QueueName, parseRedisUrl } from "@crm/shared";
import { z } from "zod";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const schema = z.object({
  query: z.string().min(1).max(500),
  location: z.string().min(1).max(500),
  jobName: z.string().min(1).max(255),
});

const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = session.user.workspaceId;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  const { query, location, jobName } = parsed.data;

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + " " + location)}`;

  try {
    const u = new URL(searchUrl);
    if (BLOCKED.test(u.hostname)) throw new Error("Blocked");
  } catch {
    return NextResponse.json({ error: "Invalid search query" }, { status: 400 });
  }

  const scrapeJob = await prismaClient.scrapeJob.create({
    data: {
      workspaceId,
      name: jobName,
      targetUrl: searchUrl,
      mode: "discover",
      status: "pending",
    },
  });

  const queue = new Queue(QueueName.SCRAPER, { connection: parseRedisUrl(REDIS_URL) });
  try {
    await queue.add("discover", {
      mode: "discover",
      url: searchUrl,
      workspaceId,
      scrapeJobId: scrapeJob.id,
      query,
      location,
      crawlMode: "single",
      maxPages: 10,
      autoEnrich: false,
    }, {
      jobId: `discover-${scrapeJob.id}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 30000 },
    });
  } finally {
    await queue.close();
  }

  return NextResponse.json({ scrapeJobId: scrapeJob.id });
}
