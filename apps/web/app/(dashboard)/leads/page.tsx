"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

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

interface Company {
  id: string;
  name: string;
}

interface Lead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  status: string;
  company: Company | null;
  createdAt: string;
}

const LEAD_TABS = [
  { href: "/leads", label: "All Leads" },
  { href: "/leads/import", label: "Import" },
  { href: "/leads/discover", label: "Discover" },
  { href: "/leads/scrape", label: "Scraper" },
];

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [form, setForm] = useState({ email: "", firstName: "", lastName: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const fetchLeads = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/leads?${params}`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      setLeads(Array.isArray(json) ? json : json.data || []);
    } catch (err) {
      console.error("Failed to fetch leads:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const filtered = leads.filter((lead) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      lead.email.toLowerCase().includes(q) ||
      `${lead.firstName || ""} ${lead.lastName || ""}`.toLowerCase().includes(q) ||
      (lead.company?.name || "").toLowerCase().includes(q)
    );
  });

  const handleSave = async () => {
    if (!form.email) return;
    setSaving(true);
    try {
      if (editingLead) {
        const res = await fetch(`/api/leads/${editingLead.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(form),
        });
        if (res.ok) { fetchLeads(); setEditingLead(null); setForm({ email: "", firstName: "", lastName: "", phone: "" }); }
      } else {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(form),
        });
        if (res.ok) { fetchLeads(); setShowAddModal(false); setForm({ email: "", firstName: "", lastName: "", phone: "" }); }
      }
    } catch (err) {
      console.error("Failed to save lead:", err);
    } finally {
      setSaving(false);
    }
  };

	const handleDelete = async (id: string) => {
		if (!confirm("Delete this lead?")) return;
		try {
			const res = await fetch(`/api/leads/${id}`, { method: "DELETE", credentials: "include" });
			if (!res.ok) throw new Error("Delete failed");
			fetchLeads();
		} catch (err) {
			alert("Failed to delete lead. Please try again.");
		}
	};

  const openEdit = (lead: Lead) => {
    setEditingLead(lead);
    setForm({ email: lead.email, firstName: lead.firstName || "", lastName: lead.lastName || "", phone: lead.phone || "" });
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} leads</p>
        </div>
        <div className="flex gap-2">
          {LEAD_TABS.filter((t) => t.href !== "/leads").map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="text-sm px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
            >
              {tab.label}
            </Link>
          ))}
          <button
            onClick={() => { setShowAddModal(true); setEditingLead(null); setForm({ email: "", firstName: "", lastName: "", phone: "" }); }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Add Lead
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-4 border-b flex gap-4">
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No leads found</div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Email</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Name</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Company</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Phone</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-700">
                  <Link href={`/leads/${lead.id}`} className="hover:text-blue-600 hover:underline">
                    {lead.email}
                  </Link>
                </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {lead.firstName} {lead.lastName}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{lead.company?.name || "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{lead.phone || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[lead.status] || "bg-slate-100 text-slate-600"}`}>
                      {STATUS_LABELS[lead.status] || lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex gap-2">
                    <button onClick={() => openEdit(lead)} className="text-blue-600 hover:underline text-sm">Edit</button>
                    <button onClick={() => handleDelete(lead.id)} className="text-red-600 hover:underline text-sm">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(showAddModal || editingLead) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingLead ? "Edit Lead" : "Add Lead"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={!!editingLead} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
                  <input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
                  <input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? "..." : editingLead ? "Save Changes" : "Add Lead"}
              </button>
              <button onClick={() => { setShowAddModal(false); setEditingLead(null); }}
                className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2 text-sm font-medium hover:bg-slate-300">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}