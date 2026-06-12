-- CRM Tool Database Schema
-- Run this manually via: docker exec -i leadstealth-postgres psql -U admin -d leadstealth_db

-- Workspaces (Tenants)
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    role VARCHAR(50) DEFAULT 'member' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_workspace_user_email UNIQUE (workspace_id, email)
);

-- Sending Domains
CREATE TABLE IF NOT EXISTS sending_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    domain VARCHAR(255) UNIQUE NOT NULL,
    spf_valid BOOLEAN DEFAULT FALSE NOT NULL,
    dkim_valid BOOLEAN DEFAULT FALSE NOT NULL,
    dmarc_valid BOOLEAN DEFAULT FALSE NOT NULL,
    mx_valid BOOLEAN DEFAULT FALSE NOT NULL,
    reputation_score INT DEFAULT 100 NOT NULL,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Connected Inboxes
CREATE TABLE IF NOT EXISTS connected_inboxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sending_domain_id UUID REFERENCES sending_domains(id) ON DELETE SET NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    smtp_host VARCHAR(255) NOT NULL,
    smtp_port INT NOT NULL DEFAULT 587,
    smtp_user VARCHAR(255) NOT NULL,
    smtp_pass_encrypted TEXT NOT NULL,
    imap_host VARCHAR(255) NOT NULL,
    imap_port INT NOT NULL DEFAULT 993,
    imap_user VARCHAR(255) NOT NULL,
    imap_pass_encrypted TEXT NOT NULL,
    oauth_token_json TEXT,
    daily_sent_count INT DEFAULT 0 NOT NULL,
    max_daily_limit INT DEFAULT 50 NOT NULL,
    warmup_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Companies
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    industry VARCHAR(255),
    size_range VARCHAR(50),
    headquarters VARCHAR(255),
    tech_stack TEXT[] DEFAULT '{}',
    firmographic_embedding BYTEA,
    extra_attributes JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    linkedin_url VARCHAR(500),
  status VARCHAR(50) DEFAULT 'raw' NOT NULL,
  score INT DEFAULT 100 NOT NULL,
  bounce_verified BOOLEAN DEFAULT FALSE NOT NULL,
  is_opted_out BOOLEAN DEFAULT FALSE NOT NULL,
  scraped_attributes JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_workspace_lead_email UNIQUE (workspace_id, email)
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Campaign Steps
CREATE TABLE IF NOT EXISTS campaign_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    delay_days INT DEFAULT 3 NOT NULL,
    channel VARCHAR(50) DEFAULT 'email' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_campaign_step_number UNIQUE (campaign_id, step_number)
);

-- Variant Templates
CREATE TABLE IF NOT EXISTS variant_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_step_id UUID NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
    variant_name VARCHAR(50) NOT NULL,
    subject_spintax TEXT NOT NULL,
    body_spintax TEXT NOT NULL,
    bandit_weight FLOAT DEFAULT 0.5 NOT NULL,
    sent_count INT DEFAULT 0 NOT NULL,
    reply_count INT DEFAULT 0 NOT NULL,
    interest_count INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Campaign Queue
CREATE TABLE IF NOT EXISTS campaign_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    campaign_step_id UUID NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    scheduled_for TIMESTAMPTZ NOT NULL,
    attempts INT DEFAULT 0 NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Communication History
CREATE TABLE IF NOT EXISTS communication_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    connected_inbox_id UUID REFERENCES connected_inboxes(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    direction VARCHAR(10) NOT NULL,
    channel VARCHAR(50) DEFAULT 'email' NOT NULL,
    subject VARCHAR(500),
    body_text TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  sentiment VARCHAR(50),
  message_id VARCHAR(255),
  is_read BOOLEAN DEFAULT FALSE NOT NULL
);

-- Pipeline Stages
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_workspace_stage_order UNIQUE (workspace_id, sort_order)
);

-- Deals
CREATE TABLE IF NOT EXISTS deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    pipeline_stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    value NUMERIC(15, 2) DEFAULT 0 NOT NULL,
    expected_close_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_workspace ON leads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_schedule ON campaign_queue(scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_lead ON campaign_queue(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_status ON campaign_queue(status);
CREATE INDEX IF NOT EXISTS idx_comm_history_lead ON communication_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_comm_history_sent_at ON communication_history(sent_at);
CREATE INDEX IF NOT EXISTS idx_comm_history_inbox ON communication_history(connected_inbox_id);
CREATE INDEX IF NOT EXISTS idx_deals_workspace ON deals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_companies_workspace ON companies(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_workspace ON pipeline_stages(workspace_id);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(100) NOT NULL,
  entity_id UUID,
  details JSONB,
  ip VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);

CREATE INDEX IF NOT EXISTS idx_comm_history_unread ON communication_history(workspace_id, is_read) WHERE is_read = FALSE;

-- Seed initial data
INSERT INTO workspaces (id, name) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Acme Corporation')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, workspace_id, email, password_hash, first_name, last_name, role) VALUES
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'admin@acme.com', '$2a$10$placeholder', 'Admin', 'User', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO pipeline_stages (id, workspace_id, name, sort_order) VALUES
    ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'New', 0),
    ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'Qualified', 1),
    ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'Negotiation', 2),
    ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'Closed Won', 3),
    ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000001', 'Closed Lost', 4)
ON CONFLICT DO NOTHING;