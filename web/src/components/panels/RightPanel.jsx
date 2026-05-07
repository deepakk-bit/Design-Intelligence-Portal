import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Send,
  Square,
  MessageSquare,
  Settings2,
  Loader2,
  RefreshCw,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Wand2,
  ArrowDown,
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
    <div className="absolute top-20 right-4 bottom-20 w-[380px] z-20 bg-white rounded-2xl shadow-floating border border-ink-200 flex flex-col overflow-hidden">
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
          title="Close panel"
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
        {def?.imageSlots ? (
          def.imageSlots.map((slot) => (
            <Field key={slot.key} label={slot.label}>
              {node.data.images?.[slot.key]?.name ?? (
                <span className="text-ink-400">none</span>
              )}
            </Field>
          ))
        ) : (def?.inputs ?? ["image"]).includes("image") ? (
          <Field label="Image">
            {node.data.image?.name ?? (
              <span className="text-ink-400">none</span>
            )}
          </Field>
        ) : (
          <Field label="Component">
            {node.data.componentName?.trim() ? (
              node.data.componentName
            ) : (
              <span className="text-ink-400">none</span>
            )}
          </Field>
        )}
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

// Per-agent prompt suggestions for the empty state. Generic fallback covers
// agents we haven't tuned yet.
const SUGGESTIONS = {
  "qa-review": [
    "Remove all low-severity issues.",
    "Make the verdict less strict.",
    "Add a check for keyboard focus rings.",
  ],
  interaction: [
    "Score this more leniently.",
    "Add a finding about touch-target sizes.",
    "Drop the nit-level findings.",
  ],
  "states-variants": [
    "Add an empty state to the content section.",
    "Drop the responsive section.",
    "Reorder the priority list, hover first.",
  ],
  "reference-finder": [
    "Refine the search to mobile screens only.",
    "Try a more specific query.",
  ],
};
const FALLBACK_SUGGESTIONS = [
  "Make this more concise.",
  "Explain why this is high severity.",
  "Add another finding.",
];

