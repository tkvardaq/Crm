Below is the fully corrected, production‑ready implementation plan.  
It integrates all original fixes plus the two critical corrections discovered during review:

- **2.1** now works with App Router (store `currentWorkspaceId` in DB, JWT callback reads it).
- **3.2** uses an atomic `UPDATE … RETURNING` to claim inbox slots without race conditions.

All code blocks are copy‑paste ready.

```markdown
# CRM Fix Implementation Plan (Final, App‑Router‑Compatible)

**Repository:** `tkvardaq/Crm`  
**Total tasks:** 26 across 4 phases  
**Estimated effort:** 5–6 engineering days  

This document contains every required code change, verified against real App Router usage.

---

## Prerequisites

```bash
git checkout -b fix/security-and-integrity
npm install rate-limiter-flexible --workspace=apps/web
npm install sanitize-html @types/sanitize-html --workspace=packages/email-engine
npm install express-basic-auth --workspace=workers/bull-board
npm install
```

---

## Phase 1 — Crashes & Broken Core Flows (~2 hrs)

### [ ] 1.1 — Fix imap-sync `workspaceId` crash

**File:** `workers/imap-sync/src/index.ts` (line ~48)

**Before:**

```ts
const { inboxId } = job.data;
```

**After:**

```ts
const { inboxId, workspaceId } = job.data;
```

**Test:** Dispatch a test IMAP sync job. Confirm inbox lookup succeeds and messages are processed.

---

### [ ] 1.2 — Fix missing `sentAt` — broken post-send transaction

**Files:** `workers/email-dispatcher/src/index.ts`, `packages/database/schema.prisma`

**Step A — dispatcher:** locate `prismaClient.communicationHistory.create({...})` and add:

```ts
sentAt: new Date(),
```

immediately after `bodyText: body,`.

**Step B — schema (safety net):** in `packages/database/schema.prisma` change

```prisma
sentAt DateTime @map("sent_at")
```

to

```prisma
sentAt DateTime @default(now()) @map("sent_at")
```

**Step C — run migration:**

```bash
npx prisma migrate dev --name add-sent-at-default --schema=packages/database/schema.prisma
```

**Test:** Full campaign dispatch → `communication_history` rows appear, `daily_sent_count` increments.

---

### [ ] 1.3 — Fix campaign launch: DB mutation before validation

**File:** `apps/web/app/api/campaigns/[id]/launch/route.ts`

Replace the entire file with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { campaignLaunchSchema, CampaignStatus, QueueName } from "@crm/shared";
import { Queue } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function parseRedisUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "localhost",
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      db: parsed.pathname ? Number(parsed.pathname.slice(1)) || 0 : 0,
    };
  } catch {
    return { host: "localhost", port: 6379, password: undefined, db: 0 };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const campaignId = params.id;

  // 1. Parse and validate body FIRST
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = campaignLaunchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }
  const leadIds: string[] = parsed.data.leadIds;

  // 2. Fetch campaign (read-only)
  const campaign = await prismaClient.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: {
      steps: {
        include: { variants: true },
        orderBy: { stepNumber: "asc" },
      },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (
    campaign.status !== CampaignStatus.DRAFT &&
    campaign.status !== CampaignStatus.PAUSED
  ) {
    return NextResponse.json(
      { error: "Campaign must be in draft or paused status to launch" },
      { status: 400 }
    );
  }

  // 3. Validate structure BEFORE touching status
  if (campaign.steps.length === 0) {
    return NextResponse.json({ error: "Campaign has no steps" }, { status: 400 });
  }

  const firstStep = campaign.steps[0];
  if (!firstStep.variants || firstStep.variants.length === 0) {
    return NextResponse.json(
      { error: "First campaign step has no email variants" },
      { status: 400 }
    );
  }

  // 4. Resolve leads
  let leads;
  if (leadIds.length > 0) {
    leads = await prismaClient.lead.findMany({
      where: { id: { in: leadIds }, workspaceId, isOptedOut: false },
    });
    if (leads.length !== leadIds.length) {
      return NextResponse.json(
        { error: "One or more lead IDs are invalid or belong to another workspace" },
        { status: 400 }
      );
    }
  } else {
    leads = await prismaClient.lead.findMany({
      where: {
        workspaceId,
        isOptedOut: false,
        status: { in: ["raw", "enriched"] },
      },
    });
  }

  if (leads.length === 0) {
    return NextResponse.json({ error: "No eligible leads found" }, { status: 400 });
  }

  const now = new Date();

  // 5. Atomic: status update + queue entries in one transaction
  const queueEntriesByStep: Array<{ id: string; scheduledFor: Date }[]> = [];

  await prismaClient.$transaction(async (tx) => {
    const updated = await tx.campaign.updateMany({
      where: { id: campaignId, workspaceId, status: campaign.status },
      data: { status: CampaignStatus.ACTIVE },
    });

    if (updated.count === 0) {
      throw new Error("CONFLICT: Campaign status changed concurrently");
    }

    for (let si = 0; si < campaign.steps.length; si++) {
      const step = campaign.steps[si];
      const delayMs = si === 0 ? 0 : step.delayDays * 24 * 60 * 60 * 1000;

      const entries = await Promise.all(
        leads.map((lead, index) =>
          tx.campaignQueue.create({
            data: {
              workspaceId,
              campaignId,
              campaignStepId: step.id,
              leadId: lead.id,
              scheduledFor: new Date(now.getTime() + delayMs + index * 2000),
              status: "pending",
            },
            select: { id: true, scheduledFor: true },
          })
        )
      );
      queueEntriesByStep.push(entries);
    }
  }).catch((err) => {
    if (err.message?.startsWith("CONFLICT")) {
      return NextResponse.json(
        { error: "Campaign status changed — another launch may be in progress" },
        { status: 409 }
      );
    }
    throw err;
  });

  // 6. Enqueue BullMQ jobs AFTER transaction commits
  const redisOpts = parseRedisUrl(REDIS_URL);
  const emailDispatchQueue = new Queue(QueueName.EMAIL_DISPATCH, {
    connection: redisOpts,
  });

  try {
    for (const entries of queueEntriesByStep) {
      for (const entry of entries) {
        await emailDispatchQueue.add(
          "dispatch",
          { campaignQueueId: entry.id },
          {
            jobId: entry.id,
            delay: Math.max(0, entry.scheduledFor.getTime() - Date.now()),
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          }
        );
      }
    }
  } finally {
    await emailDispatchQueue.close();
  }

  return NextResponse.json({
    message: "Campaign launched",
    leadsCount: leads.length,
    stepsQueued: campaign.steps.length,
    totalJobs: leads.length * campaign.steps.length,
  });
}
```

