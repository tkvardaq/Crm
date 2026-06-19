import { PrismaClient } from '@prisma/client';

declare global {
  var prismaClient: PrismaClient | undefined;
}

function createPrismaClient() {
  // Explicitly use 'binary' engine type to avoid resolution issues under Next.js
  // on Windows where the auto-detection of the query-engine can fail.
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  } as ConstructorParameters<typeof PrismaClient>[0]);
  return prisma;
}

export const prismaClient = global.prismaClient || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prismaClient = prismaClient;
}

export default prismaClient;