function ChatTab({ node }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const recordUsage = useCanvasStore((s) => s.recordUsage);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  // AbortController for the in-flight chat request so the user can cancel.
  const abortRef = useRef(null);

  const agentNode =
    node.type === "agent"
      ? node
      : nodes.find((n) => n.id === node.data.sourceAgentId);

  const agentDef = agentNode ? getAgentDef(agentNode.data.agentId) : null;
  const slots = agentDef?.imageSlots ?? null;
  const inputs = agentDef?.inputs ?? (slots ? [] : ["image"]);
  const needsImage = !slots && inputs.includes("image");
  const hasInput = slots
    ? slots.every((s) => !!agentNode?.data?.images?.[s.key])
    : needsImage
      ? !!agentNode?.data?.image
      : !!agentNode?.data?.componentName?.trim();
  const ready =
    agentNode?.data?.status === "done" &&
    hasInput &&
    agentNode?.data?.result;

  const messages = agentNode?.data?.messages ?? [];

  // Track whether the user is parked at the bottom of the transcript so we
  // don't yank them down while they're scrolling back to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = dist < 60;
      setStickToBottom(atBottom);
      if (atBottom) setUnreadCount(0);
    }
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [ready]);

  useEffect(() => {
    if (stickToBottom) {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight });
      setUnreadCount(0);
    } else {
      // Bumping unread count makes the floating "↓ N new" pill informative
      // when the user has scrolled up to read earlier messages.
      setUnreadCount((c) => c + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    if (stickToBottom) {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setStickToBottom(true);
    setUnreadCount(0);
  }, []);

  const suggestions = useMemo(
    () => SUGGESTIONS[agentDef?.id] ?? FALLBACK_SUGGESTIONS,
    [agentDef?.id],
  );

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

  const def = agentDef;

  function stop() {
    abortRef.current?.abort();
  }

  async function send(textOverride) {
    const text = (textOverride ?? draft).trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    updateNodeData(agentNode.id, { messages: next });
    if (textOverride == null) setDraft("");
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      const slotsArr = def.imageSlots ?? null;
      const imagesPayload =
        slotsArr && agentNode.data.images
          ? Object.fromEntries(
              slotsArr
                .filter((s) => !!agentNode.data.images[s.key])
                .map((s) => [
                  s.key,
                  {
                    data: agentNode.data.images[s.key].data,
                    mediaType: agentNode.data.images[s.key].mediaType,
                  },
                ]),
            )
          : undefined;
      // Strip client-only fields (meta) before sending. Server only needs
      // role + content.
      const wireMessages = next.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await chatWithAgent({
        agentId: def.id,
        image: agentNode.data.image
          ? {
              data: agentNode.data.image.data,
              mediaType: agentNode.data.image.mediaType,
            }
          : undefined,
        images: imagesPayload,
        componentName: agentNode.data.componentName?.trim() || undefined,
        context: agentNode.data.context?.trim() || undefined,
        initialResult: agentNode.data.result?.result,
        messages: wireMessages,
        signal: abortRef.current.signal,
      });

      const assistantContent =
        res.reply?.trim() ||
        (res.updatedResult ? "_Updated the analysis._" : "");
      const summary = res.updatedResult
        ? summarizeUpdate(agentNode.data.result?.result, res.updatedResult)
        : null;
      const assistantMsg = {
        role: "assistant",
        content: assistantContent,
        ...(res.updatedResult ? { meta: { updated: true, summary } } : {}),
      };

      // If the model refined the analysis, propagate the new result onto
      // the agent node and every output node it spawned. Output nodes hold
      // their own copy of `result`, so each must be updated explicitly.
      if (res.updatedResult) {
        const newAgentResult = {
          ...(agentNode.data.result ?? {}),
          result: res.updatedResult,
        };
        updateNodeData(agentNode.id, {
          messages: [...next, assistantMsg],
          result: newAgentResult,
        });
        const latest = useCanvasStore.getState().nodes;
        for (const o of latest) {
          if (
            o.type === "output" &&
            o.data?.sourceAgentId === agentNode.id
          ) {
            updateNodeData(o.id, (prev) => ({
              ...prev,
              result: newAgentResult,
              // Issue identities can shift after a refinement; reset the
              // user's "fixed" checkboxes rather than show stale ticks.
              fixedIssues: [],
            }));
          }
        }
      } else {
        updateNodeData(agentNode.id, {
          messages: [...next, assistantMsg],
        });
      }

      if (res?.usage) recordUsage(res.usage, def.id, res?.model);
    } catch (err) {
      // User-initiated cancel: roll the optimistic user message back so
      // they can edit and retry without a stray "Error" reply in history.
      if (err?.name === "AbortError") {
        updateNodeData(agentNode.id, { messages });
        if (textOverride == null) setDraft(text);
      } else {
        updateNodeData(agentNode.id, {
          messages: [
            ...next,
            {
              role: "assistant",
              content: `_Error: ${err.message ?? "request failed"}_`,
              meta: { error: true },
            },
          ],
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      // Pin focus back so the user can keep typing.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function clearChat() {
    updateNodeData(agentNode.id, { messages: [] });
  }

  function retryLast() {
    // Drop the trailing assistant turn (if any) and resend the previous
    // user message. The user's last message stays in the transcript so the
    // model sees the same prompt; we only re-issue the request.
    if (busy) return;
    let trimmed = messages;
    if (trimmed[trimmed.length - 1]?.role === "assistant") {
      trimmed = trimmed.slice(0, -1);
    }
    const lastUser = [...trimmed].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Rewind transcript to before that user message, then resend so the
    // server receives the same conversation it would have for that turn.
    const idx = trimmed.lastIndexOf(lastUser);
    updateNodeData(agentNode.id, { messages: trimmed.slice(0, idx) });
    send(lastUser.content);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === "Escape" && busy) {
      e.preventDefault();
      stop();
      return;
    }
    if (e.key === "ArrowUp" && !draft && !busy) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        e.preventDefault();
        setDraft(lastUser.content);
      }
    }
  }

  const lastAssistantIdx = messages.findLastIndex(
    (m) => m.role === "assistant" && !m.meta?.error,
  );

  const AgentIcon = def.icon;

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div className="px-3 py-2 border-b border-ink-100 flex items-center gap-2">
        {AgentIcon && (
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
            style={{ background: def.accent ?? "#0f172a" }}
          >
            <AgentIcon size={12} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-ink-500 leading-none">
            Chatting with
          </div>
          <div className="text-[13px] font-medium text-ink-900 truncate leading-tight mt-0.5">
            {def.name}
          </div>
        </div>
        {messages.length > 0 &&
          (confirmReset ? (
            <span className="inline-flex items-center gap-1 text-[10px]">
              <span className="text-ink-500">Clear chat?</span>
              <button
                onClick={() => {
                  clearChat();
                  setConfirmReset(false);
                }}
                className="px-1.5 py-0.5 rounded bg-red-500 text-white hover:bg-red-600"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="px-1.5 py-0.5 rounded text-ink-500 hover:bg-ink-100"
              >
                No
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="text-[11px] text-ink-500 hover:text-ink-900 inline-flex items-center gap-1"
              title="Clear chat history"
            >
              <RefreshCw size={11} /> Reset
            </button>
          ))}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3"
      >
        {messages.length === 0 && (
          <EmptyChatState
            agentName={def.name}
            suggestions={suggestions}
            onPick={(s) => send(s)}
          />
        )}
        {messages.map((m, i) => (
          <MessageRow
            key={i}
            message={m}
            canRetry={
              !busy && i === lastAssistantIdx && m.role === "assistant"
            }
            onRetry={retryLast}
          />
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3 py-2 bg-ink-50 border border-ink-100">
              <span className="typing-dots" aria-label="Thinking">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Floating "↓ N new" pill, visible while the user has scrolled up. */}
      {!stickToBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute right-3 bottom-[92px] inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-ink-900 text-white shadow-floating hover:bg-ink-700 transition"
        >
          <ArrowDown size={12} />
          {unreadCount > 0 ? `${unreadCount} new` : "Latest"}
        </button>
      )}

      <div className="border-t border-ink-100 p-2">
        <div className="relative bg-ink-50 rounded-lg focus-within:ring-2 focus-within:ring-brand-500/40">
          <AutoTextarea
            inputRef={inputRef}
            value={draft}
            onChange={setDraft}
            onKeyDown={onKeyDown}
            placeholder="Ask or refine the analysis…"
          />
          {busy ? (
            <button
              onClick={stop}
              className="absolute right-1.5 bottom-1.5 h-7 w-7 rounded-full bg-ink-900 text-white hover:bg-ink-700 flex items-center justify-center transition"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!draft.trim()}
              className="absolute right-1.5 bottom-1.5 h-7 w-7 rounded-full bg-brand-500 text-white disabled:bg-ink-200 disabled:text-ink-400 hover:bg-brand-600 flex items-center justify-center transition"
              title="Send (Enter)"
              aria-label="Send"
            >
              <Send size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-ink-400">
          <span>
            <kbd className="font-sans">Enter</kbd> send ·{" "}
            <kbd className="font-sans">Shift+Enter</kbd> newline
            {messages.length > 0 && (
              <>
                {" "}
                · <kbd className="font-sans">↑</kbd> edit last
              </>
            )}
          </span>
          {busy && (
            <span className="text-ink-500">
              <kbd className="font-sans">Esc</kbd> stop
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Textarea that grows with content up to a sensible cap. Keeps the input
// compact when empty but lets long prompts stay legible without an inner
// scrollbar fighting the page scroll.
const AUTO_TEXTAREA_MAX = 160;

function AutoTextarea({ inputRef, value, onChange, onKeyDown, placeholder }) {
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, AUTO_TEXTAREA_MAX);
    el.style.height = next + "px";
  }, [value, inputRef]);
  return (
    <textarea
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      rows={1}
      placeholder={placeholder}
      // Background + focus ring live on the wrapper so the inset Send
      // button sits visually inside the input. `pr-12` reserves room for it.
      className="block w-full resize-none text-[13px] bg-transparent rounded-lg pl-3 pr-12 py-2 outline-none placeholder:text-ink-400 leading-relaxed min-h-[40px] max-h-[160px]"
    />
  );
}

function EmptyChatState({ agentName, suggestions, onPick }) {
  return (
    <div className="py-4 px-1 text-[12px]">
      <div className="flex items-center gap-1.5 text-ink-700 mb-2">
        <Wand2 size={13} className="text-brand-500" />
        <span className="font-medium">Refine with chat</span>
      </div>
      <p className="text-ink-500 leading-snug mb-3">
        Ask a follow-up about {agentName}, or request a change to the
        analysis. Edits update the output card automatically.
      </p>
      <div className="flex flex-col gap-1.5">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onPick(s)}
            className="text-left text-[12px] text-ink-700 bg-ink-50 hover:bg-ink-100 border border-ink-200 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5"
          >
            <Sparkles size={11} className="text-brand-500 shrink-0" />
            <span className="truncate">{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message, canRetry, onRetry }) {
  if (message.role === "user") {
    return <Bubble role="user">{message.content}</Bubble>;
  }
  // Assistant
  return (
    <AssistantMessage
      content={message.content}
      meta={message.meta}
      canRetry={canRetry}
      onRetry={onRetry}
    />
  );
}

function AssistantMessage({ content, meta, canRetry, onRetry }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(content || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — silent */
    }
  }
  const isError = !!meta?.error;
  return (
    <div className="group flex justify-start">
      <div className="max-w-[88%] flex flex-col gap-1">
        {meta?.updated && (
          <div className="self-start inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            <Check size={10} />
            Analysis updated{meta.summary ? ` · ${meta.summary}` : ""}
          </div>
        )}
        <div
          className={`rounded-xl rounded-bl-sm px-3 py-2 text-[13px] ${
            isError
              ? "bg-red-50 text-red-800 border border-red-200"
              : "bg-ink-50 text-ink-900 border border-ink-100"
          }`}
        >
          {content ? (
            <div className="prose-chat">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          ) : (
            <span className="text-ink-400 italic">No reply text.</span>
          )}
        </div>
        {!isError && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
            {content && (
              <ActionButton onClick={copy} title="Copy">
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy"}
              </ActionButton>
            )}
            {canRetry && (
              <ActionButton onClick={onRetry} title="Retry this turn">
                <RotateCcw size={11} />
                Retry
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 text-[10px] text-ink-500 hover:text-ink-900 hover:bg-ink-100 rounded px-1.5 py-0.5"
    >
      {children}
    </button>
  );
}

function Bubble({ role, children }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`rounded-xl px-3 py-2 text-[13px] whitespace-pre-wrap break-words ${
          isUser
            ? "bg-ink-900 text-white max-w-[78%] rounded-br-sm"
            : "bg-ink-50 text-ink-900 border border-ink-100 max-w-[88%] rounded-bl-sm"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// Compact summary of what changed between two structured results, used in
// the "Analysis updated · …" chip after a tool call.
function summarizeUpdate(prev, next) {
  if (!prev || !next) return null;
  const prevIssues = Array.isArray(prev.issues) ? prev.issues.length : null;
  const nextIssues = Array.isArray(next.issues) ? next.issues.length : null;
  if (prevIssues != null && nextIssues != null && prevIssues !== nextIssues) {
    return `${prevIssues} → ${nextIssues} issues`;
  }
  const prevFindings = Array.isArray(prev.findings)
    ? prev.findings.length
    : null;
  const nextFindings = Array.isArray(next.findings)
    ? next.findings.length
    : null;
  if (
    prevFindings != null &&
    nextFindings != null &&
    prevFindings !== nextFindings
  ) {
    return `${prevFindings} → ${nextFindings} findings`;
  }
  if (prev.usabilityScore !== next.usabilityScore) {
    return `score ${prev.usabilityScore ?? "—"} → ${next.usabilityScore ?? "—"}`;
  }
  return null;
}
