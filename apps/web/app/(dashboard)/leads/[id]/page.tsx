"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

const STATUS_COLORS: Record<string, string> = {
  raw: "bg-slate-100 text-slate-600",
  enriched: "bg-purple-100 text-purple-700",
  contacted: "bg-blue-100 text-blue-700",
  replied: "bg-amber-100 text-amber-700",
  interested: "bg-emerald-100 text-emerald-700",
  not_interested: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  raw: "Raw",
  enriched: "Enriched",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  not_interested: "Not Interested",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "bg-emerald-100 text-emerald-700",
  neutral: "bg-slate-100 text-slate-600",
  negative: "bg-red-100 text-red-700",
  oof: "bg-amber-100 text-amber-700",
  unsubscribe: "bg-red-100 text-red-700",
};

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  sizeRange: string | null;
  headquarters: string | null;
  techStack: string[];
}

interface Lead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  status: string;
  score: number;
  bounceVerified: boolean;
  isOptedOut: boolean;
  scrapedAttributes: string | null;
  companyId: string | null;
  company: Company | null;
  createdAt: string;
}

interface Note {
  id: string;
  content: string;
  createdAt: string;
  user: { firstName: string | null; lastName: string | null };
}

interface Deal {
  id: string;
  title: string;
  value: number;
  pipelineStageId: string;
  expectedCloseDate: string | null;
  pipelineStage: { name: string };
}