**Test:** POST invalid JSON to a DRAFT campaign → stays DRAFT. Launch twice in quick succession → no duplicate emails.

---

## Phase 2 — Security Vulnerabilities (~1 day)

### [ ] 2.1 — Fix workspace-switch: JWT never updates (App‑Router‑compatible)

**Files:**  

- `packages/database/schema.prisma` (add `currentWorkspaceId`)  
- `apps/web/app/api/workspaces/switch/route.ts`  
- `apps/web/app/api/auth/[...nextauth]/route.ts` (NextAuth config)  
- Workspace switcher component  

**Step A — Schema: add `currentWorkspaceId` to User**  

```prisma
model User {
  id                 String    @id @default(cuid())
  // … other fields …
  workspaceId        String?
  currentWorkspaceId String?   @map("current_workspace_id")  // <-- new
  // … relations …
}
```

Run migration:

```bash
npx prisma migrate dev --name add-current-workspace --schema=packages/database/schema.prisma
```

**Step B — Switch endpoint:** replace `apps/web/app/api/workspaces/switch/route.ts`  

```ts
import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId } = (await req.json()) as { workspaceId?: string };
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Verify membership
  const user = await prismaClient.user.findFirst({
    where: { id: session.user.id, workspaceId },
  });
  if (!user) {
    return NextResponse.json(
      { error: "Not a member of this workspace" },
      { status: 403 }
    );
  }

  // Persist the choice
  await prismaClient.user.update({
    where: { id: session.user.id },
    data: { currentWorkspaceId: workspaceId },
  });

  return NextResponse.json({ message: "Workspace switch updated" });
}
```

**Step C — NextAuth JWT callback:** edit the file that configures NextAuth (e.g. `apps/web/app/api/auth/[...nextauth]/route.ts`).  

Inside the `callbacks` object, add a `jwt` callback that fetches `currentWorkspaceId` from the DB:

```ts
// … inside the NextAuth configuration:
callbacks: {
  async jwt({ token, user }) {
    // On first sign-in, set from user object (if available)
    if (user) {
      token.workspaceId = user.workspaceId;
    }

    // On subsequent token refreshes, read from DB
    if (token.sub) {
      const dbUser = await prismaClient.user.findUnique({
        where: { id: token.sub },
        select: { currentWorkspaceId: true, workspaceId: true },
      });
      if (dbUser) {
        token.workspaceId = dbUser.currentWorkspaceId || dbUser.workspaceId;
      }
    }
    return token;
  },
  async session({ session, token }) {
    if (session.user) {
      session.user.workspaceId = token.workspaceId as string;
    }
    return session;
  },
},
```

**Step D — Workspace switcher component:** after calling the switch endpoint, reload the page to refresh the session:

