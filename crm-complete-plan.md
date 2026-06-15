# CRM — Complete Implementation Plan
**Repository:** `tkvardaq/Crm`  
**Audit:** Every file across 8 workers · 25 API routes · 6 packages · middleware · auth · schema · infra  
**Total issues:** 44 verified bugs + 1 new feature (lead scraper)  
**Estimated effort:** 7–8 engineering days

---

## Severity Key

| Icon | Level |
|------|-------|
| 🔴 | Critical — active crash, data loss, or security breach |
| 🟠 | High — wrong behaviour under real load or exploitable |
| 🟡 | Medium — correctness / reliability problem |
| 🔵 | Low — quality, performance, maintainability |

---

## Phase 0 — Two-Line Crashes (fix in the next 30 minutes)

These are production outages right now. No refactoring required — single-line fixes.

---

### [ ] 0.1 — imap-sync: `workspaceId` never destructured — every IMAP sync job silently fails
🔴 `workers/imap-sync/src/index.ts:48`

**Before:**
```ts
const { inboxId } = job.data;
```
**After:**
```ts
const { inboxId, workspaceId } = job.data;
```
**Why:** `workspaceId` is declared in `ImapSyncJobData` but never extracted. Every Prisma query gets `undefined` as `workspaceId`, finds nothing, and silently skips all inbound mail.

---

### [ ] 0.2 — Middleware rate-limiting never runs — `await` missing on both calls
🔴 `apps/web/middleware.ts:46,51`

`rateLimitAuth` and `rateLimitApi` are both `async` functions. The middleware calls them without `await`, receiving a `Promise` object — which is always truthy. `result.success` is `undefined`. The `if (!result.success)` check always passes. Rate limiting is dead.

**Before:**
```ts
const result = rateLimitAuth(ip);
if (!result.success) { ... }
// ...
const result = rateLimitApi(ip);
if (!result.success) { ... }
```
**After:**
```ts
const result = await rateLimitAuth(ip);
if (!result.success) { ... }
// ...
const result = await rateLimitApi(ip);
if (!result.success) { ... }
```

---

### [ ] 0.3 — Email dispatcher: `sentAt` missing — every post-send transaction silently rolls back
🔴 `workers/email-dispatcher/src/index.ts`

`CommunicationHistory.sentAt` is `DateTime` with no `@default`. The `create` call omits it. Prisma throws `PrismaClientValidationError` inside the transaction on every send. The email goes out but: `daily_sent_count` never increments, `communication_history` row is never written, lead status never advances.

**Step A — add to `communicationHistory.create` data object:**
```ts
sentAt: new Date(),
```

**Step B — add safety-net default in schema:**
```prisma
sentAt DateTime @default(now()) @map("sent_at")
```

**Step C:**
```bash
npx prisma migrate dev --name add-sent-at-default --schema=packages/database/schema.prisma
```

---

## Phase 1 — Security (complete before first real user)

---

### [ ] 1.1 — Campaign launch: DB mutated before request is parsed or validated
🔴 `apps/web/app/api/campaigns/[id]/launch/route.ts`

Current order: fetch → check status → **set ACTIVE in DB** → check steps exist → check variants → **then** parse `req.json()`. Any error after step 3 leaves the campaign stuck in ACTIVE with zero queue entries.

**Correct order of operations (full handler replacement):**
```ts
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = session.user.workspaceId;
  const campaignId = params.id;

  // 1. Parse body FIRST
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const parsed = campaignLaunchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors }, { status: 400 });

  // 2. Read campaign — no state change yet
  const campaign = await prismaClient.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { steps: { include: { variants: true }, orderBy: { stepNumber: "asc" } } },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status !== CampaignStatus.DRAFT && campaign.status !== CampaignStatus.PAUSED)
    return NextResponse.json({ error: "Campaign must be DRAFT or PAUSED to launch" }, { status: 400 });

  // 3. Validate structure BEFORE touching status
  if (!campaign.steps.length)
    return NextResponse.json({ error: "Campaign has no steps" }, { status: 400 });
  if (!campaign.steps[0].variants?.length)
    return NextResponse.json({ error: "First step has no variants" }, { status: 400 });

  // 4. Resolve leads
  const { leadIds } = parsed.data;
  const leads = leadIds.length
    ? await prismaClient.lead.findMany({ where: { id: { in: leadIds }, workspaceId, isOptedOut: false } })
    : await prismaClient.lead.findMany({ where: { workspaceId, isOptedOut: false, status: { in: ["raw","enriched"] } } });
  if (!leads.length) return NextResponse.json({ error: "No eligible leads" }, { status: 400 });

  const now = new Date();
  const allEntries: { id: string; scheduledFor: Date }[] = [];

  // 5. Atomic: status update + queue creation in one transaction
  await prismaClient.$transaction(async (tx) => {
    const updated = await tx.campaign.updateMany({
      where: { id: campaignId, workspaceId, status: campaign.status },
      data: { status: CampaignStatus.ACTIVE },
    });
    if (!updated.count) throw new Error("CONFLICT");

    for (let si = 0; si < campaign.steps.length; si++) {
      const step = campaign.steps[si];
      const delayMs = si === 0 ? 0 : step.delayDays * 86_400_000;
      for (let li = 0; li < leads.length; li++) {
        const entry = await tx.campaignQueue.create({
          data: {
            workspaceId, campaignId, campaignStepId: step.id, leadId: leads[li].id,
            scheduledFor: new Date(now.getTime() + delayMs + li * 2000),
            status: "pending",
          },
          select: { id: true, scheduledFor: true },
        });
        allEntries.push(entry);
      }
    }
  });

  // 6. Enqueue BullMQ with jobId deduplication — idempotent on retry
  const queue = new Queue(QueueName.EMAIL_DISPATCH, { connection: parseRedisUrl(REDIS_URL) });
  try {
    for (const entry of allEntries) {
      await queue.add("dispatch", { campaignQueueId: entry.id }, {
        jobId: entry.id,  // BullMQ ignores duplicate IDs on retry
        delay: Math.max(0, entry.scheduledFor.getTime() - Date.now()),
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      });
    }
  } finally {
    await queue.close();
  }

  return NextResponse.json({ message: "Campaign launched", leadsCount: leads.length });
}
```

---

### [ ] 1.2 — Workspace-switch: JWT never updates — broken access control
🔴 `apps/web/app/api/workspaces/switch/route.ts`, `apps/web/lib/auth.ts`

Endpoint validates membership but only returns `{ message: "Workspace switched" }`. JWT is never re-issued. All subsequent requests still use the original workspace.

**Fix A — write a short-lived cookie in the switch endpoint:**
```ts
import { serialize } from "cookie";

// After membership verification, replace the return:
const cookie = serialize("next-workspace", workspaceId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 30,  // 30 seconds — consumed on next request
});
const res = NextResponse.json({ message: "Workspace switch initiated" });
res.headers.set("Set-Cookie", cookie);
return res;
```

**Fix B — consume the cookie in the NextAuth `jwt` callback (`apps/web/lib/auth.ts`):**
```ts
async jwt({ token, user, req }) {
  if (user) {
    token.id = user.id;
    token.workspaceId = user.workspaceId;
    token.role = user.role;
  }
  // Consume one-time workspace-switch cookie
  const switchTo = (req as any)?.cookies?.["next-workspace"];
  if (switchTo && token.sub) {
    const member = await prismaClient.user.findFirst({
      where: { id: String(token.sub), workspaceId: switchTo },
    });
    if (member) token.workspaceId = switchTo;
  }
  return token;
},
```

