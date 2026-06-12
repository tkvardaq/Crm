import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { campaignLaunchSchema, CampaignStatus, QueueName } from "@crm/shared";
import { Queue } from "bullmq";

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const campaignId = params.id;

  const campaign = await prismaClient.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: {
      steps: {
        include: { variants: true },
        orderBy: { stepNumber: "asc" },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (campaign.status !== CampaignStatus.DRAFT && campaign.status !== CampaignStatus.PAUSED) {
    return NextResponse.json(
      { error: "Campaign must be in draft or paused status to launch" },
      { status: 400 }
    );
  }

  const updated = await prismaClient.campaign.updateMany({
    where: { id: campaignId, workspaceId, status: campaign.status },
    data: { status: CampaignStatus.ACTIVE },
  });

  if (updated.count === 0) {
    return NextResponse.json(
      { error: "Campaign status changed — another launch may be in progress" },
      { status: 409 }
    );
  }

  if (campaign.steps.length === 0) {
    return NextResponse.json(
      { error: "Campaign has no steps" },
      { status: 400 }
    );
  }

  const firstStep = campaign.steps[0];
  if (!firstStep.variants || firstStep.variants.length === 0) {
    return NextResponse.json(
      { error: "First campaign step has no email variants" },
      { status: 400 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = campaignLaunchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }
  const leadIds: string[] = parsed.data.leadIds;
  const listId: string | null = parsed.data.listId ?? null;

  let leads;

  if (leadIds.length > 0) {
    leads = await prismaClient.lead.findMany({
      where: {
        id: { in: leadIds },
        workspaceId,
        isOptedOut: false,
      },
    });
    if (leads.length !== leadIds.length) {
      return NextResponse.json(
        { error: "One or more lead IDs are invalid or belong to another workspace" },
        { status: 400 }
      );
    }
  } else {
    leads = await prismaClient.lead.findMany({
      where: {
        workspaceId,
        isOptedOut: false,
        status: { in: ["raw", "enriched"] },
      },
    });
  }

  if (leads.length === 0) {
    return NextResponse.json(
      { error: "No eligible leads found" },
      { status: 400 }
    );
  }

  const now = new Date();

  await prismaClient.campaignQueue.createMany({
    data: leads.map((lead, index) => ({
      workspaceId,
      campaignId,
      campaignStepId: firstStep.id,
      leadId: lead.id,
      scheduledFor: new Date(now.getTime() + index * 2000),
      status: "pending",
    })),
  });

  const redisOpts = parseRedisUrl(REDIS_URL);
  const emailDispatchQueue = new Queue(QueueName.EMAIL_DISPATCH, { connection: redisOpts });

  const pendingEntries = await prismaClient.campaignQueue.findMany({
    where: {
      workspaceId,
      campaignId,
      campaignStepId: firstStep.id,
      status: "pending",
    },
  });

  for (const entry of pendingEntries) {
    await emailDispatchQueue.add(
      "dispatch",
      { campaignQueueId: entry.id },
      {
        delay: Math.max(0, entry.scheduledFor.getTime() - Date.now()),
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      }
    );
  }

  const subsequentSteps = campaign.steps.slice(1);
  for (const step of subsequentSteps) {
    const delayMs = step.delayDays * 24 * 60 * 60 * 1000;

    await prismaClient.campaignQueue.createMany({
      data: leads.map((lead, index) => ({
        workspaceId,
        campaignId,
        campaignStepId: step.id,
        leadId: lead.id,
        scheduledFor: new Date(now.getTime() + delayMs + index * 2000),
        status: "pending",
      })),
    });

    const pendingStepEntries = await prismaClient.campaignQueue.findMany({
      where: {
        workspaceId,
        campaignId,
        campaignStepId: step.id,
        status: "pending",
      },
    });

    for (const entry of pendingStepEntries) {
      await emailDispatchQueue.add(
        "dispatch",
        { campaignQueueId: entry.id },
        {
          delay: Math.max(0, entry.scheduledFor.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );
    }
  }

  await emailDispatchQueue.close();

  return NextResponse.json({
    message: "Campaign launched",
    leadsCount: leads.length,
    stepsQueued: campaign.steps.length,
    totalJobs: leads.length * campaign.steps.length,
  });
}