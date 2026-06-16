"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "bg-emerald-100 text-emerald-700",
  neutral: "bg-slate-100 text-slate-600",
  negative: "bg-red-100 text-red-700",
  oof: "bg-amber-100 text-amber-700",
  unsubscribe: "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
};

interface Lead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
}

interface Variant {
  sentCount: number;
  replyCount: number;
}

interface Step {
  variants: Variant[];
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  steps: Step[];
}

interface Deal {
  id: string;
  title: string;
  value: number;
  expectedCloseDate: Date | null;
  lead: { email: string; firstName: string | null; lastName: string | null };
}

interface Message {
  id: string;
  direction: string;
  subject: string | null;
  bodyText: string;
  sentAt: string;
  sentiment: string | null;
  lead: { email: string; firstName: string | null; lastName: string | null };
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);
  if (diffD > 0) return `${diffD}d ago`;
  if (diffH > 0) return `${diffH}h ago`;
  return "Just now";
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [leadsRes, campaignsRes, dealsRes, inboxRes] = await Promise.all([
        fetch("/api/leads", { credentials: "include" }),
        fetch("/api/campaigns", { credentials: "include" }),
        fetch("/api/deals", { credentials: "include" }),
        fetch("/api/inbox", { credentials: "include" }),
      ]);

      if (leadsRes.ok) {
        const leadsJson = await leadsRes.json();
        setLeads(Array.isArray(leadsJson) ? leadsJson : leadsJson.data || []);
      }
      if (campaignsRes.ok) setCampaigns(await campaignsRes.json());
      if (dealsRes.ok) setDeals(await dealsRes.json());
      if (inboxRes.ok) setMessages(await inboxRes.json());
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const pipelineValue = deals.reduce((sum, d) => sum + d.value, 0);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const emailsSentThisMonth = messages.filter((m) => {
    if (m.direction !== "outbound") return false;
    const d = new Date(m.sentAt);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).length;

  const repliedLeads = leads.filter((l) => l.status === "replied").slice(0, 5);

   const thirtyDaysFromNow = new Date();
   thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
   const dealsClosingSoon = deals
     .filter((d) => {
       if (!d.expectedCloseDate) return false;
       const closeDate = d.expectedCloseDate;
       return closeDate <= thirtyDaysFromNow && closeDate >= now;
     })
     .sort((a, b) => (a.expectedCloseDate!.getTime() - b.expectedCloseDate!.getTime()))
     .slice(0, 5);

  const recentMessages = messages.slice(0, 10);

  if (loading) {
    return <div className="p-6 text-slate-500">Loading dashboard...</div>;
  }

  const stats = [
    { label: "Total Leads", value: leads.length, href: "/leads" },
    { label: "Active Campaigns", value: activeCampaigns.length, href: "/campaigns" },
    { label: "Pipeline Value", value: `$${pipelineValue.toLocaleString()}`, href: "/pipeline" },
    { label: "Emails Sent (this month)", value: emailsSentThisMonth, href: "/inbox" },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Overview of your CRM activity</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="bg-white rounded-xl border p-5 hover:shadow-md transition-shadow">
            <p className="text-sm text-slate-500">{stat.label}</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{stat.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Recent Activity</h2>
              <Link href="/inbox" className="text-sm text-blue-600 hover:underline">View all</Link>
            </div>
            {recentMessages.length === 0 ? (
              <div className="p-5 text-sm text-slate-500 text-center">No recent messages</div>
            ) : (
              <div className="divide-y">
                {recentMessages.map((msg) => (
                  <div key={msg.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                    <span className={`text-sm font-medium ${msg.direction === "inbound" ? "text-blue-600" : "text-slate-400"}`}>
                      {msg.direction === "inbound" ? "\u2190" : "\u2192"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 truncate">
                        {msg.lead.firstName || msg.lead.lastName
                          ? `${msg.lead.firstName || ""} ${msg.lead.lastName || ""}`
                          : msg.lead.email}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{msg.subject || "(no subject)"}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {msg.sentiment && (
                        <span className={`text-xs px-2 py-0.5 rounded capitalize ${SENTIMENT_COLORS[msg.sentiment] || "bg-slate-100 text-slate-600"}`}>
                          {msg.sentiment}
                        </span>
                      )}
                      <span className="text-xs text-slate-400">{formatTime(msg.sentAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Active Campaigns</h2>
              <Link href="/campaigns" className="text-sm text-blue-600 hover:underline">View all</Link>
            </div>
            {activeCampaigns.length === 0 ? (
              <div className="p-5 text-sm text-slate-500 text-center">No active campaigns</div>
            ) : (
              <div className="divide-y">
                {activeCampaigns.map((campaign) => {
                  const totalSent = campaign.steps.flatMap((s) => s.variants).reduce((sum, v) => sum + v.sentCount, 0);
                  const totalReplied = campaign.steps.flatMap((s) => s.variants).reduce((sum, v) => sum + v.replyCount, 0);
                  return (
                    <div key={campaign.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-medium text-slate-900">{campaign.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[campaign.status] || "bg-slate-100 text-slate-600"}`}>
                          {campaign.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {totalSent} sent &middot; {totalReplied} replied
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border">
            <div className="px-5 py-4 border-b">
              <h2 className="font-semibold text-slate-900">Quick Actions</h2>
            </div>
            <div className="p-4 space-y-2">
              <button onClick={() => router.push("/leads")} className="w-full text-left px-4 py-3 rounded-lg bg-slate-50 hover:bg-blue-50 text-sm font-medium text-slate-700 transition-colors">
                + Add Lead
              </button>
              <button onClick={() => router.push("/campaigns")} className="w-full text-left px-4 py-3 rounded-lg bg-slate-50 hover:bg-blue-50 text-sm font-medium text-slate-700 transition-colors">
                + Create Campaign
              </button>
              <button onClick={() => router.push("/pipeline")} className="w-full text-left px-4 py-3 rounded-lg bg-slate-50 hover:bg-blue-50 text-sm font-medium text-slate-700 transition-colors">
                View Pipeline
              </button>
              <button onClick={() => router.push("/inbox")} className="w-full text-left px-4 py-3 rounded-lg bg-slate-50 hover:bg-blue-50 text-sm font-medium text-slate-700 transition-colors">
                Check Inbox
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border">
            <div className="px-5 py-4 border-b">
              <h2 className="font-semibold text-slate-900">Follow-ups Needed</h2>
            </div>
            {repliedLeads.length === 0 ? (
              <div className="p-5 text-sm text-slate-500 text-center">No follow-ups needed</div>
            ) : (
              <div className="divide-y">
                {repliedLeads.map((lead) => (
                  <Link key={lead.id} href={`/leads`} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors block">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {lead.firstName || lead.lastName
                          ? `${lead.firstName || ""} ${lead.lastName || ""}`
                          : lead.email}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{lead.email}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 capitalize">{lead.status}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border">
            <div className="px-5 py-4 border-b">
              <h2 className="font-semibold text-slate-900">Deals Closing Soon</h2>
            </div>
            {dealsClosingSoon.length === 0 ? (
              <div className="p-5 text-sm text-slate-500 text-center">No deals closing soon</div>
            ) : (
              <div className="divide-y">
                {dealsClosingSoon.map((deal) => (
                  <div key={deal.id} className="px-5 py-3 hover:bg-slate-50 transition-colors">
                    <p className="text-sm font-medium text-slate-900 truncate">{deal.title}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-sm text-emerald-600 font-medium">${deal.value.toLocaleString()}</span>
                      <span className="text-xs text-slate-400">
                        {deal.expectedCloseDate ? formatDate(new Date(deal.expectedCloseDate).toISOString()) : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
