import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prismaClient } from "@crm/database";
import { LeadStealthClient } from "@crm/shared";
import { z } from "zod";

const schema = z.object({
  query: z.string().min(1).max(500),
  location: z.string().min(1).max(500),
  sources: z.array(z.enum(["google_maps", "yellowpages", "yelp"])).default(["google_maps"]),
  jobName: z.string().min(1).max(255),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = session.user.workspaceId;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  const { query, location, sources, jobName } = parsed.data;

  // Create a ScrapeJob record in CRM for tracking
  const scrapeJob = await prismaClient.scrapeJob.create({
    data: {
      workspaceId,
      name: jobName,
      targetUrl: `leadstealth://${query} in ${location}`,
      mode: "leadstealth",
      status: "running",
    },
  });

  try {
    const client = new LeadStealthClient();
    const { job_id } = await client.startScrape(query, location, sources);

    await prismaClient.scrapeJob.update({
      where: { id: scrapeJob.id },
      data: { targetUrl: `leadstealth://job/${job_id}` },
    });

    return NextResponse.json({ scrapeJobId: scrapeJob.id, leadsStealthJobId: job_id });
  } catch (err: any) {
    await prismaClient.scrapeJob.update({
      where: { id: scrapeJob.id },
      data: { status: "failed", error: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
