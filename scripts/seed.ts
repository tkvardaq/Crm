import { prismaClient } from "@crm/database";
import bcrypt from "bcryptjs";

async function main() {
  const existingUser = await prismaClient.user.findFirst();
  if (existingUser) {
    console.log("Database already seeded, skipping.");
    return;
  }

  const workspace = await prismaClient.workspace.create({
    data: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Acme Corporation",
    },
  });

  const passwordHash = await bcrypt.hash(process.env.SEED_PASSWORD || "changeme-password123", 12);

  const user = await prismaClient.user.create({
    data: {
      email: "admin@acme.com",
      passwordHash,
      workspaceId: workspace.id,
      firstName: "Admin",
      lastName: "User",
      isActive: true,
      role: "admin",
    },
  });

  await prismaClient.pipelineStage.createMany({
    data: [
      { workspaceId: workspace.id, name: "New", sortOrder: 0 },
      { workspaceId: workspace.id, name: "Qualified", sortOrder: 1 },
      { workspaceId: workspace.id, name: "Negotiation", sortOrder: 2 },
      { workspaceId: workspace.id, name: "Closed", sortOrder: 3 },
    ],
  });

  console.log(`Seed complete. User: admin@acme.com / ${process.env.SEED_PASSWORD || "changeme-password123"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