**Fix C — force full page reload in the frontend component after calling the switch endpoint:**
```ts
await fetch("/api/workspaces/switch", { method: "POST", body: JSON.stringify({ workspaceId }), headers: { "Content-Type": "application/json" } });
window.location.href = "/";  // forces NextAuth to re-evaluate jwt callback
```

---

### [ ] 1.3 — XSS via unsanitised HTML in all email paths
🔴 `workers/email-dispatcher`, `apps/web/app/api/inbox/reply/route.ts`, `workers/imap-sync`, `workers/warmup`

`body.replace(/\n/g, "<br>")` is used as raw HTML with no sanitisation. Inbound emails stored in `communication_history` and displayed in the inbox UI can execute JS.

```bash
npm install sanitize-html @types/sanitize-html --workspace=packages/email-engine
```

**Add to `packages/email-engine/src/index.ts`:**
```ts
import sanitizeHtml from "sanitize-html";

const SAFE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p","br","b","i","strong","em","a","ul","ol","li","blockquote","pre","code"],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["https", "mailto"],
};

export const toSafeHtml = (text: string) =>
  sanitizeHtml(text.replace(/\n/g, "<br>"), SAFE_OPTIONS);

export const toPlainText = (html: string) =>
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
```

**Replace every** `body.replace(/\n/g, "<br>")` in dispatcher, reply route, and warmup worker with `toSafeHtml(body)`.

**In imap-sync**, sanitise before storing inbound body:
```ts
import { toPlainText } from "@crm/email-engine";
bodyText: toPlainText(parsed.text || parsed.html?.toString() || ""),
```

---

### [ ] 1.4 — Apollo & Hunter API keys leak into server logs via URL query strings
🔴 `workers/enrichment-worker/src/index.ts:60,72,96,108,119`

```ts
// CURRENT — api_key appears in URL, logged by every proxy and access log:
`https://api.apollo.io/v1/organizations/enrich?domain=${domain}&api_key=${process.env.APOLLO_API_KEY}`
`https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${process.env.HUNTER_API_KEY}`
```

**After — use headers instead, and add timeout to `fetchWithTimeout`:**
```ts
async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally { clearTimeout(id); }
}

// Apollo calls:
const res = await fetchWithTimeout(
  `https://api.apollo.io/v1/organizations/enrich?domain=${domain}`, 8000,
  { headers: { "X-Api-Key": process.env.APOLLO_API_KEY! } }
);

const res = await fetchWithTimeout(
  `https://api.apollo.io/v1/people/match?email=${email}`, 8000,
  { headers: { "X-Api-Key": process.env.APOLLO_API_KEY! } }
);

// Hunter calls:
const res = await fetchWithTimeout(
  `https://api.hunter.io/v2/domain-search?domain=${domain}`, 8000,
  { headers: { "Authorization": `Bearer ${process.env.HUNTER_API_KEY}` } }
);
```

---

### [ ] 1.5 — Scraper-worker: no URL validation — SSRF to internal network
🔴 `workers/scraper-worker/src/index.ts`

Any lead or campaign job can enqueue a scraper job with `url: "http://169.254.169.254/latest/meta-data/"` (AWS metadata), `url: "http://postgres:5432"`, or `url: "http://redis:6379"`. No validation exists.

**Add at the top of `processScraper`:**
```ts
import { URL } from "url";

const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;

function assertSafeUrl(raw: string): void {
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new Error(`Invalid URL: ${raw}`); }

  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error(`Blocked protocol: ${parsed.protocol}`);

  if (BLOCKED.test(parsed.hostname))
    throw new Error(`Blocked internal host: ${parsed.hostname}`);
}

async function processScraper(job: Job<ScraperJobData>) {
  const { url, workspaceId, leadId, companyId, proxy } = job.data;
  assertSafeUrl(url);  // must be first line
  // ... rest unchanged
}
```

---

### [ ] 1.6 — Hardcoded `LEGACY_SALT=crm-tool-salt-fixed` — all legacy ciphertexts trivially attackable
🔴 `.env.example`, `packages/database/crypto.ts`

`.env.example`:
```
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
LEGACY_SALT=
```

**Add to `validateEncryptionKey()` in `packages/database/crypto.ts`:**
```ts
if (process.env.LEGACY_SALT === "crm-tool-salt-fixed") {
  throw new Error("[crypto] LEGACY_SALT is set to the public default — critical security risk. Generate a new value.");
}
```

---

### [ ] 1.7 — Rate limiter is in-memory per-process and silently bypassed in development
🟠 `apps/web/lib/rate-limit.ts`

In-memory `Map` means N Docker replicas = N × limit effective ceiling. `NODE_ENV === "development"` bypass fully disables protection.

```bash
npm install rate-limiter-flexible --workspace=apps/web
```

**Replace entire `apps/web/lib/rate-limit.ts`:**
```ts
import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import IORedis from "ioredis";

const DISABLE = process.env.DISABLE_RATE_LIMIT === "true";
if (DISABLE) console.warn("[rate-limit] Rate limiting DISABLED — not for production");

const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: true,
});

const authLimiter = new RateLimiterRedis({
  storeClient: redis, keyPrefix: "rl:auth", points: 5, duration: 60, blockDuration: 300,
});
const apiLimiter = new RateLimiterRedis({
  storeClient: redis, keyPrefix: "rl:api", points: 100, duration: 60,
});

async function consume(limiter: RateLimiterRedis, key: string, limit: number, windowMs: number) {
  if (DISABLE) return { success: true, remaining: limit, resetAt: Date.now() + windowMs };
  try {
    const res = await limiter.consume(key);
    return { success: true, remaining: res.remainingPoints ?? 0, resetAt: Date.now() + (res.msBeforeNext ?? windowMs) };
  } catch (err) {
    if (err instanceof RateLimiterRes)
      return { success: false, remaining: 0, resetAt: Date.now() + (err.msBeforeNext ?? windowMs) };
    // Redis unavailable — fail open, log the error
    console.error("[rate-limit] Redis error, failing open:", err);
    return { success: true, remaining: limit, resetAt: Date.now() + windowMs };
  }
}

