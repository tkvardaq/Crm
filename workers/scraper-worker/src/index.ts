import { Worker, Job } from "bullmq";
import { prismaClient } from "@crm/database";
import { QueueName } from "@crm/shared";
import {
  fetchRawHtml, extractEmails, extractPhones, extractBusinessInfo,
  extractContactPageLinks,
} from "@crm/scraper";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = { url: REDIS_URL, maxRetriesPerRequest: null };

interface ScraperJobData {
  url: string;
  workspaceId: string;
  leadId?: string;
  companyId?: string;
  scrapeJobId?: string;
  mode?: "single" | "crawl" | "sitemap" | "discover";
  maxPages?: number;
  autoEnrich?: boolean;
  query?: string;
  location?: string;
  proxy?: { url: string; username?: string; password?: string };
}

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

const JUNK_DOMAINS = new Set([
  'gov', 'edu', 'mil', 'us', 'state.tx.us', 'state.ny.us', 'state.ca.us',
  'wikipedia.org', 'wikimedia.org', 'britannica.com',
  'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com', 'tiktok.com',
  'youtube.com', 'youtu.be', 'pinterest.com',
  'mastodon.social', 'mastodon.online', 'bsky.app', 'bsky.social',
  'reddit.com', 'quora.com', 'medium.com', 'substack.com',
  'yellowpages.com', 'yelp.com', 'bbb.org', 'chamberofcommerce.com',
  'mapquest.com', 'foursquare.com', 'manta.com',
  'angi.com', 'angieslist.com', 'thumbtack.com', 'homeadvisor.com',
  'houzz.com', 'bark.com', 'nextdoor.com', 'porch.com', 'modernize.com',
  'homeguide.com', 'fixr.com', 'expertise.com', 'locallife.com',
  'bytescraper.com', 'medicoleads.com', 'zoominfo.com', 'apollo.io',
  'hunter.io', 'snov.io', 'rocketreach.co', 'lusha.com', 'clearbit.com',
  'upcity.com', 'clutch.co', 'goodfirms.co', 'sortlist.com',
  'dandb.com', 'opendi.com', 'superpages.com', 'merchantcircle.com',
  'locallabs.com', 'local.com', 'citysearch.com', 'insiderpages.com',
  'dexknows.com', 'kudzu.com', 'talklocal.com', 'homestars.com',
  'amazon.com', 'ebay.com', 'walmart.com', 'craigslist.org',
  'glassdoor.com', 'indeed.com', 'ziprecruiter.com', 'monster.com',
]);

function isJunkDomain(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (JUNK_DOMAINS.has(lower)) return true;
  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const tld = parts.slice(i).join('.');
    if (JUNK_DOMAINS.has(tld)) return true;
  }
  if (lower.includes('.gov') || lower.includes('.edu') || lower.includes('.mil')) return true;
  if (lower.endsWith('.state.tx.us') || lower.endsWith('.state.ny.us')) return true;
  return false;
}

const GENERIC_EMAIL_PREFIXES = [
  'info@', 'contact@', 'support@', 'admin@', 'office@', 'hello@',
  'service@', 'help@', 'feedback@', 'mail@', 'team@',
  'admissions@', 'enrollment@', 'registrar@',
  'sales@', 'marketing@', 'pr@', 'media@',
  'billing@', 'accounts@', 'payroll@',
  'legal@', 'compliance@', 'privacy@',
  'careers@', 'jobs@', 'hr@', 'recruiting@',
  'press@', 'news@', 'editor@',
];

function isGenericEmail(email: string): boolean {
  return GENERIC_EMAIL_PREFIXES.some(p => email.toLowerCase().startsWith(p));
}