interface Message {
  id: string;
  leadId?: string;
  direction: string;
  subject: string | null;
  bodyText: string;
  sentAt: string;
  sentiment: string | null;
  lead: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
}

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);
  if (diffD > 0) return `${diffD}d ago`;
  if (diffH > 0) return `${diffH}h ago`;
  return "Just now";
};

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [form, setForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    linkedinUrl: "",
    status: "raw",
    companyId: "",
  });

  const fetchLead = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${id}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setLead(data);
      setForm({
        email: data.email,
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        phone: data.phone || "",
        linkedinUrl: data.linkedinUrl || "",
        status: data.status,
        companyId: data.companyId || "",
      });
    } catch (err) {
      console.error("Failed to fetch lead:", err);
    }
  }, [id]);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${id}/notes`, { credentials: "include" });
      if (res.ok) setNotes(await res.json());
    } catch (err) {
      console.error("Failed to fetch notes:", err);
    }
  }, [id]);

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch("/api/deals", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setDeals(data.filter((d: Deal & { leadId: string }) => d.leadId === id));
    } catch (err) {
      console.error("Failed to fetch deals:", err);
    }
  }, [id]);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.filter((m: Message) => m.leadId === id || m.lead?.id === id));
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    }
  }, [id]);

  useEffect(() => {
    Promise.all([fetchLead(), fetchNotes(), fetchDeals(), fetchMessages()]).finally(() => setLoading(false));
  }, [fetchLead, fetchNotes, fetchDeals, fetchMessages]);

  const handleSave = async () => {
    if (!form.email) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (res.ok) {
        await fetchLead();
        setShowEditModal(false);
      }
    } catch (err) {
      console.error("Failed to update lead:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/leads/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        router.push("/leads");
      } else {
        alert("Failed to delete lead.");
      }
    } catch (err) {
      console.error("Failed to delete lead:", err);
      alert("Failed to delete lead. Please try again.");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/leads/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: noteContent }),
      });
      if (res.ok) {
        setNoteContent("");
        fetchNotes();
      }
    } catch (err) {
      console.error("Failed to add note:", err);
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const res = await fetch(`/api/leads/${id}/notes?noteId=${noteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) fetchNotes();
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center text-slate-500">Loading...</div>;
  }

  if (!lead) {
    return <div className="h-full flex items-center justify-center text-slate-500">Lead not found</div>;
  }

  const fullName = `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || lead.email;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button onClick={() => router.push("/leads")} className="text-sm text-slate-500 hover:text-slate-700 mb-3 inline-flex items-center gap-1">
          &larr; Back to Leads
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{fullName}</h1>
              <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[lead.status] || "bg-slate-100 text-slate-600"}`}>
                {STATUS_LABELS[lead.status] || lead.status}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">{lead.email}{lead.company && ` · ${lead.company.name}`}{lead.score && ` · Score: ${lead.score}`}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowEditModal(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">Edit</button>
            <button onClick={() => setShowDeleteConfirm(true)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">Delete</button>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left column */}
        <div className="col-span-2 space-y-6">
          {/* Activity Timeline */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-slate-900 mb-4">Activity Timeline</h2>
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">No communication history</p>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${msg.direction === "inbound" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                        {msg.direction === "inbound" ? "In" : "Out"}
                      </div>
                      <div className="w-px flex-1 bg-slate-200 mt-1" />
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{msg.subject || "(no subject)"}</span>
                        {msg.sentiment && (
                          <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${SENTIMENT_COLORS[msg.sentiment] || "bg-slate-100"}`}>{msg.sentiment}</span>
                        )}
                        <span className="text-xs text-slate-400 ml-auto">{formatTime(msg.sentAt)}</span>
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{msg.bodyText}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes Section */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-slate-900 mb-4">Notes</h2>
            <div className="flex gap-2 mb-4">
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Add a note..."
                rows={2}
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <button onClick={handleAddNote} disabled={addingNote || !noteContent.trim()} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors self-end">
                {addingNote ? "..." : "Add"}
              </button>
            </div>
            {notes.length === 0 ? (
              <p className="text-sm text-slate-500">No notes yet</p>
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="border rounded-lg p-3 relative group">
                    <button onClick={() => handleDeleteNote(note.id)} className="absolute top-2 right-2 text-slate-400 hover:text-red-600 text-sm opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
                    <p className="text-sm text-slate-700 pr-6">{note.content}</p>
                    <p className="text-xs text-slate-400 mt-1.5">
                      {note.user.firstName} {note.user.lastName} &middot; {formatTime(note.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Lead Info Card */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-slate-900 mb-4">Lead Info</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd className="text-slate-900">{lead.email}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Phone</dt><dd className="text-slate-900">{lead.phone || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">LinkedIn</dt><dd className="text-slate-900">{lead.linkedinUrl ? <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[160px] inline-block align-bottom">Profile</a> : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd><span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[lead.status] || "bg-slate-100 text-slate-600"}`}>{STATUS_LABELS[lead.status] || lead.status}</span></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Score</dt><dd className="text-slate-900">{lead.score}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Bounce Verified</dt><dd className="text-slate-900">{lead.bounceVerified ? "Yes" : "No"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Opted Out</dt><dd className="text-slate-900">{lead.isOptedOut ? "Yes" : "No"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Created</dt><dd className="text-slate-900">{new Date(lead.createdAt).toLocaleDateString()}</dd></div>
            </dl>
            {lead.scrapedAttributes && (
              <div className="mt-4 pt-3 border-t">
                <p className="text-xs font-medium text-slate-500 mb-1">Scraped Attributes</p>
                <pre className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
                  {(() => { try { return JSON.stringify(JSON.parse(lead.scrapedAttributes), null, 2); } catch { return lead.scrapedAttributes; } })()}
                </pre>
              </div>
            )}
          </div>

          {/* Company Card */}
          {lead.company && (
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-slate-900 mb-4">Company</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd className="text-slate-900 font-medium">{lead.company.name}</dd></div>
                {lead.company.domain && <div className="flex justify-between"><dt className="text-slate-500">Domain</dt><dd className="text-slate-900">{lead.company.domain}</dd></div>}
                {lead.company.industry && <div className="flex justify-between"><dt className="text-slate-500">Industry</dt><dd className="text-slate-900">{lead.company.industry}</dd></div>}
                {lead.company.sizeRange && <div className="flex justify-between"><dt className="text-slate-500">Size</dt><dd className="text-slate-900">{lead.company.sizeRange}</dd></div>}
                {lead.company.headquarters && <div className="flex justify-between"><dt className="text-slate-500">HQ</dt><dd className="text-slate-900">{lead.company.headquarters}</dd></div>}
                {lead.company.techStack.length > 0 && (
                  <div><dt className="text-slate-500 text-xs mb-1.5">Tech Stack</dt><dd className="flex flex-wrap gap-1">{lead.company.techStack.map((t) => <span key={t} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{t}</span>)}</dd></div>
                )}
              </dl>
            </div>
          )}

          {/* Deals Card */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-slate-900 mb-4">Deals</h2>
            {deals.length === 0 ? (
              <p className="text-sm text-slate-500">No associated deals</p>
            ) : (
              <div className="space-y-3">
                {deals.map((deal) => (
                  <div key={deal.id} className="border rounded-lg p-3">
                    <p className="text-sm font-medium text-slate-900">{deal.title}</p>
                    <p className="text-sm text-slate-700">${deal.value.toLocaleString()}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{deal.pipelineStage.name}</span>
                      {deal.expectedCloseDate && <span className="text-xs text-slate-400">Close: {new Date(deal.expectedCloseDate).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Lead Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Edit Lead</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
                  <input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
                  <input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">LinkedIn URL</label>
                <input value={form.linkedinUrl} onChange={(e) => setForm((f) => ({ ...f, linkedinUrl: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm">
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Company ID</label>
                <input value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))} placeholder="UUID" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? "..." : "Save Changes"}
              </button>
              <button onClick={() => setShowEditModal(false)} className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2 text-sm font-medium hover:bg-slate-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Delete Lead</h2>
            <p className="text-sm text-slate-600 mb-6">Are you sure you want to delete <strong>{fullName}</strong>? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={handleDelete} disabled={deleting} className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {deleting ? "Deleting..." : "Delete"}
              </button>
              <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2 text-sm font-medium hover:bg-slate-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
