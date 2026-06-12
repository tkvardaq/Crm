"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

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

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditorModal, setShowEditorModal] = useState<Campaign | null>(null);
  const [showLaunchConfirm, setShowLaunchConfirm] = useState<Campaign | null>(null);
  const [launching, setLaunching] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [editorSteps, setEditorSteps] = useState<{ delayDays: number; subject: string; body: string }[]>([
    { delayDays: 3, subject: "Hi {{firstName}}, let's connect", body: "Hi {{firstName}},\n\nI noticed {{company}} and thought we might benefit from a conversation.\n\nBest" },
  ]);
  const [previewText, setPreviewText] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setCampaigns(data);
    } catch (err) {
      console.error("Failed to fetch campaigns:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
    const interval = setInterval(fetchCampaigns, 15000);
    return () => clearInterval(interval);
  }, [fetchCampaigns]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newName,
          steps: editorSteps.map((s, i) => ({
            delayDays: s.delayDays,
            channel: "email",
            subjectSpintax: s.subject,
            bodySpintax: s.body,
          })),
        }),
      });
      if (res.ok) {
        fetchCampaigns();
        setShowCreateModal(false);
        setNewName("");
        setEditorSteps([{ delayDays: 3, subject: "Hi {{firstName}}, let's connect", body: "Hi {{firstName}},\n\nI noticed {{company}}..." }]);
      }
    } catch (err) {
      console.error("Failed to create campaign:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    if (status === "active") {
      const campaign = campaigns.find((c) => c.id === id);
      if (campaign) {
        setShowLaunchConfirm(campaign);
        return;
      }
    }
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status }),
    });
    fetchCampaigns();
  };

  const handleLaunchConfirm = async () => {
    if (!showLaunchConfirm) return;
    setLaunching(true);
    try {
      const res = await fetch(`/api/campaigns/${showLaunchConfirm.id}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (res.ok) {
        fetchCampaigns();
        setShowLaunchConfirm(null);
      }
    } catch (err) {
      console.error("Failed to launch campaign:", err);
    } finally {
      setLaunching(false);
    }
  };

  const openEditor = (campaign: Campaign) => {
    setShowEditorModal(campaign);
    if (campaign.steps.length > 0) {
      setEditorSteps(campaign.steps.map((s) => ({
        delayDays: s.delayDays,
        subject: s.variants[0]?.subjectSpintax || "",
        body: s.variants[0]?.bodySpintax || "",
      })));
    } else {
      setEditorSteps([{ delayDays: 3, subject: "", body: "" }]);
    }
  };

  const addStep = () => {
    setEditorSteps((prev) => [...prev, { delayDays: 3, subject: "", body: "" }]);
  };

  const removeStep = (i: number) => {
    setEditorSteps((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateStep = (i: number, field: string, value: string | number) => {
    setEditorSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  };

  const handleSaveSteps = async () => {
    if (!showEditorModal) return;
    for (let i = 0; i < editorSteps.length; i++) {
      const step = editorSteps[i];
      await fetch(`/api/campaigns/${showEditorModal.id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          stepNumber: i + 1,
          delayDays: step.delayDays,
          channel: "email",
          variants: [{ variantName: "A", subjectSpintax: step.subject, bodySpintax: step.body }],
        }),
      });
    }
    setShowEditorModal(null);
    fetchCampaigns();
  };

  const totalSent = (campaign: Campaign) =>
    campaign.steps.flatMap((s) => s.variants).reduce((sum, v) => sum + v.sentCount, 0);
  const totalReplied = (campaign: Campaign) =>
    campaign.steps.flatMap((s) => s.variants).reduce((sum, v) => sum + v.replyCount, 0);

  if (loading) {
    return <div className="p-6 text-slate-500">Loading campaigns...</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
          <p className="text-sm text-slate-500 mt-0.5">{campaigns.length} campaigns</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Create Campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="text-lg font-medium text-slate-700">No campaigns yet</p>
          <p className="text-sm mt-1">Create your first campaign to start sending emails</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="bg-white rounded-xl border p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                <div className="flex items-center gap-3">
                  <Link href={`/campaigns/${campaign.id}`} className="font-semibold text-slate-900 hover:text-blue-600">
                    {campaign.name}
                  </Link>
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[campaign.status] || "bg-slate-100"}`}>
                      {campaign.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    {campaign.steps.length} steps &middot; {totalSent(campaign)} sent &middot; {totalReplied(campaign)} replied
                  </p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={campaign.status}
                    onChange={(e) => handleStatusChange(campaign.id, e.target.value)}
                    className="border rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </select>
                  <button onClick={() => openEditor(campaign)} className="text-slate-500 hover:text-slate-700 px-3 py-1.5 text-sm border rounded-lg">
                    Edit Steps
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl shadow-xl m-8">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Create Campaign</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">Campaign Name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Q1 Enterprise Outreach"
                className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="space-y-4 mb-6">
              {editorSteps.map((step, i) => (
                <div key={i} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Step {i + 1}</span>
                    {editorSteps.length > 1 && (
                      <button onClick={() => removeStep(i)} className="text-red-500 text-xs hover:underline">Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Delay (days)</label>
                      <input type="number" value={step.delayDays} onChange={(e) => updateStep(i, "delayDays", Number(e.target.value))}
                        className="w-full border rounded-lg px-3 py-2 text-sm" min={0} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Channel</label>
                      <div className="border rounded-lg px-3 py-2 text-sm text-slate-600">Email</div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Subject (spintax supported, use &#123;&#123;firstName&#125;&#125; for personalization)</label>
                    <input value={step.subject} onChange={(e) => updateStep(i, "subject", e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Hi {{firstName}}, let's connect" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Body (spintax with &#123;&#123;&#125;&#125; variables)</label>
                    <textarea value={step.body} onChange={(e) => updateStep(i, "body", e.target.value)} rows={5}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                      placeholder="Hi {{firstName}}..." />
                  </div>
                  <button onClick={() => { setPreviewSubject(parseSpintax(step.subject)); setPreviewText(parseSpintax(step.body)); }}
                    className="text-xs text-blue-600 hover:underline">Preview generated email</button>
                  {(previewSubject || previewText) && i === 0 && (
                    <div className="bg-slate-50 rounded-lg p-3 text-xs">
                      <p className="font-medium text-slate-700 mb-1">Subject: {previewSubject}</p>
                      <p className="text-slate-600 whitespace-pre-wrap">{previewText}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button onClick={addStep} className="text-blue-600 text-sm hover:underline mb-4">+ Add another step</button>

            <div className="flex gap-3">
              <button onClick={handleCreate} disabled={creating || !newName.trim()}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {creating ? "Creating..." : "Create Campaign"}
              </button>
              <button onClick={() => setShowCreateModal(false)}
                className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2.5 text-sm font-medium hover:bg-slate-300">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl shadow-xl m-8">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Edit Steps: {showEditorModal.name}</h2>
            <div className="space-y-4 mb-6">
              {editorSteps.map((step, i) => (
                <div key={i} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Step {i + 1}</span>
                    {editorSteps.length > 1 && (
                      <button onClick={() => removeStep(i)} className="text-red-500 text-xs hover:underline">Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Delay (days)</label>
                      <input type="number" value={step.delayDays} onChange={(e) => updateStep(i, "delayDays", Number(e.target.value))}
                        className="w-full border rounded-lg px-3 py-2 text-sm" min={0} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Subject</label>
                    <input value={step.subject} onChange={(e) => updateStep(i, "subject", e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Body</label>
                    <textarea value={step.body} onChange={(e) => updateStep(i, "body", e.target.value)} rows={5}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addStep} className="text-blue-600 text-sm hover:underline mb-4">+ Add another step</button>
            <div className="flex gap-3">
              <button onClick={handleSaveSteps}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700">
                Save Steps
              </button>
              <button onClick={() => setShowEditorModal(null)}
                className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2.5 text-sm font-medium hover:bg-slate-300">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showLaunchConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Launch Campaign</h2>
            <p className="text-sm text-slate-600 mb-4">
              Are you sure you want to launch <strong>{showLaunchConfirm.name}</strong>? Emails will be queued and sent to eligible leads.
            </p>
            <div className="flex gap-3">
              <button onClick={handleLaunchConfirm} disabled={launching}
                className="flex-1 bg-emerald-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                {launching ? "Launching..." : "Launch"}
              </button>
              <button onClick={() => setShowLaunchConfirm(null)}
                className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2.5 text-sm font-medium hover:bg-slate-300">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}