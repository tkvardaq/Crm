import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prismaClient } from "@crm/database";
import bcrypt from "bcryptjs";

declare module "next-auth" {
  interface User {
    workspaceId: string;
    role: string;
  }
  interface Session {
    user: {
      id: string;
      workspaceId: string;
      role: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    workspaceId: string;
    role: string;
  }
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prismaClient.user.findFirst({
          where: { email: credentials.email },
        });

        if (!user || !user.isActive) {
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
          workspaceId: user.workspaceId,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.workspaceId = user.workspaceId;
        token.role = user.role;
      }
      if (trigger === "update" && token.sub) {
        const dbUser = await prismaClient.user.findUnique({
          where: { id: String(token.sub) },
          select: { currentWorkspaceId: true, workspaceId: true },
        });
        if (dbUser) {
          token.workspaceId = dbUser.currentWorkspaceId ?? dbUser.workspaceId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id);
        session.user.workspaceId = String(token.workspaceId);
        session.user.role = String(token.role);
      }
      return session;
    },
  },
};