export async function rateLimitAuth(key: string) { return consume(authLimiter, key, 5, 60_000); }
export async function rateLimitApi(key: string)  { return consume(apiLimiter, key, 100, 60_000); }
```

---

### [ ] 1.8 — Email enumeration timing attack at registration
🟠 `apps/web/app/api/auth/register/route.ts`

Returns 409 before hashing. Existing emails ~5ms, new emails ~200ms. Trivially automatable.

**Before:**
```ts
const existing = await prismaClient.user.findFirst({ where: { email } });
if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 });
const passwordHash = await bcrypt.hash(password, 12);
```
**After:**
```ts
const passwordHash = await bcrypt.hash(password, 12);  // always hash first
const existing = await prismaClient.user.findFirst({ where: { email } });
if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 });
```

---

### [ ] 1.9 — Inbox email uniqueness scoped globally, not per-workspace
🟠 `apps/web/app/api/inboxes/route.ts:59`

**Before:**
```ts
const existing = await prismaClient.connectedInbox.findFirst({
  where: { email: { equals: email, mode: "insensitive" } },
});
```
**After:**
```ts
const existing = await prismaClient.connectedInbox.findFirst({
  where: { email: { equals: email, mode: "insensitive" }, workspaceId },
});
```

---

### [ ] 1.10 — CSRF validation runs after auth check
🟠 `apps/web/middleware.ts`

`validateOrigin()` is called after `getToken()`. Move it before, for all mutating methods on non-public routes:

```ts
// After rate-limit block, BEFORE isPublic check and token check:
if (!CSRF_SAFE_METHODS.includes(request.method) && !isPublic) {
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
}
```

Also update `validateOrigin` to check `Referer` when `Origin` is absent:
```ts
if (!origin) {
  const referer = request.headers.get("referer");
  if (!referer) return true;
  try {
    return allowedHosts.some(h => h && new URL(referer).host === h);
  } catch { return false; }
}
```

---

### [ ] 1.11 — `ai-worker`: `communicationHistory.update` missing `workspaceId` scope
🟡 `workers/ai-worker/src/index.ts:79`

**Before:**
```ts
await prismaClient.communicationHistory.update({
  where: { id: communicationHistoryId },
  data: { sentiment },
});
```
**After:**
```ts
await prismaClient.communicationHistory.update({
  where: { id: communicationHistoryId, workspaceId },
  data: { sentiment },
});
```

---

### [ ] 1.12 — Bull Board: no authentication
🟡 `workers/bull-board/src/index.ts`

```bash
npm install express-basic-auth --workspace=workers/bull-board
```
```ts
import basicAuth from "express-basic-auth";
const u = process.env.BULL_BOARD_USER;
const p = process.env.BULL_BOARD_PASS;
if (!u || !p) console.warn("[bull-board] UNPROTECTED — set BULL_BOARD_USER and BULL_BOARD_PASS");
else app.use(basicAuth({ users: { [u]: p }, challenge: true }));
```

---

### [ ] 1.13 — Docker: default `changeme` passwords silently used in production
🟠 `docker-compose.yml`

**Before:**
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
REDIS_PASSWORD:    ${REDIS_PASSWORD:-changeme}
```
**After (`:?` syntax causes immediate startup failure if unset):**
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in environment}
REDIS_PASSWORD:    ${REDIS_PASSWORD:?REDIS_PASSWORD must be set in environment}
```
Also update the Redis healthcheck (uses the password):
```yaml
test: ["CMD-SHELL", "redis-cli -a \"${REDIS_PASSWORD}\" ping"]
```

---

## Phase 2 — Data Integrity (~2 days)

---

### [ ] 2.1 — Campaign launch re-queries pending entries — double-queuing on retry
🟠 `apps/web/app/api/campaigns/[id]/launch/route.ts`

Resolved by the Phase 1.1 rewrite which uses `create` (returning IDs) instead of `createMany` + re-query, and passes `jobId: entry.id` to BullMQ.

**Verify:** Call launch twice. Confirm BullMQ job count = `leads.length`, not `2 × leads.length`.

---

### [ ] 2.2 — Inbox daily-limit race condition — can exceed limit by concurrency factor
🟡 `workers/email-dispatcher/src/index.ts`

With `concurrency: 10`, all 10 workers read `dailySentCount` before any increment. Inbox at 49/50 can dispatch 10 emails simultaneously.

**Replace inbox selection with atomic `SELECT FOR UPDATE SKIP LOCKED`:**
```ts
// Reserve one inbox slot atomically
const claimed = await prismaClient.$queryRaw<{ id: string }[]>`
  SELECT id FROM connected_inboxes
  WHERE workspace_id = ${queueEntry.workspaceId}::uuid
    AND is_active = true
    AND daily_sent_count < max_daily_limit
  ORDER BY daily_sent_count ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
`;
if (!claimed.length) throw new Error("No available inbox");

// Increment BEFORE sending (atomic reservation)
await prismaClient.connectedInbox.update({
  where: { id: claimed[0].id },
  data: { dailySentCount: { increment: 1 } },
});

const inbox = await prismaClient.connectedInbox.findUniqueOrThrow({ where: { id: claimed[0].id } });
```

---

### [ ] 2.3 — CSV import: N+1 transaction queries (2–3 queries per row)
🟠 `apps/web/app/api/leads/import/route.ts`

1,000-row CSV = ~3,000 sequential queries inside one open transaction. Must be 4 queries total.

**Also add size and row limits before any parsing:**
```ts
if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "File exceeds 5MB" }, { status: 413 });
// After splitting lines:
if (lines.length - 1 > 10_000) return NextResponse.json({ error: "Max 10,000 rows per import" }, { status: 400 });
```

**Replace the entire transaction block:**
```ts
// 1. Batch-resolve companies (2 queries)
const uniqueNames = [...new Set(validRows.map(r => r.company).filter(Boolean) as string[])];
const coMap = new Map<string, string>();

