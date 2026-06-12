# CRM Tool - Cold Email Engine & Pipeline CRM

Production-grade multi-tenant SaaS platform combining a drag-and-drop pipeline CRM with a cold email outreach engine.

## Architecture

```
crm-tool/
├── apps/web/                 # Next.js 14 (App Router)
│   ├── app/                  # Pages & API routes
│   ├── components/           # UI components (CRM, Leads, Campaigns, Inbox)
│   └── lib/                  # Auth, Prisma client
├── packages/
│   ├── database/             # Prisma schema (13 tables)
│   ├── shared/               # Enums, types, Zod validators
│   ├── email-engine/         # SMTP, spintax, smart rotation
│   ├── scraper/              # Playwright stealth scraper
│   ├── enrichment/           # Waterfall enrichment (Apollo/Hunter/etc)
│   └── ai-client/            # NVIDIA NIM API adapter
└── workers/                  # BullMQ background workers
    ├── email-dispatcher/
    ├── imap-sync/
    ├── dns-checker/
    ├── warmup/
    ├── scraper-worker/
    ├── enrichment-worker/
    └── decay-tracker/
```

## Setup

### 1. Start Infrastructure

```bash
# Start PostgreSQL + Redis containers
docker compose up -d

# Verify containers are running
docker ps --filter "name=leadstealth"
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example apps/web/.env.local
# Edit apps/web/.env.local with your values:
#   - NEXTAUTH_SECRET (generate a random string)
#   - DATABASE_URL (already configured for docker compose)
#   - NIM_API_KEY (your NVIDIA NIM API key)
```

### 4. Run Database Migration

```bash
# From packages/database/
npx prisma migrate dev --name init

# Or from root
npm run db:migrate
```

### 5. Seed Initial Data

```bash
# Seed workspace, user, and pipeline stages
npx ts-node scripts/seed.ts
```

### 6. Start Development Server

```bash
npm run dev
# Open http://localhost:3000
```

## Database Schema (13 Tables)

- `workspaces` - Multi-tenant workspaces
- `users` - Authenticated users scoped to workspaces
- `sending_domains` - SPF/DKIM/DMARC tracked domains
- `connected_inboxes` - SMTP/IMAP inbox pool with rotation
- `companies` - Firmographic data with vector embeddings
- `leads` - Contact targets with enrichment status
- `campaigns` - Outreach sequences
- `campaign_steps` - Milestones within campaigns
- `variant_templates` - Multi-armed bandit spintax templates
- `campaign_queue` - Scheduled email dispatch jobs
- `communication_history` - Unified audit ledger
- `pipeline_stages` - Kanban column configurations
- `deals` - Visual pipeline tracking layer

## Key Features Implemented

### Phase 1 - Foundation ✓
- [x] Monorepo structure with npm workspaces
- [x] Docker Compose (PostgreSQL + pgvector, Redis)
- [x] Complete Prisma schema (13 tables + indices)
- [x] NextAuth.js with workspace-scoped sessions
- [x] Dashboard layout with sidebar navigation
- [x] Drag-and-drop Kanban pipeline board
- [x] Leads management page
- [x] Campaigns listing page
- [x] Master inbox with sentiment badges
- [x] Settings page (domains, inboxes, integrations)
- [x] REST API routes (deals, leads, campaigns, pipeline-stages)
- [x] NVIDIA NIM AI client adapter
- [x] Configurable enrichment adapters (mock/live)
- [x] Email engine (spintax, SMTP, smart rotation)
- [x] Playwright stealth scraper with HTML→Markdown
- [x] BullMQ worker stubs

### Phase 2 - CRM Pipeline
- [ ] Deal CRUD with atomic transactions
- [ ] WebSocket real-time pipeline updates
- [ ] Lead import (CSV bulk upload)
- [ ] Pipeline stage creation/reordering

### Phase 3 - Email Engine
- [ ] Campaign builder UI with step editor
- [ ] Spintax editor with preview
- [ ] Smart inbox rotation algorithm
- [ ] DNS health checker daemon

### Phase 4 - Outreach Execution
- [ ] BullMQ email dispatcher worker
- [ ] IMAP sync worker for inbound
- [ ] Communication history ledger
- [ ] Reply detection and threading

### Phase 5 - Scraping & Enrichment
- [ ] Playwright scraper worker
- [ ] Waterfall enrichment (Apollo→Hunter→ContactOut)
- [ ] Company tech stack detection

### Phase 6 - AI Integration
- [ ] NVIDIA NIM embedding generation
- [ ] Sentiment classification
- [ ] Lookalike matching via pgvector
- [ ] SDR draft generation

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `NEXTAUTH_URL` | App URL (http://localhost:3000) |
| `NEXTAUTH_SECRET` | Random secret for session encryption |
| `NIM_API_KEY` | NVIDIA NIM API key |
| `NIM_BASE_URL` | NIM API base URL |
| `ADAPTER_MODE` | `mock` or `live` for external services |

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS, shadcn/ui, @dnd-kit
- **Backend**: Next.js API Routes, Prisma 5, NextAuth.js v4
- **Database**: PostgreSQL 16 + pgvector extension
- **Queue**: Redis 7 + BullMQ
- **AI**: NVIDIA NIM API (OpenAI-compatible)
- **Scraping**: Playwright with stealth evasions