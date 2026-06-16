# Complete Review & Integration Plan
**CRM:** `tkvardaq/Crm` (updated) · **LeadStealth:** `tkvardaq/leadstealth-upgraded-v2`

---

## Part 1 — CRM: What Was Fixed vs What Still Needs Fixing

### ✅ Fixed Since Last Review
| # | Issue |
|---|-------|
| 0.1 | `workspaceId` now destructured in imap-sync |
| 0.2 | `await` added to `rateLimitAuth`/`rateLimitApi` in middleware |
| 0.3 | `sentAt @default(now())` added to schema |
| 1.1 | Campaign launch body parsed before DB mutation |
| 1.2 | Workspace-switch now writes `next-workspace` cookie |
| 1.3 | `toSafeHtml` applied in email dispatcher |
| 1.4 | Apollo key moved to `X-Api-Key` header |
| 1.5 | SSRF `assertSafeUrl` guard added to scraper-worker |
| 1.9 | Inbox email uniqueness now scoped to `workspaceId` |
| 2.7 | `company.create` → `company.upsert` in enrichment-worker |
| 2.9 | `decay-scores` uses `$executeRaw` + `POST` method |
| 2.10 | `pipeline-stages` GET uses `_count` instead of `include: { deals: true }` |
| 2.14 | `expectedCloseDate` is now `DateTime?` in schema |
| 2.16 | `companies` GET has cursor pagination |
| 3.1 | `ai-worker` OOF rescheduling uses `$executeRaw` |
| ScrapeJob | Schema model added, migration included in init |

---

### ❌ Still Broken in CRM (18 remaining issues)

---

#### [ ] C-1 — `/api/scrape-jobs` route does not exist — ScrapeJob schema has no API
🔴 **Critical** | `apps/web/app/api/scrape-jobs/` — only `[id]/route.ts` exists, root `route.ts` is missing

The `ScrapeJob` model is in the schema and the migration ran, but there is no `POST /api/scrape-jobs` endpoint to create a job or `GET` to list them. The scraper feature is in the DB but completely unreachable from the UI.

**Create `apps/web/app/api/scrape-jobs/route.ts`:**
```ts
import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@crm/database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { Queue } from "bullmq";
import { QueueName, parseRedisUrl } from "@crm/shared";

const schema = z.object({
  name: z.string().min(1).max(255),
  targetUrl: z.string().url(),
  mode: z.enum(["single", "crawl", "sitemap"]).default("single"),
  maxPages: z.number().int().min(1).max(100).default(10),
  autoEnrich: z.boolean().default(true),
});

const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1)/i;

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

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors }, { status: 400 });

  const { name, targetUrl, mode, maxPages, autoEnrich } = parsed.data;

  try {
    const u = new URL(targetUrl);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("Bad protocol");
    if (BLOCKED.test(u.hostname)) throw new Error("Internal URL blocked");
  } catch (e: any) {
    return NextResponse.json({ error: `Invalid URL: ${e.message}` }, { status: 400 });
  }

  const job = await prismaClient.scrapeJob.create({
    data: { workspaceId, name, targetUrl, mode, maxPages, status: "pending" },
  });

  const queue = new Queue(QueueName.SCRAPER, {
    connection: parseRedisUrl(process.env.REDIS_URL || "redis://localhost:6379"),
  });
  try {
    await queue.add("discover", {
      mode: "discover", url: targetUrl, workspaceId,
      scrapeJobId: job.id, crawlMode: mode, maxPages, autoEnrich,
    }, { jobId: `discover-${job.id}`, attempts: 2, backoff: { type: "exponential", delay: 30000 } });
  } finally {
    await queue.close();
  }
  return NextResponse.json(job, { status: 201 });
}
```

---

#### [ ] C-2 — Only one migration file exists — `add_scrape_jobs` migration is missing
🔴 **Critical** | `packages/database/migrations/`

The metadata references a `20260615043000_add_scrape_jobs` migration but the folder contains only the init migration. The `add_scrape_jobs` folder has a `metadata.json` but no `migration.sql`. Any fresh database deployment will fail to find the expected migration state and `prisma migrate deploy` will error.

**Fix:** Squash both migrations into the init (since this appears to be a fresh codebase), or create the missing `migration.sql`:
```bash
npx prisma migrate dev --name add_scrape_jobs \
  --schema=packages/database/schema.prisma
```
Alternatively, delete `migration_lock.toml` and the partial metadata folder and run `prisma migrate dev` fresh.

---

#### [ ] C-3 — `prisma.config.js` at repo root is non-standard and will confuse Prisma CLI
🟠 **High** | `prisma.config.js`

Prisma does not read a `prisma.config.js` file — it only reads `prisma/schema.prisma` or the path passed via `--schema`. This file does nothing and will mislead developers into thinking schema config is centralised here. The actual schema is at `packages/database/schema.prisma`.

