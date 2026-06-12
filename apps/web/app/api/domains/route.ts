import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendingDomainSchema } from "@crm/shared";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const domains = await prismaClient.sendingDomain.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(domains);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const body = await req.json();
  const parsed = sendingDomainSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { domain } = parsed.data;

  const existing = await prismaClient.sendingDomain.findUnique({
    where: { domain },
  });
  if (existing) {
    if (existing.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: "Domain is already registered in another workspace" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Domain already exists in this workspace" },
      { status: 409 }
    );
  }

  const sendingDomain = await prismaClient.sendingDomain.create({
    data: {
      domain,
      workspaceId,
    },
  });

  return NextResponse.json(sendingDomain, { status: 201 });
}
