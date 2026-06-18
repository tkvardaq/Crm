"use client";

import React, { useState, useEffect } from "react";

type ScrapeResponse = {
  scrapeJobId: string;
};

type JobStatus = {
  status: string;
  leads_found: number;
  error?: string;
};

export default function LeadDiscovery() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [scrapeJobId, setScrapeJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
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
      setScrapeJobId(data.scrapeJobId);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!scrapeJobId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/leadstealth/scrape/${scrapeJobId}`);
      if (!res.ok) {
        setStatus({ status: "error", leads_found: 0, error: "Failed to fetch status" });
        clearInterval(interval);
        return;
      }
      const data: JobStatus = await res.json();
      setStatus(data);
      if (data.status !== "running" && data.status !== "pending") clearInterval(interval);
    }, 3000);
    return () => clearInterval(interval);
  }, [scrapeJobId]);

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-2xl font-bold mb-2">Lead Discovery</h2>
      <p className="text-gray-500 mb-4">Search for businesses by type and location. The scraper will find business websites and extract contact information (emails, phone numbers).</p>

      <div className="mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Business type (e.g., plumber, dentist, restaurant)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border rounded px-3 py-2 flex-1 min-w-[200px]"
        />
        <input
          type="text"
          placeholder="Location (e.g., Austin TX, New York)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="border rounded px-3 py-2 flex-1 min-w-[200px]"
        />
        <button
          onClick={startScrape}
          disabled={loading || !query || !location}
          className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50 hover:bg-blue-700"
        >
          {loading ? "Starting..." : "Start Scrape"}
        </button>
      </div>

      {status && (
        <div className={`p-4 rounded mb-4 ${status.status === 'completed' ? 'bg-green-50 border border-green-200' : status.status === 'failed' ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
          <div className="flex items-center gap-3">
            {status.status === 'running' && <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />}
            <div>
              <p className="font-semibold">
                Status: <span className={status.status === 'completed' ? 'text-green-700' : status.status === 'failed' ? 'text-red-700' : 'text-blue-700'}>{status.status}</span>
              </p>
              <p>Leads found: <strong>{status.leads_found}</strong></p>
              {status.error && <p className="text-red-600 mt-1">Error: {status.error}</p>}
              {status.status === 'completed' && status.leads_found > 0 && (
                <p className="text-green-700 mt-1">Found {status.leads_found} leads! Check your Leads list.</p>
              )}
              {status.status === 'completed' && status.leads_found === 0 && (
                <p className="text-amber-600 mt-1">No leads found. Try a different search term or location.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
