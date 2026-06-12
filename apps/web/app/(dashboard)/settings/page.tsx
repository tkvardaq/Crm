"use client";

import { useState, useEffect, useCallback } from "react";

interface Domain {
  id: string;
  domain: string;
  spfValid: boolean;
  dkimValid: boolean;
  dmarcValid: boolean;
  mxValid: boolean;
  reputationScore: number;
  lastCheckedAt: string | null;
}

interface Inbox {
  id: string;
  email: string;
  smtpHost: string;
  dailySentCount: number;
  maxDailyLimit: number;
  warmupEnabled: boolean;
  isActive: boolean;
  sendingDomain: { domain: string } | null;
}

export default function SettingsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"domains" | "inboxes" | "integrations">("domains");
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [showInboxModal, setShowInboxModal] = useState(false);
  const [recheckingDomainId, setRecheckingDomainId] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [newInbox, setNewInbox] = useState({ email: "", smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", imapHost: "", imapPort: "993", imapUser: "", imapPass: "", maxDailyLimit: "50" });
  const [saving, setSaving] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testingImap, setTestingImap] = useState(false);
  const [testResult, setTestResult] = useState<{ type: string; success: boolean; message: string } | null>(null);

  const handleTestConnection = async (type: "smtp" | "imap") => {
    const isSmtp = type === "smtp";
    if (isSmtp) setTestingSmtp(true); else setTestingImap(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type,
          host: isSmtp ? newInbox.smtpHost : (newInbox.imapHost || autoPopulateImap(newInbox.smtpHost)),
          port: isSmtp ? Number(newInbox.smtpPort) : Number(newInbox.imapPort || 993),
          user: isSmtp ? newInbox.smtpUser : (newInbox.imapUser || newInbox.smtpUser),
          pass: isSmtp ? newInbox.smtpPass : (newInbox.imapPass || newInbox.smtpPass),
        }),
      });
      const data = await res.json();
      setTestResult({ type, success: data.success, message: data.message });
    } catch (err) {
      setTestResult({ type, success: false, message: "Connection test failed" });
    } finally {
      if (isSmtp) setTestingSmtp(false); else setTestingImap(false);
    }
  };

  const fetchSettings = useCallback(async () => {
    try {
      const [domainsRes, inboxesRes] = await Promise.all([
        fetch("/api/domains", { credentials: "include" }),
        fetch("/api/inboxes", { credentials: "include" }),
      ]);
      if (domainsRes.ok) setDomains(await domainsRes.json());
      if (inboxesRes.ok) setInboxes(await inboxesRes.json());
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ domain: newDomain }),
      });
      if (res.ok) { fetchSettings(); setShowDomainModal(false); setNewDomain(""); }
    } catch (err) {
      console.error("Failed to add domain:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleAddInbox = async () => {
    if (!newInbox.email || !newInbox.smtpHost) return;
    setSaving(true);
    try {
      const imapHost = newInbox.imapHost || autoPopulateImap(newInbox.smtpHost);
      const imapUser = newInbox.imapUser || newInbox.smtpUser;
      const imapPass = newInbox.imapPass || newInbox.smtpPass;
      const res = await fetch("/api/inboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: newInbox.email,
          smtpHost: newInbox.smtpHost,
          smtpPort: Number(newInbox.smtpPort),
          smtpUser: newInbox.smtpUser,
          smtpPass: newInbox.smtpPass,
          imapHost,
          imapPort: Number(newInbox.imapPort || "993"),
          imapUser,
          imapPass,
          maxDailyLimit: Number(newInbox.maxDailyLimit),
        }),
      });
      if (res.ok) { fetchSettings(); setShowInboxModal(false); setNewInbox({ email: "", smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", imapHost: "", imapPort: "993", imapUser: "", imapPass: "", maxDailyLimit: "50" }); }
    } catch (err) {
      console.error("Failed to add inbox:", err);
    } finally {
      setSaving(false);
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
      "smtp.mail.me.com": "imap.mail.me.com",
      "smtp.icloud.com": "imap.mail.me.com",
    };
    return map[smtpHost.toLowerCase()] || smtpHost.replace(/^smtp\./i, "imap.");
  };

  const handleRecheckDns = async (domainId: string) => {
    setRecheckingDomainId(domainId);
    try {
      const res = await fetch("/api/cron/dns-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET || ""}` },
        credentials: "include",
        body: JSON.stringify({ domainId }),
      });
      if (res.ok) {
        await fetchSettings();
      }
    } catch (err) {
      console.error("Failed to recheck DNS:", err);
    } finally {
      setRecheckingDomainId(null);
    }
  };

  if (loading) {
    return <div className="p-6 text-slate-500">Loading settings...</div>;
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Settings</h1>

      <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1 w-fit">
        {(["domains", "inboxes", "integrations"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-md capitalize transition-colors ${
              tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "domains" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900">Sending Domains</h2>
              <button onClick={() => setShowDomainModal(true)} className="text-blue-600 hover:underline text-sm">+ Add Domain</button>
            </div>
            {domains.length === 0 ? (
              <p className="text-sm text-slate-500">No domains configured yet.</p>
            ) : (
              <div className="space-y-3">
              {domains.map((d) => {
                const checks = [
                  { label: "SPF", ok: d.spfValid },
                  { label: "DKIM", ok: d.dkimValid },
                  { label: "DMARC", ok: d.dmarcValid },
                  { label: "MX", ok: d.mxValid },
                ];
                const passCount = checks.filter((c) => c.ok).length;
                const allValid = passCount === 4;
                return (
                <div key={d.id} className="p-4 bg-slate-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-slate-700">{d.domain}</p>
                    <button
                      onClick={() => handleRecheckDns(d.id)}
                      disabled={recheckingDomainId === d.id}
                      className="text-blue-600 hover:underline text-sm disabled:opacity-50"
                    >
                      {recheckingDomainId === d.id ? "Checking..." : "Recheck DNS"}
                    </button>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mb-2">
                    <div
                      className={`h-full rounded-full transition-all ${allValid ? "bg-emerald-500" : passCount >= 2 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${(passCount / 4) * 100}%` }}
                    />
                  </div>
                  <div className="flex gap-2">
                    {checks.map(({ label, ok }) => (
                      <span key={label} className={`text-xs px-2 py-0.5 rounded ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                        {label} {ok ? "✓" : "✗"}
                      </span>
                    ))}
                    <span className={`text-xs px-2 py-0.5 rounded ${allValid ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                      Score: {d.reputationScore}
                    </span>
                  </div>
                  {d.lastCheckedAt && (
                    <p className="text-xs text-slate-400 mt-1.5">Last checked: {new Date(d.lastCheckedAt).toLocaleString()}</p>
                  )}
                </div>
                );
              })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "inboxes" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900">Connected Inboxes</h2>
              <button onClick={() => setShowInboxModal(true)} className="text-blue-600 hover:underline text-sm">+ Add Inbox</button>
            </div>
            {inboxes.length === 0 ? (
              <p className="text-sm text-slate-500">No inboxes connected yet.</p>
            ) : (
              <div className="space-y-3">
                {inboxes.map((inbox) => (
                  <div key={inbox.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div>
                      <p className="font-medium text-slate-700">{inbox.email}</p>
                      {inbox.sendingDomain && (
                        <p className="text-xs text-slate-400 mt-0.5">{inbox.sendingDomain.domain}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${inbox.dailySentCount / inbox.maxDailyLimit > 0.8 ? "bg-red-500" : "bg-blue-500"}`}
                            style={{ width: `${Math.min((inbox.dailySentCount / inbox.maxDailyLimit) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">
                          {inbox.dailySentCount}/{inbox.maxDailyLimit} sent today
                        </span>
                        {inbox.warmupEnabled && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Warmup</span>
                        )}
                      </div>
                    </div>
                    <button className="text-blue-600 hover:underline text-sm">Edit</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "integrations" && (
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Integrations</h2>
          <div className="grid grid-cols-2 gap-3">
            {["HubSpot", "Salesforce", "Apollo.io", "Hunter.io", "Clearbit", "ZeroBounce"].map((name) => (
              <div key={name} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span className="font-medium text-slate-700">{name}</span>
                <button className="text-blue-600 hover:underline text-sm">Connect</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showDomainModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Sending Domain</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">Domain</label>
              <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)}
                placeholder="mail.example.com"
                className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-slate-500 mt-1">Make sure DNS records are configured before adding</p>
            </div>
            <div className="flex gap-3">
              <button onClick={handleAddDomain} disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? "..." : "Add Domain"}
              </button>
              <button onClick={() => setShowDomainModal(false)}
                className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2.5 text-sm font-medium hover:bg-slate-300">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showInboxModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Connected Inbox</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                <input value={newInbox.email} onChange={(e) => setNewInbox((i) => ({ ...i, email: e.target.value }))}
                  type="email" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Host *</label>
                  <input value={newInbox.smtpHost} onChange={(e) => setNewInbox((i) => ({ ...i, smtpHost: e.target.value }))}
                    placeholder="smtp.gmail.com" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Port</label>
                  <input value={newInbox.smtpPort} onChange={(e) => setNewInbox((i) => ({ ...i, smtpPort: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Username *</label>
                <input value={newInbox.smtpUser} onChange={(e) => setNewInbox((i) => ({ ...i, smtpUser: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Password *</label>
                  <input type="password" value={newInbox.smtpPass} onChange={(e) => setNewInbox((i) => ({ ...i, smtpPass: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <button
                  type="button"
                  onClick={() => handleTestConnection("smtp")}
                  disabled={testingSmtp || !newInbox.smtpHost || !newInbox.smtpUser || !newInbox.smtpPass}
                  className="w-full px-3 py-2 text-sm font-medium border rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {testingSmtp ? "Testing..." : "Test SMTP Connection"}
                </button>
                <div className="border-t pt-3 mt-1">
                  <p className="text-xs text-slate-500 mb-2">IMAP settings (for inbox sync — auto-populated from SMTP)</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">IMAP Host</label>
                    <input value={newInbox.imapHost} onChange={(e) => setNewInbox((i) => ({ ...i, imapHost: e.target.value }))}
                      placeholder={autoPopulateImap(newInbox.smtpHost) || "imap.example.com"} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">IMAP Port</label>
                    <input value={newInbox.imapPort} onChange={(e) => setNewInbox((i) => ({ ...i, imapPort: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">IMAP Username</label>
                  <input value={newInbox.imapUser} onChange={(e) => setNewInbox((i) => ({ ...i, imapUser: e.target.value }))}
                    placeholder={newInbox.smtpUser || "same as SMTP"} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">IMAP Password</label>
                  <input type="password" value={newInbox.imapPass} onChange={(e) => setNewInbox((i) => ({ ...i, imapPass: e.target.value }))}
                    placeholder="same as SMTP" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <button
                  type="button"
                  onClick={() => handleTestConnection("imap")}
                  disabled={testingImap || !newInbox.smtpHost}
                  className="w-full px-3 py-2 text-sm font-medium border rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {testingImap ? "Testing..." : "Test IMAP Connection"}
                </button>
                {testResult && (
                  <div className={`text-xs px-3 py-2 rounded-lg ${testResult.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                    {testResult.type.toUpperCase()}: {testResult.message}
                  </div>
                )}
                <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Daily Limit</label>
                <input type="number" value={newInbox.maxDailyLimit} onChange={(e) => setNewInbox((i) => ({ ...i, maxDailyLimit: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" min={1} max={500} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleAddInbox} disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? "..." : "Add Inbox"}
              </button>
              <button onClick={() => setShowInboxModal(false)}
                className="flex-1 bg-slate-200 text-slate-700 rounded-lg py-2.5 text-sm font-medium hover:bg-slate-300">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}