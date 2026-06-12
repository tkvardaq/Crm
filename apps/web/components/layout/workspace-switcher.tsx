"use client";

import React, { useState, useEffect } from "react";
import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Workspace {
  id: string;
  name: string;
}

export default function WorkspaceSwitcher() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentWorkspaceId = session?.user?.workspaceId;
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/workspaces")
      .then((r) => r.json())
      .then((data: Workspace[] | { error: string }) => {
        if (Array.isArray(data)) {
          setWorkspaces(data);
        }
      })
      .catch(() => {});
  }, [session?.user]);

  async function handleSwitch(workspaceId: string) {
    if (workspaceId === currentWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to switch workspace");
      }
      await update({ workspaceId });
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Switch failed");
    } finally {
      setLoading(false);
    }
  }

  if (workspaces.length <= 1) {
    return (
      <div className="text-sm text-slate-400 px-3 py-2">
        {currentWorkspace?.name ?? "Workspace"}
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 cursor-pointer"
        value={currentWorkspaceId ?? ""}
        onChange={(e) => handleSwitch(e.target.value)}
        disabled={loading}
      >
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.name}
          </option>
        ))}
      </select>
      {loading && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
         ...
        </div>
      )}
      {error && (
        <div className="text-xs text-red-400 mt-1 px-1">{error}</div>
      )}
    </div>
  );
}