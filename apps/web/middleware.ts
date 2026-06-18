import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { rateLimitAuth, rateLimitApi } from "@/lib/rate-limit-edge";
import { createRequestLogger } from "@crm/shared";

const CSRF_SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

function validateOrigin(request: NextRequest): boolean {
  if (CSRF_SAFE_METHODS.includes(request.method)) return true;

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin && !host) return false;

  if (origin) {
    try {
      const originUrl = new URL(origin);
      const allowedHosts = [
        host,
        `localhost:${request.nextUrl.port || 3000}`,
        `127.0.0.1:${request.nextUrl.port || 3000}`,
      ].filter(Boolean);
      return allowedHosts.some(
        (h) => h && originUrl.host.toLowerCase() === h.toLowerCase()
      );
    } catch {
      return false;
    }
  }

  return true;
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get('x-request-id') || generateRequestId();

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const isAuthRoute = pathname === "/api/auth/signin" || pathname === "/api/auth/signout" || pathname === "/api/auth/callback" || pathname.startsWith("/api/auth/providers");
  const isCronRoute = pathname.startsWith("/api/cron/");
  const isHealthRoute = pathname === "/api/health" || pathname === "/api/ready";

  if (isAuthRoute || pathname === "/login" || pathname === "/register") {
    const result = await rateLimitAuth(ip);
    if (!result.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
  } else if (pathname.startsWith("/api/") && !isCronRoute && !isHealthRoute) {
    const result = await rateLimitApi(ip);
    if (!result.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
  }

  const publicPaths = ["/login", "/register"];
  const publicApiPrefixes = ["/api/auth/"];
  const isPublic = publicPaths.includes(pathname) || publicApiPrefixes.some((p) => pathname.startsWith(p));

  if (!isPublic && !CSRF_SAFE_METHODS.includes(request.method)) {
    if (!validateOrigin(request)) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
  }

  if (isPublic) return NextResponse.next();

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set('x-request-id', requestId);
  
  const logger = createRequestLogger(requestId, token.id as string, token.workspaceId as string);
  logger.info({ method: request.method, pathname, ip, userAgent: request.headers.get('user-agent') }, 'Request received');

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};