function getDomainFromEmail(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

function isRealBusinessEmail(email: string, bizDomain?: string): boolean {
  const domain = getDomainFromEmail(email);
  if (!domain) return false;

  if (isJunkDomain(domain)) return false;

  if (bizDomain && domain === bizDomain) return true;

  if (isGenericEmail(email) && bizDomain && domain !== bizDomain) return false;

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const SEARCH_ENGINES = {
  startpage: (query: string) =>
    `https://www.startpage.com/do/search?q=${encodeURIComponent(query)}`,
  mojeek: (query: string) =>
    `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`,
};

function isUrlAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (isJunkDomain(host)) return false;
    const blockedHosts = ['startpage', 'google', 'bing', 'duckduckgo', 'facebook', 'twitter',
      'instagram', 'linkedin', 'youtube', 'mastodon', 'bsky', 'tiktok', 'pinterest',
      'mojeek', 'yelp', 'reddit', 'quora', 'medium', 'substack', 'wikipedia'];
    if (blockedHosts.some(b => host.includes(b))) return false;
    const blockedPaths = ['/search', '/images/', '/news/', '/videos/'];
    const path = new URL(url).pathname.toLowerCase();
    if (blockedPaths.some(p => path.startsWith(p))) return false;
    return true;
  } catch {
    return false;
  }
}

function extractUrlsFromStartpage(html: string): string[] {
  const urls: string[] = [];
  const regex = /href="(https?:\/\/[^"]+)"/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    if (isUrlAllowed(m[1])) urls.push(m[1]);
  }
  return urls;
}

function extractUrlsFromMojeek(html: string): string[] {
  const urls: string[] = [];

  const classOb = /class="ob"[^>]*href="(https?:\/\/[^"]+)"/g;
  let m;
  while ((m = classOb.exec(html)) !== null) {
    if (isUrlAllowed(m[1])) urls.push(m[1]);
  }

  if (urls.length === 0) {
    const olResults = /<li class="results-standard">[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"/g;
    while ((m = olResults.exec(html)) !== null) {
      if (isUrlAllowed(m[1])) urls.push(m[1]);
    }
  }

  return urls;
}

async function searchMultipleEngines(queries: string[]): Promise<string[]> {
  const allUrls: string[] = [];
  const seenHosts = new Set<string>();

  for (const query of queries) {
    for (const [engineName, engineUrl] of Object.entries(SEARCH_ENGINES)) {
      try {
        const url = engineUrl(query);
        console.log(`[scraper-worker] Searching ${engineName}: "${query}"`);
        const html = await fetchRawHtml(url);

        let urls: string[] = [];
        if (engineName === 'startpage') {
          urls = extractUrlsFromStartpage(html);
        } else if (engineName === 'mojeek') {
          urls = extractUrlsFromMojeek(html);
        }

        let added = 0;
        for (const u of urls) {
          try {
            const host = new URL(u).hostname.replace(/^www\./, '');
            if (!seenHosts.has(host) && !isJunkDomain(host)) {
              seenHosts.add(host);
              allUrls.push(u);
              added++;
            }
          } catch {}
        }
        console.log(`[scraper-worker] ${engineName}: found ${urls.length} URLs, ${added} new unique`);

        await sleep(2000 + Math.random() * 3000);
      } catch (err: any) {
        console.log(`[scraper-worker] ${engineName} failed for "${query}": ${err.message}`);
      }
    }
  }

  return allUrls;
}

interface ScrapedLead {
  email?: string;
  phone?: string;
  name?: string;
  website: string;
}

