import { useRef } from "react";
import { Handle, Position } from "@xyflow/react";
import { ImagePlus, Play, Loader2, Trash2, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "../../store.js";
import { getAgentDef } from "../../agents.js";
import { runAgent, fileToImagePayload } from "../../lib/api.js";

export default function AgentNode({ id, data, selected }) {
  const def = getAgentDef(data.agentId);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const nodes = useCanvasStore((s) => s.nodes);

  if (!def) return null;
  const Icon = def.icon;
  const accent = def.accent;
  const slots = def.imageSlots ?? null;
  const inputs = def.inputs ?? (slots ? [] : ["image"]);
  const wantsImage = !slots && inputs.includes("image");
  const wantsText = inputs.includes("text") && !slots;
  const requireOneOf = def.inputsRequireOneOf ?? null;
  // For prompt-style text inputs (no image alongside) we expose a "Component
  // name" affordance; when paired with an image, we use a more general "Prompt".
  const textKind = wantsImage && wantsText ? "prompt" : "component";

  const allSlotsFilled =
    !slots || slots.every((s) => !!data.images?.[s.key]);

  async function setSlotImage(slotKey, file) {
    if (!file) return;
    try {
      const img = await fileToImagePayload(file);
      // Functional patch: read latest data so concurrent slot fills don't
      // overwrite each other.
      updateNodeData(id, (prev) => ({
        ...prev,
        images: {
          ...(prev.images ?? {}),
          [slotKey]: { ...img, name: file.name, size: file.size },
        },
        result: null,
        error: null,
        status: "idle",
      }));
    } catch (err) {
      updateNodeData(id, { error: err.message });
    }
  }

  function clearSlotImage(slotKey) {
    updateNodeData(id, (prev) => {
      const nextImages = { ...(prev.images ?? {}) };
      delete nextImages[slotKey];
      return {
        ...prev,
        images: nextImages,
        result: null,
        error: null,
        status: "idle",
      };
    });
  }

  async function setSingleImage(file) {
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

  function clearSingleImage() {
    updateNodeData(id, { image: null, result: null, error: null, status: "idle" });
  }

  async function run() {
    if (data.status === "running") return;
    if (slots && !allSlotsFilled) return;
    if (requireOneOf) {
      const haveImage = !!data.image;
      const haveText = !!data.componentName?.trim();
      if (!haveImage && !haveText) return;
    } else {
      if (wantsImage && !data.image) return;
      if (wantsText && !data.componentName?.trim()) return;
    }
    updateNodeData(id, { status: "running", error: null });
    try {
      const imagesPayload = slots
        ? Object.fromEntries(
            slots.map((s) => [
              s.key,
              {
                data: data.images[s.key].data,
                mediaType: data.images[s.key].mediaType,
              },
            ]),
          )
        : undefined;
      const res = await runAgent({
        agentId: def.id,
        image:
          wantsImage && data.image
            ? { data: data.image.data, mediaType: data.image.mediaType }
            : undefined,
        images: imagesPayload,
        componentName:
          wantsText && data.componentName?.trim()
            ? data.componentName.trim()
            : undefined,
        context: data.context?.trim() || undefined,
      });
      updateNodeData(id, { status: "done", result: res });

      const r = res?.result ?? {};
      const kinds = [
        {
          kind: "overview",
          has: r.usabilityScore != null || (r.findings?.length ?? 0) > 0,
        },
        { kind: "suggestions", has: (r.suggestions?.length ?? 0) > 0 },
        {
          kind: "actionPlan",
          has: (r.strengths?.length ?? 0) > 0 || (r.nextSteps?.length ?? 0) > 0,
        },
        { kind: "checklist", has: (r.sections?.length ?? 0) > 0 && !r.summary?.recommendedAction },
        {
          kind: "recommendations",
          has:
            (r.recommendations?.length ?? 0) > 0 ||
            (r.priorityOrder?.length ?? 0) > 0,
        },
        {
          kind: "qaReport",
          has: !!r.summary?.recommendedAction && (r.sections?.length ?? 0) > 0,
        },
        {
          kind: "references",
          has: Array.isArray(r.references) && r.references.length > 0,
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

  return (
    <div
      className={`w-[340px] bg-white rounded-2xl shadow-floating border ${
        selected ? "border-brand-500" : "border-ink-200"
      } overflow-hidden`}
    >
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

      <div className="p-4 space-y-3">
        {slots &&
          slots.map((slot) => (
            <ImageSlot
              key={slot.key}
              slot={slot}
              image={data.images?.[slot.key]}
              onPick={(file) => setSlotImage(slot.key, file)}
              onClear={() => clearSlotImage(slot.key)}
            />
          ))}

        {wantsImage && (
          <SingleImage
            image={data.image}
            onPick={setSingleImage}
            onClear={clearSingleImage}
          />
        )}

        {wantsText && textKind === "component" && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500 block mb-1">
              Component name
            </label>
            <input
              type="text"
              value={data.componentName ?? ""}
              onChange={(e) =>
                updateNodeData(id, { componentName: e.target.value })
              }
              placeholder="e.g. Input Field, Button, Notification Badge"
              maxLength={200}
              className="nodrag w-full text-[13px] bg-ink-50 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-brand-500/40 placeholder:text-ink-400"
            />
          </div>
        )}

        {wantsText && textKind === "prompt" && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500 block mb-1">
              Prompt {data.image ? "(optional)" : "(or upload an image above)"}
            </label>
            <textarea
              value={data.componentName ?? ""}
              onChange={(e) =>
                updateNodeData(id, { componentName: e.target.value })
              }
              placeholder="e.g. pricing page tiered comparison, or onboarding flow for fintech"
              rows={2}
              maxLength={2000}
              className="nodrag w-full text-[13px] bg-ink-50 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-brand-500/40 resize-none placeholder:text-ink-400"
            />
          </div>
        )}

        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500 block mb-1">
            Context (optional)
          </label>
          <textarea
            value={data.context ?? ""}
            onChange={(e) => updateNodeData(id, { context: e.target.value })}
            placeholder="What should the agent focus on?"
            rows={3}
            maxLength={4000}
            className="nodrag w-full text-[12px] bg-ink-50 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-brand-500/40 resize-none placeholder:text-ink-400"
          />
        </div>

        {data.error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-md px-2 py-1.5">
            {data.error}
          </div>
        )}

        <button
          onClick={run}
          disabled={
            data.status === "running" ||
            (slots && !allSlotsFilled) ||
            (requireOneOf
              ? !data.image && !data.componentName?.trim()
              : (wantsImage && !data.image) ||
                (wantsText && !data.componentName?.trim()))
          }
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

function ImageSlot({ slot, image, onPick, onClear }) {
  const fileRef = useRef(null);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
          {slot.label}
        </label>
        {slot.help && (
          <span className="text-[10px] text-ink-400 truncate ml-2">
            {slot.help}
          </span>
        )}
      </div>
      {image ? (
        <div className="relative rounded-lg overflow-hidden border border-ink-200 bg-ink-50">
          <img
            src={image.dataUrl}
            alt=""
            className="w-full max-h-[140px] object-contain"
          />
          <button
            onClick={onClear}
            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white/90 backdrop-blur shadow flex items-center justify-center text-ink-700 hover:text-red-600"
          >
            <X size={11} />
          </button>
          <div className="absolute bottom-0 inset-x-0 px-2 py-0.5 text-[10px] text-white bg-gradient-to-t from-black/60 to-transparent truncate">
            {image.name}
          </div>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full h-[80px] rounded-lg border-2 border-dashed border-ink-200 hover:border-brand-500 hover:bg-brand-500/5 flex flex-col items-center justify-center gap-1 text-ink-500 hover:text-brand-600 transition"
        >
          <ImagePlus size={16} />
          <span className="text-[11px] font-medium">Drop or click to add</span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
    </div>
  );
}

function SingleImage({ image, onPick, onClear }) {
  const fileRef = useRef(null);
  return (
    <>
      {image ? (
        <div className="relative rounded-lg overflow-hidden border border-ink-200 bg-ink-50">
          <img
            src={image.dataUrl}
            alt=""
            className="w-full max-h-[200px] object-contain"
          />
          <button
            onClick={onClear}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/90 backdrop-blur shadow flex items-center justify-center text-ink-700 hover:text-red-600"
          >
            <X size={12} />
          </button>
          <div className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] text-white bg-gradient-to-t from-black/60 to-transparent truncate">
            {image.name}
          </div>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full h-[120px] rounded-lg border-2 border-dashed border-ink-200 hover:border-brand-500 hover:bg-brand-500/5 flex flex-col items-center justify-center gap-1.5 text-ink-500 hover:text-brand-600 transition"
        >
          <ImagePlus size={20} />
          <span className="text-xs font-medium">
            Drop or click to add screenshot
          </span>
          <span className="text-[10px] text-ink-400">PNG, JPG, WEBP</span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
    </>
  );
}
