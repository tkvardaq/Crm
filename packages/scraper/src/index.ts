import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const tdService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

export interface ProxyConfig {
  url: string;
  username?: string;
  password?: string;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

export async function scrapeUrl(url: string, proxy?: ProxyConfig): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: DEFAULT_HEADERS });
    const html = await response.text();
    return htmlToMarkdown(html);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRawHtml(url: string, proxy?: ProxyConfig): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: DEFAULT_HEADERS, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) throw new Error(`Not HTML: ${ct}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export function htmlToMarkdown(rawHtml: string): string {
  const cleaned = rawHtml.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '');
  const $ = cheerio.load(cleaned);
  ['nav', 'footer', 'header', 'aside', 'script', 'style'].forEach(tag => $(tag).remove());
  return tdService.turndown($.html());
}

const JUNK_EMAIL_DOMAINS = new Set([
  'example.com', 'sentry.io', 'wixpress.com', 'w3.org', 'schema.org',
  'googleapis.com', 'google.com', 'facebook.com', 'twitter.com',
  'wordpress.org', 'wordpress.com', 'gravatar.com', 'w.org',
  'jquery.com', 'bootstrapcdn.com', 'cloudflare.com', 'amazonaws.com',
  'squarespace.com', 'wix.com', 'weebly.com', 'godaddy.com',
  'googleapis.com', 'gstatic.com', 'youtube.com', 'youtu.be',
  'instagram.com', 'tiktok.com', 'pinterest.com', 'yelp.com',
  'bbb.org', 'chamberofcommerce.com', 'yellowpages.com',
  'mapquest.com', 'foursquare.com', 'angi.com', 'angieslist.com',
  'thumbtack.com', 'homeadvisor.com', 'houzz.com', 'bark.com',
  'nextdoor.com', 'manta.com', 'locallife.com', 'expertise.com',
  'porch.com', 'modernize.com', 'homeguide.com', 'fixr.com',
  'bytescraper.com', 'medicoleads.com', 'zoominfo.com', 'apollo.io',
  'hunter.io', 'snov.io', 'rocketreach.co', 'lusha.com',
]);

const JUNK_EMAIL_PREFIXES = [
  'your@', 'name@', 'email@', 'user@', 'test@', 'admin@',
  'noreply@', 'no-reply@', 'donotreply@', 'mailer-daemon@',
  'postmaster@', 'webmaster@', 'hostmaster@', 'abuse@',
  'spam@', 'unsubscribe@',
];

export function isJunkEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const domain = lower.split('@')[1] || '';
  const local = lower.split('@')[0] || '';

  if (JUNK_EMAIL_DOMAINS.has(domain)) return true;
  if (JUNK_EMAIL_PREFIXES.some(p => lower.startsWith(p))) return true;

  if (domain.includes('sentry')) return true;
  if (domain.includes('wixpress')) return true;
  if (domain.includes('squarespace') || domain.includes('wix.com') || domain.includes('weebly')) return true;
  if (domain.includes('googleapis') || domain.includes('gstatic') || domain.includes('cloudfront')) return true;

  if (local.length > 20 && /^[a-f0-9]+$/.test(local)) return true;

  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.gif') || lower.endsWith('.webp')) return true;
  if (lower.includes('example.com') || lower.includes('test.com') || lower.includes('domain.com')) return true;

  if (local.length > 64) return true;

  return false;
}

export function extractEmails(html: string): string[] {
  const $ = cheerio.load(html);
  const emails: Set<string> = new Set();

  $('a[href^="mailto:"]').each((_, el) => {
    const email = $(el).attr('href')?.replace('mailto:', '').split('?')[0]?.trim();
    if (email && email.includes('@') && email.includes('.')) emails.add(email.toLowerCase());
  });

  const bodyText = $.text();
  const regex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  let match;
  while ((match = regex.exec(bodyText)) !== null) {
    const email = match[0].toLowerCase();
    if (email.includes('@') && email.includes('.')) emails.add(email);
  }

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (m) emails.add(m[0].toLowerCase());
  });

  return [...emails].filter(e => !isJunkEmail(e));
}

export function extractPhones(html: string): string[] {
  const $ = cheerio.load(html);
  const phones: Set<string> = new Set();

  $('a[href^="tel:"]').each((_, el) => {
    const phone = $(el).attr('href')?.replace('tel:', '')?.trim();
    if (phone && phone.length >= 7) phones.add(phone);
  });

  const bodyText = $.text();
  const regex = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
  let match;
  while ((match = regex.exec(bodyText)) !== null) {
    const phone = match[0].trim();
    if (phone.replace(/\D/g, '').length >= 10) phones.add(phone);
  }

  return [...phones];
}

export function extractBusinessInfo(html: string): { name?: string; description?: string } {
  const $ = cheerio.load(html);

  let name = '';

  const jsonLd = $('script[type="application/ld+json"]').first().text();
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd);
      if (data.name) name = data.name;
      if (data['@graph']) {
        const org = data['@graph'].find((i: any) => i['@type'] === 'LocalBusiness' || i['@type'] === 'Organization' || i['@type'] === 'Plumber');
        if (org?.name) name = org.name;
      }
    } catch {}
  }

  if (!name) {
    name = $('meta[property="og:site_name"]').attr('content') || '';
  }

  if (!name) {
    const title = $('title').text() || '';
    const GENERIC = /^(contact|about|home|welcome|our services|services|blog|news|faq|support|help|privacy|terms|login|sign in|search|plumbers?\s+in|dentists?\s+in|electricians?\s+in|contractors?\s+in|hvacs?\s+in|roofers?\s+in|painters?\s+in|movers?\s+in|cleaners?\s+in)/i;
    const parts = title.split(/[|\-–—]/).map(s => s.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p && p.length > 2 && p.length < 100 && !GENERIC.test(p)) {
        name = p;
        break;
      }
    }
    if (!name && parts[0] && parts[0].length > 2 && parts[0].length < 100 && !GENERIC.test(parts[0])) {
      name = parts[0];
    }
  }

  if (!name) {
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length > 2 && h1.length < 100) {
      const GENERIC = /^(contact|about|home|welcome|our services|services|blog|news|faq|support|help)$/i;
      if (!GENERIC.test(h1)) name = h1;
    }
  }

  const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
  return { name: name || undefined, description: description || undefined };
}

export function extractContactPageLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const base = new URL(baseUrl);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().toLowerCase().trim();
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== base.hostname) return;
      if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return;

      const path = resolved.pathname.toLowerCase();
      const isContactLink = text.includes('contact') || text.includes('about') || text.includes('reach') ||
        text.includes('location') || text.includes('team') || text.includes('staff') ||
        path.includes('/contact') || path.includes('/about') || path.includes('/reach') ||
        path.includes('/location') || path.includes('/team') || path.includes('/staff') ||
        path.includes('/our-') || path.includes('/meet-');

      if (isContactLink) {
        links.push(resolved.href);
      }
    } catch {}
  });

  return [...new Set(links)].slice(0, 5);
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: Set<string> = new Set();
  const base = new URL(baseUrl);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    try {
      const resolved = new URL(href, base.origin);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        links.add(resolved.href);
      }
    } catch {}
  });

  return [...links].slice(0, 30);
}

export function extractExternalLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: Set<string> = new Set();
  let baseHost = '';
  try { baseHost = new URL(baseUrl).hostname; } catch {}

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    try {
      const resolved = new URL(href, baseUrl);
      if ((resolved.protocol === 'http:' || resolved.protocol === 'https:') &&
          resolved.hostname !== baseHost &&
          !resolved.hostname.includes('google') &&
          !resolved.hostname.includes('gstatic') &&
          !resolved.hostname.includes('youtube') &&
          !resolved.hostname.includes('facebook') &&
          !resolved.hostname.includes('twitter')) {
        links.add(resolved.href);
      }
    } catch {}
  });

  return [...links].slice(0, 15);
}

export interface BusinessLead {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  source: string;
}

export function extractBusinessLeadsFromSearch(html: string, searchUrl: string): BusinessLead[] {
  const $ = cheerio.load(html);
  const leads: BusinessLead[] = [];

  $('div[data-attrid], div[data-container-id], div.VkpGBb, div[jscontroller]').each((_, el) => {
    const $el = $(el);
    const name = $el.find('div[role="heading"], .dbg0pd, .OSrXXb, .cXedhc').first().text().trim();
    const phone = $el.find('a[href^="tel:"]').first().attr('href')?.replace('tel:', '')?.trim();
    const website = $el.find('a[href*="http"]').map((_, a) => $(a).attr('href')).get()
      .find(h => h && !h.includes('google') && !h.includes('maps'));
    const address = $el.find('.rllt__details div:last-child, span.LrzXr').first().text().trim();

    if (name && name.length > 2 && name.length < 200) {
      leads.push({
        name,
        phone: phone || undefined,
        website: website || undefined,
        address: address || undefined,
        source: searchUrl,
      });
    }
  });

  if (leads.length === 0) {
    $('a[href*="/maps/place/"]').each((_, el) => {
      const $a = $(el);
      const name = $a.text().trim() || $a.find('span').first().text().trim();
      if (name && name.length > 2) {
        leads.push({ name, source: searchUrl });
      }
    });
  }

  return leads;
}
