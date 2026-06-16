import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { LeadStealthClient } from "@crm/shared";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  try {
    const client = new LeadStealthClient();
    const status = await client.getJobStatus(id);
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json({ status: "failed", leads_found: 0, error: err.message }, { status: 502 });
  }
}
