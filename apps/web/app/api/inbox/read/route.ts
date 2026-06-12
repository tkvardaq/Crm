import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const body = await req.json();
  const { messageIds, allForLeadId } = body as {
    messageIds?: string[];
    allForLeadId?: string;
  };

  if (messageIds?.length) {
    await prismaClient.communicationHistory.updateMany({
      where: { id: { in: messageIds }, workspaceId },
      data: { isRead: true },
    });
    return NextResponse.json({ updated: messageIds.length });
  }

  if (allForLeadId) {
    const result = await prismaClient.communicationHistory.updateMany({
      where: { leadId: allForLeadId, workspaceId, isRead: false, direction: "inbound" },
      data: { isRead: true },
    });
    return NextResponse.json({ updated: result.count });
  }

  return NextResponse.json({ error: "Provide messageIds or allForLeadId" }, { status: 400 });
}