**Fix:** Delete `prisma.config.js`. Document the correct path in `README.md` and in each package's `package.json` scripts.

---

#### [ ] C-4 — Workspace-switch: `next-workspace` cookie consumed in `jwt` callback but `req` is not passed
🔴 **Critical** | `apps/web/lib/auth.ts`

The NextAuth `jwt` callback receives `req` only when `useSecureCookies` or a custom cookie handler is active. In the standard NextAuth v4 setup with `getServerSession`, the `jwt` callback does **not** receive the request object — `req` is `undefined`. The `req?.cookies?.["next-workspace"]` lookup silently returns `undefined` on every call. The workspace switch never actually takes effect.

**Fix — read the cookie in the API route itself, verify membership, and embed the new `workspaceId` into the token via a database update or a signed JWT passed back:**
```ts
// In apps/web/app/api/workspaces/switch/route.ts
// After verifying membership, update the user's currentWorkspaceId in DB:
await prismaClient.user.update({
  where: { id: session.user.id },
  data: { currentWorkspaceId: workspaceId },
});
// The jwt callback reads currentWorkspaceId from DB on next session refresh
```

**Then in `auth.ts` jwt callback:**
```ts
async jwt({ token, user, trigger }) {
  if (user) {
    token.workspaceId = user.workspaceId;
  }
  // On session update trigger, re-read workspace from DB
  if (trigger === "update" && token.sub) {
    const dbUser = await prismaClient.user.findUnique({
      where: { id: String(token.sub) },
      select: { currentWorkspaceId: true, workspaceId: true },
    });
    if (dbUser) token.workspaceId = dbUser.currentWorkspaceId ?? dbUser.workspaceId;
  }
  return token;
},
```

**Frontend — trigger session update:**
```ts
await fetch("/api/workspaces/switch", { method: "POST", body: JSON.stringify({ workspaceId }), headers: { "Content-Type": "application/json" } });
await update(); // from useSession() — triggers jwt callback with trigger="update"
window.location.href = "/";
```

---

#### [ ] C-5 — Audit logging is still not called from any route
🟡 **Medium** | All mutating API routes

`auditLog()` exists and the schema table is there, but zero routes call it. The compliance table is permanently empty.

**Add to each mutating route (fire-and-forget):**
```ts
import { auditLog } from "@crm/database";
auditLog({ workspaceId, userId: session.user.id, action: "lead.create",
  entity: "Lead", entityId: lead.id,
  ip: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
}).catch(() => {});
```

Minimum routes: `lead.create`, `lead.import`, `campaign.launch`, `deal.create`, `deal.move`, `inbox.create`, `inbox.delete`, `user.register`.

---

#### [ ] C-6 — `decay-scores` cron has no auth — any unauthenticated caller can trigger bulk score decay
🟠 **High** | `apps/web/app/api/cron/decay-scores/route.ts`

The route correctly uses `POST` and `$executeRaw`, but it has no `Authorization: Bearer` check. Any external caller can trigger bulk lead score degradation by posting to this endpoint.

**Add at the top of the handler:**
```ts
const cronSecret = process.env.CRON_SECRET;
const authHeader = req.headers.get("authorization");
if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

---

#### [ ] C-7 — `decay-tracker` worker: double update on same row still unfixed
🟡 **Medium** | `workers/decay-tracker/src/index.ts`

Two sequential `prismaClient.lead.update` calls on the same row when score hits threshold — not merged into one atomic write.

```ts
// Replace:
await prismaClient.lead.update({ where: { id: lead.id }, data: { score: newScore } });
if (newScore <= COLD_THRESHOLD && lead.status === "contacted") {
  await prismaClient.lead.update({ where: { id: lead.id }, data: { status: "raw" } });
}

