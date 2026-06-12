"use client";

import { useState, useEffect, useCallback } from "react";

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "bg-emerald-100 text-emerald-700",
  neutral: "bg-slate-100 text-slate-600",
  negative: "bg-red-100 text-red-700",
  oof: "bg-amber-100 text-amber-700",
  unsubscribe: "bg-red-100 text-red-700",
};

interface Message {
  id: string;
  leadId: string;
  connectedInboxId: string | null;
  direction: string;
  subject: string | null;
  bodyText: string;
  sentAt: string;
  sentiment: string | null;
  isRead: boolean;
  lead: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    company?: string | null;
  };
}

interface Inbox {
  id: string;
  email: string;
}

interface Thread {
  threadKey: string;
  leadId: string | null;
  lead: Message["lead"];
  messages: Message[];
  lastMessage: Message;
  messageCount: number;
  hasUnread: boolean;
}

type FilterTab = "all" | "inbound" | "unsubscribe";

const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function linkify(text: string): string {
  const escaped = escapeHtml(text);
  const parts = escaped.split(URL_REGEX);
  return parts
    .map((part, i) => {
      if (URL_REGEX.test(part)) {
        URL_REGEX.lastIndex = 0;
        return `<a href="${part}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">${part}</a>`;
      }
      URL_REGEX.lastIndex = 0;
      return part.replace(/\n/g, "<br />");
    })
    .join("");
}