if (uniqueNames.length) {
  const existing = await prismaClient.company.findMany({
    where: { workspaceId, name: { in: uniqueNames, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  existing.forEach(c => coMap.set(c.name.toLowerCase(), c.id));

  const newNames = uniqueNames.filter(n => !coMap.has(n.toLowerCase()));
  if (newNames.length) {
    await prismaClient.company.createMany({
      data: newNames.map(name => ({ workspaceId, name })), skipDuplicates: true,
    });
    const created = await prismaClient.company.findMany({
      where: { workspaceId, name: { in: newNames } }, select: { id: true, name: true },
    });
    created.forEach(c => coMap.set(c.name.toLowerCase(), c.id));
  }
}

// 2. Pre-check existing leads for accurate count (1 query)
const existingEmails = new Set(
  (await prismaClient.lead.findMany({
    where: { workspaceId, email: { in: validRows.map(r => r.email) } },
    select: { email: true },
  })).map(l => l.email)
);

const toInsert = validRows.filter(r => !existingEmails.has(r.email));
skippedCount += existingEmails.size;

// 3. Bulk insert (1 query)
if (toInsert.length) {
  await prismaClient.lead.createMany({
    data: toInsert.map(r => ({
      workspaceId, email: r.email,
      firstName: r.firstName || null, lastName: r.lastName || null,
      phone: r.phone || null, status: "raw",
      companyId: r.company ? (coMap.get(r.company.toLowerCase()) ?? null) : null,
    })),
    skipDuplicates: true,
  });
}
created = toInsert.length;
```

**Also replace the O(n²) duplicate check:**
```ts
const seenEmails = new Set<string>();
// Inside the row loop, replace validRows.some():
if (seenEmails.has(email)) { skippedCount++; continue; }
seenEmails.add(email);
```

---

### [ ] 2.4 — Decay-tracker: two sequential `lead.update` calls on the same row
🟡 `workers/decay-tracker/src/index.ts:59-70`

**Before:**
```ts
await prismaClient.lead.update({ where: { id: lead.id }, data: { score: newScore } });
decayed++;
if (newScore <= COLD_THRESHOLD && lead.status === "contacted") {
  await prismaClient.lead.update({ where: { id: lead.id }, data: { status: "raw" } });
}
```
**After:**
```ts
const goesStale = newScore <= COLD_THRESHOLD && lead.status === "contacted";
await prismaClient.lead.update({
  where: { id: lead.id },
  data: { score: newScore, ...(goesStale ? { status: "raw" } : {}) },
});
decayed++;
```

---

### [ ] 2.5 — Decay-tracker: N individual `update` calls per workspace — should be bulk
🟡 `workers/decay-tracker/src/index.ts`

50,000 leads = 50,000 DB round trips per cron run.

```ts
const updates = leads
  .map(lead => {
    const days = Math.floor((Date.now() - lead.updatedAt.getTime()) / 86_400_000);
    if (days < 1) return null;
    const decay = (DECAY_RULES[lead.status] ?? -1) * days;
    if (!decay) return null;
    const newScore = Math.max(0, Math.min(100, lead.score + decay));
    if (newScore === lead.score) return null;
    return { id: lead.id, newScore, status: lead.status };
  })
  .filter((u): u is { id: string; newScore: number; status: string } => u !== null);

if (updates.length) {
  await prismaClient.$executeRaw`
    UPDATE leads SET score = CASE id
      ${Prisma.join(updates.map(u => Prisma.sql`WHEN ${u.id}::uuid THEN ${u.newScore}`))}
    END, updated_at = NOW()
    WHERE id IN (${Prisma.join(updates.map(u => Prisma.sql`${u.id}::uuid`))})
  `;

  const staleIds = updates.filter(u => u.newScore <= COLD_THRESHOLD && u.status === "contacted").map(u => u.id);
  if (staleIds.length) {
    await prismaClient.lead.updateMany({ where: { id: { in: staleIds } }, data: { status: "raw" } });
  }
}
```

---

### [ ] 2.6 — AI-worker: N individual `campaignQueue.update` calls for OOF rescheduling
🟡 `workers/ai-worker/src/index.ts:114-122`

**Before:**
```ts
for (const entry of pendingEntries) {
  await prismaClient.campaignQueue.update({
    where: { id: entry.id, workspaceId },
    data: { scheduledFor: newDate },
  });
}
```
**After:**
```ts
await prismaClient.$executeRaw`
  UPDATE campaign_queue
  SET scheduled_for = scheduled_for + INTERVAL '3 days'
  WHERE lead_id = ${comm.leadId}::uuid
    AND workspace_id = ${workspaceId}::uuid
    AND status = 'pending'
`;
```

---

### [ ] 2.7 — Enrichment-worker: `company.create` not `upsert` — race condition crashes concurrent jobs
🟡 `workers/enrichment-worker/src/index.ts:177`

**Before:**
```ts
const company = await prismaClient.company.create({
  data: { workspaceId, name: result.company, domain },
});
```
**After:**
```ts
const company = await prismaClient.company.upsert({
  where: { workspaceId_domain: { workspaceId, domain } },
  create: { workspaceId, name: result.company, domain },
  update: {},
});
```
> **Note:** Requires `@@unique([workspaceId, domain])` on Company. Add the constraint:
```prisma
@@unique([workspaceId, domain])
```
```bash
npx prisma migrate dev --name add-company-workspace-domain-unique --schema=packages/database/schema.prisma
```

---

### [ ] 2.8 — Daily-reset cron not idempotent — duplicate firing sends double warmup emails
🟡 `apps/web/app/api/cron/daily-reset/route.ts`

```ts
const todayKey = `crm:cron:daily-reset:${new Date().toISOString().slice(0, 10)}`;
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
try {
  const acquired = await redis.set(todayKey, "1", "EX", 86400, "NX");
  if (!acquired) return NextResponse.json({ message: "Already reset today" });
  // ... rest of handler, then add jobId to warmup:
  await warmupQueue.add("warmup-daily", { inboxId: inbox.id }, {
    jobId: `warmup-${inbox.id}-${todayKey}`,  // BullMQ deduplicates
    attempts: 2, backoff: { type: "exponential", delay: 60000 },
  });
} finally {
  await redis.quit();
}
```

---

### [ ] 2.9 — `decay-scores` cron uses `$executeRawUnsafe` and wrong HTTP method
🟡 `apps/web/app/api/cron/decay-scores/route.ts`

**Change to `POST`:**
```ts
export async function POST(req: NextRequest) {  // was GET
```

**Replace both `$executeRawUnsafe` with typed `$executeRaw`:**
```ts
import { Prisma } from "@prisma/client";

const staleRawEnriched = await prismaClient.$executeRaw(Prisma.sql`
  UPDATE leads SET score = GREATEST(score - 10, 0)
  WHERE status IN ('raw', 'enriched') AND created_at < NOW() - INTERVAL '60 days' AND score > 0
`);

const staleContacted = await prismaClient.$executeRaw(Prisma.sql`
  UPDATE leads SET score = GREATEST(score - 5, 0)
  WHERE id IN (
    SELECT l.id FROM leads l
    LEFT JOIN communication_history ch ON ch.lead_id = l.id
    WHERE l.status IN ('contacted', 'replied') AND l.score > 0
    GROUP BY l.id
    HAVING MAX(ch.sent_at) < NOW() - INTERVAL '30 days' OR MAX(ch.sent_at) IS NULL
  )
`);
```

---

### [ ] 2.10 — `pipeline-stages` GET: `include: { deals: true }` — unbounded join
🟡 `apps/web/app/api/pipeline-stages/route.ts:16`

**Before:**
```ts
include: { deals: true },
```
**After:**
```ts
include: { _count: { select: { deals: true } } },
```
Return `dealCount: _count.deals` to the frontend. Load deals separately when a stage is expanded.

---

### [ ] 2.11 — `verify-email`: external DNS fetch has no timeout
🟡 `apps/web/app/api/leads/verify-email/route.ts:53`

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000);
try {
  const res = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`,
    { signal: controller.signal });
  // ...
} catch (err: any) {
  dnsError = true;
  if (err.name === "AbortError") console.warn(`[verify-email] Timed out for ${domain}`);
} finally {
  clearTimeout(timer);
}
```

---

### [ ] 2.12 — IMAP stream errors leave worker concurrency slots blocked forever
🟡 `workers/imap-sync/src/index.ts`

```ts
const MSG_TIMEOUT = 30_000;

msg.on("body", (stream: NodeJS.ReadableStream) => {
  stream.on("error", reject);  // ← add this
  stream.on("data", (c: Buffer) => bodyChunks.push(c));
  stream.on("end", async () => { try { /* ... */ resolve(); } catch (e) { reject(e); } });
});
msg.once("error", reject);

// Wrap promise with timeout:
messages.push(Promise.race([
  messagePromise,
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Message timeout")), MSG_TIMEOUT)),
]));
```

---

### [ ] 2.13 — `note.content` has no max length — unbounded DB write
🟡 `apps/web/app/api/leads/[id]/notes/route.ts`, `packages/database/schema.prisma`

**Route:**
```ts
if (!content?.trim()) return NextResponse.json({ error: "Content required" }, { status: 400 });
if (content.length > 50_000) return NextResponse.json({ error: "Note too long (max 50,000 chars)" }, { status: 400 });
```
**Schema:**
```prisma
content String @db.VarChar(50000) @map("content")
```

---

### [ ] 2.14 — `expectedCloseDate` stored as `String?` — SQL date queries fail
🟡 `packages/database/schema.prisma`, `packages/shared/src/validators.ts`

**Schema:** `expectedCloseDate String?` → `expectedCloseDate DateTime?`  
**Validators:** `z.string().optional()` → `z.coerce.date().optional()` (both `dealSchema` and `dealCreateSchema`)
```bash
npx prisma migrate dev --name fix-expected-close-date-type --schema=packages/database/schema.prisma
```

---

### [ ] 2.15 — `PipelineStage @@unique([workspaceId, sortOrder])` makes reordering impossible
🟡 `packages/database/schema.prisma`

**Replace:**
```prisma
// @@unique([workspaceId, sortOrder])   ← remove
@@index([workspaceId, sortOrder])       // ← add
```
```bash
npx prisma migrate dev --name remove-stage-sortorder-unique --schema=packages/database/schema.prisma
```

**Add reorder endpoint `apps/web/app/api/pipeline-stages/reorder/route.ts`:**
```ts
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { stageIds } = z.object({ stageIds: z.array(z.string().uuid()).min(1) }).parse(await req.json());
  await prismaClient.$transaction(
    stageIds.map((id, index) =>
      prismaClient.pipelineStage.update({ where: { id, workspaceId: session.user.workspaceId }, data: { sortOrder: index } })
    )
  );
  return NextResponse.json({ success: true });
}
```

---

### [ ] 2.16 — `companies` GET: hardcoded `take: 100`, no cursor pagination
🟡 `apps/web/app/api/companies/route.ts`

```ts
const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
const limit = Math.max(1, Math.min(200, isNaN(rawLimit) ? 50 : rawLimit));
const cursor = searchParams.get("cursor");

const companies = await prismaClient.company.findMany({
  where: { workspaceId, ...(search ? { name: { contains: search, mode: "insensitive" } } : {}) },
  include: { _count: { select: { leads: true } } },
  orderBy: { name: "asc" },
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

const hasMore = companies.length > limit;
const data = hasMore ? companies.slice(0, limit) : companies;
return NextResponse.json({
  data: data.map(({ _count, ...c }) => ({ ...c, leadCount: _count.leads })),
  nextCursor: hasMore ? data.at(-1)?.id : null,
  hasMore,
});
```

---

## Phase 3 — Code Quality & Architecture (~2 days)

---

### [ ] 3.1 — Audit logging is built but never called — compliance table always empty
🟡 Multiple API routes

`auditLog()` exists in `@crm/database` but is called from zero routes.

```ts
import { auditLog } from "@crm/database";

// Fire-and-forget after each successful mutation:
auditLog({
  workspaceId,
  userId: session.user.id,
  action: "lead.create",  // change per route
  entity: "Lead",
  entityId: lead.id,
  ip: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
}).catch(() => {});
```

| Route | Action | Entity |
|-------|--------|--------|
| `POST /api/auth/register` | `user.register` | `User` |
| NextAuth `authorize` | `user.login` | `User` |
| `POST /api/leads` | `lead.create` | `Lead` |
| `POST /api/leads/import` | `lead.import` | `Lead` |
| `POST /api/campaigns/[id]/launch` | `campaign.launch` | `Campaign` |
| `PATCH /api/campaigns/[id]` | `campaign.pause` | `Campaign` |
| `POST /api/deals` | `deal.create` | `Deal` |
| `PATCH /api/deals/[id]/move` | `deal.move` | `Deal` |
| `POST /api/inboxes` | `inbox.create` | `ConnectedInbox` |
| `DELETE /api/inboxes/[id]` | `inbox.delete` | `ConnectedInbox` |
| `POST /api/domains` | `domain.create` | `SendingDomain` |

---

### [ ] 3.2 — `parseRedisUrl` copy-pasted in 6+ files
🔵 `packages/shared/src/redis.ts` (new)

```ts
import IORedis from "ioredis";

export function parseRedisUrl(url: string) {
  try {
    const p = new URL(url);
    return { host: p.hostname || "localhost", port: Number(p.port) || 6379, password: p.password || undefined, db: p.pathname ? Number(p.pathname.slice(1)) || 0 : 0 };
  } catch { return { host: "localhost", port: 6379 }; }
}

let _conn: IORedis | null = null;
export function getRedisConnection(): IORedis {
  if (!_conn) _conn = new IORedis(process.env.REDIS_URL || "redis://localhost:6379",
    { maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: true });
  return _conn;
}
```

Export from `packages/shared/src/index.ts`. Replace all inline copies.

---

### [ ] 3.3 — Nodemailer transport: `pool: true` created & destroyed per job — pooling has no effect
🔵 `workers/email-dispatcher/src/index.ts`

```ts
// Module-level cache
const transportCache = new Map<string, nodemailer.Transporter>();
function getTransport(inbox: ConnectedInbox): nodemailer.Transporter {
  if (!transportCache.has(inbox.id))
    transportCache.set(inbox.id, createTransport(inbox));
  return transportCache.get(inbox.id)!;
}
// Use in processEmailDispatch:
const transport = getTransport(inbox);  // no finally/close
// On SIGTERM:
for (const t of transportCache.values()) { try { t.close(); } catch {} }
```

Remove `pool: true, maxConnections: 5` from `createTransport` options in `email-engine/src/index.ts`.

---

### [ ] 3.4 — Spintax parser doesn't handle nested braces
🔵 `packages/email-engine/src/index.ts`

```ts
export function parseSpintax(text: string): string {
  const INNER = /\{([^{}]+)\}/g;
  let result = text;
  for (let depth = 0; depth < 10; depth++) {
    const next = result.replace(INNER, (_, choices) => {
      const opts = choices.split("|");
      return opts[Math.floor(Math.random() * opts.length)];
    });
    if (next === result) break;
    result = next;
    INNER.lastIndex = 0;
  }
  return result;
}
```

---

### [ ] 3.5 — `test-connection` ciphertext check rejects long passwords
🔵 `apps/web/app/api/test-connection/route.ts`

```ts
// Before: s.split(":").every(p => p.length === 32)
// After:
const isValidCiphertext = (s: string) =>
  Boolean(s) && s.split(":").length === 4 && s.split(":").every(p => p.length >= 32);
```

---

### [ ] 3.6 — Duplicate `schema.prisma` in `apps/web/`
🟡 `apps/web/schema.prisma`

Delete `apps/web/schema.prisma`. Add to `apps/web/package.json`:
```json
"db:generate": "prisma generate --schema=../../packages/database/schema.prisma"
```
Add `schema.prisma` to `apps/web/.gitignore`.

---

### [ ] 3.7 — E2E test scripts in app root — included in Docker image
🔵 Multiple files

```bash
mkdir -p tests/e2e scripts
mv e2e.js tests/e2e/
mv apps/web/e2e_full.js tests/e2e/
mv apps/web/e2e_test.js tests/e2e/
mv apps/web/fix-imports.js scripts/
```
Add to `.dockerignore`: `tests/` and `scripts/`.

---

### [ ] 3.8 — Backup container: no success verification — silent failures
🔵 `docker-compose.yml`

```yaml
entrypoint: >
  sh -c "while true; do
    F=/backups/crm_backup_$$(date +%Y%m%d_%H%M%S).dump;
    if pg_dump -Fc -f $$F; then
      echo \"[backup] OK: $$F\"; find /backups -name '*.dump' -mtime +7 -delete;
    else echo \"[backup] FAILED at $$(date)\" >&2; exit 1; fi;
    sleep 86400;
  done"
restart: on-failure
healthcheck:
  test: ["CMD-SHELL", "find /backups -name '*.dump' -mmin -1500 | grep -q ."]
  interval: 1h
  timeout: 10s
  retries: 1
```

---

## Phase 4 — New Feature: Lead Scraper

The existing `scraper-worker` enriches individual known leads. This phase builds a full **prospecting scraper** that discovers new leads from target URLs and automatically funnels them into the CRM.

### Architecture

```
User configures scrape job in UI
        ↓
POST /api/scrape-jobs          (create job record)
        ↓
Queue: SCRAPE_DISCOVERY        (BullMQ)
        ↓
scraper-worker (enhanced)      (crawl URL, extract emails/names)
        ↓
Queue: ENRICHMENT              (per discovered email)
        ↓
enrichment-worker              (enrich discovered leads)
        ↓
Lead appears in CRM with       (status: raw, source tagged)
source_url, campaign-ready
```

---

### [ ] 4.1 — Schema: add `ScrapeJob` model

`packages/database/schema.prisma` — add:
```prisma
model ScrapeJob {
  id          String    @id @default(uuid())
  workspaceId String    @map("workspace_id")
  name        String
  targetUrl   String    @map("target_url")
  mode        String    @default("single")  // "single" | "crawl" | "sitemap"
  maxPages    Int       @default(10)        @map("max_pages")
  status      String    @default("pending") // pending | running | completed | failed
  leadsFound  Int       @default(0)         @map("leads_found")
  pagesScraped Int      @default(0)         @map("pages_scraped")
  error       String?
  createdAt   DateTime  @default(now())     @map("created_at")
  updatedAt   DateTime  @updatedAt          @map("updated_at")
  completedAt DateTime?                     @map("completed_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, status])
  @@map("scrape_jobs")
}
```

Add `scrapeJobs ScrapeJob[]` to `model Workspace`.

Also add `sourceUrl String? @map("source_url")` and `scrapeJobId String? @map("scrape_job_id")` to `model Lead` for traceability.

```bash
npx prisma migrate dev --name add-scrape-jobs --schema=packages/database/schema.prisma
```

---

### [ ] 4.2 — Schema: add `SCRAPE_DISCOVERY` queue name

`packages/shared/src/enums.ts` (or wherever `QueueName` is defined) — add:
```ts
SCRAPE_DISCOVERY = "scrape-discovery",
```

---

### [ ] 4.3 — Enhance `packages/scraper/src/index.ts`

Add crawling, sitemap parsing, and better email extraction:

```ts
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { HttpsProxyAgent } from "https-proxy-agent";
import { URL } from "url";

export interface DiscoveredLead {
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  sourceUrl: string;
  context?: string; // surrounding text
}

export interface CrawlResult {
  leads: DiscoveredLead[];
  pagesScraped: number;
  errors: string[];
}

const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;

function assertSafeUrl(raw: string): URL {
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  if (BLOCKED.test(parsed.hostname))
    throw new Error(`Blocked host: ${parsed.hostname}`);
  return parsed;
}

// More comprehensive email extraction — includes text content, not just mailto hrefs
export function extractLeadsFromHtml(html: string, sourceUrl: string): DiscoveredLead[] {
  const $ = cheerio.load(html);
  const found = new Map<string, DiscoveredLead>();

  // 1. Extract from mailto: links — highest quality
  $("a[href^='mailto:']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const email = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (!isValidEmail(email) || found.has(email)) return;
    const linkText = $(el).text().trim();
    found.set(email, { email, name: linkText || undefined, sourceUrl });
  });

  // 2. Extract from plain text / visible content
  const text = $.text();
  const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
  const bodyEmails = [...text.matchAll(EMAIL_RE)];
  for (const match of bodyEmails) {
    const email = match[0].toLowerCase();
    if (!isValidEmail(email) || found.has(email)) continue;
    // Extract surrounding words as context
    const start = Math.max(0, match.index! - 60);
    const context = text.slice(start, match.index! + email.length + 60).trim();
    found.set(email, { email, sourceUrl, context });
  }

  // 3. Try to extract name from structured markup near email
  for (const [email, lead] of found) {
    if (lead.name) continue;
    // Look for schema.org Person markup
    const personEl = $(`[itemprop="email"][content="${email}"]`).closest("[itemtype*='Person']");
    if (personEl.length) {
      const name = personEl.find("[itemprop='name']").first().text().trim();
      if (name) lead.name = name;
    }
  }

  return [...found.values()].filter(l => !isGenericEmail(l.email));
}

// Filter out generic catch-all emails
function isGenericEmail(email: string): boolean {
  const GENERIC = /^(info|contact|hello|support|admin|noreply|no-reply|sales|team|office|webmaster|help|enquiries|enquiry|mail|postmaster)@/i;
  return GENERIC.test(email);
}

function isValidEmail(email: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) && email.length <= 254;
}

export async function fetchPage(
  url: string,
  proxyConfig?: ProxyConfig,
  timeoutMs = 15_000
): Promise<{ html: string; finalUrl: string; status: number }> {
  const safe = assertSafeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetchOptions: RequestInit & { agent?: HttpsProxyAgent } = {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CRM-LeadBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
    };
    if (proxyConfig?.url) fetchOptions.agent = getProxyAgent(proxyConfig);
    const res = await fetch(url, fetchOptions as RequestInit);
    if (!res.ok) return { html: "", finalUrl: res.url || url, status: res.status };
    const html = await res.text();
    return { html, finalUrl: res.url || url, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

// Extract same-domain links for crawling
export function extractInternalLinks(html: string, baseUrl: string, maxLinks = 50): string[] {
  const base = new URL(baseUrl);
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: string[] = [];

  $("a[href]").each((_, el) => {
    if (links.length >= maxLinks) return false;
    try {
      const href = $(el).attr("href") || "";
      const resolved = new URL(href, base);
      if (resolved.hostname !== base.hostname) return;
      if (!["http:", "https:"].includes(resolved.protocol)) return;
      resolved.hash = "";  // strip fragments
      const normalized = resolved.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        links.push(normalized);
      }
    } catch {}
  });
  return links;
}

// Parse XML sitemap for URLs
export async function fetchSitemapUrls(domain: string, proxyConfig?: ProxyConfig): Promise<string[]> {
  const candidates = [
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://www.${domain}/sitemap.xml`,
  ];
  for (const sitemapUrl of candidates) {
    try {
      assertSafeUrl(sitemapUrl);
      const { html } = await fetchPage(sitemapUrl, proxyConfig, 10_000);
      if (!html) continue;
      const $ = cheerio.load(html, { xmlMode: true });
      const urls: string[] = [];
      $("url > loc, sitemap > loc").each((_, el) => urls.push($(el).text().trim()));
      if (urls.length) return urls.filter(u => { try { assertSafeUrl(u); return true; } catch { return false; } });
    } catch {}
  }
  return [];
}

// The main crawl function for multi-page discovery
export async function crawlForLeads(
  startUrl: string,
  options: { maxPages: number; mode: "single" | "crawl" | "sitemap"; proxy?: ProxyConfig }
): Promise<CrawlResult> {
  const allLeads = new Map<string, DiscoveredLead>();
  const errors: string[] = [];
  let pagesScraped = 0;

  const toVisit: string[] = [startUrl];
  const visited = new Set<string>();

  if (options.mode === "sitemap") {
    try {
      const domain = new URL(startUrl).hostname;
      const sitemapUrls = await fetchSitemapUrls(domain, options.proxy);
      toVisit.push(...sitemapUrls.slice(0, options.maxPages));
    } catch (e: any) {
      errors.push(`Sitemap fetch failed: ${e.message}`);
    }
  }

  while (toVisit.length > 0 && pagesScraped < options.maxPages) {
    const url = toVisit.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const { html, status } = await fetchPage(url, options.proxy);
      if (!html || status >= 400) continue;
      pagesScraped++;

      const leads = extractLeadsFromHtml(html, url);
      leads.forEach(l => { if (!allLeads.has(l.email)) allLeads.set(l.email, l); });

      // For crawl mode, discover more pages from the same domain
      if (options.mode === "crawl" && pagesScraped < options.maxPages) {
        const links = extractInternalLinks(html, url, 20);
        for (const link of links) {
          if (!visited.has(link) && !toVisit.includes(link)) {
            toVisit.push(link);
          }
        }
      }
    } catch (e: any) {
      errors.push(`Failed to scrape ${url}: ${e.message}`);
    }

    // Rate-limit crawling — be a polite bot
    if (toVisit.length > 0) await new Promise(r => setTimeout(r, 500));
  }

  return { leads: [...allLeads.values()], pagesScraped, errors };
}

// Re-export existing utilities for backward compatibility
export { scrapeUrl, fetchRawHtml, htmlToMarkdown, extractEmails, extractMeta, getProxyAgent };
export type { ProxyConfig };
```

---

### [ ] 4.4 — Enhance `workers/scraper-worker/src/index.ts`

Replace the worker to handle both existing enrichment mode and new discovery mode:

```ts
import { Worker, Job, Queue } from "bullmq";
import { prismaClient } from "@crm/database";
import { QueueName } from "@crm/shared";
import {
  crawlForLeads,
  fetchPage,
  extractLeadsFromHtml,
  fetchRawHtml,
  extractEmails,
  extractMeta,
  scrapeUrl,
} from "@crm/scraper";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

interface ScraperJobData {
  mode: "enrich" | "discover";   // NEW: explicit mode
  url: string;
  workspaceId: string;
  // For "enrich" mode (existing):
  leadId?: string;
  companyId?: string;
  proxy?: { url: string; username?: string; password?: string };
  // For "discover" mode (new):
  scrapeJobId?: string;
  crawlMode?: "single" | "crawl" | "sitemap";
  maxPages?: number;
  autoEnrich?: boolean;
  campaignId?: string;  // optional: auto-add discovered leads to a campaign
}

// SSRF guard (always first)
const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;
function assertSafeUrl(raw: string) {
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new Error(`Invalid URL: ${raw}`); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`Blocked protocol`);
  if (BLOCKED.test(parsed.hostname)) throw new Error(`Blocked internal host: ${parsed.hostname}`);
}

async function processEnrich(job: Job<ScraperJobData>) {
  // Existing enrichment logic — unchanged except SSRF guard moved here
  const { url, workspaceId, leadId, companyId, proxy } = job.data;
  assertSafeUrl(url);

  const proxyConfig = proxy?.url ? proxy : undefined;
  const html = await fetchRawHtml(url, proxyConfig);
  const emails = extractEmails(html);
  const meta = extractMeta(html);
  const markdown = await scrapeUrl(url, proxyConfig);

  const result = { url, markdown: markdown.substring(0, 50000), emails, meta, scrapedAt: new Date().toISOString() };

  if (leadId) {
    await prismaClient.lead.update({
      where: { id: leadId, workspaceId },
      data: { scrapedAttributes: JSON.stringify(result), status: "enriched" },
    });
  }

  if (companyId) {
    const company = await prismaClient.company.findFirst({ where: { id: companyId, workspaceId } });
    if (company) {
      let extra: Record<string, unknown> = {};
      try { extra = JSON.parse(typeof company.extraAttributes === "string" ? company.extraAttributes : "{}"); } catch {}
      await prismaClient.company.update({
        where: { id: companyId },
        data: { extraAttributes: JSON.stringify({ ...extra, scrapedMeta: meta, scrapedAt: new Date().toISOString() }) },
      });
    }
  }

  return result;
}

async function processDiscover(job: Job<ScraperJobData>) {
  const {
    url, workspaceId, scrapeJobId,
    crawlMode = "single", maxPages = 10,
    autoEnrich = true, campaignId, proxy,
  } = job.data;

  assertSafeUrl(url);

  // Mark job as running
  if (scrapeJobId) {
    await prismaClient.scrapeJob.update({
      where: { id: scrapeJobId, workspaceId },
      data: { status: "running" },
    });
  }

  try {
    const result = await crawlForLeads(url, {
      maxPages: Math.min(maxPages, 100),  // hard cap
      mode: crawlMode,
      proxy: proxy?.url ? proxy : undefined,
    });

    let leadsCreated = 0;
    const enrichmentQueue = new Queue(QueueName.ENRICHMENT, { connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) });

    try {
      for (const discovered of result.leads) {
        // Upsert lead — don't overwrite existing data
        const existing = await prismaClient.lead.findFirst({
          where: { workspaceId, email: discovered.email },
        });

        if (!existing) {
          const parts = (discovered.name || "").split(" ");
          const lead = await prismaClient.lead.create({
            data: {
              workspaceId,
              email: discovered.email,
              firstName: parts[0] || null,
              lastName: parts.slice(1).join(" ") || null,
              status: "raw",
              scrapeJobId: scrapeJobId || null,
              sourceUrl: discovered.sourceUrl,
              scrapedAttributes: JSON.stringify({
                sourceUrl: discovered.sourceUrl,
                context: discovered.context,
                discoveredAt: new Date().toISOString(),
              }),
            },
          });
          leadsCreated++;

          // Auto-enrich each new lead
          if (autoEnrich) {
            await enrichmentQueue.add(
              "enrich",
              { leadId: lead.id, workspaceId, enrichByEmail: true, enrichByDomain: true },
              { jobId: `enrich-${lead.id}`, attempts: 2, backoff: { type: "exponential", delay: 10000 } }
            );
          }
        }
      }
    } finally {
      await enrichmentQueue.close();
    }

    // Update ScrapeJob with results
    if (scrapeJobId) {
      await prismaClient.scrapeJob.update({
        where: { id: scrapeJobId, workspaceId },
        data: {
          status: "completed",
          leadsFound: leadsCreated,
          pagesScraped: result.pagesScraped,
          completedAt: new Date(),
          error: result.errors.length ? result.errors.slice(0, 3).join("; ") : null,
        },
      });
    }

    console.log(`[scraper-worker] Discovery complete: ${leadsCreated} new leads from ${result.pagesScraped} pages`);
    return { leadsCreated, pagesScraped: result.pagesScraped };

  } catch (err: any) {
    if (scrapeJobId) {
      await prismaClient.scrapeJob.update({
        where: { id: scrapeJobId, workspaceId },
        data: { status: "failed", error: err.message },
      }).catch(() => {});
    }
    throw err;
  }
}

async function processJob(job: Job<ScraperJobData>) {
  if (job.data.mode === "discover") return processDiscover(job);
  return processEnrich(job);
}

const worker = new Worker<ScraperJobData>(QueueName.SCRAPER, processJob, {
  connection,
  concurrency: 3,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 30000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
    timeout: 300_000,  // 5 min — crawl jobs can take longer
  },
});

