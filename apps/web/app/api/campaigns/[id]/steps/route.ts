import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { campaignStepSchema, variantTemplateSchema } from "@crm/shared";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const campaign = await prismaClient.campaign.findFirst({
    where: { id: params.id, workspaceId },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const steps = await prismaClient.campaignStep.findMany({
    where: { campaignId: params.id },
    include: { variants: true },
    orderBy: { stepNumber: "asc" },
  });

  return NextResponse.json(steps);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const campaign = await prismaClient.campaign.findFirst({
    where: { id: params.id, workspaceId },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

	const body = await req.json();
	const { variants, ...stepData } = body;
	const stepParsed = campaignStepSchema.safeParse(stepData);
  if (!stepParsed.success) {
    return NextResponse.json({ error: stepParsed.error.errors }, { status: 400 });
  }

  const existingStep = await prismaClient.campaignStep.findFirst({
    where: { campaignId: params.id, stepNumber: stepParsed.data.stepNumber },
  });
  if (existingStep) {
    return NextResponse.json(
      { error: `Step number ${stepParsed.data.stepNumber} already exists for this campaign` },
      { status: 409 }
    );
  }

  type VariantInput = z.infer<typeof variantTemplateSchema>;

  if (variants?.length) {
    const invalidVariant = variants.find((v: VariantInput) => !variantTemplateSchema.safeParse(v).success);
    if (invalidVariant) {
      return NextResponse.json(
        { error: "One or more variants have invalid fields" },
        { status: 400 }
      );
    }
  }

  const newStep = await prismaClient.campaignStep.create({
    data: {
      campaignId: params.id,
      stepNumber: stepParsed.data.stepNumber,
      delayDays: stepParsed.data.delayDays,
      channel: stepParsed.data.channel,
      variants: variants?.length
        ? {
            create: variants.map((v: unknown) => {
              const vParsed = variantTemplateSchema.parse(v);
              return {
                variantName: vParsed.variantName,
                subjectSpintax: vParsed.subjectSpintax,
                bodySpintax: vParsed.bodySpintax,
              };
            }),
          }
        : undefined,
    },
    include: { variants: true },
  });

  return NextResponse.json(newStep, { status: 201 });
}