```ts
await fetch("/api/workspaces/switch", {
  method: "POST",
  body: JSON.stringify({ workspaceId }),
  headers: { "Content-Type": "application/json" },
});
window.location.href = "/";
```

**Test:** Switch workspace → page reloads → subsequent API calls are scoped to the new workspace.

---

### [ ] 2.2 — Sanitise HTML email body (XSS)

**Files:** `packages/email-engine/src/index.ts`, `workers/email-dispatcher/src/index.ts`, `apps/web/app/api/inbox/reply/route.ts`, `workers/imap-sync/src/index.ts`

**Step A — Update `packages/email-engine/src/index.ts`:**

Add imports and helpers at the top:

```ts
import sanitizeHtml from "sanitize-html";

const SAFE_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "b", "i", "strong", "em", "a", "ul", "ol", "li", "blockquote"],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["https", "mailto"],
};

/** Converts plain-text body to safe HTML. Strips all script/event tags. */
export function toSafeHtml(text: string): string {
  return sanitizeHtml(text.replace(/\n/g, "<br>"), SAFE_HTML_OPTIONS);
}

/** Strips ALL tags — use for storing plain-text copies of inbound emails. */
export function toPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
}
```

Then, in the existing `sendEmail` helper (where `html` is set), replace:

```ts
html: body.replace(/\n/g, "<br>"),
```

with

```ts
html: toSafeHtml(body),
```

**Step B — In `workers/email-dispatcher/src/index.ts`:**

Add `toSafeHtml` to the import:

```ts
import { createTransport, generateSpintaxVariant, getWeightedRandomIndex, toSafeHtml } from "@crm/email-engine";
```

Find `sendMail` call and replace:

```ts
html: body.replace(/\n/g, "<br>"),
```

with

```ts
html: toSafeHtml(body),
```

**Step C — In `apps/web/app/api/inbox/reply/route.ts`:**

Add `toSafeHtml` to the import:

```ts
import { createTransport, toSafeHtml } from "@crm/email-engine";
```

Replace:

```ts
html: body.replace(/\n/g, "<br>"),
```

with

```ts
html: toSafeHtml(body),
```

**Step D — In `workers/imap-sync/src/index.ts`:**

Import `toPlainText`:

```ts
import { toPlainText } from "@crm/email-engine";
```

In the message processing block, replace:

```ts
const bodyText = parsed.text || "";
```

with

```ts
const bodyText = toPlainText(parsed.text || parsed.html?.toString() || "");
```

**Test:** Send an inbound email with `<script>alert(1)</script>` in body → open inbox, no alert fires.

---

### [ ] 2.3 — Fix hardcoded LEGACY_SALT

**Files:** `.env.example`, `packages/database/crypto.ts`

**Step A — `.env.example`:** Replace the line:

```
LEGACY_SALT=crm-tool-salt-fixed
```

with:

```
# LEGACY_SALT is only required if you have ciphertexts created before the
# 4-part encryption format was introduced. If unset, legacy decryption is disabled.
# Generate a value with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# WARNING: Never use the default value "crm-tool-salt-fixed" — it is public and insecure.
LEGACY_SALT=
```

**Step B — `packages/database/crypto.ts`:** Replace `validateEncryptionKey()` with:

```ts
function validateEncryptionKey(): void {
  const key = process.env.FERNET_KEY || process.env.ENCRYPTION_KEY;
  if (!key) {
    console.error("[crypto] FERNET_KEY or ENCRYPTION_KEY is not set. Encryption will fail.");
    return;
  }
  if (key.startsWith("replace_") || key.length < 32) {
    console.error("[crypto] FERNET_KEY appears to be a placeholder or too short. Please set a proper 64-char hex key.");
  }

  const legacySalt = process.env.LEGACY_SALT;
  if (legacySalt === "crm-tool-salt-fixed") {
    throw new Error(
      "[crypto] LEGACY_SALT is set to the well-known public default value. " +
      "This is critically insecure. Generate a new random value: " +
      "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  if (legacySalt && legacySalt.length < 32) {
    console.error("[crypto] LEGACY_SALT is shorter than 32 characters. Use a 64-char hex string.");
  }
}
```

**Test:** Set `LEGACY_SALT=crm-tool-salt-fixed` in local `.env` → server refuses to start.

---

### [ ] 2.4 — Replace in-memory rate limiter with Redis-backed store

**File:** `apps/web/lib/rate-limit.ts`

Replace entire file with:

