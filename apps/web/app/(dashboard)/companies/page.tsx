"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  sizeRange: string | null;
  headquarters: string | null;
  leadCount: number;
  createdAt: string;
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({
    name: "",
    domain: "",
    industry: "",
    sizeRange: "",
    headquarters: "",
  });
  const [saving, setSaving] = useState(false);

  const fetchCompanies = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/companies?${params}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setCompanies(data);
    } catch (err) {
      console.error("Failed to fetch companies:", err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (res.ok) {
        fetchCompanies();
        setShowAddModal(false);
        setForm({ name: "", domain: "", industry: "", sizeRange: "", headquarters: "" });
      }
    } catch (err) {
      console.error("Failed to create company:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
          <p className="text-sm text-slate-500 mt-0.5">{companies.length} companies</p>
        </div>
        <button
          onClick={() => {
            setShowAddModal(true);
            setForm({ name: "", domain: "", industry: "", sizeRange: "", headquarters: "" });
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Add Company
        </button>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-4 border-b">
          <input
            type="text"
            placeholder="Search companies by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading...</div>
        ) : companies.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-slate-400 text-4xl mb-3">&#127970;</div>
            <h3 className="text-sm font-medium text-slate-900 mb-1">No companies yet</h3>
            <p className="text-sm text-slate-500 mb-4">
              Add your first company to start organizing your leads.
            </p>
            <button
              onClick={() => {
                setShowAddModal(true);
                setForm({ name: "", domain: "", industry: "", sizeRange: "", headquarters: "" });
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Company
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Name</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Domain</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Industry</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Size</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Leads</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {companies.map((company) => (
                <tr key={company.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm">
                    <Link href={`/companies/${company.id}`} className="text-blue-600 hover:underline font-medium">
                      {company.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{company.domain || "\u2014"}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{company.industry || "\u2014"}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{company.sizeRange || "\u2014"}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{company.leadCount}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {new Date(company.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Company</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Domain</label>
                <input
                  type="text"
                  value={form.domain}
                  onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                  placeholder="example.com"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
                <input
                  type="text"
                  value={form.industry}
                  onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Size Range</label>
                <input
                  type="text"
                  value={form.sizeRange}
                  onChange={(e) => setForm((f) => ({ ...f, sizeRange: e.target.value }))}
                  placeholder="1-10, 11-50, 51-200..."
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Headquarters</label>
                <input
                  type="text"
                  value={form.headquarters}
                  onChange={(e) => setForm((f) => ({ ...f, headquarters: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "..." : "Add Company"}
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2 text-sm font-medium hover:bg-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
