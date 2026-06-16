import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const company = await prismaClient.company.findFirst({
    where: { id: params.id, workspaceId: session.user.workspaceId },
    include: {
      _count: { select: { leads: true } },
      leads: {
        take: 50,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const { _count, ...data } = company;
  return NextResponse.json({ ...data, leadCount: _count.leads });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const company = await prismaClient.company.findFirst({
    where: { id: params.id, workspaceId: session.user.workspaceId },
  });

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const updated = await prismaClient.company.update({
    where: { id: params.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.domain !== undefined ? { domain: body.domain } : {}),
      ...(body.industry !== undefined ? { industry: body.industry } : {}),
      ...(body.sizeRange !== undefined ? { sizeRange: body.sizeRange } : {}),
      ...(body.headquarters !== undefined ? { headquarters: body.headquarters } : {}),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const company = await prismaClient.company.findFirst({
    where: { id: params.id, workspaceId: session.user.workspaceId },
  });

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  await prismaClient.company.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
