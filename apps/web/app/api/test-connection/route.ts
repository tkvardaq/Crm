import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@crm/database";
import { createTransport } from "@crm/email-engine";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import nodemailer from "nodemailer";
import IORedis from "ioredis";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { type, host, port, user, pass, encryptedPass } = body as {
    type: "smtp" | "imap";
    host: string;
    port: number;
    user: string;
    pass?: string;
    encryptedPass?: string;
  };

  const isValidCiphertext = (s: string) =>
    s && s.split(":").length === 4 && s.split(":").every((p) => p.length === 32);
  const password = (encryptedPass && isValidCiphertext(encryptedPass))
    ? decrypt(encryptedPass)
    : (pass ?? "");

  if (!host || !port || !user || !password) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (type === "smtp") {
    try {
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass: password },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      });
      await transport.verify();
      transport.close();
      return NextResponse.json({ success: true, message: "SMTP connection verified" });
    } catch (err: any) {
      return NextResponse.json({
        success: false,
        message: `SMTP connection failed: ${err.message}`,
      });
    }
  }

  if (type === "imap") {
    const { ImapFlow: ImapFlowClass } = await import("imapflow");
    const client = new ImapFlowClass({
      host,
      port,
      secure: port === 993,
      auth: { user, pass: password },
      logger: false,
    });
    try {
      await client.connect();
      await client.logout();
    } catch (err: any) {
      return NextResponse.json({
        success: false,
        message: `IMAP connection failed: ${err.message}`,
      });
    }
    return NextResponse.json({ success: true, message: "IMAP connection verified" });
  }

  return NextResponse.json({ error: "Invalid type, use smtp or imap" }, { status: 400 });
}