// With:
const goesStale = newScore <= COLD_THRESHOLD && lead.status === "contacted";
await prismaClient.lead.update({
  where: { id: lead.id },
  data: { score: newScore, ...(goesStale ? { status: "raw" } : {}) },
});
```

---

#### [ ] C-8 — `decay-tracker` worker: N individual `update` calls per workspace
🟡 **Medium** | `workers/decay-tracker/src/index.ts`

Per-lead loop = 50,000 DB round trips for a large workspace. Needs a bulk CASE-based UPDATE via `$executeRaw`. See previous checklist task 2.5 for the full SQL pattern.

---

#### [ ] C-9 — `note.content` has no max length validation or DB constraint
🟡 **Medium** | `apps/web/app/api/leads/[id]/notes/route.ts`, `packages/database/schema.prisma`

```ts
// Route: add before DB write
if (content.length > 50_000) return NextResponse.json({ error: "Note too long" }, { status: 400 });
```
```prisma
// Schema
content String @db.VarChar(50000) @map("content")
```

---

#### [ ] C-10 — `PipelineStage @@unique([workspaceId, sortOrder])` never removed
🟡 **Medium** | `packages/database/schema.prisma`

Stage reordering still impossible — the unique constraint rejects any swap of two adjacent sort orders.

```prisma
// Remove:
// @@unique([workspaceId, sortOrder])
// Add:
@@index([workspaceId, sortOrder])
```
```bash
npx prisma migrate dev --name remove-stage-sortorder-unique --schema=packages/database/schema.prisma
```
Add a `PATCH /api/pipeline-stages/reorder` endpoint (see previous checklist C-13 for full code).

---

#### [ ] C-11 — Daily-reset cron: no Redis idempotency guard — duplicate warmup jobs on re-trigger
🟡 **Medium** | `apps/web/app/api/cron/daily-reset/route.ts`

No `SET NX` lock. Double-firing sends double warmup emails per inbox.

```ts
const todayKey = `crm:cron:daily-reset:${new Date().toISOString().slice(0, 10)}`;
const acquired = await redis.set(todayKey, "1", "EX", 86400, "NX");
if (!acquired) return NextResponse.json({ message: "Already reset today" });
// Add to each warmup job:
{ jobId: `warmup-${inbox.id}-${todayKey}` }
```

---

#### [ ] C-12 — IMAP stream: missing `stream.on("error", reject)` — slots blocked on network drop
🟡 **Medium** | `workers/imap-sync/src/index.ts`

```ts
stream.on("error", reject); // add alongside stream.on("end", ...)
// Wrap promise with 30s timeout:
Promise.race([messagePromise, new Promise<never>((_, rej) =>
  setTimeout(() => rej(new Error("Message timeout")), 30_000)
)])
```

---

#### [ ] C-13 — Bull Board: no authentication
🟡 **Medium** | `workers/bull-board/src/index.ts`

```bash
npm install express-basic-auth --workspace=workers/bull-board
```
```ts
import basicAuth from "express-basic-auth";
const u = process.env.BULL_BOARD_USER, p = process.env.BULL_BOARD_PASS;
if (u && p) app.use(basicAuth({ users: { [u]: p }, challenge: true }));
else console.warn("[bull-board] No auth configured — board is unprotected");
```

---

#### [ ] C-14 — Docker: `changeme` default passwords still in `docker-compose.yml`
🟠 **High** | `docker-compose.yml`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
REDIS_PASSWORD:    ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
```

---

#### [ ] C-15 — Backup container: no healthcheck, silent failures
🔵 **Low** | `docker-compose.yml`

```yaml
restart: on-failure
healthcheck:
  test: ["CMD-SHELL", "find /backups -name '*.dump' -mmin -1500 | grep -q ."]
  interval: 1h
  timeout: 10s
  retries: 1
```

---

#### [ ] C-16 — Scraper-worker: `discover` mode not implemented in `processJob`
🔴 **Critical** | `workers/scraper-worker/src/index.ts`

The worker only handles the `enrich` path. The `discover` mode queued by the (missing) scrape-jobs route has no handler — every discovery job will hit the `else` branch and be marked `failed` with "Unknown job type".

**Add `discover` mode dispatch** (full implementation in the integration section below).

---

#### [ ] C-17 — `verify-email` DNS fetch: no timeout
🟡 **Medium** | `apps/web/app/api/leads/verify-email/route.ts`

```ts
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 5000);
try {
  const res = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`, { signal: ctrl.signal });
} catch (e: any) {
  if (e.name === "AbortError") dnsError = true;
} finally { clearTimeout(timer); }
```

---

#### [ ] C-18 — `HARDCODED LEGACY_SALT` startup guard not present
🔴 **Critical** | `packages/database/crypto.ts`

```ts
if (process.env.LEGACY_SALT === "crm-tool-salt-fixed")
  throw new Error("[crypto] LEGACY_SALT is the public default value — insecure");
```

---

## Part 2 — LeadStealth: Full Bug Report

---

### [ ] L-1 — SMTP/IMAP passwords stored in plaintext in the database
🔴 **Critical** | `database/models.py:114,120,126`

`smtp_pass`, `imap_pass`, and `webmail_pass` are all `String(255)` columns — no encryption. Anyone with DB read access has every email credential.

**Fix — encrypt at rest using Fernet (already in requirements):**
```python
# In database/service.py, before saving a SendingAccount:
from cryptography.fernet import Fernet
import config

_fernet = Fernet(config.SECRET_KEY.encode() if len(config.SECRET_KEY) == 44 else Fernet.generate_key())

def encrypt_field(value: str | None) -> str | None:
    if not value: return value
    return _fernet.encrypt(value.encode()).decode()

def decrypt_field(value: str | None) -> str | None:
    if not value: return value
    try: return _fernet.decrypt(value.encode()).decode()
    except Exception: return value  # already plaintext (migration path)

# Wrap in create_sending_account and update_sending_account:
if "smtp_pass" in data: data["smtp_pass"] = encrypt_field(data["smtp_pass"])
if "imap_pass" in data: data["imap_pass"] = encrypt_field(data["imap_pass"])
if "webmail_pass" in data: data["webmail_pass"] = encrypt_field(data["webmail_pass"])

