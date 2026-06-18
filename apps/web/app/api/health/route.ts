import { NextResponse } from 'next/server';
import { prismaClient } from '@crm/database';
import { getRedisConnection } from '@crm/shared';

export async function GET() {
  const checks = {
    database: false,
    redis: false,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
  };

  try {
    await prismaClient.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (e) {
    console.error('[health] Database check failed:', e);
  }

  try {
    const redis = getRedisConnection();
    await redis.ping();
    checks.redis = true;
  } catch (e) {
    console.error('[health] Redis check failed:', e);
  }

  const healthy = checks.database && checks.redis;
  return NextResponse.json(checks, { status: healthy ? 200 : 503 });
}