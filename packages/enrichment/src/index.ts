export type AdapterMode = "mock" | "live";

export interface EnrichmentResult {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  title?: string;
  linkedinUrl?: string;
  confidence: number;
  source: string;
}

export interface EnrichmentAdapter {
  mode: AdapterMode;
  enrichByDomain(domain: string): Promise<Partial<EnrichmentResult>>;
  enrichByEmail(email: string): Promise<Partial<EnrichmentResult>>;
  verifyEmail(email: string): Promise<boolean>;
}

export class MockEnrichmentAdapter implements EnrichmentAdapter {
  mode: AdapterMode = "mock";

  async enrichByDomain(domain: string): Promise<Partial<EnrichmentResult>> {
    return {
      company: domain.replace(/^www\./, "").split(".")[0] + " Inc",
      confidence: 0.7,
      source: "mock",
    };
  }

  async enrichByEmail(email: string): Promise<Partial<EnrichmentResult>> {
    const [local] = email.split("@");
    return {
      firstName: local.split(".")[0] || local,
      confidence: 0.5,
      source: "mock",
    };
  }

  async verifyEmail(email: string): Promise<boolean> {
    return email.includes("@") && email.includes(".");
  }
}

export class WaterfallEnrichmentService {
  private adapters: EnrichmentAdapter[] = [];
  private allowMock: boolean;

  constructor(allowMock = false) {
    this.allowMock = allowMock;
  }

  addAdapter(adapter: EnrichmentAdapter) {
    this.adapters.push(adapter);
  }

  async enrichByDomain(domain: string): Promise<EnrichmentResult> {
    for (const adapter of this.adapters) {
      if (adapter.mode === "mock" && !this.allowMock) continue;
      try {
        const result = await adapter.enrichByDomain(domain);
        if (result && result.confidence && result.confidence > 0.6) {
          return { ...result, source: adapter.constructor.name } as EnrichmentResult;
        }
      } catch {
        // Try next adapter
      }
    }
    const mock = new MockEnrichmentAdapter();
    return await mock.enrichByDomain(domain) as EnrichmentResult;
  }

  async enrichByEmail(email: string): Promise<EnrichmentResult> {
    for (const adapter of this.adapters) {
      if (adapter.mode === "mock" && !this.allowMock) continue;
      try {
        const result = await adapter.enrichByEmail(email);
        if (result && result.confidence && result.confidence > 0.6) {
          return { ...result, source: adapter.constructor.name } as EnrichmentResult;
        }
      } catch {
        // Try next adapter
      }
    }
    const mock = new MockEnrichmentAdapter();
    return await mock.enrichByEmail(email) as EnrichmentResult;
  }
}

export class DnsEnrichmentAdapter implements EnrichmentAdapter {
  mode: AdapterMode = "live";

  async enrichByDomain(domain: string): Promise<Partial<EnrichmentResult>> {
    try {
      const [mxRes, txtRes] = await Promise.allSettled([
        fetch(`https://dns.google/resolve?name=${domain}&type=MX`),
        fetch(`https://dns.google/resolve?name=${domain}&type=TXT`),
      ]);
      let hasMx = false;
      let usesGoogle = false;
      if (mxRes.status === "fulfilled") {
        const mxData = await mxRes.value.json();
        hasMx = mxData.Answer?.length > 0;
        const mxTargets: string[] = (mxData.Answer || []).map((a: any) => a.data?.toLowerCase() || "");
        usesGoogle = mxTargets.some((t) => t.includes("google") || t.includes("googlemail"));
      }
      let hasSpf = false;
      if (txtRes.status === "fulfilled") {
        const txtData = await txtRes.value.json();
        const txtRecords: string[] = (txtData.Answer || []).map((a: any) => a.data || "");
        hasSpf = txtRecords.some((t) => t.includes("v=spf1"));
      }
      const companyName = domain.replace(/^www\./, "").split(".")[0];
      const capitalized = companyName.charAt(0).toUpperCase() + companyName.slice(1);
      const confidence = hasMx ? 0.65 : 0.3;
      return {
        company: capitalized,
        confidence,
        source: "dns",
      };
    } catch (err) {
      console.error(`[DnsEnrichmentAdapter] enrichByDomain(${domain}) failed:`, err);
      return { confidence: 0, source: "dns" };
    }
  }

  async enrichByEmail(email: string): Promise<Partial<EnrichmentResult>> {
    const domain = email.split("@")[1];
    if (!domain) return { confidence: 0, source: "dns" };
    try {
      const res = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`);
      const data = await res.json();
      const hasMx = data.Answer?.length > 0;
      return {
        confidence: hasMx ? 0.7 : 0.1,
        source: "dns",
      };
    } catch {
      return { confidence: 0, source: "dns" };
    }
  }

  async verifyEmail(email: string): Promise<boolean> {
    const domain = email.split("@")[1];
    if (!domain) return false;
    try {
      const res = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`);
      const data = await res.json();
      return data.Answer?.length > 0;
    } catch {
      return false;
    }
  }
}

export class GitHubEnrichmentAdapter implements EnrichmentAdapter {
  mode: AdapterMode = "live";