async function scrapeWebsiteForLeads(url: string): Promise<ScrapedLead[]> {
  try {
    const parsedUrl = new URL(url);
    const bizDomain = parsedUrl.hostname.replace(/^www\./, '');

    const html = await fetchRawHtml(url);
    const emails = extractEmails(html);
    const phones = extractPhones(html);
    const bizInfo = extractBusinessInfo(html);

    const leads: ScrapedLead[] = [];

    const contactLinks = extractContactPageLinks(html, url);
    let contactEmails: string[] = [];
    let contactPhones: string[] = [];
    let contactBizInfo = bizInfo;

    for (const contactUrl of contactLinks.slice(0, 2)) {
      try {
        const contactHtml = await fetchRawHtml(contactUrl);
        contactEmails = [...contactEmails, ...extractEmails(contactHtml)];
        contactPhones = [...contactPhones, ...extractPhones(contactHtml)];
        const cBiz = extractBusinessInfo(contactHtml);
        if (cBiz.name && cBiz.name.length > (contactBizInfo.name?.length || 0)) {
          contactBizInfo = cBiz;
        }
      } catch {}
    }

    const allEmails = [...new Set([...emails, ...contactEmails])];
    const allPhones = [...new Set([...phones, ...contactPhones])];

    const primaryEmail = allEmails.find(e => isRealBusinessEmail(e, bizDomain)) || allEmails[0];
    const primaryPhone = allPhones.find(p => !p.startsWith('800') && !p.startsWith('888') && !p.startsWith('877')) || allPhones[0];

    if (primaryEmail || primaryPhone) {
      leads.push({
        email: primaryEmail,
        phone: primaryPhone,
        name: contactBizInfo.name || bizInfo.name,
        website: url,
      });
    }

    for (const email of allEmails) {
      if (email !== primaryEmail && isRealBusinessEmail(email, bizDomain)) {
        leads.push({
          email,
          phone: undefined,
          name: contactBizInfo.name || bizInfo.name,
          website: url,
        });
      }
    }

    return leads;
  } catch (err: any) {
    return [];
  }
}

