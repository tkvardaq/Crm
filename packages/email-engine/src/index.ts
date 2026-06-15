import nodemailer from "nodemailer";
import { decrypt } from "@crm/database";
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

export function generateSpintaxVariant(template: string, variables: Record<string, string>): string {
  let result = parseSpintax(template);
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}}}`, "g"), value);
  }
  return result;
}

export function createTransport(inbox: {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassEncrypted: string;
}) {
  const smtpPass = decrypt(inbox.smtpPassEncrypted);
  return nodemailer.createTransport({
    host: inbox.smtpHost,
    port: inbox.smtpPort,
    secure: inbox.smtpPort === 465,
    auth: {
      user: inbox.smtpUser,
      pass: smtpPass,
    },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  });
}

export async function sendEmail(
  inbox: { email: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPassEncrypted: string },
  to: string,
  subject: string,
  body: string
) {
  const transport = createTransport(inbox);
  await transport.sendMail({
    from: inbox.email,
    to,
    subject,
    text: body,
    html: toSafeHtml(body),
  });
}

export function getWeightedRandomIndex(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) return i;
  }
  return weights.length - 1;
}