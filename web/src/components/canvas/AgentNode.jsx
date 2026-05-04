import { useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { ImagePlus, Play, Loader2, Trash2, X, MessageSquarePlus } from "lucide-react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "../../store.js";
import { getAgentDef } from "../../agents.js";
import { runAgent, fileToImagePayload } from "../../lib/api.js";

export default function AgentNode({ id, data, selected }) {
  const fileRef = useRef(null);
  const [showContext, setShowContext] = useState(false);
  const def = getAgentDef(data.agentId);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const addNode = useCanvasStore((s) => s.addNode);
  const addEdge = useCanvasStore((s) => s.addEdge);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const nodes = useCanvasStore((s) => s.nodes);

  if (!def) return null;
  const Icon = def.icon;
  const accent = def.accent;

  async function pickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await fileToImagePayload(file);
      updateNodeData(id, {
        image: { ...img, name: file.name, size: file.size },
        result: null,
        error: null,
        status: "idle",
      });
    } catch (err) {
      updateNodeData(id, { error: err.message });
    }
  }

  async function run() {
    if (!data.image || data.status === "running") return;
    updateNodeData(id, { status: "running", error: null });
    try {
      const res = await runAgent({
        agentId: def.id,
        image: { data: data.image.data, mediaType: data.image.mediaType },
        context: data.context?.trim() || undefined,
      });
      updateNodeData(id, { status: "done", result: res });

      // Fan out into 3 categorical output nodes, side-by-side, no edges:
      //   1. Overview   = summary + findings
      //   2. Suggestions = visual snippet proposals
      //   3. Action plan = strengths + next steps
      const r = res?.result ?? {};
      const kinds = [
        {
          kind: "overview",
          has:
            !!r.summary ||
            r.usabilityScore != null ||
            (r.findings?.length ?? 0) > 0,
        },
        { kind: "suggestions", has: (r.suggestions?.length ?? 0) > 0 },
        {
          kind: "actionPlan",
          has: (r.strengths?.length ?? 0) > 0 || (r.nextSteps?.length ?? 0) > 0,
        },
      ].filter((k) => k.has);

      const me = nodes.find((n) => n.id === id);
      const basePos = me?.position ?? { x: 0, y: 0 };
      const AGENT_WIDTH = 340;
      const OUTPUT_WIDTH = 520;
      const HORIZONTAL_GAP = 60;
      const startX = basePos.x + AGENT_WIDTH + HORIZONTAL_GAP;

      const outputIds = kinds.map(() => nanoid(8));
      kinds.forEach((k, i) => {
        addNode({
          id: outputIds[i],
          type: "output",
          position: {
            x: startX + i * (OUTPUT_WIDTH + HORIZONTAL_GAP),
            y: basePos.y,
          },
          data: {
            sourceAgentId: id,
            agentDefId: def.id,
            kind: k.kind,
            result: res,
          },
        });
      });
      if (outputIds[0]) selectNode(outputIds[0]);
    } catch (err) {
      updateNodeData(id, {
        status: "error",
        error: err.message ?? "request failed",
      });
    }
  }

  function clearImage() {
    updateNodeData(id, { image: null, result: null, error: null, status: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div
      className={`w-[340px] bg-white rounded-2xl shadow-floating border ${
        selected ? "border-brand-500" : "border-ink-200"
      } overflow-hidden`}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-ink-100">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ background: accent }}
        >
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-900 truncate">
            {def.name}
          </div>
          <div className="text-[11px] text-ink-500 uppercase tracking-wide">
            Agent
          </div>
        </div>
        <button
          onClick={() => removeNode(id)}
          className="p-1 rounded text-ink-400 hover:text-red-600 hover:bg-red-50"
          title="Delete node"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {data.image ? (
          <div className="relative rounded-lg overflow-hidden border border-ink-200 bg-ink-50">
            <img
              src={data.image.dataUrl}
              alt=""
              className="w-full max-h-[200px] object-contain"
            />
            <button
              onClick={clearImage}
              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/90 backdrop-blur shadow flex items-center justify-center text-ink-700 hover:text-red-600"
            >
              <X size={12} />
            </button>
            <div className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] text-white bg-gradient-to-t from-black/60 to-transparent truncate">
              {data.image.name}
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full h-[120px] rounded-lg border-2 border-dashed border-ink-200 hover:border-brand-500 hover:bg-brand-500/5 flex flex-col items-center justify-center gap-1.5 text-ink-500 hover:text-brand-600 transition"
          >
            <ImagePlus size={20} />
            <span className="text-xs font-medium">Drop or click to add screenshot</span>
            <span className="text-[10px] text-ink-400">PNG, JPG, WEBP</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={pickFile}
        />

        {/* Optional context */}
        {showContext || data.context ? (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Context (optional)
              </label>
              {!data.context && (
                <button
                  onClick={() => setShowContext(false)}
                  className="text-[10px] text-ink-400 hover:text-ink-700"
                >
                  Hide
                </button>
              )}
            </div>
            <textarea
              value={data.context ?? ""}
              onChange={(e) => updateNodeData(id, { context: e.target.value })}
              placeholder="e.g. B2B finance dashboard, focus on accessibility, target users are screen-reader heavy."
              rows={3}
              maxLength={4000}
              className="nodrag w-full text-[12px] bg-ink-50 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-brand-500/40 resize-none placeholder:text-ink-400"
            />
            {data.context && (
              <div className="text-[10px] text-ink-400 mt-1 text-right">
                {data.context.length}/4000
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowContext(true)}
            className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] text-ink-500 hover:text-brand-600 py-1"
          >
            <MessageSquarePlus size={12} /> Add context (optional)
          </button>
        )}

        {data.error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-md px-2 py-1.5">
            {data.error}
          </div>
        )}

        <button
          onClick={run}
          disabled={!data.image || data.status === "running"}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
          style={{
            background: data.status === "running" ? "#94a3b8" : accent,
          }}
        >
          {data.status === "running" ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Analyzing…
            </>
          ) : data.status === "done" ? (
            <>
              <Play size={14} /> Run again
            </>
          ) : (
            <>
              <Play size={14} /> Run analysis
            </>
          )}
        </button>
      </div>

      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