```ts
import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import IORedis from "ioredis";
import { NextRequest, NextResponse } from "next/server";

if (process.env.DISABLE_RATE_LIMIT === "true") {
  console.warn(
    "[rate-limit] WARNING: Rate limiting is disabled via DISABLE_RATE_LIMIT=true. " +
    "Do NOT use this in production."
  );
}

const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,
});

const authLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:auth",
  points: 5,
  duration: 60,
  blockDuration: 300,
});

const apiLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:api",
  points: 100,
  duration: 60,
});

async function consume(
  limiter: RateLimiterRedis,
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; remaining: number; resetAt: number }> {
  if (process.env.DISABLE_RATE_LIMIT === "true") {
    return { success: true, remaining: limit, resetAt: Date.now() + windowMs };
  }
  try {
    const res = await limiter.consume(key);
    return {
      success: true,
      remaining: res.remainingPoints ?? 0,
      resetAt: Date.now() + (res.msBeforeNext ?? windowMs),
    };
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      return {
        success: false,
        remaining: 0,
        resetAt: Date.now() + (err.msBeforeNext ?? windowMs),
      };
    }
    console.error("[rate-limit] Redis error, failing open:", err);
    return { success: true, remaining: limit, resetAt: Date.now() + windowMs };
  }
}

export async function rateLimitAuth(key: string) {
  return consume(authLimiter, key, 5, 60_000);
}

export async function rateLimitApi(key: string) {
  return consume(apiLimiter, key, 100, 60_000);
}

export function withRateLimit(limit: number, windowMs: number) {
  const limiter = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: `rl:custom:${limit}:${windowMs}`,
    points: limit,
    duration: Math.ceil(windowMs / 1000),
  });

  return async (request: NextRequest): Promise<NextResponse | null> => {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    const result = await consume(limiter, ip, limit, windowMs);

    if (!result.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
          },
        }
      );
    }

    return null;
  };
}
```

**Also:** In `apps/web/middleware.ts` and any auth route that calls `rateLimitAuth` or `rateLimitApi`, make sure to `await` them (they are now async).

**Add to `.env.example`:**

```
# Set to "true" ONLY for automated testing — never in production
DISABLE_RATE_LIMIT=
```

**Test:** Send 6 POSTs to `/api/auth/register` from same IP within 60s → 6th returns 429.

---

### [ ] 2.5 — Fix email enumeration timing attack

**File:** `apps/web/app/api/auth/register/route.ts`

**Before:**

```ts
const existing = await prismaClient.user.findFirst({ where: { email } });
if (existing) {
  return NextResponse.json({ error: "Email already registered" }, { status: 409 });
}

const passwordHash = await bcrypt.hash(password, 12);
```

**After:**

```ts
// Hash BEFORE checking existence — equalises response time
const passwordHash = await bcrypt.hash(password, 12);

const existing = await prismaClient.user.findFirst({ where: { email } });
if (existing) {
  return NextResponse.json({ error: "Email already registered" }, { status: 409 });
}
```

**Test:** Measure response times; existing vs new email both ~200ms.

---

### [ ] 2.6 — CSV import: file size limit, row limit, O(n) dedup, batch inserts, correct counts

**File:** `apps/web/app/api/leads/import/route.ts`

This replacement covers tasks 2.6, 3.3, and 3.4. Replace the **entire content after file reading** (from `const file = formData.get("file");` to the final response) with:

```ts
const file = formData.get("file");
if (!file || !(file instanceof File)) {
  return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
}

const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CSV_ROWS = 10_000;
if (file.size > MAX_CSV_BYTES) {
  return NextResponse.json(
    { error: "File too large. Maximum size is 5MB." },
    { status: 413 }
  );
}

// Parse CSV...
const text = await file.text();
const lines = text
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);
const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

if (lines.length < 2) {
  return NextResponse.json(
    { error: "CSV must have a header and at least one data row" },
    { status: 400 }
  );
}
if (lines.length - 1 > MAX_CSV_ROWS) {
  return NextResponse.json(
    { error: `File contains too many rows. Maximum is ${MAX_CSV_ROWS.toLocaleString()}.` },
    { status: 400 }
  );
}

// Parse rows into objects
const rows = lines.slice(1).map((line) => {
  const values = line.split(",");
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => (obj[h] = values[i]?.trim() ?? ""));
  return obj;
});

// Validate emails, build validRows
let skippedCount = 0;
const validRows: Array<{
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
}> = [];

for (const row of rows) {
  const email = row["email"] ?? row["e-mail"] ?? "";
  if (!email) {
    skippedCount++;
    continue;
  }
  validRows.push({
    email,
    firstName: row["first_name"] || row["firstname"] || undefined,
    lastName: row["last_name"] || row["lastname"] || undefined,
    phone: row["phone"] || undefined,
    company: row["company"] || undefined,
  });
}

// Deduplicate within the file itself
const seenInFile = new Set<string>();
const uniqueValidRows: typeof validRows = [];
let inFileDupes = 0;
for (const row of validRows) {
  if (seenInFile.has(row.email)) {
    inFileDupes++;
  } else {
    seenInFile.add(row.email);
    uniqueValidRows.push(row);
  }
}

// Batch company resolution
const uniqueCompanyNames = [
  ...new Set(
    uniqueValidRows.map((r) => r.company).filter((c): c is string => Boolean(c))
  ),
];

const companyMap = new Map<string, string>(); // name.lower → id

if (uniqueCompanyNames.length > 0) {
  const existing = await prismaClient.company.findMany({
    where: {
      workspaceId,
      name: { in: uniqueCompanyNames, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  existing.forEach((c) => companyMap.set(c.name.toLowerCase(), c.id));

  const newNames = uniqueCompanyNames.filter(
    (n) => !companyMap.has(n.toLowerCase())
  );
  if (newNames.length > 0) {
    await prismaClient.company.createMany({
      data: newNames.map((name) => ({ workspaceId, name })),
      skipDuplicates: true,
    });
    const created = await prismaClient.company.findMany({
      where: { workspaceId, name: { in: newNames } },
      select: { id: true, name: true },
    });
    created.forEach((c) => companyMap.set(c.name.toLowerCase(), c.id));
  }
}

// Determine which emails already exist in DB
const incomingEmails = uniqueValidRows.map((r) => r.email);
const existingLeads = await prismaClient.lead.findMany({
  where: { workspaceId, email: { in: incomingEmails } },
  select: { email: true },
});
const existingEmailSet = new Set(existingLeads.map((l) => l.email));

const newLeads = uniqueValidRows.filter((r) => !existingEmailSet.has(r.email));

if (newLeads.length > 0) {
  await prismaClient.lead.createMany({
    data: newLeads.map((r) => ({
      workspaceId,
      email: r.email,
      firstName: r.firstName || null,
      lastName: r.lastName || null,
      phone: r.phone || null,
      status: "raw",
      companyId: r.company
        ? (companyMap.get(r.company.toLowerCase()) ?? null)
        : null,
    })),
    skipDuplicates: true,
  });
}

const created = newLeads.length;
skippedCount += inFileDupes + existingEmailSet.size; // in-file dupes + already in DB

return NextResponse.json({
  message: "Import complete",
  created,
  skipped: skippedCount,
  total: validRows.length, // original valid rows before dedup
});
```

**Test:** Upload a 6MB file → 413. Upload 10,001 rows → 400. Upload 10,000 rows with 500 duplicates (mix of in-file and pre-existing) → correct `created` and `skipped`, execution under 3s.

---

## Phase 3 — Data Integrity & Correctness (~2 days)

### [ ] 3.1 — Fix double-queueing on campaign launch retry

Already handled by 1.3. Verify that launching twice gives exactly one set of BullMQ jobs.

---

### [ ] 3.2 — Fix inbox daily-limit race condition (atomic claim)

**File:** `workers/email-dispatcher/src/index.ts`

Replace the inbox selection block with an atomic `UPDATE … RETURNING`:

```ts
// Atomically claim one inbox slot (increment count within the SELECT transaction)
const claimed = await prismaClient.$queryRaw<{ id: string }[]>`
  UPDATE connected_inboxes
  SET daily_sent_count = daily_sent_count + 1
  WHERE workspace_id = ${queueEntry.workspaceId}
    AND is_active = true
    AND daily_sent_count < max_daily_limit
    AND id = (
      SELECT id FROM connected_inboxes
      WHERE workspace_id = ${queueEntry.workspaceId}
        AND is_active = true
        AND daily_sent_count < max_daily_limit
      ORDER BY daily_sent_count ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
  RETURNING id
`;

if (claimed.length === 0) {
  throw new Error("No available inbox with remaining daily capacity");
}

const inbox = await prismaClient.connectedInbox.findUniqueOrThrow({
  where: { id: claimed[0].id },
});
```

Then, **remove** the separate `prismaClient.connectedInbox.update({ dailySentCount: { increment: 1 } })` that used to come after `sendMail`. The increment has already been done atomically above.  

(Keep the rest of the transaction for campaignQueue, lead, communicationHistory, variantTemplate.)

**Test:** Run 10 concurrent jobs against an inbox with `maxDailyLimit=10`, `dailySentCount=9` → exactly 1 email sent.

---

### [ ] 3.3 & 3.4 — Batch CSV import & fix skippedCount

Already implemented in 2.6. Verify `skippedCount` correctly accounts for in-file and DB‑existing duplicates.

---

### [ ] 3.5 — Change `expectedCloseDate` from String to DateTime

**Files:** `packages/database/schema.prisma`, `packages/shared/src/validators.ts`

**Step A — schema:** in `packages/database/schema.prisma` change

```prisma
expectedCloseDate String?  @map("expected_close_date")
```

to

```prisma
expectedCloseDate DateTime? @map("expected_close_date")
```

**Step B — migration:** (⚠️ If existing data contains non‑date strings, write a custom migration that casts safely.)

```bash
npx prisma migrate dev --name fix-expected-close-date-type --schema=packages/database/schema.prisma
```

**Step C — validator:** in `packages/shared/src/validators.ts` change

```ts
expectedCloseDate: z.string().optional(),
```

to

```ts
expectedCloseDate: z.coerce.date().optional(),
```

**Test:** Create a deal with a date → `SELECT * FROM deals WHERE expected_close_date < NOW()` works without casting.

---

### [ ] 3.6 — Remove PipelineStage unique sortOrder constraint

**Files:** `packages/database/schema.prisma`, add new endpoint.

**Step A — schema:** change

```prisma
@@unique([workspaceId, sortOrder])
```

to

```prisma
@@index([workspaceId, sortOrder])
```

**Step B — migration:**

```bash
npx prisma migrate dev --name remove-stage-sortorder-unique --schema=packages/database/schema.prisma
```

**Step C — new reorder endpoint:** create `apps/web/app/api/pipeline-stages/reorder/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const reorderSchema = z.object({
  stageIds: z.array(z.string().uuid()).min(1),
});

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const body = reorderSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.errors }, { status: 400 });
  }

  const { stageIds } = body.data;

  await prismaClient.$transaction(
    stageIds.map((id, index) =>
      prismaClient.pipelineStage.update({
        where: { id, workspaceId },
        data: { sortOrder: index },
      })
    )
  );

  return NextResponse.json({ success: true });
}
```

**Test:** Reorder stages via API; no unique constraint errors.

---

### [ ] 3.7 — Fix daily-reset idempotency

**File:** `apps/web/app/api/cron/daily-reset/route.ts`

Replace entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { Queue } from "bullmq";
import { QueueName } from "@crm/shared";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function parseRedisUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "localhost",
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      db: parsed.pathname ? Number(parsed.pathname.slice(1)) || 0 : 0,
    };
  } catch {
    return { host: "localhost", port: 6379, password: undefined, db: 0 };
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todayUTC = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `crm:cron:daily-reset:${todayUTC}`;

  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });

  try {
    const acquired = await redis.set(idempotencyKey, "1", "EX", 86400, "NX");
    if (!acquired) {
      console.log(`[daily-reset] Already ran for ${todayUTC}, skipping.`);
      return NextResponse.json({ message: "Already reset today", date: todayUTC });
    }

    const resetResult = await prismaClient.connectedInbox.updateMany({
      where: { isActive: true },
      data: { dailySentCount: 0 },
    });

    const inboxes = await prismaClient.connectedInbox.findMany({
      where: { warmupEnabled: true, isActive: true },
      select: { id: true },
    });

    const redisOpts = parseRedisUrl(REDIS_URL);
    const warmupQueue = new Queue(QueueName.WARMUP, { connection: redisOpts });

    for (const inbox of inboxes) {
      await warmupQueue.add(
        "warmup-daily",
        { inboxId: inbox.id },
        {
          jobId: `warmup-${inbox.id}-${todayUTC}`,
          attempts: 2,
          backoff: { type: "exponential", delay: 60000 },
        }
      );
    }

    await warmupQueue.close();

    return NextResponse.json({
      message: "Daily reset complete",
      date: todayUTC,
      inboxesReset: resetResult.count,
      warmupJobsQueued: inboxes.length,
    });
  } finally {
    await redis.quit();
  }
}
```

**Test:** Call endpoint twice → second returns “Already reset today”, no duplicate warmup jobs.

---

### [ ] 3.8 — Fix IMAP stream error: pending promises never resolve

**File:** `workers/imap-sync/src/index.ts`

Replace the `messageFetcher.on("message", ...)` handler with:

```ts
const MESSAGE_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

