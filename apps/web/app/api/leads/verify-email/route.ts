import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const verifyEmailSchema = z.object({
  leadId: z.string().uuid({ message: "Invalid leadId format" }),
});

const EMAIL_RE = z.string().email();

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

  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { leadId } = parsed.data;
  const lead = await prismaClient.lead.findFirst({
    where: { id: leadId, workspaceId: session.user.workspaceId },
  });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const email = lead.email;
  const validFormat = EMAIL_RE.safeParse(email).success;
  if (!validFormat) {
    await prismaClient.lead.update({
      where: { id: leadId, workspaceId: session.user.workspaceId },
      data: { bounceVerified: false },
    });
    return NextResponse.json({ valid: false, mxRecords: false, reason: "Invalid email format" });
  }

  const domain = email.split("@")[1];
  let mxRecords = false;
  let dnsError = false;
  try {
    const res = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`);
    if (!res.ok) throw new Error(`DNS lookup failed: ${res.status}`);
    const data = await res.json();
    mxRecords = !!(data.Answer && data.Answer.length > 0);
  } catch (err) {
    dnsError = true;
    console.error(`[verify-email] DNS lookup failed for ${domain}:`, err);
    mxRecords = false;
  }

  await prismaClient.lead.update({
    where: { id: leadId, workspaceId: session.user.workspaceId },
    data: { bounceVerified: mxRecords },
  });

  return NextResponse.json({
    valid: mxRecords,
    mxRecords,
    reason: dnsError
      ? "DNS verification failed — please try again"
      : mxRecords
        ? "MX records found"
        : "No MX records found",
  });
}
