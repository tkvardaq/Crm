import { NextRequest, NextResponse } from "next/server";
import { prismaClient, auditLog } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { moveDealSchema } from "@crm/shared";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const { id } = params;
  const body = await req.json();
  const parsed = moveDealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const deal = await prismaClient.deal.findFirst({
    where: { id, workspaceId },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const destStage = await prismaClient.pipelineStage.findFirst({
    where: { id: parsed.data.destinationStageId, workspaceId },
  });
  if (!destStage) {
    return NextResponse.json({ error: "Destination stage not found in workspace" }, { status: 403 });
  }

  const updated = await prismaClient.deal.update({
    where: { id, workspaceId },
    data: { pipelineStageId: parsed.data.destinationStageId },
  });

  auditLog({ workspaceId, userId: session.user.id, action: "deal.move",
    entity: "Deal", entityId: id,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
  }).catch(() => {});

  return NextResponse.json(updated);
}
