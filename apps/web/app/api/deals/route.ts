import { NextRequest, NextResponse } from "next/server";
import { prismaClient, auditLog } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dealCreateSchema } from "@crm/shared";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const { searchParams } = new URL(req.url);
  const stageId = searchParams.get("stageId");

  const deals = await prismaClient.deal.findMany({
    where: {
      workspaceId,
      ...(stageId ? { pipelineStageId: stageId } : {}),
    },
    include: {
      lead: true,
      pipelineStage: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(deals);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const body = await req.json();
  const parsed = dealCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { leadId, pipelineStageId, title, value, expectedCloseDate, notes } = parsed.data;

  const lead = await prismaClient.lead.findFirst({ where: { id: leadId, workspaceId } });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found in workspace" }, { status: 403 });
  }

  const stage = await prismaClient.pipelineStage.findFirst({ where: { id: pipelineStageId, workspaceId } });
  if (!stage) {
    return NextResponse.json({ error: "Pipeline stage not found in workspace" }, { status: 403 });
  }

  const deal = await prismaClient.deal.create({
    data: {
      workspaceId,
      leadId,
      pipelineStageId,
      title,
      value: value || 0,
      expectedCloseDate,
      notes,
    },
  });

  auditLog({ workspaceId, userId: session.user.id, action: "deal.create",
    entity: "Deal", entityId: deal.id,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
  }).catch(() => {});

  return NextResponse.json(deal, { status: 201 });
}
