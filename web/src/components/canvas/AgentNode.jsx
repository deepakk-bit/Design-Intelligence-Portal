import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import {
  ImagePlus,
  Play,
  Loader2,
  Trash2,
  X,
  ChevronDown,
  Check,
} from "lucide-react";
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
  const recordUsage = useCanvasStore((s) => s.recordUsage);

  if (!def) return null;
  const Icon = def.icon;
  const accent = def.accent;
  const slots = def.imageSlots ?? null;
  const inputs = def.inputs ?? (slots ? [] : ["image"]);
  const wantsImage = !slots && inputs.includes("image");
  const wantsText = inputs.includes("text") && !slots;
  const requireOneOf = def.inputsRequireOneOf ?? null;
  const requireAll = def.inputsRequireAll ?? null;
  // Text input UX:
  //   "url"       → URL field (QA Report)
  //   "prompt"    → multi-line prompt (image+text agents)
  //   "component" → single-line component name (text-only agents)
  const textKind =
    def.textInputKind ??
    (wantsImage && wantsText ? "prompt" : "component");

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
    if (requireAll) {
      if (requireAll.includes("image") && !data.image) return;
      if (requireAll.includes("text") && !data.componentName?.trim()) return;
    } else if (requireOneOf) {
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
        extras: def.extras
          ? Object.fromEntries(
              def.extras.map((ex) => [
                ex.key,
                data.extras?.[ex.key] ?? ex.default,
              ]),
            )
          : undefined,
      });
      updateNodeData(id, { status: "done", result: res });
      // Roll up tokens onto the workspace accumulator. Reruns of the same
      // node still count toward the workspace total even though the per-node
      // result.usage gets overwritten.
      if (res?.usage) recordUsage(res.usage, def.id, res?.model);

      const r = res?.result ?? {};
      // The unified QA Review result has both `issues[]` and `checkCoverage`.
      // Detect it first so it doesn't get matched by the more generic
      // "checklist" / "recommendations" kinds below (which key off `sections`
      // and `recommendations` arrays).
      const isQaReview =
        Array.isArray(r.issues) &&
        !!r.checkCoverage &&
        r.recommendations &&
        !Array.isArray(r.recommendations);
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
        {
          kind: "checklist",
          has: !isQaReview && (r.sections?.length ?? 0) > 0,
        },
        {
          kind: "previews",
          // Spawn the matrix preview card whenever the agent produced a
          // matrix spec (rowGroups × rowSubItems × columns). The SVG is
          // composed deterministically by the frontend from those tokens.
          has:
            !isQaReview &&
            !!r.matrix &&
            Array.isArray(r.matrix.rowGroups) &&
            Array.isArray(r.matrix.rowSubItems) &&
            Array.isArray(r.matrix.columns) &&
            r.matrix.rowGroups.length > 0 &&
            r.matrix.columns.length > 0,
        },
        {
          kind: "recommendations",
          has:
            !isQaReview &&
            (Array.isArray(r.recommendations)
              ? r.recommendations.length > 0
              : false ||
                (r.priorityOrder?.length ?? 0) > 0),
        },
        {
          kind: "qaReview",
          has: isQaReview,
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

        {wantsText && textKind === "url" && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500 block mb-1">
              Live URL
            </label>
            <input
              type="url"
              inputMode="url"
              value={data.componentName ?? ""}
              onChange={(e) =>
                updateNodeData(id, { componentName: e.target.value })
              }
              placeholder="https://example.com/page"
              maxLength={500}
              className="nodrag w-full text-[13px] bg-ink-50 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-brand-500/40 placeholder:text-ink-400"
            />
          </div>
        )}

        {def.extras?.map((ex) => (
          <div key={ex.key}>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500 block mb-1">
              {ex.label}
            </label>
            {ex.type === "select" ? (
              <Select
                value={data.extras?.[ex.key] ?? ex.default}
                options={ex.options}
                onChange={(v) =>
                  updateNodeData(id, (prev) => ({
                    ...prev,
                    extras: { ...(prev.extras ?? {}), [ex.key]: v },
                  }))
                }
              />
            ) : null}
          </div>
        ))}

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
            (requireAll
              ? (requireAll.includes("image") && !data.image) ||
                (requireAll.includes("text") &&
                  !data.componentName?.trim())
              : requireOneOf
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

// Lightweight, design-system-matching select. Native <select> on macOS /
// Windows pulls in browser chrome that looks alien next to our rounded
// `bg-ink-50` inputs, so we render a styled trigger + a small floating
// menu. Outside-click and Escape close the menu; Enter / Space toggles it.
function Select({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const current =
    options.find((o) => o.value === value) ?? options[0] ?? null;

  // Position the floating menu under the trigger and track its rect so
  // the portal stays anchored across canvas pans / scrolls. Escape and
  // outside-click both dismiss.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setMenuRect({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (
        triggerRef.current?.contains(e.target) ||
        menuRef.current?.contains(e.target)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="nodrag relative">
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full text-[13px] bg-ink-50 rounded-lg px-2.5 py-2 text-left flex items-center justify-between gap-2 outline-none transition ${
          open
            ? "ring-2 ring-brand-500/40"
            : "hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-brand-500/40"
        }`}
      >
        <span className="truncate text-ink-900">
          {current?.label ?? "Select…"}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-ink-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open &&
        menuRect &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: "fixed",
              left: menuRect.left,
              top: menuRect.top,
              width: menuRect.width,
            }}
            className="z-[60] bg-white rounded-lg border border-ink-200 shadow-floating overflow-hidden py-1"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full text-left text-[13px] px-2.5 py-1.5 flex items-center justify-between gap-2 transition ${
                    selected
                      ? "text-ink-900 font-medium bg-brand-500/5"
                      : "text-ink-700 hover:bg-ink-50"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {selected && (
                    <Check size={12} className="text-brand-600 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
