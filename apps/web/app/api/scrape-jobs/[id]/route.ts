import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const job = await prismaClient.scrapeJob.findFirst({
    where: { id: params.id, workspaceId: session.user.workspaceId },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const job = await prismaClient.scrapeJob.findFirst({
    where: { id: params.id, workspaceId: session.user.workspaceId },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.status === "running") return NextResponse.json({ error: "Cannot delete a running job" }, { status: 409 });

  await prismaClient.scrapeJob.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}