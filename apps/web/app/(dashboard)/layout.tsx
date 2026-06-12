"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { ErrorBoundary } from "@/components/error-boundary";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "🏠" },
  { href: "/pipeline", label: "Pipeline", icon: "📊" },
  { href: "/leads", label: "Leads", icon: "👥" },
  { href: "/campaigns", label: "Campaigns", icon: "📧" },
  { href: "/inbox", label: "Inbox", icon: "📥" },
  { href: "/companies", label: "Companies", icon: "🏢" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

interface Workspace {
  id: string;
  name: string;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const workspacesFetched = useRef(false);

  const userInitial =
    session?.user?.name?.[0]?.toUpperCase() ||
    session?.user?.email?.[0]?.toUpperCase() ||
    "A";

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data);
        if (data.length > 0 && !workspacesFetched.current) {
          setCurrentWorkspaceId(data[0].id);
          workspacesFetched.current = true;
        }
      }
    } catch (err) {
      console.error("[dashboard] Failed to fetch workspaces:", err);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleWorkspaceChange = async (workspaceId: string) => {
    setCurrentWorkspaceId(workspaceId);
    try {
      const res = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) {
        console.error("[dashboard] Workspace switch failed:", res.status);
        return;
      }
      window.location.reload();
    } catch (err) {
      console.error("[dashboard] Workspace switch error:", err);
    }
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-slate-700/60">
        <div
          className={`flex items-center gap-3 ${sidebarCollapsed ? "justify-center" : ""}`}
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            C
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight text-white">
                CRM Tool
              </h1>
              <p className="text-[11px] text-slate-400 leading-none mt-0.5">
                Cold Email Engine
              </p>
            </div>
          )}
        </div>
      </div>

      {!sidebarCollapsed && (
        <div className="px-3 py-3">
          <div className="relative">
            <select
              value={currentWorkspaceId}
              onChange={(e) => handleWorkspaceChange(e.target.value)}
              className="w-full appearance-none bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 pr-8 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 transition-colors cursor-pointer"
            >
              {workspaces.length === 0 && (
                <option value="">No workspaces</option>
              )}
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
            <svg
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
      )}

      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard" || pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMobileMenu}
              title={sidebarCollapsed ? item.label : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 border-l-[3px] ${
                sidebarCollapsed ? "justify-center" : ""
              } ${
                isActive
                  ? "border-l-blue-500 bg-blue-500/10 text-white font-medium"
                  : "border-l-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`}
            >
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-700/60 p-3">
        <div
          className={`flex items-center gap-3 mb-2 ${sidebarCollapsed ? "justify-center" : ""}`}
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 ring-2 ring-slate-700/50">
            {userInitial}
          </div>
          {!sidebarCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {session?.user?.name || "Admin User"}
              </p>
              <p className="text-xs text-slate-400 truncate">
                {session?.user?.email || "admin@acme.com"}
              </p>
            </div>
          )}
        </div>
        {!sidebarCollapsed && (
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full flex items-center gap-2 text-sm text-slate-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-slate-800/60 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Sign Out
          </button>
        )}
        {sidebarCollapsed && (
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Sign Out"
            className="mx-auto flex items-center justify-center text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800/60 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="hidden md:block border-t border-slate-700/60 p-2">
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="w-full flex items-center justify-center p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            className={`w-5 h-5 transition-transform duration-200 ${sidebarCollapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          </svg>
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={closeMobileMenu}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 bg-slate-900 text-white flex flex-col transition-all duration-300 ease-in-out
          md:relative md:z-auto
          ${sidebarCollapsed ? "w-16" : "w-64"}
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        {sidebarContent}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">
              C
            </div>
            <span className="font-semibold text-slate-900 text-sm">
              CRM Tool
            </span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Toggle menu"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {mobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-50">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
