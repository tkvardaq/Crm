"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Lead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  createdAt: string;
}

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  sizeRange: string | null;
  headquarters: string | null;
  techStack: string[];
  leadCount: number;
  leads: Lead[];
  createdAt: string;
}

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "", industry: "", sizeRange: "", headquarters: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/companies/${params.id}`, { credentials: "include" });
        if (!res.ok) { router.push("/companies"); return; }
        const data = await res.json();
        setCompany(data);
        setForm({
          name: data.name,
          domain: data.domain || "",
          industry: data.industry || "",
          sizeRange: data.sizeRange || "",
          headquarters: data.headquarters || "",
        });
      } catch (err) {
        console.error("Failed to load company:", err);
        router.push("/companies");
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id, router]);

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const updated = await res.json();
        setCompany((prev) => prev ? { ...prev, ...updated } : null);
        setEditing(false);
      }
    } catch (err) {
      console.error("Failed to update company:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this company and its associated leads?")) return;
    try {
      const res = await fetch(`/api/companies/${params.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) router.push("/companies");
    } catch (err) {
      alert("Failed to delete company.");
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-slate-500">Loading...</div>;
  }

  if (!company) {
    return <div className="p-6 text-center text-slate-500">Company not found</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/companies" className="text-sm text-blue-600 hover:underline mb-2 inline-block">
          &larr; Back to Companies
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{company.name}</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(!editing)}
              className="text-sm px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              {editing ? "Cancel" : "Edit"}
            </button>
            <button
              onClick={handleDelete}
              className="text-sm px-3 py-1.5 rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-xl border p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wide">Details</h2>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
                  <input value={form.name} onChange={(e) => setForm(f => ({...f, name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Domain</label>
                  <input value={form.domain} onChange={(e) => setForm(f => ({...f, domain: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Industry</label>
                  <input value={form.industry} onChange={(e) => setForm(f => ({...f, industry: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Size Range</label>
                  <input value={form.sizeRange} onChange={(e) => setForm(f => ({...f, sizeRange: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Headquarters</label>
                  <input value={form.headquarters} onChange={(e) => setForm(f => ({...f, headquarters: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <button onClick={handleSave} disabled={saving}
                  className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            ) : (
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Domain</dt>
                  <dd className="text-sm text-slate-900 mt-0.5">{company.domain || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Industry</dt>
                  <dd className="text-sm text-slate-900 mt-0.5">{company.industry || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Size Range</dt>
                  <dd className="text-sm text-slate-900 mt-0.5">{company.sizeRange || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Headquarters</dt>
                  <dd className="text-sm text-slate-900 mt-0.5">{company.headquarters || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Created</dt>
                  <dd className="text-sm text-slate-900 mt-0.5">{new Date(company.createdAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Total Leads</dt>
                  <dd className="text-sm text-slate-900 mt-0.5">{company.leadCount}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Leads</h2>
            </div>
            {company.leads.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">No leads for this company</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Email</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Name</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {company.leads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm">
                        <Link href={`/leads/${lead.id}`} className="text-blue-600 hover:underline">
                          {lead.email}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {lead.firstName} {lead.lastName}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-1 rounded-full capitalize bg-slate-100 text-slate-600">
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
