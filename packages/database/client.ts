import { PrismaClient } from '@prisma/client';

declare global {
  var prismaClient: PrismaClient | undefined;
}

function createPrismaClient() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
  return prisma;
}

export const prismaClient = global.prismaClient || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prismaClient = prismaClient;
}

export default prismaClient;
