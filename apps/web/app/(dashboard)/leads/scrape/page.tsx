"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export default function ScrapePage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    targetUrl: "",
    mode: "single",
    maxPages: "10",
    autoEnrich: true,
  });
  const [error, setError] = useState("");

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/scrape-jobs");
      const data = await res.json();
      if (data.data) setJobs(data.data);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [jobs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/scrape-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          targetUrl: formData.targetUrl,
          mode: formData.mode,
          maxPages: Number(formData.maxPages),
          autoEnrich: formData.autoEnrich,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create job");
        return;
      }
      setFormData({ name: "", targetUrl: "", mode: "single", maxPages: "10", autoEnrich: true });
      fetchJobs();
    } catch (err: any) {
      setError(err.message || "Failed to create job");
    } finally {
      setLoading(false);
    }
  };

  const deleteJob = async (id: string) => {
    if (!confirm("Delete this scrape job?")) return;
    await fetch(`/api/scrape-jobs/${id}`, { method: "DELETE" });
    fetchJobs();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Web Scraper</h1>
        <p className="text-gray-600">Discover leads by scraping company websites and extracting contact information.</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">New Scrape Job</h2>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Job Name</label>
              <input
                type="text"
                required
                className="w-full px-3 py-2 border rounded-md"
                placeholder="e.g. Acme Corp Discovery"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target URL</label>
              <input
                type="url"
                required
                className="w-full px-3 py-2 border rounded-md"
                placeholder="https://example.com"
                value={formData.targetUrl}
                onChange={(e) => setFormData({ ...formData, targetUrl: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mode</label>
              <select
                className="w-full px-3 py-2 border rounded-md"
                value={formData.mode}
                onChange={(e) => setFormData({ ...formData, mode: e.target.value })}
              >
                <option value="single">Single Page</option>
                <option value="crawl">Crawl Site</option>
                <option value="sitemap">Sitemap</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Pages</label>
              <input
                type="number"
                min="1"
                max="100"
                className="w-full px-3 py-2 border rounded-md"
                value={formData.maxPages}
                onChange={(e) => setFormData({ ...formData, maxPages: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoEnrich"
              className="rounded"
              checked={formData.autoEnrich}
              onChange={(e) => setFormData({ ...formData, autoEnrich: e.target.checked })}
            />
            <label htmlFor="autoEnrich" className="text-sm text-gray-700">Auto-enrich leads with Apollo, Hunter & Clearbit</label>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create & Start Job"}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Scrape Jobs</h2>
        </div>
        {jobs.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No scrape jobs yet. Create one above.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Leads Found</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium">{job.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 truncate max-w-xs">{job.targetUrl}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 uppercase">{job.mode}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[job.status] || "bg-gray-100 text-gray-800"}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">{job.leadsFound ?? 0}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(job.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 flex gap-2">
                    {job.leadsFound > 0 && (
                      <Link
                        href={`/leads?scrapeJobId=${job.id}`}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        View Leads
                      </Link>
                    )}
                    {job.status !== "running" && (
                      <button
                        onClick={() => deleteJob(job.id)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}