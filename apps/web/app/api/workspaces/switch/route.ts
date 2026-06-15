import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serialize } from "cookie";

const switchWorkspaceSchema = z.object({
  workspaceId: z.string().uuid({ message: "Invalid workspaceId format" }),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = switchWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { workspaceId } = parsed.data;

  const workspace = await prismaClient.workspace.findUnique({
    where: { id: workspaceId },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const user = await prismaClient.user.findFirst({
    where: { id: session.user.id, workspaceId },
  });

  if (!user) {
    return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });
  }

  const cookie = serialize("next-workspace", workspaceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30,
  });
  const res = NextResponse.json({ message: "Workspace switched", workspaceId });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