# Decrypt on read in smtp_sender.py and imap_monitor.py:
smtp_pass = decrypt_field(account.smtp_pass)
```

---

### [ ] L-2 — Default admin account `admin/admin` created on first launch — no forced password change
🔴 **Critical** | `auth.py:ensure_default_admin()`

```python
def ensure_default_admin() -> None:
    if count_users() == 0:
        pw = hash_password("admin")
        create_user(username="admin", password_hash=pw, ...)
```

A well-known default credential pair is created silently. No warning is shown after login. No forced password-change flow exists.

**Fix:**
```python
# Set a random initial password and log it prominently:
import secrets
initial_pw = secrets.token_urlsafe(16)
pw = hash_password(initial_pw)
create_user(username="admin", password_hash=pw, display_name="Administrator")
logger.critical("=" * 60)
logger.critical("FIRST-RUN: Default admin created.")
logger.critical("Username: admin  |  Password: %s", initial_pw)
logger.critical("CHANGE THIS PASSWORD IMMEDIATELY after first login.")
logger.critical("=" * 60)

# In login_gate(), add a forced-change flag:
if user.username == "admin" and user.must_change_password:
    st.warning("You must change your password before continuing.")
    # show change password form
```

---

### [ ] L-3 — No rate limiting on login — brute-force vulnerable
🔴 **Critical** | `auth.py:login_gate()`

The login form has zero rate limiting. An attacker can submit unlimited password guesses programmatically.

**Fix:**
```python
import time

FAILED_ATTEMPTS: dict[str, list[float]] = {}
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 300  # 5 minutes

def _check_rate_limit(username: str) -> bool:
    now = time.time()
    attempts = FAILED_ATTEMPTS.get(username, [])
    # Prune old attempts
    attempts = [t for t in attempts if now - t < WINDOW_SECONDS]
    FAILED_ATTEMPTS[username] = attempts
    return len(attempts) < MAX_ATTEMPTS

def _record_failure(username: str) -> None:
    FAILED_ATTEMPTS.setdefault(username, []).append(time.time())

# In login_gate():
if submitted:
    if not _check_rate_limit(username):
        st.error("Too many failed attempts. Try again in 5 minutes.")
        return False
    user = get_user_by_username(username)
    if user and verify_password(password, user.password_hash):
        # ... success
    else:
        _record_failure(username)
        st.error("Invalid username or password.")
```

---

### [ ] L-4 — `SECRET_KEY` generates a new random value on every restart — sessions invalidated
🟠 **High** | `config.py:26-30`

```python
if not SECRET_KEY:
    from cryptography.fernet import Fernet
    SECRET_KEY = Fernet.generate_key().decode("utf-8")
```

A new key is generated each process start. Every user is logged out on every restart. Streamlit `session_state` is in-process memory anyway, but any encrypted data stored between sessions (e.g. cookies) becomes unreadable.

**Fix — require it to be set:**
```python
SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not set. Generate one with: "
        "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        " and add it to your .env file."
    )
```

---

### [ ] L-5 — Scraper has no SSRF protection — any internal URL can be fetched
🔴 **Critical** | `scraper.py:enrich_website()`, `scraper.py:search_*`

`enrich_website` calls `page.goto(base_url)` with no URL validation. If a user passes `url: "http://169.254.169.254"` or `url: "http://localhost:5432"`, Playwright will navigate there.

**Fix — add URL guard at the top of `enrich_website` and `search_*`:**
```python
import ipaddress
from urllib.parse import urlparse

BLOCKED_HOSTS = re.compile(
    r'^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|'
    r'192\.168\.|169\.254\.|::1|0\.0\.0\.0)', re.IGNORECASE
)

def _assert_safe_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Blocked URL scheme: {parsed.scheme}")
    if BLOCKED_HOSTS.match(parsed.hostname or ""):
        raise ValueError(f"Blocked internal host: {parsed.hostname}")

# First line of enrich_website:
_assert_safe_url(base_url)
```

---

### [ ] L-6 — `upsert_lead`: unknown fields silently stored in `extra_data` — data leaks between fields
🟡 **Medium** | `database/service.py:upsert_lead()`

Any key not in the Lead schema columns is silently dumped into `extra_data`. If a caller passes `{"email": "x@y.com", "password": "hunter2"}`, `password` is stored in `extra_data` and returned to any caller of `load_leads()`.

**Fix — allowlist unknown fields and log a warning:**
```python
ALLOWED_EXTRA_KEYS = {"google_maps_url", "yelp_url", "hours", "rating", "review_count", "cms", "wordpress", "shopify", "technologies", "context", "latest_draft"}

for k, v in data.items():
    if k not in known_fields and k != "extra_data":
        if k in ALLOWED_EXTRA_KEYS:
            extra_data[k] = v
        else:
            logger.warning("upsert_lead: ignoring unknown field '%s'", k)
