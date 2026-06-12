import { NextRequest, NextResponse } from "next/server";

type RateLimitEntry = { count: number; resetAt: number };

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 50_000;

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { success: boolean; remaining: number; resetAt: number } {
  if (process.env.NODE_ENV === "development") {
    return { success: true, remaining: limit, resetAt: Date.now() + windowMs };
  }

  const now = Date.now();

  for (const [k, v] of store) {
    if (now >= v.resetAt) store.delete(k);
  }

  let entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    if (store.size >= MAX_STORE_SIZE) {
      const oldestKeys = Array.from(store.entries())
        .sort((a, b) => a[1].resetAt - b[1].resetAt)
        .slice(0, Math.floor(MAX_STORE_SIZE * 0.1))
        .map(([k]) => k);
      oldestKeys.forEach((k) => store.delete(k));
    }
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count++;

  if (entry.count > limit) {
    return { success: false, remaining: 0, resetAt: entry.resetAt };
  }

  return {
    success: true,
    remaining: limit - entry.count,
    resetAt: entry.resetAt,
  };
}

export function rateLimitApi(key: string) {
  return rateLimit(key, 100, 60_000);
}

export function rateLimitAuth(key: string) {
  return rateLimit(key, 5, 60_000);
}

export function withRateLimit(limit: number, windowMs: number) {
  return (request: NextRequest): NextResponse | null => {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    const result = rateLimit(ip, limit, windowMs);

    if (!result.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
          },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Limit", String(limit));
    response.headers.set("X-RateLimit-Remaining", String(result.remaining));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    return response;
  };
}
