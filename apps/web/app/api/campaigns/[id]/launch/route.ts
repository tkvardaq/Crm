import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { campaignLaunchSchema, CampaignStatus, QueueName } from "@crm/shared";
import { Queue } from "bullmq";
import { parseRedisUrl } from "@crm/shared";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

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
  const allEntries: { id: string; scheduledFor: Date }[] = [];

  await prismaClient.$transaction(async (tx) => {
    const updated = await tx.campaign.updateMany({
      where: { id: campaignId, workspaceId, status: campaign.status },
      data: { status: CampaignStatus.ACTIVE },
    });
    if (updated.count === 0) {
      throw new Error("CONFLICT");
    }

    for (let si = 0; si < campaign.steps.length; si++) {
      const step = campaign.steps[si];
      const delayMs = si === 0 ? 0 : step.delayDays * 86_400_000;
      for (let li = 0; li < leads.length; li++) {
        const entry = await tx.campaignQueue.create({
          data: {
            workspaceId,
            campaignId,
            campaignStepId: step.id,
            leadId: leads[li].id,
            scheduledFor: new Date(now.getTime() + delayMs + li * 2000),
            status: "pending",
          },
          select: { id: true, scheduledFor: true },
        });
        allEntries.push(entry);
      }
    }
  });

  const redisOpts = parseRedisUrl(REDIS_URL);
  const emailDispatchQueue = new Queue(QueueName.EMAIL_DISPATCH, { connection: redisOpts });
  try {
    for (const entry of allEntries) {
      await emailDispatchQueue.add(
        "dispatch",
        { campaignQueueId: entry.id },
        {
          jobId: entry.id,
          delay: Math.max(0, entry.scheduledFor.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );
    }
  } finally {
    await emailDispatchQueue.close();
  }

  return NextResponse.json({
    message: "Campaign launched",
    leadsCount: leads.length,
    stepsQueued: campaign.steps.length,
    totalJobs: allEntries.length,
  });
}