```

---

### [ ] L-7 — IMAP polling marks messages SEEN but never stores a unique message ID — duplicate records on re-poll
🟠 **High** | `email_logic/imap_monitor.py`

The duplicate check uses `(lead_id, direction, subject)` — a blunt instrument. Two emails with the same subject from the same lead will be deduped even if they're different messages. Worse, a third email with a unique subject from an already-processed conversation will always be inserted fresh.

**Fix — fetch and store the IMAP `Message-ID` header:**
```python
# Add message_id column to Message model:
message_id = Column(String(255), nullable=True, index=True)

# In poll_all_inboxes():
msg_id_header = msg.get("Message-ID", "").strip()

existing_msg = s_db.query(Message).filter_by(
    lead_id=lead.id,
    direction="inbound",
    message_id=msg_id_header or None,
).first() if msg_id_header else None

if not existing_msg:
    create_message(..., message_id=msg_id_header or None)
```

---

### [ ] L-8 — `poll_all_inboxes` fetches UNSEEN only — marks them read by fetching, but never calls `STORE +FLAGS (\Seen)`
🟡 **Medium** | `email_logic/imap_monitor.py`

`mail.fetch(email_id, "(RFC822)")` does NOT mark messages as read in most IMAP servers — only `STORE` with `+FLAGS (\Seen)` does. So on the next poll, the same unseen messages are fetched again, causing duplicates.

**Fix — explicitly mark as read after processing:**
```python
# After successfully processing each email_id:
mail.store(email_id, "+FLAGS", "\\Seen")
```

---

### [ ] L-9 — `init_db` uses raw `ALTER TABLE` DDL for migrations — breaks on Postgres
🟠 **High** | `database/service.py:init_db()`

```python
conn.execute(text(f"ALTER TABLE leads ADD COLUMN {col_name} {col_type}"))
```

This works on SQLite but not Postgres (which requires `IF NOT EXISTS` syntax only available in Postgres 9.6+ and not via the SQLAlchemy text API the same way). If `DATABASE_URL` points to Postgres, `init_db` will error on the first run after a schema change.

**Fix — use Alembic (already configured in the repo):**
```bash
alembic upgrade head
```
Remove the `ALTER TABLE` migration block from `init_db`. The `alembic/versions/` directory already has two migrations. Use them properly.

---

### [ ] L-10 — `get_pending_job` optimistic lock is broken on SQLite
🟡 **Medium** | `database/service.py:get_pending_job()`

The optimistic lock relies on a `UPDATE ... WHERE status = "pending"` returning `rows_updated == 1`. On SQLite, `session.query(...).update()` does not always return the number of affected rows reliably when using `expire_on_commit=False` and autoflush. The retry loop can infinite-loop or miss jobs.

**Fix — for SQLite, use a simple SELECT + UPDATE in one session without the optimistic loop:**
```python
if config.DATABASE_URL.startswith("sqlite"):
    with get_session() as s:
        job = s.query(Job).filter(Job.status == "pending", Job.scheduled_at <= now) \
              .order_by(Job.created_at.asc()).first()
        if not job: return None
        job.status = "running"
        job.started_at = now
        return job
```

---

### [ ] L-11 — `run_smtp_campaign` resets `sent_today` inside the accounts loop but writes it via a separate session — race condition
🟡 **Medium** | `email_logic/smtp_sender.py:run_smtp_campaign()`

The loop reads accounts in one session, resets `sent_today` in that session, but the session is closed before sending. The `sent_today` increment is written in a **separate** `with get_session()` block per-send. If the process crashes mid-campaign, `sent_today` is partially incremented in DB but the in-memory `account_list` dict is lost — the next run restarts from 0 and can double-send.

**Fix — track `sent_today` purely in DB, not in a local dict:**
```python
# Each send: atomically increment in DB first, check limit
with get_session() as s:
    acc = s.get(SendingAccount, account_id)
    if acc.sent_today >= acc.daily_limit:
        continue  # skip this account
    acc.sent_today += 1
    acc.last_sent_date = datetime.now(timezone.utc)
# Then send the email
```

---

### [ ] L-12 — `webmail/sender.py`: Gmail credentials passed as plaintext to `asyncio.run()` via job payload
🟠 **High** | `worker.py:_run_job()`, `database/models.py:Job`

```python
asyncio.run(run_webmail_campaign(
    gmail_user=payload.get("gmail_user", ""),
    gmail_pass=payload.get("gmail_pass", ""),
    ...
))
```

Gmail password is stored in the `jobs.payload` JSON column — plaintext in the database. Any DB read returns credentials.

**Fix:** Store Gmail credentials in `SendingAccount` (already exists) and pass only `account_id` in the payload. Look up the credential at runtime and decrypt it using the fix from L-1.

```python
# Job payload: { "account_id": 3, "campaign_id": 1, "dry_run": false }
# At runtime:
account = get_sending_account(payload["account_id"])
gmail_pass = decrypt_field(account.webmail_pass)
```

---

### [ ] L-13 — Spintax parser (`spintax.py`) doesn't handle nested braces
🔵 **Low** | `spintax.py`

Same issue as CRM: `{Hi|Hello {there|friend}}` resolves incorrectly. Use an inside-out iterative parser:
```python
import re, random

