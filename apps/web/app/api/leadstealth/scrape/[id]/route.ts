import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prismaClient } from "@crm/database";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const job = await prismaClient.scrapeJob.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: { status: true, leadsFound: true, error: true },
  });

  if (!job) return NextResponse.json({ status: "failed", leads_found: 0, error: "Job not found" }, { status: 404 });

  return NextResponse.json({
    status: job.status,
    leads_found: job.leadsFound ?? 0,
    error: job.error ?? undefined,
  });
}
