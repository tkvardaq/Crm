import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { campaignSchema } from "@crm/shared";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const campaigns = await prismaClient.campaign.findMany({
    where: { workspaceId },
    include: {
      steps: {
        include: { variants: true },
        orderBy: { stepNumber: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(campaigns);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const body = await req.json();
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { name, steps } = parsed.data;

  const campaign = await prismaClient.campaign.create({
    data: {
      workspaceId,
      name: parsed.data.name,
      status: "draft",
      steps: steps
        ? {
            create: steps.map((s, i) => ({
							stepNumber: i + 1,
							delayDays: s.delayDays ?? 3,
							channel: s.channel ?? "email",
							variants: s.variants?.length
								? {
										create: s.variants.map((v) => ({
											variantName: v.variantName || v.variantLabel || "A",
											subjectSpintax: v.subject || v.subjectSpintax || "",
											bodySpintax: v.body || v.bodySpintax || v.bodyTemplate || "",
										})),
									}
								: undefined,
						})),
					}
				: undefined,
		},
		include: { steps: { include: { variants: true } } },
	});

  return NextResponse.json(campaign, { status: 201 });
}