export default function InboxPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyInboxId, setReplyInboxId] = useState<string>("");

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data);
      if (data.length > 0 && !selectedThreadKey) {
        setSelectedThreadKey(data[0].leadId || data[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch inbox:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedThreadKey]);

  const fetchInboxes = useCallback(async () => {
    try {
      const res = await fetch("/api/inboxes", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setInboxes(data);
      if (data.length > 0 && !replyInboxId) {
        setReplyInboxId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch inboxes:", err);
    }
  }, [replyInboxId]);

  useEffect(() => {
    fetchMessages();
    fetchInboxes();
    const interval = setInterval(fetchMessages, 30000);
    return () => clearInterval(interval);
  }, [fetchMessages, fetchInboxes]);

  const threads = buildThreads(messages);
  const filteredThreads = applyFilter(threads, filterTab);
  const selectedThread = selectedThreadKey
    ? threads.find((t) => t.threadKey === selectedThreadKey) ?? null
    : null;

  const handleSelectThread = (threadKey: string) => {
    setSelectedThreadKey(threadKey);
    const thread = threads.find((t) => t.threadKey === threadKey);
    if (thread) {
      const subj = thread.lastMessage.subject || "(no subject)";
      setReplySubject(subj.startsWith("Re:") ? subj : `Re: ${subj}`);
      if (thread.hasUnread && thread.leadId) {
        markAsRead(thread.leadId);
      }
    }
    setReplyBody("");
  };

  const markAsRead = async (leadId: string) => {
    try {
      await fetch("/api/inbox/read", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ allForLeadId: leadId }),
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.leadId === leadId && m.direction === "inbound" ? { ...m, isRead: true } : m
        )
      );
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  };

  const handleSendReply = async () => {
    if (!selectedThread?.leadId || !replyBody.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          leadId: selectedThread.leadId,
          subject: replySubject,
          body: replyBody,
          inboxId: replyInboxId,
        }),
      });
      if (res.ok) {
        setReplyBody("");
        await fetchMessages();
      }
    } catch (err) {
      console.error("Failed to send reply:", err);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffH / 24);
    if (diffD > 0) return `${diffD}d ago`;
    if (diffH > 0) return `${diffH}h ago`;
    return "Just now";
  };

  const formatFullDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        Loading inbox...
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <div className="w-80 border-r bg-white flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-slate-900">Inbox</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {filteredThreads.length} thread{filteredThreads.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex border-b">
          {(["all", "inbound", "unsubscribe"] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
                filterTab === tab
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredThreads.length === 0 ? (
            <div className="p-4 text-sm text-slate-500 text-center">
              No threads found
            </div>
          ) : (
      filteredThreads.map((thread) => (
            <div
              key={thread.threadKey}
              onClick={() => handleSelectThread(thread.threadKey)}
              className={`p-4 border-b cursor-pointer transition-colors ${
                selectedThreadKey === thread.threadKey
                  ? "bg-blue-50"
                  : thread.hasUnread
                  ? "bg-blue-50/30 hover:bg-slate-50"
                  : "hover:bg-slate-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {thread.hasUnread && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                  <p
                    className={`text-sm truncate ${
                      thread.hasUnread
                        ? "font-bold text-slate-900"
                        : selectedThreadKey === thread.threadKey
                        ? "font-medium text-slate-900"
                        : "font-medium text-slate-600"
                    }`}
                  >
                  {thread.lead.firstName && thread.lead.lastName
                    ? `${thread.lead.firstName} ${thread.lead.lastName}`
                    : thread.lead.email}
                  </p>
                </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {formatTime(thread.lastMessage.sentAt)}
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {thread.lead.email}
                </p>
                <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">
                  {thread.lastMessage.subject || "(no subject)"}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {thread.lastMessage.bodyText}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {thread.messageCount}
                  </span>
                  {thread.lastMessage.sentiment && (
                    <span
                      className={`inline-block text-xs px-1.5 py-0.5 rounded capitalize ${
                        SENTIMENT_COLORS[thread.lastMessage.sentiment] ||
                        "bg-slate-100"
                      }`}
                    >
                      {thread.lastMessage.sentiment}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-slate-50">
        {selectedThread ? (
          <>
            <div className="bg-white border-b px-6 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">
                    {selectedThread.lead.firstName && selectedThread.lead.lastName
                      ? `${selectedThread.lead.firstName} ${selectedThread.lead.lastName}`
                      : selectedThread.lead.email}
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {selectedThread.lead.email}
                    {selectedThread.lead.company &&
                      ` · ${selectedThread.lead.company}`}
                  </p>
                </div>
                <span className="text-xs text-slate-400">
                  {selectedThread.messageCount} message
                  {selectedThread.messageCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {selectedThread.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.direction === "outbound" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[75%] rounded-xl border p-4 ${
                      msg.direction === "outbound"
                        ? "bg-blue-50 border-blue-200"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold text-slate-800">
                        {msg.subject || "(no subject)"}
                      </p>
                      {msg.sentiment && (
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded capitalize whitespace-nowrap ${
                            SENTIMENT_COLORS[msg.sentiment] || "bg-slate-100"
                          }`}
                        >
                          {msg.sentiment}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-sm text-slate-700 whitespace-pre-wrap break-words"
                      dangerouslySetInnerHTML={{
                        __html: linkify(msg.bodyText),
                      }}
                    />
                    <p className="text-xs text-slate-400 mt-2">
                      {msg.direction === "inbound" ? "Received" : "Sent"} ·{" "}
                      {formatFullDate(msg.sentAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={replySubject}
                  onChange={(e) => setReplySubject(e.target.value)}
                  className="flex-1 text-sm border rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Subject"
                />
                {inboxes.length > 0 && (
                  <select
                    value={replyInboxId}
                    onChange={(e) => setReplyInboxId(e.target.value)}
                    className="text-sm border rounded-lg px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {inboxes.map((inbox) => (
                      <option key={inbox.id} value={inbox.id}>
                        {inbox.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={3}
                className="w-full text-sm border rounded-lg px-3 py-2 text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Write your reply..."
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleSendReply}
                  disabled={sending || !replyBody.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? "Sending..." : "Send Reply"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">&#9993;</span>
              </div>
              <p className="text-slate-500 text-sm">Select a thread to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildThreads(messages: Message[]): Thread[] {
const map = new Map<string, Message[]>();
for (const msg of messages) {
const threadKey = msg.leadId || `unknown-${msg.lead?.email || msg.id}`;
const existing = map.get(threadKey) ?? [];
existing.push(msg);
map.set(threadKey, existing);
}
const threads: Thread[] = [];
for (const [threadKey, msgs] of map) {
const sorted = [...msgs].sort(
(a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
);
const last = sorted[sorted.length - 1];
    threads.push({
      threadKey,
      leadId: last.leadId,
      lead: last.lead,
      messages: sorted,
      lastMessage: last,
      messageCount: sorted.length,
      hasUnread: sorted.some((m) => !m.isRead && m.direction === "inbound"),
    });
}
  threads.sort(
    (a, b) =>
      new Date(b.lastMessage.sentAt).getTime() -
      new Date(a.lastMessage.sentAt).getTime()
  );
  return threads;
}

function applyFilter(threads: Thread[], tab: FilterTab): Thread[] {
  if (tab === "all") return threads;
  if (tab === "inbound") {
    return threads.filter((t) => t.messages.some((m) => m.direction === "inbound"));
  }
  if (tab === "unsubscribe") {
    return threads.filter((t) =>
      t.messages.some((m) => m.sentiment === "unsubscribe")
    );
  }
  return threads;
}
