import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import IORedis from "ioredis";

const DISABLE = process.env.DISABLE_RATE_LIMIT === "true";
if (DISABLE) console.warn("[rate-limit] Rate limiting DISABLED — not for production");

const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,
});

const authLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:auth",
  points: 5,
  duration: 60,
  blockDuration: 300,
});

const apiLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:api",
  points: 100,
  duration: 60,
});

async function consume(
  limiter: RateLimiterRedis,
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; remaining: number; resetAt: number }> {
  if (DISABLE) return { success: true, remaining: limit, resetAt: Date.now() + windowMs };
  try {
    const res = await limiter.consume(key);
    return { success: true, remaining: res.remainingPoints ?? 0, resetAt: Date.now() + (res.msBeforeNext ?? windowMs) };
  } catch (err: unknown) {
    if (err instanceof RateLimiterRes)
      return { success: false, remaining: 0, resetAt: Date.now() + (err.msBeforeNext ?? windowMs) };
    console.error("[rate-limit] Redis error, failing open:", err);
    return { success: true, remaining: limit, resetAt: Date.now() + windowMs };
  }
}

export async function rateLimitAuth(key: string) {
  return consume(authLimiter, key, 5, 60_000);
}

export async function rateLimitApi(key: string) {
  return consume(apiLimiter, key, 100, 60_000);
}