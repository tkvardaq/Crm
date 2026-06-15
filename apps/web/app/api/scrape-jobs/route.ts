import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { Queue } from "bullmq";
import { QueueName } from "@crm/shared";
import { parseRedisUrl } from "@crm/shared";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const scrapeJobSchema = z.object({
  name: z.string().min(1).max(255),
  targetUrl: z.string().url({ message: "Must be a valid URL" }),
  mode: z.enum(["single", "crawl", "sitemap"]).default("single"),
  maxPages: z.number().int().min(1).max(100).default(10),
  autoEnrich: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobs = await prismaClient.scrapeJob.findMany({
    where: { workspaceId: session.user.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ data: jobs });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = session.user.workspaceId;

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = scrapeJobSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors }, { status: 400 });

  const { name, targetUrl, mode, maxPages, autoEnrich } = parsed.data;

  const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;
  try {
    const u = new URL(targetUrl);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("Blocked");
    if (BLOCKED.test(u.hostname)) throw new Error("Blocked internal URL");
  } catch (e: any) {
    return NextResponse.json({ error: `Invalid or blocked URL: ${e.message}` }, { status: 400 });
  }

  const scrapeJob = await prismaClient.scrapeJob.create({
    data: { workspaceId, name, targetUrl, mode, maxPages, status: "pending" },
  });

  const queue = new Queue(QueueName.SCRAPER, { connection: parseRedisUrl(REDIS_URL) });
  try {
    await queue.add("discover", {
      mode: "discover",
      url: targetUrl,
      workspaceId,
      scrapeJobId: scrapeJob.id,
      crawlMode: mode,
      maxPages,
      autoEnrich,
    }, {
      jobId: `discover-${scrapeJob.id}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 30000 },
    });
  } finally {
    await queue.close();
  }

  return NextResponse.json(scrapeJob, { status: 201 });
}