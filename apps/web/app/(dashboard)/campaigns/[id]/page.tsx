"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
};

interface Variant {
  id: string;
  variantName: string;
  subjectSpintax: string;
  bodySpintax: string;
  sentCount: number;
  replyCount: number;
  interestCount: number;
  banditWeight: number;
}

interface Step {
  id: string;
  stepNumber: number;
  delayDays: number;
  channel: string;
  variants: Variant[];
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  steps: Step[];
  createdAt: string;
}

function parseSpintax(text: string): string {
  return text.replace(/\{([^}]+)\}/g, (_, choices) => {
    const opts = choices.split("|");
    return opts[Math.floor(Math.random() * opts.length)];
  });
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [editingSteps, setEditingSteps] = useState(false);
  const [newStep, setNewStep] = useState({ stepNumber: 0, delayDays: 0, channel: "email" });
  const [addingStep, setAddingStep] = useState(false);

  const fetchCampaign = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns", { credentials: "include" });
      if (!res.ok) return;
      const data: Campaign[] = await res.json();
      const found = data.find((c) => c.id === id);
      setCampaign(found || null);
    } catch (err) {
      console.error("Failed to fetch campaign:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchCampaign(); }, [fetchCampaign]);

  const handleStatusChange = async (newStatus: string) => {
    if (!campaign) return;
    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setCampaign((prev) => (prev ? { ...prev, status: newStatus } : prev));
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setStatusUpdating(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-slate-500">Loading campaign...</div>;
  }

  if (!campaign) {
    return (
      <div className="p-6">
        <button onClick={() => router.push("/campaigns")} className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-flex items-center gap-1">
          &larr; Back to Campaigns
        </button>
        <p className="text-slate-500">Campaign not found</p>
      </div>
    );
  }

  const allVariants = campaign.steps.flatMap((s) => s.variants);
  const totalSent = allVariants.reduce((sum, v) => sum + v.sentCount, 0);
  const totalReplies = allVariants.reduce((sum, v) => sum + v.replyCount, 0);
  const replyRate = totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1) : "0.0";
  const maxSent = Math.max(...allVariants.map((v) => v.sentCount), 1);
  const maxReplies = Math.max(...allVariants.map((v) => v.replyCount), 1);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button onClick={() => router.push("/campaigns")} className="text-sm text-slate-500 hover:text-slate-700 mb-3 inline-flex items-center gap-1">
          &larr; Back to Campaigns
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
              <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[campaign.status] || "bg-slate-100 text-slate-700"}`}>
                {campaign.status}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Created {new Date(campaign.createdAt).toLocaleDateString()} &middot; {campaign.steps.length} steps &middot; {allVariants.length} variants
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={campaign.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={statusUpdating}
              className="border rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-slate-500">Total Sent</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalSent.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-slate-500">Total Replies</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalReplies.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-slate-500">Reply Rate</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{replyRate}%</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-slate-500">Total Steps</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{campaign.steps.length}</p>
        </div>
      </div>

      {/* Steps Breakdown */}
      <div className="bg-white rounded-xl border p-5 mb-6">
        <h2 className="font-semibold text-slate-900 mb-4">Steps Breakdown</h2>
        {campaign.steps.length === 0 ? (
          <p className="text-sm text-slate-500">No steps configured</p>
        ) : (
          <div className="space-y-4">
            {campaign.steps.map((step) => (
              <div key={step.id} className="border rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm font-semibold text-slate-900">Step {step.stepNumber}</span>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                    {step.delayDays === 0 ? "Day 0 (immediate)" : `Day ${step.delayDays}`}
                  </span>
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded capitalize">{step.channel}</span>
                </div>
                <div className="space-y-3">
                  {step.variants.map((variant) => {
                    const vRate = variant.sentCount > 0 ? ((variant.replyCount / variant.sentCount) * 100).toFixed(1) : "0.0";
                    return (
                      <div key={variant.id} className="bg-slate-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-medium bg-white border px-2 py-0.5 rounded text-slate-700">
                            {variant.variantName}
                          </span>
                        </div>
                        <div className="space-y-1 mb-2">
                          <p className="text-xs text-slate-500">
                            <span className="font-medium text-slate-600">Subject:</span>{" "}
                            {parseSpintax(variant.subjectSpintax)}
                          </p>
                          <p className="text-xs text-slate-500">
                            <span className="font-medium text-slate-600">Body:</span>{" "}
                            {parseSpintax(variant.bodySpintax).slice(0, 100)}{variant.bodySpintax.length > 100 ? "..." : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-600 mb-2">
                          <span>Sent: <strong>{variant.sentCount.toLocaleString()}</strong></span>
                          <span>Replies: <strong>{variant.replyCount.toLocaleString()}</strong></span>
                          <span>Rate: <strong>{vRate}%</strong></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 w-24 shrink-0">Bandit weight</span>
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{ width: `${Math.min(variant.banditWeight * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-600 w-10 text-right">{(variant.banditWeight * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Variant Performance Comparison */}
      <div className="bg-white rounded-xl border p-5 mb-6">
        <h2 className="font-semibold text-slate-900 mb-4">Variant Performance</h2>
        {allVariants.length === 0 ? (
          <p className="text-sm text-slate-500">No variants to compare</p>
        ) : (
          <div className="space-y-3">
            {allVariants.map((variant) => (
              <div key={variant.id} className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-700 w-16 shrink-0 truncate" title={variant.variantName}>
                  {variant.variantName}
                </span>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-blue-600 w-10 shrink-0">Sent</span>
                    <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded flex items-center px-2"
                        style={{ width: `${Math.max((variant.sentCount / maxSent) * 100, variant.sentCount > 0 ? 8 : 0)}%` }}
                      >
                        {variant.sentCount > 0 && (
                          <span className="text-xs text-white font-medium">{variant.sentCount.toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    {variant.sentCount === 0 && (
                      <span className="text-xs text-slate-400">0</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-emerald-600 w-10 shrink-0">Reply</span>
                    <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded flex items-center px-2"
                        style={{ width: `${Math.max((variant.replyCount / maxReplies) * 100, variant.replyCount > 0 ? 8 : 0)}%` }}
                      >
                        {variant.replyCount > 0 && (
                          <span className="text-xs text-white font-medium">{variant.replyCount.toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    {variant.replyCount === 0 && (
                      <span className="text-xs text-slate-400">0</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-slate-900 mb-4">Quick Actions</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setEditingSteps(!editingSteps)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              editingSteps
                ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {editingSteps ? "Done Editing" : "Edit Steps"}
          </button>
          <select
            value={campaign.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={statusUpdating}
            className="border rounded-lg px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="" disabled>Change Status</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {editingSteps && (
        <div className="bg-white rounded-xl border p-5 mt-6">
          <h2 className="font-semibold text-slate-900 mb-4">Add Step</h2>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Step #</label>
              <input type="number" value={newStep.stepNumber}
                onChange={(e) => setNewStep(s => ({...s, stepNumber: parseInt(e.target.value) || 0}))}
                className="w-20 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Delay (days)</label>
              <input type="number" value={newStep.delayDays}
                onChange={(e) => setNewStep(s => ({...s, delayDays: parseInt(e.target.value) || 0}))}
                className="w-24 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Channel</label>
              <select value={newStep.channel}
                onChange={(e) => setNewStep(s => ({...s, channel: e.target.value}))}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="email">Email</option>
                <option value="linkedin">LinkedIn</option>
                <option value="call">Call</option>
              </select>
            </div>
            <button onClick={async () => {
              if (!newStep.stepNumber) return;
              setAddingStep(true);
              try {
                const res = await fetch(`/api/campaigns/${id}/steps`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ stepNumber: newStep.stepNumber, delayDays: newStep.delayDays, channel: newStep.channel }),
                });
                if (res.ok) {
                  fetchCampaign();
                  setNewStep({ stepNumber: 0, delayDays: 0, channel: "email" });
                } else {
                  const err = await res.json();
                  alert(err.error || "Failed to add step");
                }
              } catch (err) {
                alert("Failed to add step");
              } finally {
                setAddingStep(false);
              }
            }} disabled={addingStep}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {addingStep ? "Adding..." : "Add Step"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
