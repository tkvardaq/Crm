import { prismaClient } from '../packages/database/dist/index';
import bcrypt from 'bcryptjs';

async function main() {
  const email = 't.k.vardaq@gmail.com';
  const password = '1234567890';

  // Delete any existing user with this email
  const existing = await prismaClient.user.findFirst({ where: { email } });
  if (existing) {
    console.log('Found existing user, removing...');
    await prismaClient.user.delete({ where: { id: existing.id } });
    console.log('Removed.');
  }

  // Find the first workspace, or create one
  let workspace = await prismaClient.workspace.findFirst();
  if (!workspace) {
    workspace = await prismaClient.workspace.create({
      data: { name: 'Default Workspace' },
    });
    console.log('Created workspace:', workspace.id);
  }

  // Ensure default pipeline stages exist
  const stageCount = await prismaClient.pipelineStage.count({ where: { workspaceId: workspace.id } });
  if (stageCount === 0) {
    await prismaClient.pipelineStage.createMany({
      data: [
        { workspaceId: workspace.id, name: 'New', sortOrder: 0 },
        { workspaceId: workspace.id, name: 'Qualified', sortOrder: 1 },
        { workspaceId: workspace.id, name: 'Negotiation', sortOrder: 2 },
        { workspaceId: workspace.id, name: 'Closed', sortOrder: 3 },
      ],
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prismaClient.user.create({
    data: {
      email,
      passwordHash,
      workspaceId: workspace.id,
      firstName: 'Talha',
      lastName: 'Vardaq',
      isActive: true,
      role: 'admin',
    },
  });

  console.log('\n✅ Account created!');
  console.log('   Email:    ', user.email);
  console.log('   Password: 1234567890');
  console.log('   Role:     ', user.role);
  console.log('   Workspace:', workspace.name, '(' + workspace.id + ')');
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exit(1); })
  .finally(() => prismaClient.$disconnect());
