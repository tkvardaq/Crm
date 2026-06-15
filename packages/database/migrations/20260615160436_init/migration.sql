-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "current_workspace_id" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sending_domains" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "spf_valid" BOOLEAN NOT NULL DEFAULT false,
    "dkim_valid" BOOLEAN NOT NULL DEFAULT false,
    "dmarc_valid" BOOLEAN NOT NULL DEFAULT false,
    "mx_valid" BOOLEAN NOT NULL DEFAULT false,
    "reputation_score" INTEGER NOT NULL DEFAULT 100,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sending_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connected_inboxes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "sending_domain_id" TEXT,
    "email" TEXT NOT NULL,
    "smtp_host" TEXT NOT NULL,
    "smtp_port" INTEGER NOT NULL DEFAULT 587,
    "smtp_user" TEXT NOT NULL,
    "smtp_pass_encrypted" TEXT NOT NULL,
    "imap_host" TEXT NOT NULL,
    "imap_port" INTEGER NOT NULL DEFAULT 993,
    "imap_user" TEXT NOT NULL,
    "imap_pass_encrypted" TEXT NOT NULL,
    "oauth_token_json" TEXT,
    "daily_sent_count" INTEGER NOT NULL DEFAULT 0,
    "max_daily_limit" INTEGER NOT NULL DEFAULT 50,
    "warmup_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "size_range" TEXT,
    "headquarters" TEXT,
    "tech_stack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firmographic_embedding" BYTEA,
    "extra_attributes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "company_id" TEXT,
    "scrape_job_id" TEXT,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "linkedin_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'raw',
    "score" INTEGER NOT NULL DEFAULT 100,
    "bounce_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_opted_out" BOOLEAN NOT NULL DEFAULT false,
    "scraped_attributes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_steps" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "step_number" INTEGER NOT NULL,
    "delay_days" INTEGER NOT NULL DEFAULT 3,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_templates" (
    "id" TEXT NOT NULL,
    "campaign_step_id" TEXT NOT NULL,
    "variant_name" TEXT NOT NULL,
    "subject_spintax" TEXT NOT NULL,
    "body_spintax" TEXT NOT NULL,
    "bandit_weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "interest_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_queue" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "campaign_step_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_history" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "connected_inbox_id" TEXT,
    "campaign_id" TEXT,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body_text" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentiment" TEXT,
    "message_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "communication_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "pipeline_stage_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expected_close_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" VARCHAR(50000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tags" (
    "lead_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "lead_tags_pkey" PRIMARY KEY ("lead_id","tag_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "details" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_jobs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'single',
    "max_pages" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "leads_found" INTEGER NOT NULL DEFAULT 0,
    "pages_scraped" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_workspace_id_email_key" ON "users"("workspace_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sending_domains_domain_key" ON "sending_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "connected_inboxes_email_key" ON "connected_inboxes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "companies_workspace_id_domain_key" ON "companies"("workspace_id", "domain");

-- CreateIndex
CREATE INDEX "leads_workspace_id_status_idx" ON "leads"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leads_workspace_id_email_key" ON "leads"("workspace_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_steps_campaign_id_step_number_key" ON "campaign_steps"("campaign_id", "step_number");

-- CreateIndex
CREATE INDEX "campaign_queue_workspace_id_campaign_id_status_idx" ON "campaign_queue"("workspace_id", "campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_queue_workspace_id_idx" ON "campaign_queue"("workspace_id");

-- CreateIndex
CREATE INDEX "campaign_queue_lead_id_idx" ON "campaign_queue"("lead_id");

-- CreateIndex
CREATE INDEX "campaign_queue_workspace_id_campaign_id_idx" ON "campaign_queue"("workspace_id", "campaign_id");

-- CreateIndex
CREATE INDEX "communication_history_workspace_id_direction_idx" ON "communication_history"("workspace_id", "direction");

-- CreateIndex
CREATE INDEX "communication_history_workspace_id_lead_id_idx" ON "communication_history"("workspace_id", "lead_id");

-- CreateIndex
CREATE INDEX "communication_history_sent_at_idx" ON "communication_history"("sent_at");

-- CreateIndex
CREATE INDEX "communication_history_workspace_id_campaign_id_idx" ON "communication_history"("workspace_id", "campaign_id");

-- CreateIndex
CREATE INDEX "pipeline_stages_workspace_id_sort_order_idx" ON "pipeline_stages"("workspace_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "tags_workspace_id_name_key" ON "tags"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "lead_tags_lead_id_idx" ON "lead_tags"("lead_id");

-- CreateIndex
CREATE INDEX "lead_tags_tag_id_idx" ON "lead_tags"("tag_id");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_idx" ON "audit_logs"("workspace_id");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_entity_idx" ON "audit_logs"("workspace_id", "entity");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_action_idx" ON "audit_logs"("workspace_id", "action");

-- CreateIndex
CREATE INDEX "scrape_jobs_workspace_id_idx" ON "scrape_jobs"("workspace_id");

-- CreateIndex
CREATE INDEX "scrape_jobs_workspace_id_status_idx" ON "scrape_jobs"("workspace_id", "status");
