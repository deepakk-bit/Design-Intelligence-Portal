import { useEffect, useRef, useState } from "react";
import {
  X,
  Send,
  MessageSquare,
  Settings2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useCanvasStore } from "../../store.js";
import { getAgentDef } from "../../agents.js";
import { chatWithAgent } from "../../lib/api.js";

export default function RightPanel() {
  const open = useCanvasStore((s) => s.rightPanelOpen);
  const toggle = useCanvasStore((s) => s.toggleRightPanel);
  const tab = useCanvasStore((s) => s.rightPanelTab);
  const setTab = useCanvasStore((s) => s.setRightPanelTab);
  const selectedId = useCanvasStore((s) => s.selectedNodeId);
  const nodes = useCanvasStore((s) => s.nodes);

  if (!open) return null;
  const node = nodes.find((n) => n.id === selectedId);

  return (
    <div className="absolute top-20 right-4 bottom-20 w-[360px] z-20 bg-white rounded-2xl shadow-floating border border-ink-200 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-ink-100 flex items-center gap-1">
        <TabBtn active={tab === "chat"} onClick={() => setTab("chat")} icon={MessageSquare}>
          Chat
        </TabBtn>
        <TabBtn
          active={tab === "properties"}
          onClick={() => setTab("properties")}
          icon={Settings2}
        >
          Properties
        </TabBtn>
        <div className="flex-1" />
        <button
          onClick={() => toggle(false)}
          className="p-1.5 rounded text-ink-400 hover:text-ink-700 hover:bg-ink-100"
        >
          <X size={14} />
        </button>
      </div>

      {!node && <EmptyState />}
      {node && tab === "chat" && <ChatTab node={node} />}
      {node && tab === "properties" && <PropertiesTab node={node} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium ${
        active
          ? "bg-ink-900 text-white"
          : "text-ink-500 hover:text-ink-900 hover:bg-ink-100"
      }`}
    >
      <Icon size={13} />
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-ink-500">
      Select a node on the canvas to chat with its agent or view properties.
    </div>
  );
}

function PropertiesTab({ node }) {
  const removeNode = useCanvasStore((s) => s.removeNode);

  if (node.type === "agent") {
    const def = getAgentDef(node.data.agentId);
    return (
      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-3 text-[13px]">
        <Field label="Type">Agent</Field>
        <Field label="Name">{def?.name}</Field>
        <Field label="Status">
          <StatusBadge status={node.data.status} />
        </Field>
        <Field label="Image">
          {node.data.image?.name ?? <span className="text-ink-400">none</span>}
        </Field>
        {node.data.result?.usage && (
          <Field label="Tokens">
            in {node.data.result.usage.input ?? "?"} · out{" "}
            {node.data.result.usage.output ?? "?"}
          </Field>
        )}
        <button
          onClick={() => removeNode(node.id)}
          className="mt-3 w-full text-[13px] text-red-600 border border-red-200 hover:bg-red-50 rounded-lg py-1.5"
        >
          Delete node
        </button>
      </div>
    );
  }

  if (node.type === "output") {
    const def = getAgentDef(node.data.agentDefId);
    const r = node.data.result?.result;
    return (
      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-3 text-[13px]">
        <Field label="Type">Output</Field>
        <Field label="Source agent">{def?.name}</Field>
        <Field label="Usability score">{r?.usabilityScore ?? "—"}</Field>
        <Field label="Findings">{r?.findings?.length ?? 0}</Field>
        <Field label="Suggestions">{r?.suggestions?.length ?? 0}</Field>
        <button
          onClick={() => removeNode(node.id)}
          className="mt-3 w-full text-[13px] text-red-600 border border-red-200 hover:bg-red-50 rounded-lg py-1.5"
        >
          Delete node
        </button>
      </div>
    );
  }

  return null;
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 mb-0.5">
        {label}
      </div>
      <div className="text-ink-900">{children}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    idle: ["Idle", "#64748b"],
    running: ["Running", "#7c3aed"],
    done: ["Done", "#10b981"],
    error: ["Error", "#dc2626"],
  };
  const [label, color] = map[status] ?? map.idle;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: `${color}1a`, color }}
    >
      {label}
    </span>
  );
}

function ChatTab({ node }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  const agentNode =
    node.type === "agent"
      ? node
      : nodes.find((n) => n.id === node.data.sourceAgentId);

  const ready =
    agentNode?.data?.status === "done" &&
    agentNode?.data?.image &&
    agentNode?.data?.result;

  const messages = agentNode?.data?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, busy]);

  if (!agentNode) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-ink-500">
        Original agent node was deleted.
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-ink-500">
        Run the agent first — chat unlocks once you have a result.
      </div>
    );
  }

  const def = getAgentDef(agentNode.data.agentId);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    updateNodeData(agentNode.id, { messages: next });
    setDraft("");
    setBusy(true);
    try {
      const res = await chatWithAgent({
        agentId: def.id,
        image: {
          data: agentNode.data.image.data,
          mediaType: agentNode.data.image.mediaType,
        },
        initialResult: agentNode.data.result?.result,
        messages: next,
      });
      updateNodeData(agentNode.id, {
        messages: [...next, { role: "assistant", content: res.reply }],
      });
    } catch (err) {
      updateNodeData(agentNode.id, {
        messages: [
          ...next,
          {
            role: "assistant",
            content: `_Error: ${err.message ?? "request failed"}_`,
          },
        ],
      });
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    updateNodeData(agentNode.id, { messages: [] });
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-ink-100 flex items-center justify-between">
        <div className="text-[12px] text-ink-500 truncate">
          Chatting with <span className="font-medium text-ink-900">{def.name}</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-[11px] text-ink-500 hover:text-ink-900 inline-flex items-center gap-1"
          >
            <RefreshCw size={11} /> Reset
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3"
      >
        {messages.length === 0 && (
          <div className="text-center text-xs text-ink-500 py-6">
            Ask a follow-up about the analysis above.
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role}>
            {m.role === "assistant" ? (
              <div className="prose-chat">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            ) : (
              m.content
            )}
          </Bubble>
        ))}
        {busy && (
          <Bubble role="assistant">
            <span className="inline-flex items-center gap-1.5 text-ink-500">
              <Loader2 size={12} className="animate-spin" /> Thinking…
            </span>
          </Bubble>
        )}
      </div>

      <div className="border-t border-ink-100 p-2 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Ask a follow-up…"
          className="flex-1 resize-none text-[13px] bg-ink-50 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <button
          onClick={send}
          disabled={busy || !draft.trim()}
          className="p-2 rounded-lg bg-brand-500 text-white disabled:opacity-40 hover:bg-brand-600"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function Bubble({ role, children }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-xl px-3 py-2 text-[13px] ${
          isUser
            ? "bg-ink-900 text-white"
            : "bg-ink-50 text-ink-900 border border-ink-100"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
