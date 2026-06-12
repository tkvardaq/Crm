import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { HttpsProxyAgent } from 'https-proxy-agent';

interface FetchOptions extends RequestInit {
  agent?: HttpsProxyAgent;
}

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

function getProxyAgent(proxy: ProxyConfig): HttpsProxyAgent | undefined {
  if (!proxy.url) return undefined;
  if (proxy.username && proxy.password) {
    const parsed = new URL(proxy.url);
    parsed.username = proxy.username;
    parsed.password = proxy.password;
    return new HttpsProxyAgent(parsed.toString());
  }
  return new HttpsProxyAgent(proxy.url);
}

export async function scrapeUrl(url: string, proxy?: ProxyConfig): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30000);

	try {
		const headers: Record<string, string> = {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.5',
		};

		const fetchOptions: FetchOptions = {
			signal: controller.signal,
			headers,
		};

		if (proxy?.url) {
			const agent = getProxyAgent(proxy);
			if (agent) {
				fetchOptions.agent = agent;
			}
		}

		const response = await fetch(url, fetchOptions);
		const html = await response.text();
		return htmlToMarkdown(html);
	} finally {
		clearTimeout(timeout);
	}
}

export async function fetchRawHtml(url: string, proxy?: ProxyConfig): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30000);

	try {
		const headers: Record<string, string> = {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.5',
		};

		const fetchOptions: FetchOptions = {
			signal: controller.signal,
			headers,
		};

		if (proxy?.url) {
			const agent = getProxyAgent(proxy);
			if (agent) {
				fetchOptions.agent = agent;
			}
		}

		const response = await fetch(url, fetchOptions);
		return await response.text();
	} finally {
		clearTimeout(timeout);
	}
}

export function htmlToMarkdown(rawHtml: string): string {
  const scripts: string[] = [];
  let index = 0;
  const cleaned = rawHtml.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, () => {
    scripts.push(`[SCRIPT ${index++}]`);
    return `[SCRIPT ${index - 1}]`;
  });

  const $ = cheerio.load(cleaned);
  ['nav', 'footer', 'header', 'aside'].forEach(tag => $(tag).remove());
  const result = tdService.turndown($.html());
  return result;
}

export function extractEmails(html: string): string[] {
  const $ = cheerio.load(html);
  const emails: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (match) emails.push(match[0]);
  });
  return [...new Set(emails)];
}

export function extractMeta(html: string): { title?: string; description?: string; ogImage?: string } {
  const $ = cheerio.load(html);
  return {
    title: $('meta[property="og:title"]').attr('content') || $('title').text() || undefined,
    description: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || undefined,
    ogImage: $('meta[property="og:image"]').attr('content') || undefined,
  };
}
