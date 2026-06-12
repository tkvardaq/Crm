import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { leadSchema } from "@crm/shared";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const lead = await prismaClient.lead.findFirst({
    where: { id: params.id, workspaceId },
    include: { company: true },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  return NextResponse.json(lead);
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
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { email, firstName, lastName, phone, linkedinUrl, companyId, status } = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (email !== undefined) updateData.email = email;
  if (firstName !== undefined) updateData.firstName = firstName;
  if (lastName !== undefined) updateData.lastName = lastName;
  if (phone !== undefined) updateData.phone = phone;
  if (linkedinUrl !== undefined) updateData.linkedinUrl = linkedinUrl;
  if (companyId !== undefined) updateData.companyId = companyId;
  if (status !== undefined) updateData.status = status;

  const updated = await prismaClient.lead.updateMany({
    where: { id: params.id, workspaceId },
    data: updateData,
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const lead = await prismaClient.lead.findFirst({
    where: { id: params.id, workspaceId },
    include: { company: true },
  });

  return NextResponse.json(lead);
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
  const deleted = await prismaClient.lead.deleteMany({
    where: { id: params.id, workspaceId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
