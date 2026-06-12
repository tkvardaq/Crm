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
  const inboxId = searchParams.get("inboxId");

  const whereClause: Record<string, unknown> = { workspaceId };
  if (inboxId) whereClause.connectedInboxId = inboxId;

  const history = await prismaClient.communicationHistory.findMany({
    where: whereClause,
    include: {
      lead: true,
      connectedInbox: { include: { sendingDomain: true } },
    },
    orderBy: { sentAt: "desc" },
    take: 50,
  });

  return NextResponse.json(history);
}
