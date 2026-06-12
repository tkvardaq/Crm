import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { campaignSchema } from "@crm/shared";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const campaign = await prismaClient.campaign.findFirst({
    where: { id: params.id, workspaceId },
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

  return NextResponse.json(campaign);
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
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { steps: _steps, ...updateData } = parsed.data;

  const updated = await prismaClient.campaign.updateMany({
    where: { id: params.id, workspaceId },
    data: updateData,
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const campaign = await prismaClient.campaign.findFirst({
    where: { id: params.id, workspaceId },
    include: {
      steps: {
        include: { variants: true },
        orderBy: { stepNumber: "asc" },
      },
    },
  });

  return NextResponse.json(campaign);
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
  const deleted = await prismaClient.campaign.deleteMany({
    where: { id: params.id, workspaceId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
