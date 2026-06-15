import { NextRequest, NextResponse } from "next/server";
import { prismaClient, encrypt } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectedInboxSchema } from "@crm/shared";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
	const inboxes = await prismaClient.connectedInbox.findMany({
		where: { workspaceId },
		select: {
			id: true,
			email: true,
			smtpHost: true,
			smtpPort: true,
			imapHost: true,
			imapPort: true,
			isActive: true,
			dailySentCount: true,
			maxDailyLimit: true,
			warmupEnabled: true,
			sendingDomainId: true,
			sendingDomain: true,
			createdAt: true,
		},
		orderBy: { createdAt: "desc" },
	});

  return NextResponse.json(inboxes);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const body = await req.json();
  const parsed = connectedInboxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { email, smtpHost, smtpPort, smtpUser, smtpPass, imapHost, imapPort, imapUser, imapPass, maxDailyLimit, warmupEnabled, sendingDomainId } = parsed.data;

  if (sendingDomainId) {
    const domain = await prismaClient.sendingDomain.findFirst({ where: { id: sendingDomainId, workspaceId } });
    if (!domain) {
      return NextResponse.json({ error: "Sending domain not found in workspace" }, { status: 403 });
    }
  }

  const existing = await prismaClient.connectedInbox.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, workspaceId },
  });
  if (existing) {
    return NextResponse.json(
      { error: "An inbox with this email already exists" },
      { status: 409 }
    );
  }

  const smtpPassEncrypted = encrypt(smtpPass);
  const imapPassEncrypted = encrypt(imapPass);

  const inbox = await prismaClient.connectedInbox.create({
    data: {
      email,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassEncrypted,
      imapHost,
      imapPort,
      imapUser,
      imapPassEncrypted,
      maxDailyLimit,
      warmupEnabled,
      sendingDomainId,
      workspaceId,
    },
    include: { sendingDomain: true },
  });

  return NextResponse.json(inbox, { status: 201 });
}
