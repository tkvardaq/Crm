# CRM Tool

A multi-tenant SaaS platform combining a pipeline CRM with a cold email outreach engine.

## Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, Prisma 5, NextAuth.js
- **Database**: PostgreSQL 16 + pgvector
- **Queue**: Redis 7 + BullMQ
- **Scraping**: Playwright stealth

## Architecture

```
crm-tool/
├── apps/web/              # Next.js 14 web application
├── packages/
│   ├── database/          # Prisma schema & migrations
│   ├── shared/            # Shared types & utilities
│   ├── email-engine/      # SMTP engine with rotation
│   ├── scraper/           # Playwright scraper
│   ├── enrichment/        # Lead enrichment
│   └── ai-client/         # AI API adapter
└── workers/               # BullMQ background workers
    ├── email-dispatcher/
    ├── imap-sync/
    ├── dns-checker/
    ├── warmup/
    ├── scraper-worker/
    ├── enrichment-worker/
    └── decay-tracker/
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL and Redis)

### Setup

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example apps/web/.env.local
# Edit apps/web/.env.local with your values

# 4. Run migrations
npx prisma migrate deploy --schema=packages/database/schema.prisma

# 5. Seed the database
npx tsx scripts/seed.ts

# 6. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

See `.env.example` for all required variables.

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `NEXTAUTH_SECRET` | Random secret (min 32 chars) |
| `NEXTAUTH_URL` | App URL |
| `FERNET_KEY` | 64-char hex encryption key |
| `ENCRYPTION_KEY` | 64-char hex encryption key |

## Scripts

```bash
npm run dev           # Start development server
npm run build         # Build for production
npm run db:migrate    # Run database migrations
npm run db:generate   # Regenerate Prisma client
```