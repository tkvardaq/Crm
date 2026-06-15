import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { rateLimitAuth, rateLimitApi } from "@/lib/rate-limit-edge";

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const isAuthRoute = pathname === "/api/auth/signin" || pathname === "/api/auth/signout" || pathname === "/api/auth/callback" || pathname.startsWith("/api/auth/providers");
  const isCronRoute = pathname.startsWith("/api/cron/");

  if (isAuthRoute || pathname === "/login" || pathname === "/register") {
    const result = await rateLimitAuth(ip);
    if (!result.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
  } else if (pathname.startsWith("/api/") && !isCronRoute) {
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};