import nodemailer from "nodemailer";
import { decrypt } from "@crm/database";

export function parseSpintax(text: string): string {
  return text.replace(/\{([^}]+)\}/g, (_, choices) => {
    const opts = choices.split("|");
    return opts[Math.floor(Math.random() * opts.length)];
  });
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
    pool: true,
    maxConnections: 5,
    auth: {
      user: inbox.smtpUser,
      pass: smtpPass,
    },
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
    html: body.replace(/\n/g, "<br>"),
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
