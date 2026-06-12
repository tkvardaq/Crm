import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const { searchParams } = new URL(req.url);
  const entity = searchParams.get("entity");
  const action = searchParams.get("action");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);
  const cursor = searchParams.get("cursor");

  const where: Record<string, unknown> = { workspaceId };
  if (entity) where.entity = entity;
  if (action) where.action = action;

  const logs = await prismaClient.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasNext = logs.length > limit;
  const items = hasNext ? logs.slice(0, -1) : logs;

  return NextResponse.json({
    items,
    nextCursor: hasNext ? items[items.length - 1]?.id : null,
  });
}
