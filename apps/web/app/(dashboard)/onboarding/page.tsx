"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TOTAL_STEPS = 4;
const STEP_META = [
  { title: "Welcome & Profile", desc: "Let's get to know you a bit." },
  { title: "Connect Your First Inbox", desc: "Link an SMTP inbox to send emails from." },
  { title: "Add Your First Sending Domain", desc: "Set up a domain for your outgoing mail." },
  { title: "Create Your First Campaign", desc: "Launch your first outreach campaign." },
];

const ic = "w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input className={ic} {...props} />
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<"idle" | "success" | "error">("idle");

  const [profile, setProfile] = useState({ firstName: "", lastName: "" });
  const [inbox, setInbox] = useState({ smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", email: "", imapHost: "", imapPort: "993", imapUser: "", imapPass: "" });
  const [domain, setDomain] = useState("");
  const [campaign, setCampaign] = useState({
    name: "",
    subject: "Hi {{firstName}}, let's connect",
    body: "Hi {{firstName}},\n\nI came across {{company}} and thought we could benefit from a conversation.\n\nBest regards",
  });

  const go = (dir: 1 | -1) => {
    if (dir === -1 && step === 0) return;
    if (dir === 1 && step === TOTAL_STEPS - 1) { router.push("/dashboard"); return; }
    setStep(step + dir);
    setTestResult("idle");
  };

  const post = async (url: string, body: unknown) => {
    setSubmitting(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const autoPopulateImap = (smtpHost: string): string => {
    const map: Record<string, string> = {
      "smtp.gmail.com": "imap.gmail.com",
      "smtp.outlook.com": "outlook.office365.com",
      "smtp.office365.com": "outlook.office365.com",
      "smtp.mail.yahoo.com": "imap.mail.yahoo.com",
      "smtp.yahoo.com": "imap.mail.yahoo.com",
      "smtp.zoho.com": "imap.zoho.com",
    };
    return map[smtpHost.toLowerCase()] || smtpHost.replace(/^smtp\./i, "imap.");
  };

  const handleTestConnection = async () => {
    const imapHost = inbox.imapHost || autoPopulateImap(inbox.smtpHost);
    const imapUser = inbox.imapUser || inbox.smtpUser;
    const imapPass = inbox.imapPass || inbox.smtpPass;
    const ok = await post("/api/inboxes", {
      email: inbox.email, smtpHost: inbox.smtpHost, smtpPort: Number(inbox.smtpPort),
      smtpUser: inbox.smtpUser, smtpPass: inbox.smtpPass,
      imapHost, imapPort: Number(inbox.imapPort || "993"),
      imapUser, imapPass,
      maxDailyLimit: 50,
    });
    setTestResult(ok ? "success" : "error");
    if (ok) go(1);
  };

  const handleAddDomain = async () => {
    if (!domain.trim()) return;
    const ok = await post("/api/domains", { domain });
    if (ok) { setDomain(""); go(1); }
  };

  const handleCreateCampaign = async () => {
    if (!campaign.name.trim()) return;
    const ok = await post("/api/campaigns", {
      name: campaign.name,
      steps: [{ delayDays: 0, channel: "email", subjectSpintax: campaign.subject, bodySpintax: campaign.body }],
    });
    if (ok) go(1);
  };

  const btnCls = "bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50";

  return (
    <div className="max-w-xl mx-auto mt-12 bg-white rounded-2xl shadow-lg border p-8">
      <div className="flex items-center justify-center gap-2 mb-6">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div key={i} className={`h-2.5 w-2.5 rounded-full transition-colors ${i < step ? "bg-blue-600" : i === step ? "bg-blue-500" : "bg-slate-200"}`} />
        ))}
      </div>
      <p className="text-center text-xs text-slate-400 mb-4">Step {step + 1} of {TOTAL_STEPS}</p>
      <h2 className="text-xl font-bold text-slate-900 text-center">{STEP_META[step].title}</h2>
      <p className="text-sm text-slate-500 text-center mt-1 mb-6">{STEP_META[step].desc}</p>

      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 text-center">Welcome to CRM Tool! Let&apos;s get you set up.</p>
          <Field label="First Name" value={profile.firstName} onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))} placeholder="John" />
          <Field label="Last Name" value={profile.lastName} onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))} placeholder="Doe" />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SMTP Host" value={inbox.smtpHost} onChange={(e) => setInbox((i) => ({ ...i, smtpHost: e.target.value }))} placeholder="smtp.gmail.com" />
            <Field label="SMTP Port" value={inbox.smtpPort} onChange={(e) => setInbox((i) => ({ ...i, smtpPort: e.target.value }))} placeholder="587" />
          </div>
          <Field label="SMTP User" value={inbox.smtpUser} onChange={(e) => setInbox((i) => ({ ...i, smtpUser: e.target.value }))} placeholder="you@example.com" />
          <Field label="SMTP Password" type="password" value={inbox.smtpPass} onChange={(e) => setInbox((i) => ({ ...i, smtpPass: e.target.value }))} placeholder="••••••••" />
            <Field label="Email" type="email" value={inbox.email} onChange={(e) => setInbox((i) => ({ ...i, email: e.target.value }))} placeholder="you@example.com" />
            <div className="border-t pt-3 mt-1">
              <p className="text-xs text-slate-500 mb-2">IMAP settings (auto-populated from SMTP)</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="IMAP Host" value={inbox.imapHost} onChange={(e) => setInbox((i) => ({ ...i, imapHost: e.target.value }))} placeholder={inbox.smtpHost ? autoPopulateImap(inbox.smtpHost) : "imap.example.com"} />
              <Field label="IMAP Port" value={inbox.imapPort} onChange={(e) => setInbox((i) => ({ ...i, imapPort: e.target.value }))} placeholder="993" />
            </div>
            <Field label="IMAP Username" value={inbox.imapUser} onChange={(e) => setInbox((i) => ({ ...i, imapUser: e.target.value }))} placeholder={inbox.smtpUser || "same as SMTP"} />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">IMAP Password</label>
              <input type="password" value={inbox.imapPass} onChange={(e) => setInbox((i) => ({ ...i, imapPass: e.target.value }))} placeholder="same as SMTP" className={ic} />
            </div>
          {testResult === "success" && <p className="text-xs text-emerald-600">Connection successful!</p>}
          {testResult === "error" && <p className="text-xs text-red-600">Connection failed. Please check your credentials.</p>}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Field label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="mail.example.com" />
          <p className="text-xs text-slate-500">You can verify DNS records later in Settings.</p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Field label="Campaign Name" value={campaign.name} onChange={(e) => setCampaign((c) => ({ ...c, name: e.target.value }))} placeholder="Q1 Enterprise Outreach" />
          <Field label="Subject Line" value={campaign.subject} onChange={(e) => setCampaign((c) => ({ ...c, subject: e.target.value }))} placeholder="Hi {{firstName}}, let's connect" />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Body</label>
            <textarea value={campaign.body} onChange={(e) => setCampaign((c) => ({ ...c, body: e.target.value }))} rows={5}
              className={`${ic} resize-y`} placeholder="Hi {{firstName}},&#10;&#10;I came across {{company}}..." />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-8">
        <div>{step > 0 && <button onClick={() => go(-1)} className="text-sm text-slate-500 hover:text-slate-700 font-medium">Back</button>}</div>
        <div className="flex items-center gap-3">
          <button onClick={() => go(1)} className="text-sm text-slate-400 hover:text-slate-600 font-medium">Skip</button>
          {step === 1 && <button onClick={handleTestConnection} disabled={submitting} className={btnCls}>{submitting ? "Testing..." : "Test Connection"}</button>}
          {step === 2 && <button onClick={handleAddDomain} disabled={submitting || !domain.trim()} className={btnCls}>{submitting ? "Adding..." : "Add Domain"}</button>}
          {step === 3 && <button onClick={handleCreateCampaign} disabled={submitting || !campaign.name.trim()} className={btnCls}>{submitting ? "Creating..." : "Create Campaign"}</button>}
          {step === 0 && <button onClick={() => go(1)} className={btnCls}>Next</button>}
        </div>
      </div>
    </div>
  );
}
