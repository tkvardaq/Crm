import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { companySchema } from "@crm/shared";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");

  const companies = await prismaClient.company.findMany({
    where: {
      workspaceId,
      ...(search
        ? { name: { contains: search, mode: "insensitive" } }
        : {}),
    },
    include: { _count: { select: { leads: true } } },
    orderBy: { name: "asc" },
    take: 100,
  });

  const result = companies.map(({ _count, ...company }) => ({
    ...company,
    leadCount: _count.leads,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const body = await req.json();
  const parsed = companySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { name, domain, industry, sizeRange, headquarters, techStack } = parsed.data;

  const company = await prismaClient.company.create({
    data: {
      name,
      domain: domain || null,
      industry: industry || null,
      sizeRange: sizeRange || null,
      headquarters: headquarters || null,
      techStack: techStack || [],
      workspaceId,
    },
  });

  return NextResponse.json(company, { status: 201 });
}
