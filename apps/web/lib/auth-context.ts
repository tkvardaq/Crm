import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prismaClient } from "@crm/database";

export interface AuthContext {
  userId: string;
  workspaceId: string;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const user = await prismaClient.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, workspaceId: true },
  });

  if (!user) return null;

  return {
    userId: user.id,
    workspaceId: user.workspaceId,
  };
}

export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    throw new Error("Unauthorized");
  }
  return ctx;
}
