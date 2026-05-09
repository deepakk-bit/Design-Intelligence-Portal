import { useState } from "react";
import { Search, X } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { nanoid } from "nanoid";
import { AGENT_CATEGORIES, getAgentDef } from "../../agents.js";
import { useCanvasStore } from "../../store.js";

export default function AgentLibraryPanel() {
  const open = useCanvasStore((s) => s.leftPanelOpen);
  const toggle = useCanvasStore((s) => s.toggleLeftPanel);
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const nodes = useCanvasStore((s) => s.nodes);
  const { screenToFlowPosition } = useReactFlow();
  const [q, setQ] = useState("");

  if (!open) return null;

  function spawnAgent(agentId) {
    const def = getAgentDef(agentId);
    if (!def || def.disabled) return;

    // Place near the viewport center, but offset a bit so successive
    // clicks don't pile up on the same spot.
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const offset = (nodes.length % 6) * 32;
    const node = {
      id: nanoid(8),
      type: "agent",
      position: { x: center.x - 170 + offset, y: center.y - 120 + offset },
      data: {
        agentId: def.id,
        status: "idle",
        image: null,
        result: null,
        error: null,
        messages: [],
        context: "",
      },
    };
    addNode(node);
    selectNode(node.id);
  }

  const query = q.trim().toLowerCase();
  const filtered = AGENT_CATEGORIES.map((c) => ({
    ...c,
    agents: c.agents.filter(
      (a) =>
        !query ||
        a.name.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query),
    ),
  })).filter((c) => c.agents.length > 0);

  function onDragStart(e, agent) {
    if (agent.disabled) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("application/agent-id", agent.id);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <aside
      aria-label="Agent library"
      className="absolute top-20 left-4 bottom-20 w-[300px] z-20 bg-white rounded-2xl shadow-floating border border-ink-200 flex flex-col overflow-hidden"
    >
      <div className="px-3 py-3 border-b border-ink-100 flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search agents…"
            aria-label="Search agents"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-ink-50 rounded-lg outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </div>
        <button
          onClick={() => toggle(false)}
          aria-label="Close agent library"
          title="Close agent library"
          className="p-1.5 rounded text-ink-500 hover:text-ink-900 hover:bg-ink-100 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-2 py-2 space-y-3">
        {filtered.length === 0 && (
          <div className="text-center text-xs text-ink-500 py-8">
            No agents match “{q}”
          </div>
        )}
        {filtered.map((cat) => (
          <div key={cat.id}>
            <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold text-ink-400 uppercase tracking-wider">
              {cat.label}
            </div>
            <div className="space-y-1">
              {cat.agents.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  onDragStart={onDragStart}
                  onClick={() => spawnAgent(a.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-ink-100 text-[11px] text-ink-500">
        Click or drag an agent onto the canvas
      </div>
    </aside>
  );
}

function AgentRow({ agent, onDragStart, onClick }) {
  const Icon = agent.icon;
  return (
    <button
      type="button"
      draggable={!agent.disabled}
      onDragStart={(e) => onDragStart(e, agent)}
      onClick={() => !agent.disabled && onClick?.()}
      disabled={agent.disabled}
      aria-label={
        agent.disabled
          ? `${agent.name} (coming soon)`
          : `Add ${agent.name} agent to canvas`
      }
      title={agent.disabled ? "Coming soon" : "Click or drag to canvas"}
      className={`group flex items-start gap-2.5 px-2 py-2 rounded-lg w-full text-left outline-none transition focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
        agent.disabled
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer hover:bg-ink-50 focus-visible:bg-ink-50"
      }`}
    >
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
        style={{ background: agent.accent }}
        aria-hidden="true"
      >
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink-900 leading-tight truncate">
          {agent.name}
        </div>
        <div className="text-[11px] text-ink-500 leading-snug line-clamp-2 mt-0.5">
          {agent.description}
        </div>
      </div>
    </button>
  );
}
