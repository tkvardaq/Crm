export interface LeadStealthLead {
  email: string;
  name?: string;
  company?: string;
  website?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  category?: string;
  facebook?: string;
  linkedin?: string;
  source?: string;
  rating?: string;
  review_count?: string;
  google_maps_url?: string;
}

export interface ScrapeJobStatus {
  job_id: string;
  status: "running" | "completed" | "failed";
  leads_found: number;
  error?: string;
}

export class LeadStealthClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.LEADSTEALTH_URL || "http://leadstealth:8001";
    this.apiKey = process.env.LEADSTEALTH_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("LEADSTEALTH_API_KEY is not set");
    }
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "X-Api-Key": this.apiKey,
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`LeadStealth API error ${res.status}: ${txt}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async startScrape(query: string, location: string, sources?: string[]): Promise<{ job_id: string }> {
    return this.fetch("/scrape", {
      method: "POST",
      body: JSON.stringify({ query, location, sources: sources ?? ["google_maps", "yellowpages", "yelp"] }),
    });
  }

  async getJobStatus(jobId: string): Promise<ScrapeJobStatus> {
    return this.fetch(`/scrape/${jobId}`);
  }

  async getLeads(limit = 100, source?: string): Promise<{ data: LeadStealthLead[]; total: number }> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (source) params.set("source", source);
    return this.fetch(`/leads?${params}`);
  }
}
