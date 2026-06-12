import { NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const workspaces = await prismaClient.workspace.findMany({
    where: {
      users: { some: { id: userId } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(workspaces);
}