async function processScraper(job: Job<ScraperJobData>) {
  const { url, workspaceId, leadId, companyId, scrapeJobId, mode = "single", autoEnrich = false, maxPages = 20 } = job.data;
  assertSafeUrl(url);

  if (scrapeJobId) {
    await prismaClient.scrapeJob.update({
      where: { id: scrapeJobId, workspaceId },
      data: { status: "running" },
    }).catch(() => {});
  }

  try {
    if (mode === "discover") {
      const query = job.data.query || "";
      const location = job.data.location || "";

      const searchQueries = [
        `${query} ${location} contact us email`,
        `${query} ${location} email address phone`,
        `${query} near ${location} about us`,
        `${query} company ${location} contact`,
      ];

      console.log(`[scraper-worker] Starting search with ${searchQueries.length} queries across 2 engines`);
      const uniqueUrls = await searchMultipleEngines(searchQueries);
      console.log(`[scraper-worker] Total unique candidate URLs after filtering: ${uniqueUrls.length}`);

      const urlsToScrape = uniqueUrls.slice(0, maxPages);
      const leadsToSave: ScrapedLead[] = [];

      for (let i = 0; i < urlsToScrape.length; i++) {
        const targetUrl = urlsToScrape[i];
        console.log(`[scraper-worker] [${i + 1}/${urlsToScrape.length}] Scraping ${targetUrl}`);
        const found = await scrapeWebsiteForLeads(targetUrl);
        leadsToSave.push(...found);
        console.log(`[scraper-worker] -> Found ${found.length} leads from ${targetUrl}`);
      }

      let leadsCreated = 0;
      const savedEmails = new Set<string>();
      const savedPhones = new Set<string>();

      for (const lead of leadsToSave) {
        if (lead.email && !savedEmails.has(lead.email)) {
          savedEmails.add(lead.email);
          try {
            const nameParts = (lead.name || '').split(/\s+/).filter(Boolean);
            await prismaClient.lead.upsert({
              where: { workspaceId_email: { workspaceId, email: lead.email } },
              create: {
                workspaceId,
                email: lead.email,
                firstName: nameParts[0] || null,
                lastName: nameParts.slice(1).join(' ') || null,
                phone: lead.phone || null,
                status: "raw",
                scrapeJobId: scrapeJobId ?? null,
                scrapedAttributes: JSON.stringify({
                  sourceUrl: lead.website,
                  discovered: true,
                  businessName: lead.name,
                }),
              },
              update: {
                phone: lead.phone || undefined,
                scrapeJobId: scrapeJobId ?? undefined,
              },
            });
            leadsCreated++;
          } catch (err: any) {
            console.log(`[scraper-worker] Failed to save lead ${lead.email}: ${err.message}`);
          }
        } else if (lead.phone && !lead.email && !savedPhones.has(lead.phone)) {
          const digits = lead.phone.replace(/\D/g, '');
          if (digits.length >= 10) {
            savedPhones.add(lead.phone);
            const phoneHash = `phone_${digits}`;
            try {
              const nameParts = (lead.name || '').split(/\s+/).filter(Boolean);
              await prismaClient.lead.upsert({
                where: { workspaceId_email: { workspaceId, email: phoneHash } },
                create: {
                  workspaceId,
                  email: phoneHash,
                  firstName: nameParts[0] || null,
                  lastName: nameParts.slice(1).join(' ') || null,
                  phone: lead.phone,
                  status: "raw",
                  scrapeJobId: scrapeJobId ?? null,
                  scrapedAttributes: JSON.stringify({
                    sourceUrl: lead.website,
                    discovered: true,
                    businessName: lead.name,
                  }),
                },
                update: {},
              });
              leadsCreated++;
            } catch {}
          }
        }
      }

      if (scrapeJobId) {
        await prismaClient.scrapeJob.update({
          where: { id: scrapeJobId, workspaceId },
          data: {
            status: "completed",
            leadsFound: leadsCreated,
            pagesScraped: urlsToScrape.length,
            completedAt: new Date(),
          },
        }).catch(() => {});
      }

      console.log(
        `[scraper-worker] Discover complete: ${leadsCreated} leads from ${urlsToScrape.length} pages`
      );

      return {
        url,
        leadsCreated,
        pagesScraped: urlsToScrape.length,
        scrapedAt: new Date().toISOString(),
      };
    }

    const html = await fetchRawHtml(url);
    const emails = extractEmails(html);
    const phones = extractPhones(html);
    const bizInfo = extractBusinessInfo(html);

    let singleLeadsCreated = 0;
    if (!leadId && !companyId && (emails.length > 0 || phones.length > 0)) {
      for (const email of emails.slice(0, 10)) {
        await prismaClient.lead.upsert({
          where: { workspaceId_email: { workspaceId, email } },
          create: {
            workspaceId,
            email,
            firstName: bizInfo.name?.split(/\s+/)[0] || null,
            phone: phones[0] || null,
            status: "raw",
            scrapeJobId: scrapeJobId ?? null,
            scrapedAttributes: JSON.stringify({ sourceUrl: url, businessName: bizInfo.name }),
          },
          update: {
            scrapeJobId: scrapeJobId ?? undefined,
            scrapedAttributes: JSON.stringify({ sourceUrl: url, businessName: bizInfo.name }),
          },
        });
        singleLeadsCreated++;
      }
    }

    if (scrapeJobId) {
      await prismaClient.scrapeJob.update({
        where: { id: scrapeJobId, workspaceId },
        data: {
          status: "completed",
          leadsFound: singleLeadsCreated,
          pagesScraped: 1,
          completedAt: new Date(),
        },
      }).catch(() => {});
    }

    return { url, emails, phones, bizInfo, leadsCreated: singleLeadsCreated, scrapedAt: new Date().toISOString() };
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

const worker = new Worker<ScraperJobData>(QueueName.SCRAPER, processScraper, {
  connection,
  concurrency: 1,
});

worker.on("completed", (job) => {
  console.log(`[scraper-worker] Completed job ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[scraper-worker] Failed job ${job?.id}:`, err.message);
});

worker.on("error", (err) => {
  console.error("[scraper-worker] Worker error:", err);
});

console.log("[scraper-worker] Worker started");

process.on("SIGTERM", async () => {
  console.log("[scraper-worker] SIGTERM received, shutting down gracefully...");
  await worker.close();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[scraper-worker] SIGINT received, shutting down gracefully...");
  await worker.close();
  await prismaClient.$disconnect().catch(() => {});
  process.exit(0);
});
