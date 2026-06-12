import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { registerSchema } from "@crm/shared";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  const { email, password, workspaceName, firstName, lastName } = parsed.data;

  const existing = await prismaClient.user.findFirst({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

	const passwordHash = await bcrypt.hash(password, 12);

	const result = await prismaClient.$transaction(async (tx) => {
		const workspace = await tx.workspace.create({
			data: { name: workspaceName },
		});

		const user = await tx.user.create({
			data: {
				email,
				passwordHash,
				firstName,
				lastName,
				workspaceId: workspace.id,
				role: "owner",
				isActive: true,
			},
		});

		await tx.pipelineStage.createMany({
			data: [
				{ workspaceId: workspace.id, name: "New", sortOrder: 0 },
				{ workspaceId: workspace.id, name: "Qualified", sortOrder: 1 },
				{ workspaceId: workspace.id, name: "Negotiation", sortOrder: 2 },
				{ workspaceId: workspace.id, name: "Closed", sortOrder: 3 },
			],
		});

		return { user, workspace };
	});

	return NextResponse.json(
		{
			id: result.user.id,
			email: result.user.email,
			firstName: result.user.firstName,
			lastName: result.user.lastName,
			workspaceId: result.user.workspaceId,
		},
		{ status: 201 }
	);
}
