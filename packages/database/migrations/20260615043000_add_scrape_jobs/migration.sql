-- Create ScrapeJob table
CREATE TABLE scrape_jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_url TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'single',
    max_pages INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'pending',
    leads_found INTEGER NOT NULL DEFAULT 0,
    pages_scraped INTEGER NOT NULL DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Add scrape_job_id to leads
ALTER TABLE leads ADD COLUMN scrape_job_id TEXT REFERENCES scrape_jobs(id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX idx_scrape_jobs_workspace_id ON scrape_jobs(workspace_id);
CREATE INDEX idx_scrape_jobs_workspace_id_status ON scrape_jobs(workspace_id, status);