const tracker = new Map<string, { count: number; resetAt: number }>();

async function consumeEdge(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  
  // Lazy cleanup of some random entries to prevent memory leaks
  if (tracker.size > 1000) {
    for (const [k, v] of tracker.entries()) {
      if (now > v.resetAt) {
        tracker.delete(k);
      }
    }
  }

  const record = tracker.get(key);

  if (!record || now > record.resetAt) {
    const resetAt = now + windowMs;
    tracker.set(key, { count: 1, resetAt });
    return { success: true, remaining: limit - 1, resetAt };
  }

  if (record.count >= limit) {
    return { success: false, remaining: 0, resetAt: record.resetAt };
  }

  record.count += 1;
  return { success: true, remaining: limit - record.count, resetAt: record.resetAt };
}

export async function rateLimitAuth(key: string) {
  if (process.env.DISABLE_RATE_LIMIT === "true") {
    return { success: true, remaining: 5, resetAt: Date.now() + 60000 };
  }
  return consumeEdge(`auth:${key}`, 5, 60000);
}

export async function rateLimitApi(key: string) {
  if (process.env.DISABLE_RATE_LIMIT === "true") {
    return { success: true, remaining: 100, resetAt: Date.now() + 60000 };
  }
  return consumeEdge(`api:${key}`, 100, 60000);
}
