import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dealSchema } from "@crm/shared";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const deal = await prismaClient.deal.findFirst({
    where: { id: params.id, workspaceId },
    include: { lead: true, pipelineStage: true },
  });

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  return NextResponse.json(deal);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const body = await req.json();
  const parsed = dealSchema.omit({ leadId: true, pipelineStageId: true }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { title, value, expectedCloseDate, notes } = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title;
  if (value !== undefined) updateData.value = value;
  if (expectedCloseDate !== undefined) updateData.expectedCloseDate = expectedCloseDate;
  if (notes !== undefined) updateData.notes = notes;

  const updated = await prismaClient.deal.updateMany({
    where: { id: params.id, workspaceId },
    data: updateData,
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const deal = await prismaClient.deal.findFirst({
    where: { id: params.id, workspaceId },
    include: { lead: true, pipelineStage: true },
  });

  return NextResponse.json(deal);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const deleted = await prismaClient.deal.deleteMany({
    where: { id: params.id, workspaceId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
