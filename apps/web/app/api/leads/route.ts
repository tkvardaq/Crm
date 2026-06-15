import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { leadCreateSchema, QueueName } from "@crm/shared";
import { Queue, ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const cursor = searchParams.get("cursor");
  const scrapeJobId = searchParams.get("scrapeJobId");
  const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
  const limit = Math.max(1, Math.min(100, isNaN(rawLimit) ? 50 : rawLimit));

  const leads = await prismaClient.lead.findMany({
    where: {
      workspaceId,
      ...(status ? { status } : {}),
      ...(scrapeJobId ? { scrapeJobId } : {}),
    },
    include: { company: true },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = leads.length > limit;
  const data = hasMore ? leads.slice(0, limit) : leads;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return NextResponse.json({ data, nextCursor, hasMore });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const body = await req.json();
  const parsed = leadCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { email, firstName, lastName, phone, linkedinUrl, companyId } = parsed.data;

  if (companyId) {
    const company = await prismaClient.company.findFirst({ where: { id: companyId, workspaceId } });
    if (!company) {
      return NextResponse.json({ error: "Company not found in workspace" }, { status: 403 });
    }
  }

  const lead = await prismaClient.lead.create({
    data: {
      workspaceId,
      email,
      firstName,
      lastName,
      phone,
      linkedinUrl,
      companyId,
      status: "raw",
    },
  });

  try {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;
    const enrichmentQueue = new Queue(QueueName.ENRICHMENT, { connection });
    try {
      await enrichmentQueue.add("enrich", { leadId: lead.id, workspaceId }, { attempts: 2, backoff: { type: "exponential", delay: 10000 } });
    } finally {
      await enrichmentQueue.close();
      await (connection as IORedis).quit().catch(() => {});
    }
  } catch (err) {
    console.error("[leads] Failed to queue enrichment for lead:", err);
  }

  return NextResponse.json(lead, { status: 201 });
}
