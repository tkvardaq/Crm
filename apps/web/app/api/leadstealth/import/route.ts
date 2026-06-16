import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prismaClient } from "@crm/database";
import { LeadStealthClient } from "@crm/shared";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = session.user.workspaceId;

  const { source, limit = 500 } = await req.json().catch(() => ({}));

  const client = new LeadStealthClient();
  const { data: leads } = await client.getLeads(limit, source);

  if (!leads.length) return NextResponse.json({ imported: 0 });

  // Resolve company IDs
  const domainNames = [...new Set(leads.map(l => l.company).filter(Boolean) as string[])];
  const existingCos = await prismaClient.company.findMany({
    where: { workspaceId, name: { in: domainNames } },
    select: { id: true, name: true },
  });
  const coMap = new Map(existingCos.map(c => [c.name.toLowerCase(), c.id]));

  const newCoNames = domainNames.filter(n => !coMap.has(n.toLowerCase()));
  if (newCoNames.length) {
    await prismaClient.company.createMany({
      data: newCoNames.map(name => ({ workspaceId, name })),
      skipDuplicates: true,
    });
    const created = await prismaClient.company.findMany({
      where: { workspaceId, name: { in: newCoNames } },
      select: { id: true, name: true },
    });
    created.forEach(c => coMap.set(c.name.toLowerCase(), c.id));
  }

  // Filter out existing leads
  const emails = leads.map(l => l.email).filter(Boolean);
  const existing = new Set(
    (await prismaClient.lead.findMany({
      where: { workspaceId, email: { in: emails } },
      select: { email: true },
    })).map(l => l.email)
  );

  const toInsert = leads.filter(l => l.email && !existing.has(l.email));
  if (!toInsert.length) return NextResponse.json({ imported: 0, skipped: existing.size });

  await prismaClient.lead.createMany({
    data: toInsert.map(l => ({
      workspaceId,
      email: l.email!,
      firstName: l.name?.split(" ")[0] || null,
      lastName: l.name?.split(" ").slice(1).join(" ") || null,
      phone: l.phone || null,
      status: "raw",
      sourceUrl: l.google_maps_url || l.website || null,
      scrapedAttributes: JSON.stringify({
        source: l.source,
        company: l.company,
        address: l.address,
        city: l.city,
        state: l.state,
        category: l.category,
        rating: l.rating,
        importedAt: new Date().toISOString(),
      }),
      companyId: l.company ? (coMap.get(l.company.toLowerCase()) ?? null) : null,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ imported: toInsert.length, skipped: existing.size });
}
