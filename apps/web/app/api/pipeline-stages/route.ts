import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pipelineStageSchema } from "@crm/shared";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const stages = await prismaClient.pipelineStage.findMany({
    where: { workspaceId },
    include: { _count: { select: { deals: true } } },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(stages.map((s) => ({ ...s, dealCount: s._count.deals })));
}

export async function POST(req: NextRequest) {
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

  const existing = await prismaClient.pipelineStage.findFirst({
    where: { workspaceId, sortOrder },
  });
  if (existing) {
    return NextResponse.json(
      { error: `A stage with sort order ${sortOrder} already exists in this workspace` },
      { status: 409 }
    );
  }

  const stage = await prismaClient.pipelineStage.create({
    data: {
      workspaceId,
      name,
      sortOrder,
    },
  });

  return NextResponse.json(stage, { status: 201 });
}