messageFetcher.on("message", (msg: any, seqno: number) => {
  const promise = withTimeout(
    new Promise<void>((resolve, reject) => {
      const bodyChunks: Buffer[] = [];
      msg.on("body", (stream: NodeJS.ReadableStream) => {
        stream.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", async () => {
          try {
            const raw = Buffer.concat(bodyChunks).toString("utf8");
            const parsed = await simpleParser(raw);

            if (parsed.headers?.get("x-crm-warmup") === "true") {
              resolve();
              return;
            }

            const fromAddr = parsed.from?.value?.[0]?.address || "";
            const subject = parsed.subject || "";
            const bodyText = parsed.text || "";
            const messageId = parsed.messageId || null;

            // ... rest of processing unchanged ...

            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
      msg.once("error", reject);
    }),
    MESSAGE_TIMEOUT_MS,
    `message seqno=${seqno}`
  );
  messages.push(promise);
});
```

**Test:** Simulate network drop mid-stream → worker slot released within 30s.

---

## Phase 4 — Code Quality & Architecture (~2 days)

### [ ] 4.1 — Wire up audit logging

Add `import { auditLog } from "@crm/database";` at the top of each listed route, and after any successful DB write:

```ts
auditLog({
  workspaceId,
  userId: session.user.id,
  action: "lead.create",   // change per route
  entity: "Lead",          // change per route
  entityId: lead.id,       // change per route
  ip: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
}).catch(() => {}); // non-blocking
```

**Routes to update:**

| Route | Action | Entity |
|-------|--------|--------|
| `POST /api/auth/register` | `user.register` | `User` |
| NextAuth `authorize` callback | `user.login` | `User` |
| `POST /api/leads` | `lead.create` | `Lead` |
| `POST /api/leads/import` | `lead.import` | `Lead` |
| `POST /api/campaigns/[id]/launch` | `campaign.launch` | `Campaign` |
| `PATCH /api/campaigns/[id]` | `campaign.pause` | `Campaign` |
| `POST /api/deals` | `deal.create` | `Deal` |
| `PATCH /api/deals/[id]/move` | `deal.move` | `Deal` |
| `POST /api/inboxes` | `inbox.create` | `ConnectedInbox` |
| `DELETE /api/inboxes/[id]` | `inbox.delete` | `ConnectedInbox` |

**Test:** Create a lead → `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 1` shows a row.

---

### [ ] 4.2 — Consolidate `parseRedisUrl` into shared package

**Create `packages/shared/src/redis.ts`:**

```ts
import IORedis from "ioredis";

export function parseRedisUrl(url: string): {
  host: string;
  port: number;
  password?: string;
  db?: number;
} {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "localhost",
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      db: parsed.pathname ? Number(parsed.pathname.slice(1)) || 0 : 0,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

let _singleton: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!_singleton) {
    _singleton = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  }
  return _singleton;
}
```

**Export from `packages/shared/src/index.ts`:**

```ts
export { parseRedisUrl, getRedisConnection } from "./redis";
```

**Replace local `parseRedisUrl` functions** in these files with `import { parseRedisUrl } from "@crm/shared";`:

- `apps/web/app/api/campaigns/[id]/launch/route.ts`
- `apps/web/app/api/cron/daily-reset/route.ts`
- `apps/web/app/api/cron/dns-check/route.ts`
- `apps/web/app/api/cron/imap-sync/route.ts`

**Test:** Build passes, launch still works.

---

### [ ] 4.3 — Add authentication to Bull Board

**File:** `workers/bull-board/src/index.ts`

Add before the board adapter:

```ts
import basicAuth from "express-basic-auth";

const boardUser = process.env.BULL_BOARD_USER;
const boardPass = process.env.BULL_BOARD_PASS;

if (!boardUser || !boardPass) {
  console.warn(
    "[bull-board] WARNING: BULL_BOARD_USER / BULL_BOARD_PASS are not set. " +
    "The board is unprotected. Set these environment variables."
  );
} else {
  app.use(
    basicAuth({
      users: { [boardUser]: boardPass },
      challenge: true,
      realm: "CRM Bull Board",
    })
  );
}
```

**Add to `.env.example`:**

```
BULL_BOARD_USER=admin
BULL_BOARD_PASS=replace_with_strong_password
```

**Test:** Open `http://localhost:3010` → login prompt appears.

---

### [ ] 4.4 — Delete duplicate schema file

- Delete `apps/web/schema.prisma`
- In `apps/web/package.json`, update scripts:

```json
{
  "scripts": {
    "db:generate": "prisma generate --schema=../../packages/database/schema.prisma",
    "db:migrate": "prisma migrate dev --schema=../../packages/database/schema.prisma",
    "db:studio": "prisma studio --schema=../../packages/database/schema.prisma"
  }
}
```

- Add to `apps/web/.gitignore`:

```
schema.prisma
```

**Test:** `npm run db:generate` from `apps/web` targets the correct schema.

---

### [ ] 4.5 — Fix nodemailer transport pooling misuse

**Files:** `packages/email-engine/src/index.ts`, `workers/email-dispatcher/src/index.ts`

**Step A — In email-engine, change `createTransport` options:** remove `pool: true` and `maxConnections: 5`, add timeouts:

```ts
return nodemailer.createTransport({
  host: inbox.smtpHost,
  port: inbox.smtpPort,
  secure: inbox.smtpPort === 465,
  auth: { user: inbox.smtpUser, pass: smtpPass },
  connectionTimeout: 15_000,
  greetingTimeout: 10_000,
});
```

**Step B — In dispatcher, add transport cache:**

```ts
const transportCache = new Map<string, ReturnType<typeof createTransport>>();

function getOrCreateTransport(inbox: { id: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPassEncrypted: string }) {
  if (!transportCache.has(inbox.id)) {
    transportCache.set(inbox.id, createTransport(inbox)); // assumes createTransport decrypts smtpPassEncrypted
  }
  return transportCache.get(inbox.id)!;
}
```

Replace per‑job transport creation:

```ts
const transport = getOrCreateTransport(inbox);
await transport.sendMail({ ... });
```

Add to graceful shutdown:

```ts
for (const transport of transportCache.values()) {
  try { transport.close(); } catch {}
}
transportCache.clear();
```

**Test:** Multiple jobs reuse the same transport; SMTP connections are not re‑established each time.

---

### [ ] 4.6 — Fix spintax parser: nested braces

**File:** `packages/email-engine/src/index.ts`

Replace `parseSpintax` function:

```ts
export function parseSpintax(text: string): string {
  const INNER_RE = /\{([^{}]+)\}/g;
  let result = text;
  let depth = 0;

  while (depth < 10) {
    const next = result.replace(INNER_RE, (_, choices) => {
      const opts = choices.split("|");
      return opts[Math.floor(Math.random() * opts.length)];
    });
    if (next === result) break;
    result = next;
    depth++;
  }

  return result;
}
```

**Test:**

```ts
parseSpintax("{Hi|Hello {there|friend}}") // returns one of "Hi", "Hello there", "Hello friend"
parseSpintax("{unclosed") // does not throw
```

---

### [ ] 4.7 — Fix ciphertext validity check in test-connection

**File:** `apps/web/app/api/test-connection/route.ts`

Replace the `isValidCiphertext` function:

```ts
const isValidCiphertext = (s: string): boolean => {
  if (!s) return false;
  const parts = s.split(":");
  return (
    parts.length === 4 &&
    parts[0].length === 32 &&
    parts[1].length === 32 &&
    parts[2].length === 32 &&
    parts[3].length >= 32
  );
};
```

**Test:** Encrypt a 100‑character password; endpoint uses ciphertext, not plaintext.

---

### [ ] 4.8 — Move e2e scripts to proper directories

```bash
mkdir -p tests/e2e scripts
mv e2e.js tests/e2e/e2e.test.js
mv apps/web/e2e_full.js tests/e2e/e2e.full.test.js
mv apps/web/e2e_test.js tests/e2e/e2e.smoke.test.js
mv apps/web/fix-imports.js scripts/fix-imports.js
```

**Add to `.dockerignore`:**

```
tests/
scripts/
**/e2e_*.js
**/e2e.js
```

**Test:** Build Docker image → `/app/tests` directory not present.

---

### [ ] 4.9 — Fix CSRF validation ordering in middleware

**File:** `apps/web/middleware.ts`

Re‑order the middleware so CSRF check runs before auth:

```ts
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Rate limit (existing)

  // 2. CSRF check on mutating methods for non-public routes
  const CSRF_SAFE = ["GET", "HEAD", "OPTIONS"];
  const isPublicPath = PUBLIC_PATHS.some((p) =>
    typeof p === "string" ? pathname.startsWith(p) : p.test(pathname)
  );

  if (!CSRF_SAFE.includes(request.method) && !isPublicPath) {
    if (!validateOrigin(request)) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
  }

  // 3. Auth check (existing)
}
```

**Update `validateOrigin` to include `Referer` fallback:**

```ts
function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const allowedHosts = [
    host,
    process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).host : null,
  ].filter(Boolean);

  if (!origin) {
    const referer = request.headers.get("referer");
    if (!referer) return true; // direct same-site browser request
    try {
      const refHost = new URL(referer).host;
      return allowedHosts.some((h) => h && refHost === h);
    } catch {
      return false;
    }
  }

  try {
    const originHost = new URL(origin).host;
    return allowedHosts.some((h) => h && originHost === h);
  } catch {
    return false;
  }
}
```

**Test:** POST `/api/leads` with `Origin: https://evil.com` → 403. Correct origin → allowed.

---

## Migrations

Run all after applying schema changes:

```bash
npx prisma migrate dev --schema=packages/database/schema.prisma
```

| Migration | Task | Risk |
|-----------|------|------|
| `add-sent-at-default` | 1.2 | Safe |
| `add-current-workspace` | 2.1 | Safe (nullable column) |
| `fix-expected-close-date-type` | 3.5 | Medium — invalid existing strings will error |
| `remove-stage-sortorder-unique` | 3.6 | Safe |

---

## Final Checklist

- [ ] All code changes applied
- [ ] Migrations run
- [ ] Manual tests passed for each task
- [ ] Audit log entries appear
- [ ] Rate limiting works
- [ ] CSV import counts are correct
- [ ] Campaign launch is idempotent
- [ ] Workspace switch persists and token reflects it
- [ ] Daily inbox limit atomic claim prevents over‑send

```
