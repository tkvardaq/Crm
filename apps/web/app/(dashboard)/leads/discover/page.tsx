"use client";

import React, { useState, useEffect } from "react";

type ScrapeResponse = {
  scrapeJobId: string;
  leadsStealthJobId: string;
};

type JobStatus = {
  status: string;
  leads_found: number;
  error?: string;
};

export default function LeadDiscovery() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [jobInfo, setJobInfo] = useState<ScrapeResponse | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const startScrape = async () => {
    if (!query || !location) return;
    setLoading(true);
    try {
      const res = await fetch("/api/leadstealth/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, location, jobName: `${query} in ${location}` }),
      });
      const data: ScrapeResponse = await res.json();
      if (!res.ok) {
        alert("Failed to start scrape: " + JSON.stringify(data));
        return;
      }
      setJobInfo(data);
      setStatus(null);
      setImportResult(null);
    } finally {
      setLoading(false);
    }
  };

  // Poll job status
  useEffect(() => {
    if (!jobInfo) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/leadstealth/scrape/${jobInfo.leadsStealthJobId}`);
      if (!res.ok) {
        setStatus({ status: "error", leads_found: 0, error: "Failed to fetch status" });
        clearInterval(interval);
        return;
      }
      const data: JobStatus = await res.json();
      setStatus(data);
      if (data.status !== "running") clearInterval(interval);
    }, 5000);
    return () => clearInterval(interval);
  }, [jobInfo]);

  const importLeads = async () => {
    const res = await fetch("/api/leadstealth/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: undefined, limit: 500 }) });
    const data = await res.json();
    setImportResult({ imported: data.imported, skipped: data.skipped });
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Lead Discovery</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Query (e.g., plumbers)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border p-2"
        />
        <input
          type="text"
          placeholder="Location (e.g., Austin TX)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="border p-2"
        />
        <button onClick={startScrape} disabled={loading} className="bg-blue-500 text-white px-3 py-1 rounded disabled:opacity-50">
          {loading ? "Starting..." : "Start Scrape"}
        </button>
      </div>
      {status && (
        <div className="mb-4 p-3 bg-gray-100 rounded">
          <p>Status: <strong>{status.status}</strong></p>
          <p>Leads found: <strong>{status.leads_found}</strong></p>
          {status.error && <p className="text-red-600">Error: {status.error}</p>}
        </div>
      )}
      {jobInfo && status && status.status !== "running" && !status.error && (
        <button onClick={importLeads} className="bg-green-600 text-white px-3 py-1 rounded">
          Import Leads
        </button>
      )}
      {importResult && (
        <div className="mt-4 p-3 bg-green-100 rounded">
          <p>Imported: <strong>{importResult.imported}</strong></p>
          <p>Skipped (existing): <strong>{importResult.skipped}</strong></p>
        </div>
      )}
    </div>
  );
}