def spin(text: str) -> str:
    pattern = re.compile(r'\{([^{}]+)\}')
    for _ in range(10):
        new_text = pattern.sub(lambda m: random.choice(m.group(1).split('|')), text)
        if new_text == text:
            break
        text = new_text
    return text
```

---

### [ ] L-14 — `validate_lead` MX check raises `invalid` on network timeout — valid leads marked bad
🟡 **Medium** | `email_logic/lead_validation.py`

`dns.resolver.resolve()` raises various exceptions on timeout. All exceptions are caught and return `(False, "invalid", ...)`. A transient DNS timeout permanently marks a valid lead as invalid.

**Fix — distinguish transient from permanent failures:**
```python
import dns.exception

try:
    answers = dns.resolver.resolve(domain, 'MX', lifetime=5.0)
    if not answers:
        return False, 'invalid', f'No MX records: {domain}'
except dns.exception.Timeout:
    # Transient — don't invalidate the lead
    logger.warning("MX lookup timed out for %s — skipping MX check", domain)
except dns.resolver.NXDOMAIN:
    return False, 'invalid', f'Domain does not exist: {domain}'
except Exception as e:
    logger.warning("MX lookup error for %s: %s", domain, e)
    # Don't invalidate on unknown errors
```

---

### [ ] L-15 — `process_leads` silently swallows all enrichment exceptions via `return_exceptions=True`
🟡 **Medium** | `processor.py:process_leads()`

```python
await asyncio.gather(*tasks, return_exceptions=True)
```

Any enrichment failure — including DB errors or scraper crashes — is silently discarded. No logging, no retry.

**Fix:**
```python
results = await asyncio.gather(*tasks, return_exceptions=True)
for i, result in enumerate(results):
    if isinstance(result, Exception):
        logger.error("process_leads: task %d failed: %s", i, result)
```

---

### [ ] L-16 — `_find_emails` regex matches image filenames as emails — `logo@2x.png` passes the filter
🔵 **Low** | `scraper.py:_find_emails()`

The `bad` tuple filters extensions in the email string itself (`e.endswith(bad)`), but the regex `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}` would match `logo@2x.png` only if `.png` is the TLD. The real bug is that CSS class names and filenames with `@` (like `font@2x.woff2`) get matched as emails.

**Fix — add minimum domain validation after regex:**
```python
def _find_emails(self, text):
    raw = set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text))
    bad_ext = (".png", ".jpg", ".gif", ".svg", ".css", ".js", ".woff", ".ttf", ".ico", ".webp")
    skip = ("example", "sentry", "noreply", "no-reply", "mailer-daemon", "postmaster")
    return [
        e for e in raw
        if not any(e.lower().endswith(x) for x in bad_ext)
        and not any(s in e.lower() for s in skip)
        and len(e) <= 254
        and '.' in e.split('@')[1]     # domain must have a dot
        and len(e.split('@')[1]) > 3   # domain must be non-trivial
    ]