worker.on("completed", job => console.log(`[scraper-worker] Completed ${job.id}`));
worker.on("failed", (job, err) => console.error(`[scraper-worker] Failed ${job?.id}:`, err.message));
worker.on("error", err => console.error("[scraper-worker] Worker error:", err));

console.log("[scraper-worker] Worker started (enrich + discover modes)");

process.on("SIGTERM", async () => { await worker.close(); await connection.quit(); await prismaClient.$disconnect().catch(() => {}); process.exit(0); });
process.on("SIGINT",  async () => { await worker.close(); await connection.quit(); await prismaClient.$disconnect().catch(() => {}); process.exit(0); });
```

---

### [ ] 4.5 — New API route: `apps/web/app/api/scrape-jobs/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { Queue } from "bullmq";
import { QueueName } from "@crm/shared";
import { parseRedisUrl } from "@crm/shared";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const scrapeJobSchema = z.object({
  name: z.string().min(1).max(255),
  targetUrl: z.string().url({ message: "Must be a valid URL" }),
  mode: z.enum(["single", "crawl", "sitemap"]).default("single"),
  maxPages: z.number().int().min(1).max(100).default(10),
  autoEnrich: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobs = await prismaClient.scrapeJob.findMany({
    where: { workspaceId: session.user.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ data: jobs });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = session.user.workspaceId;

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = scrapeJobSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors }, { status: 400 });

  const { name, targetUrl, mode, maxPages, autoEnrich } = parsed.data;

  // SSRF guard at API layer too
  const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;
  try {
    const u = new URL(targetUrl);
    if (!["http:","https:"].includes(u.protocol)) throw new Error("Blocked");
    if (BLOCKED.test(u.hostname)) throw new Error("Blocked internal URL");
  } catch (e: any) {
    return NextResponse.json({ error: `Invalid or blocked URL: ${e.message}` }, { status: 400 });
  }

  const scrapeJob = await prismaClient.scrapeJob.create({
    data: { workspaceId, name, targetUrl, mode, maxPages, status: "pending" },
  });

  const queue = new Queue(QueueName.SCRAPER, { connection: parseRedisUrl(REDIS_URL) });
  try {
    await queue.add("discover", {
      mode: "discover",
      url: targetUrl,
      workspaceId,
      scrapeJobId: scrapeJob.id,
      crawlMode: mode,
      maxPages,
      autoEnrich,
    }, {
      jobId: `discover-${scrapeJob.id}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 30000 },
    });
  } finally {
    await queue.close();
  }

  return NextResponse.json(scrapeJob, { status: 201 });
}
```

---

### [ ] 4.6 — New API route: `apps/web/app/api/scrape-jobs/[id]/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const job = await prismaClient.scrapeJob.findFirst({
    where: { id: params.id, workspaceId: session.user.workspaceId },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const job = await prismaClient.scrapeJob.findFirst({
    where: { id: params.id, workspaceId: session.user.workspaceId },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.status === "running") return NextResponse.json({ error: "Cannot delete a running job" }, { status: 409 });

  await prismaClient.scrapeJob.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
```

---

### [ ] 4.7 — New UI page: `apps/web/app/(dashboard)/leads/scrape/page.tsx`

Create a page with:

1. **"New Scrape Job" form** — fields: Name, Target URL, Mode (single / crawl / sitemap), Max Pages (1–100), Auto-Enrich toggle
2. **Jobs list** — table showing: Name, URL, Mode, Status (with colour badge), Leads Found, Pages Scraped, Created At, Actions (View Leads, Delete)
3. **Status polling** — `useEffect` with 5-second interval `refetch` while any job is `running`
4. **"View Leads" action** — links to `/leads?scrapeJobId={id}` (filter leads by source job)

Key component structure:
```tsx
// apps/web/app/(dashboard)/leads/scrape/page.tsx
"use client";
import { useState, useEffect } from "react";

export default function ScrapePage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchJobs = async () => {
    const res = await fetch("/api/scrape-jobs");
    const data = await res.json();
    setJobs(data.data);
  };

  useEffect(() => {
    fetchJobs();
    const hasRunning = jobs.some((j: any) => j.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [jobs.length]);

  const createJob = async (formData: FormData) => {
    setLoading(true);
    await fetch("/api/scrape-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        targetUrl: formData.get("targetUrl"),
        mode: formData.get("mode"),
        maxPages: Number(formData.get("maxPages")),
        autoEnrich: formData.get("autoEnrich") === "true",
      }),
    });
    setLoading(false);
    fetchJobs();
  };
  // ... render form + table
}
```

---

### [ ] 4.8 — Update `apps/web/app/api/leads/route.ts` to support `scrapeJobId` filter

```ts
const scrapeJobId = searchParams.get("scrapeJobId");

const leads = await prismaClient.lead.findMany({
  where: {
    workspaceId,
    ...(status ? { status } : {}),
    ...(scrapeJobId ? { scrapeJobId } : {}),  // ← add this
  },
  // ...
});
```

---

## Migrations Summary

Run all pending migrations:
```bash
npx prisma migrate dev --schema=packages/database/schema.prisma
```

| # | Migration Name | Task | Risk |
|---|---------------|------|------|
| 1 | `add-sent-at-default` | 0.3 | Safe |
| 2 | `add-company-workspace-domain-unique` | 2.7 | Safe if no existing dups |
| 3 | `fix-expected-close-date-type` | 2.14 | Medium — cast existing strings |
| 4 | `remove-stage-sortorder-unique` | 2.15 | Safe |
| 5 | `add-scrape-jobs` | 4.1 | Safe — new table + Lead columns |

---

## Packages to Install

```bash
npm install rate-limiter-flexible              --workspace=apps/web
npm install sanitize-html @types/sanitize-html --workspace=packages/email-engine
npm install express-basic-auth                 --workspace=workers/bull-board
npm install cookie                             --workspace=apps/web
npm install @types/cookie                      --workspace=apps/web
```

---

## New vs Previously Documented Issues

Issues confirmed from deeper pass that were missing from the first checklist:

| Issue | Layer | Was Missing |
|-------|-------|-------------|
| `rateLimitAuth`/`rateLimitApi` called without `await` — rate limiting dead | Middleware | ✅ New |
| Apollo/Hunter API keys in URL query strings → access logs | Worker | ✅ New |
| SSRF in scraper-worker — no URL validation | Worker | ✅ New |
| Inbox email uniqueness check not scoped to workspace | API | ✅ New |
| `ai-worker` communicationHistory update missing workspaceId | Worker | ✅ New |
| Decay-tracker double `update` on same row | Worker | ✅ New |
| Decay-tracker N individual updates — should be bulk | Worker | ✅ New |
| AI-worker OOF rescheduling N individual updates | Worker | ✅ New |
| Enrichment-worker `company.create` race condition | Worker | ✅ New |
| `decay-scores` uses `$executeRawUnsafe` | API | ✅ New |
| `decay-scores` uses GET not POST | API | ✅ New |
| `pipeline-stages` GET: unbounded deal join | API | ✅ New |
| `note.content` no max length | API + Schema | ✅ New |
| `companies` GET: `take: 100` no pagination | API | ✅ New |
| Docker: `changeme` defaults silently used | Infra | ✅ New |
| Backup container: no success verification | Infra | ✅ New |
| `verify-email` DNS fetch has no timeout | API | ✅ New |

---

*Complete audit of `tkvardaq/Crm` · All layers · June 2026 · 44 bugs + 1 new feature*
