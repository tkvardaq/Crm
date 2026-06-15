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

  const workspaceId = session.user.workspaceId;

  const lead = await prismaClient.lead.findFirst({
    where: { id: params.id, workspaceId },
  });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const notes = await prismaClient.note.findMany({
    where: { leadId: params.id, workspaceId },
include: { user: { select: { firstName: true, lastName: true } } },
  orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(notes);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const userId = session.user.id;

  const lead = await prismaClient.lead.findFirst({
    where: { id: params.id, workspaceId },
  });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const body = await req.json();
  const { content } = body;
  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }
  if (content.length > 50_000) {
    return NextResponse.json({ error: "Note too long (max 50,000 chars)" }, { status: 400 });
  }

  const note = await prismaClient.note.create({
    data: {
      workspaceId,
      leadId: params.id,
      userId,
      content,
    },
    include: { user: { select: { firstName: true, lastName: true } } },
  });

  return NextResponse.json(note, { status: 201 });
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
  const { searchParams } = new URL(req.url);
  const noteId = searchParams.get("noteId");

  if (!noteId) {
    return NextResponse.json({ error: "noteId query parameter is required" }, { status: 400 });
  }

  const deleted = await prismaClient.note.deleteMany({
    where: { id: noteId, leadId: params.id, workspaceId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