```

---

## Part 3 — Integration Plan: LeadStealth → CRM

### Architecture Overview

```
LeadStealth (Python / Playwright / SQLite)
        ↓  REST bridge  (new: /api/leadstealth/*)
CRM (Next.js / Prisma / PostgreSQL / BullMQ)
        ↓
Scraper-worker enhanced (discover mode)
        ↓
Enrichment-worker → Leads in CRM with source tagging
```

The cleanest integration strategy is a **REST bridge** — LeadStealth runs as its own service and exposes a small API that the CRM's scraper-worker calls. This avoids rewriting LeadStealth in TypeScript and keeps the Python Playwright environment isolated.

---

### [ ] I-1 — Add a REST API to LeadStealth

Create `leadstealth/api.py` — a FastAPI wrapper that the CRM calls:

```python
# leadstealth/api.py
from fastapi import FastAPI, BackgroundTasks, HTTPException, Depends, Header
from fastapi.security import HTTPBearer
from pydantic import BaseModel, HttpUrl
from typing import Optional
import asyncio, os, uuid
from datetime import datetime, timezone

from database.service import init_db, save_session, load_leads, upsert_lead
from scraper import LeadScraper
from processor import process_leads

app = FastAPI(title="LeadStealth API")
API_KEY = os.environ.get("LEADSTEALTH_API_KEY", "")

def verify_key(x_api_key: str = Header(...)):
    if not API_KEY or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key

class ScrapeRequest(BaseModel):
    query: str
    location: str
    sources: list[str] = ["google_maps", "yellowpages", "yelp"]
    max_results: int = 50

class ScrapeJob(BaseModel):
    job_id: str
    status: str
    leads_found: int = 0

# In-memory job tracker (replace with Redis for production)
_jobs: dict[str, dict] = {}

@app.get("/health")
def health(): return {"ok": True}

@app.post("/scrape", dependencies=[Depends(verify_key)])
async def start_scrape(req: ScrapeRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "running", "leads_found": 0, "started_at": datetime.now(timezone.utc).isoformat()}
    background_tasks.add_task(_run_scrape, job_id, req)
    return {"job_id": job_id, "status": "running"}

@app.get("/scrape/{job_id}", dependencies=[Depends(verify_key)])
def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job: raise HTTPException(404, "Job not found")
    return job

@app.get("/leads", dependencies=[Depends(verify_key)])
def get_leads(limit: int = 100, source: Optional[str] = None):
    df = load_leads()
    if source: df = df[df["source"] == source]
    return {"data": df.tail(limit).to_dict(orient="records"), "total": len(df)}

async def _run_scrape(job_id: str, req: ScrapeRequest):
    scraper = LeadScraper(headful=False)
    try:
        from database.service import load_leads
        df = load_leads()
        for source in req.sources:
            if source == "google_maps":
                df = await process_leads(df, scraper.search_google_maps(req.query, req.location), scraper)
            elif source == "yellowpages":
                df = await process_leads(df, scraper.search_yellowpages(req.query, req.location), scraper)
            elif source == "yelp":
                df = await process_leads(df, scraper.search_yelp(req.query, req.location), scraper)
        _jobs[job_id] = {"status": "completed", "leads_found": len(df), "completed_at": datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        _jobs[job_id] = {"status": "failed", "error": str(e)}
    finally:
        await scraper.close_browser()

if __name__ == "__main__":
    import uvicorn
    init_db()
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

Add to `requirements.txt`:
```
fastapi>=0.111.0
uvicorn>=0.29.0
```

---

### [ ] I-2 — Add LeadStealth service to `docker-compose.yml`

```yaml
leadstealth:
  build:
    context: ./leadstealth
    dockerfile: Dockerfile
  environment:
    DATABASE_URL: ${LEADSTEALTH_DB_URL:-sqlite:///inogen.db}
    SECRET_KEY: ${LEADSTEALTH_SECRET_KEY:?LEADSTEALTH_SECRET_KEY must be set}
    LEADSTEALTH_API_KEY: ${LEADSTEALTH_API_KEY:?LEADSTEALTH_API_KEY must be set}
  ports:
    - "8001:8001"
  volumes:
    - leadstealth_data:/app
  restart: unless-stopped
  healthcheck:
    test: ["CMD-SHELL", "curl -sf http://localhost:8001/health || exit 1"]
    interval: 30s
    timeout: 10s
    retries: 3

volumes:
  leadstealth_data:
```

Create `leadstealth/Dockerfile`:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget gnupg && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium --with-deps
COPY . .
CMD ["python", "api.py"]
```

---

### [ ] I-3 — Add LeadStealth client to CRM shared package

Create `packages/shared/src/leadstealth-client.ts`:

```ts
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
    if (!this.apiKey) throw new Error("LEADSTEALTH_API_KEY is not set");
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json", ...(init?.headers || {}) },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`LeadStealth API error ${res.status}: ${await res.text()}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async startScrape(query: string, location: string, sources?: string[]): Promise<{ job_id: string }> {
    return this.fetch("/scrape", {
      method: "POST",
      body: JSON.stringify({ query, location, sources: sources || ["google_maps", "yellowpages", "yelp"] }),
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
```

Export from `packages/shared/src/index.ts`.

---

### [ ] I-4 — Add CRM API route to proxy LeadStealth scrape jobs

Create `apps/web/app/api/leadstealth/scrape/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prismaClient } from "@crm/database";
import { LeadStealthClient } from "@crm/shared";
import { z } from "zod";

const schema = z.object({
  query: z.string().min(1).max(500),
  location: z.string().min(1).max(500),
  sources: z.array(z.enum(["google_maps", "yellowpages", "yelp"])).default(["google_maps"]),
  jobName: z.string().min(1).max(255),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = session.user.workspaceId;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors }, { status: 400 });

  const { query, location, sources, jobName } = parsed.data;

  // Create a ScrapeJob record in CRM for tracking
  const scrapeJob = await prismaClient.scrapeJob.create({
    data: {
      workspaceId,
      name: jobName,
      targetUrl: `leadstealth://${query} in ${location}`,
      mode: "leadstealth",
      status: "running",
    },
  });

  try {
    const client = new LeadStealthClient();
    const { job_id } = await client.startScrape(query, location, sources);

    await prismaClient.scrapeJob.update({
      where: { id: scrapeJob.id },
      data: { targetUrl: `leadstealth://job/${job_id}` },
    });

    return NextResponse.json({ scrapeJobId: scrapeJob.id, leadsStealthJobId: job_id });
  } catch (err: any) {
    await prismaClient.scrapeJob.update({
      where: { id: scrapeJob.id },
      data: { status: "failed", error: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
```

---

### [ ] I-5 — Add webhook/poll endpoint to import leads from LeadStealth into CRM

Create `apps/web/app/api/leadstealth/import/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prismaClient } from "@crm/database";
import { LeadStealthClient } from "@crm/shared";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = session.user.workspaceId;

  const { source, limit = 500 } = await req.json().catch(() => ({}));

  const client = new LeadStealthClient();
  const { data: leads } = await client.getLeads(limit, source);

  if (!leads.length) return NextResponse.json({ imported: 0 });

  // Batch company resolution
  const domainNames = [...new Set(leads.map(l => l.company).filter(Boolean) as string[])];
  const existingCos = await prismaClient.company.findMany({
    where: { workspaceId, name: { in: domainNames } },
    select: { id: true, name: true },
  });
  const coMap = new Map(existingCos.map(c => [c.name.toLowerCase(), c.id]));

  const newCoNames = domainNames.filter(n => !coMap.has(n.toLowerCase()));
  if (newCoNames.length) {
    await prismaClient.company.createMany({
      data: newCoNames.map(name => ({ workspaceId, name })),
      skipDuplicates: true,
    });
    const created = await prismaClient.company.findMany({
      where: { workspaceId, name: { in: newCoNames } },
      select: { id: true, name: true },
    });
    created.forEach(c => coMap.set(c.name.toLowerCase(), c.id));
  }

  // Pre-check existing emails
  const emails = leads.filter(l => l.email).map(l => l.email!);
  const existing = new Set(
    (await prismaClient.lead.findMany({
      where: { workspaceId, email: { in: emails } },
      select: { email: true },
    })).map(l => l.email)
  );

  const toInsert = leads.filter(l => l.email && !existing.has(l.email));
  if (!toInsert.length) return NextResponse.json({ imported: 0, skipped: existing.size });

  await prismaClient.lead.createMany({
    data: toInsert.map(l => ({
      workspaceId,
      email: l.email!,
      firstName: l.name?.split(" ")[0] || null,
      lastName: l.name?.split(" ").slice(1).join(" ") || null,
      phone: l.phone || null,
      status: "raw",
      sourceUrl: l.google_maps_url || l.website || null,
      scrapedAttributes: JSON.stringify({
        source: l.source,
        company: l.company,
        address: l.address,
        city: l.city,
        state: l.state,
        category: l.category,
        rating: l.rating,
        importedAt: new Date().toISOString(),
      }),
      companyId: l.company ? (coMap.get(l.company.toLowerCase()) ?? null) : null,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ imported: toInsert.length, skipped: existing.size });
}
```

---

### [ ] I-6 — Add env vars to `.env.example` (CRM)

```bash
# LeadStealth integration
LEADSTEALTH_URL=http://leadstealth:8001
LEADSTEALTH_API_KEY=replace_with_strong_random_key
```

---

### [ ] I-7 — Add UI page: `apps/web/app/(dashboard)/leads/discover/page.tsx`

A two-panel UI:
- **Left: Discovery form** — Query (e.g. "plumbers"), Location (e.g. "Austin TX"), Sources (checkboxes: Google Maps / Yellow Pages / Yelp), Start button
- **Right: Active jobs list** — job name, status badge, leads found count, "Import to CRM" button that calls `POST /api/leadstealth/import`

Status polling every 5 seconds while jobs are running, same pattern as the existing scrape-jobs page.

---

## Migration Checklist

```bash
# CRM migrations needed
npx prisma migrate dev --name add_scrape_jobs_proper \
  --schema=packages/database/schema.prisma

npx prisma migrate dev --name remove_stage_sortorder_unique \
  --schema=packages/database/schema.prisma

npx prisma migrate dev --name add_note_content_max_length \
  --schema=packages/database/schema.prisma

# LeadStealth migrations
cd leadstealth && alembic upgrade head
```

---

## Packages to Install

```bash
# CRM
npm install express-basic-auth --workspace=workers/bull-board

# LeadStealth
pip install fastapi uvicorn
```

---

## New `.env` Variables Required

```bash
# CRM additions
BULL_BOARD_USER=admin
BULL_BOARD_PASS=<strong_password>
CRON_SECRET=<random_hex_32>
LEADSTEALTH_URL=http://leadstealth:8001
LEADSTEALTH_API_KEY=<random_hex_32>

# LeadStealth additions
LEADSTEALTH_API_KEY=<same_value_as_above>
SECRET_KEY=<fernet_key>  # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

---

*Full audit of `tkvardaq/Crm` (post-update) + `tkvardaq/leadstealth-upgraded-v2` · June 2026*
