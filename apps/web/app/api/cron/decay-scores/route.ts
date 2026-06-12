import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staleRawEnriched = await prismaClient.$executeRawUnsafe(`
    UPDATE leads
    SET score = GREATEST(score - 10, 0)
    WHERE status IN ('raw', 'enriched')
      AND created_at < NOW() - INTERVAL '60 days'
      AND score > 0
  `);

  const staleContacted = await prismaClient.$executeRawUnsafe(`
    UPDATE leads
    SET score = GREATEST(score - 5, 0)
    WHERE id IN (
      SELECT l.id
      FROM leads l
      LEFT JOIN communication_history ch ON ch.lead_id = l.id
      WHERE l.status IN ('contacted', 'replied')
        AND l.score > 0
      GROUP BY l.id
      HAVING MAX(ch.sent_at) < NOW() - INTERVAL '30 days'
         OR MAX(ch.sent_at) IS NULL
    )
  `);

  const decayed = staleRawEnriched + staleContacted;

  return NextResponse.json({ success: true, decayed });
}