  async enrichByDomain(domain: string): Promise<Partial<EnrichmentResult>> {
    try {
      const orgName = domain.replace(/^www\./, "").split(".")[0];
      const res = await fetch(`https://api.github.com/orgs/${orgName}`, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (!res.ok) return { confidence: 0, source: "github" };
      const data = await res.json();
      return {
        company: data.name || data.login,
        confidence: 0.75,
        source: "github",
      };
    } catch {
      return { confidence: 0, source: "github" };
    }
  }

  async enrichByEmail(email: string): Promise<Partial<EnrichmentResult>> {
    try {
      const [local, domain] = email.split("@");
      const username = local.split(/[._+-]/)[0];
      const res = await fetch(`https://api.github.com/search/users?q=${username}+in:login`, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (!res.ok) return { confidence: 0, source: "github" };
      const data = await res.json();
      if (data.total_count === 0) return { confidence: 0.2, source: "github" };
      const user = data.items[0];
      const profileRes = await fetch(`https://api.github.com/users/${user.login}`, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (!profileRes.ok) return { confidence: 0.2, source: "github" };
      const profile = await profileRes.json();
      const nameParts = (profile.name || "").split(" ");
      return {
        firstName: nameParts[0] || undefined,
        lastName: nameParts.slice(1).join(" ") || undefined,
        company: profile.company || undefined,
        linkedinUrl: profile.blog?.includes("linkedin") ? profile.blog : undefined,
        confidence: profile.name ? 0.7 : 0.4,
        source: "github",
      };
    } catch {
      return { confidence: 0, source: "github" };
    }
  }

  async verifyEmail(email: string): Promise<boolean> {
    const domain = email.split("@")[1];
    if (!domain) return false;
    try {
      const res = await fetch(`https://api.github.com/orgs/${domain.split(".")[0]}`, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class ClearbitLogoAdapter implements EnrichmentAdapter {
  mode: AdapterMode = "live";

  async enrichByDomain(domain: string): Promise<Partial<EnrichmentResult>> {
    const companyName = domain.replace(/^www\./, "").split(".")[0];
    const capitalized = companyName.charAt(0).toUpperCase() + companyName.slice(1);
    return {
      company: capitalized,
      confidence: 0.5,
      source: "clearbit-logo",
    };
  }

  async enrichByEmail(_email: string): Promise<Partial<EnrichmentResult>> {
    return { confidence: 0, source: "clearbit-logo" };
  }

  async verifyEmail(_email: string): Promise<boolean> {
    return false;
  }
}

export class WebsiteAiAdapter implements EnrichmentAdapter {
  mode: AdapterMode = "live";
  private nvidiaApiKey: string;

  constructor(nvidiaApiKey: string) {
    this.nvidiaApiKey = nvidiaApiKey;
  }

  async enrichByDomain(domain: string): Promise<Partial<EnrichmentResult>> {
    try {
      const url = domain.startsWith("http") ? domain : `https://${domain}`;
      const scrapeRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CRM-Bot/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!scrapeRes.ok) return { confidence: 0, source: "website-ai" };
      const html = await scrapeRes.text();
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/i);
      const ogTitle = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["'](.*?)["']/i);
      const companyName = ogTitle?.[1] || titleMatch?.[1]?.replace(/ - .+| \| .+/, "").trim();
      if (!companyName) return { confidence: 0.3, source: "website-ai" };
      return {
        company: companyName,
        confidence: 0.6,
        source: "website-ai",
      };
    } catch {
      return { confidence: 0, source: "website-ai" };
    }
  }

  async enrichByEmail(email: string): Promise<Partial<EnrichmentResult>> {
    const domain = email.split("@")[1];
    if (!domain) return { confidence: 0, source: "website-ai" };
    try {
      const url = `https://${domain}`;
      const scrapeRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CRM-Bot/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!scrapeRes.ok) return { confidence: 0, source: "website-ai" };
      const html = await scrapeRes.text();
      const aboutLinks = html.match(/href=["'](\/[^"']*about[^"']*)["']/gi);
      if (!aboutLinks || aboutLinks.length === 0) return { confidence: 0.2, source: "website-ai" };
      const aboutPath = aboutLinks[0].match(/href=["']([^"']+)["']/i)?.[1];
      if (!aboutPath) return { confidence: 0.2, source: "website-ai" };
      const aboutUrl = aboutPath.startsWith("http") ? aboutPath : `${url}${aboutPath}`;
      const aboutRes = await fetch(aboutUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CRM-Bot/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!aboutRes.ok) return { confidence: 0.2, source: "website-ai" };
      const aboutHtml = await aboutRes.text();
      const textContent = aboutHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 4000);
      if (!this.nvidiaApiKey) return { confidence: 0.2, source: "website-ai" };
      const aiRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.nvidiaApiKey}`,
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-8b-instruct",
          messages: [
            {
              role: "system",
              content: "Extract company info from website text. Return JSON only: {\"company\":\"name\",\"industry\":\"...\",\"sizeRange\":\"...\",\"headquarters\":\"...\"}",
            },
            { role: "user", content: textContent.slice(0, 2000) },
          ],
          temperature: 0.1,
          max_tokens: 200,
        }),
      });
      if (!aiRes.ok) return { confidence: 0.2, source: "website-ai" };
      const aiData = await aiRes.json();
      const content = aiData.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { confidence: 0.3, source: "website-ai" };
      try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        company: parsed.company,
        confidence: parsed.company ? 0.65 : 0.3,
        source: "website-ai",
      };
    } catch {
      return { confidence: 0.3, source: "website-ai" };
    }
    } catch {
      return { confidence: 0, source: "website-ai" };
    }
  }

  async verifyEmail(_email: string): Promise<boolean> {
    return false;
  }
}
