import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createTransport } from "@crm/email-engine";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leadId, subject, body, inboxId } = await req.json();

  if (!leadId || !subject || !body || !inboxId) {
    return NextResponse.json(
      { error: "Missing required fields: leadId, subject, body, inboxId" },
      { status: 400 }
    );
  }

  const workspaceId = session.user.workspaceId;

  const lead = await prismaClient.lead.findFirst({
    where: { id: leadId, workspaceId },
  });

  if (!lead?.email) {
    return NextResponse.json(
      { error: "Lead not found or has no email address" },
      { status: 404 }
    );
  }

  const inbox = await prismaClient.connectedInbox.findFirst({
    where: { id: inboxId, workspaceId },
  });

  if (!inbox) {
    return NextResponse.json(
      { error: "Connected inbox not found" },
      { status: 404 }
    );
  }

  const transport = createTransport({
    smtpHost: inbox.smtpHost,
    smtpPort: inbox.smtpPort,
    smtpUser: inbox.smtpUser,
    smtpPassEncrypted: inbox.smtpPassEncrypted,
  });

  try {
    await transport.sendMail({
      from: inbox.email,
      to: lead.email,
      subject,
      text: body,
      html: body.replace(/\n/g, "<br>"),
    });

    await prismaClient.communicationHistory.create({
        data: {
          workspaceId,
          leadId: lead.id,
          connectedInboxId: inbox.id,
          direction: "outbound",
          channel: "email",
          subject,
          bodyText: body,
          sentAt: new Date(),
        },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[inbox/reply] Failed to send email:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  } finally {
    await transport.close();
  }
}
