import { NextRequest, NextResponse } from "next/server";
import { prismaClient, auditLog } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

// Expect body: { order: [{ id: string, sortOrder: number }, ...] }
const reorderSchema = z.object({
  order: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })).nonempty(),
});

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const order = parsed.data.order;
  // Perform updates in a transaction
  await prismaClient.$transaction(async (tx) => {
    for (const { id, sortOrder } of order) {
      await tx.pipelineStage.updateMany({
        where: { id, workspaceId },
        data: { sortOrder },
      });
    }
  });

  // Audit log
  await auditLog({
    workspaceId,
    userId: session.user.id,
    action: "pipeline_stage.reorder",
    entity: "PipelineStage",
    ip: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
