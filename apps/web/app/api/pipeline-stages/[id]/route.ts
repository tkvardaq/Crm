import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pipelineStageSchema } from "@crm/shared";

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
  const parsed = pipelineStageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { name, sortOrder } = parsed.data;

  const updated = await prismaClient.pipelineStage.updateMany({
    where: { id: params.id, workspaceId },
    data: { name, sortOrder },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Stage not found" }, { status: 404 });
  }

  const stage = await prismaClient.pipelineStage.findFirst({
    where: { id: params.id, workspaceId },
  });

  return NextResponse.json(stage);
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
  const dealCount = await prismaClient.deal.count({
    where: { pipelineStageId: params.id, workspaceId },
  });

  if (dealCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete stage with ${dealCount} existing deal(s)` },
      { status: 409 }
    );
  }

  const deleted = await prismaClient.pipelineStage.deleteMany({
    where: { id: params.id, workspaceId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Stage not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
