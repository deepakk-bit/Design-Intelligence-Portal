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
  AlertCircle,
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
  // Text input renders alongside slots too (e.g. Dev Handoff Checker
  // takes 1–4 frames + a feature description).
  const wantsText = inputs.includes("text");
  const requireOneOf = def.inputsRequireOneOf ?? null;
  const requireAll = def.inputsRequireAll ?? null;
  // Text input UX:
  //   "url"       → URL field (QA Report)
  //   "prompt"    → multi-line prompt (image+text agents)
  //   "component" → single-line component name (text-only agents)
  const textKind =
    def.textInputKind ??
    (wantsImage && wantsText ? "prompt" : "component");

  // Optional slots don't gate the run button.
  const allSlotsFilled =
    !slots || slots.every((s) => s.optional || !!data.images?.[s.key]);

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
      // Dev Handoff has the unique combination of `verdict + stats +
      // blockers + categories`. Detect early so the generic "checklist"
      // path doesn't grab it.
      const isHandoff =
        !!r.verdict &&
        !!r.stats &&
        Array.isArray(r.blockers) &&
        Array.isArray(r.categories);
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
          has:
            !isQaReview && !isHandoff && (r.sections?.length ?? 0) > 0,
        },
        {
          kind: "previews",
          // Spawn the matrix preview card whenever the agent produced a
          // matrix spec (rowGroups × rowSubItems × columns). The SVG is
          // composed deterministically by the frontend from those tokens.
          has:
            !isQaReview &&
            !isHandoff &&
            !!r.matrix &&
            Array.isArray(r.matrix.rowGroups) &&
            Array.isArray(r.matrix.rowSubItems) &&
            Array.isArray(r.matrix.columns) &&
            r.matrix.rowGroups.length > 0 &&
            r.matrix.columns.length > 0,
        },
        {
          kind: "handoff",
          has: isHandoff,
        },
        {
          kind: "recommendations",
          has:
            !isQaReview &&
            !isHandoff &&
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
        {
          // TailGrids Component Generator output. Phase 1: the agent
          // returns the raw .tsx source for the picked component; the
          // body shows it with a Phase 2 placeholder for the visual
          // preview. Detected by the presence of r.tailgrids.source.
          kind: "tailgrids",
          has: !!r.tailgrids && typeof r.tailgrids.source === "string",
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
          aria-label={`Delete ${def.name} node`}
          title="Delete node"
          className="p-1 rounded text-ink-400 hover:text-red-600 hover:bg-red-50 outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        >
          <Trash2 size={14} aria-hidden="true" />
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

        {def.extras?.map((ex) => {
          const value = data.extras?.[ex.key] ?? ex.default;
          const setValue = (v) =>
            updateNodeData(id, (prev) => ({
              ...prev,
              extras: { ...(prev.extras ?? {}), [ex.key]: v },
            }));
          return (
            <div key={ex.key}>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500 block mb-1">
                {ex.label}
              </label>
              {ex.type === "select" && (
                <Select value={value} options={ex.options} onChange={setValue} />
              )}
              {ex.type === "color" && (
                <ColorInput value={value} onChange={setValue} />
              )}
              {ex.type === "number" && (
                <NumberInput
                  value={value}
                  min={ex.min}
                  max={ex.max}
                  suffix={ex.suffix}
                  onChange={setValue}
                />
              )}
              {ex.help && (
                <p className="text-[10px] text-ink-400 mt-1 leading-snug">
                  {ex.help}
                </p>
              )}
            </div>
          );
        })}

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
          <div
            role="alert"
            className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 flex items-start gap-1.5 leading-snug"
          >
            <AlertCircle
              size={13}
              aria-hidden="true"
              className="text-red-600 shrink-0 mt-px"
            />
            <span>{data.error}</span>
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

// Listens for clipboard paste events at the document level and forwards
// the first image-typed item to `onPick` — but only when one of the
// elements in `targetRefs` is currently focused, so multiple slots on
// the same node don't all swallow the same paste.
function usePasteImage(targetRefs, onPick) {
  useEffect(() => {
    function handle(e) {
      const refs = Array.isArray(targetRefs) ? targetRefs : [targetRefs];
      const focused = refs.some((r) => r.current === document.activeElement);
      if (!focused) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((it) => it.type?.startsWith("image/"));
      if (!imageItem) return;
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) onPick(file);
    }
    document.addEventListener("paste", handle);
    return () => document.removeEventListener("paste", handle);
  }, [targetRefs, onPick]);
}

function ImageSlot({ slot, image, onPick, onClear }) {
  const fileRef = useRef(null);
  const dropRef = useRef(null);
  usePasteImage(dropRef, onPick);
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
            aria-label={`Remove ${slot.label} image`}
            title="Remove image"
            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white/90 backdrop-blur shadow flex items-center justify-center text-ink-700 hover:text-red-600 outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            <X size={11} aria-hidden="true" />
          </button>
          <div className="absolute bottom-0 inset-x-0 px-2 py-0.5 text-[10px] text-white bg-gradient-to-t from-black/60 to-transparent truncate">
            {image.name}
          </div>
        </div>
      ) : (
        <button
          ref={dropRef}
          onClick={() => fileRef.current?.click()}
          className="nodrag w-full h-[80px] rounded-lg border-2 border-dashed border-ink-200 hover:border-brand-500 hover:bg-brand-500/5 focus:outline-none focus:border-brand-500 focus:bg-brand-500/5 flex flex-col items-center justify-center gap-1 text-ink-500 hover:text-brand-600 focus:text-brand-600 transition"
        >
          <ImagePlus size={16} />
          <span className="text-[11px] font-medium">
            Drop, paste, or click
          </span>
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
  const dropRef = useRef(null);
  usePasteImage(dropRef, onPick);
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
            aria-label="Remove image"
            title="Remove image"
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/90 backdrop-blur shadow flex items-center justify-center text-ink-700 hover:text-red-600 outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            <X size={12} aria-hidden="true" />
          </button>
          <div className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] text-white bg-gradient-to-t from-black/60 to-transparent truncate">
            {image.name}
          </div>
        </div>
      ) : (
        <button
          ref={dropRef}
          onClick={() => fileRef.current?.click()}
          className="nodrag w-full h-[120px] rounded-lg border-2 border-dashed border-ink-200 hover:border-brand-500 hover:bg-brand-500/5 focus:outline-none focus:border-brand-500 focus:bg-brand-500/5 flex flex-col items-center justify-center gap-1.5 text-ink-500 hover:text-brand-600 focus:text-brand-600 transition"
        >
          <ImagePlus size={20} />
          <span className="text-xs font-medium">
            Drop, paste, or click to add
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

// Hex colour input that matches the surrounding ink-50 inputs. Native
// <input type="color"> would pull in the OS picker which looks alien;
// instead we show a swatch that triggers it in a hidden child input,
// plus a free-text hex field next to it.
function ColorInput({ value, onChange }) {
  const safe = /^#([\da-f]{3}|[\da-f]{6})$/i.test(value ?? "")
    ? value
    : "#000000";
  const pickerRef = useRef(null);
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commitDraft() {
    const trimmed = draft.trim();
    const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (/^#([\da-f]{3}|[\da-f]{6})$/i.test(withHash)) {
      onChange(withHash);
    } else {
      setDraft(value ?? "");
    }
  }

  return (
    <div className="nodrag flex items-center gap-2 bg-ink-50 rounded-lg px-2 py-1.5 focus-within:ring-2 focus-within:ring-brand-500/40">
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          pickerRef.current?.click();
        }}
        title="Pick a colour"
        className="w-6 h-6 rounded-md border border-ink-200 shrink-0"
        style={{ background: safe }}
      />
      <input
        ref={pickerRef}
        type="color"
        value={safe}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 min-w-0 bg-transparent text-[13px] font-mono outline-none text-ink-900 placeholder:text-ink-400"
        placeholder="#0f172a"
      />
    </div>
  );
}

function NumberInput({ value, min, max, suffix, onChange }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  function commit() {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      const lo = min ?? Number.NEGATIVE_INFINITY;
      const hi = max ?? Number.POSITIVE_INFINITY;
      onChange(Math.max(lo, Math.min(hi, n)));
    } else {
      setDraft(String(value ?? ""));
    }
  }

  return (
    <div className="nodrag flex items-center gap-1 bg-ink-50 rounded-lg px-2.5 py-2 focus-within:ring-2 focus-within:ring-brand-500/40">
      <input
        type="number"
        inputMode="numeric"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex-1 min-w-0 bg-transparent text-[13px] outline-none text-ink-900 placeholder:text-ink-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && (
        <span className="text-[12px] text-ink-400 shrink-0 select-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

// Lightweight, design-system-matching select. Native <select> on macOS /
// Windows pulls in browser chrome that looks alien next to our rounded
// `bg-ink-50` inputs, so we render a styled trigger + a small floating
// menu. Outside-click and Escape close the menu; Enter / Space toggles it.
// Maximum visible height of the dropdown listbox. Long lists (the
// TailGrids picker is 54 entries) overflow this and scroll instead
// of growing off-screen. About 10 rows tall at our 32px row height,
// which is the typical combobox / native <select> popover size.
const SELECT_MAX_MENU_HEIGHT = 320;
const SELECT_VIEWPORT_PADDING = 8;

function Select({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const current =
    options.find((o) => o.value === value) ?? options[0] ?? null;

  // Position the floating menu next to the trigger. We compute both
  // the height we want (capped at SELECT_MAX_MENU_HEIGHT) and whether
  // there's room below or whether we should flip above — same
  // behaviour native <select> uses to keep the menu on-screen.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const vh = window.innerHeight;
      const spaceBelow = vh - r.bottom - SELECT_VIEWPORT_PADDING;
      const spaceAbove = r.top - SELECT_VIEWPORT_PADDING;
      // Prefer below unless we'd have to clip more than we would
      // above. If space below is enough for the cap, just open below.
      const flipAbove =
        spaceBelow < SELECT_MAX_MENU_HEIGHT && spaceAbove > spaceBelow;
      const maxHeight = Math.max(
        120,
        Math.min(SELECT_MAX_MENU_HEIGHT, flipAbove ? spaceAbove : spaceBelow),
      );
      const top = flipAbove ? r.top - maxHeight - 4 : r.bottom + 4;
      setMenuRect({ left: r.left, top, width: r.width, maxHeight });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // When the menu opens, scroll the currently-selected option into
  // view. With 54 items in the TailGrids picker the user's choice
  // would otherwise be off-screen on every re-open.
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const selectedEl = menuRef.current.querySelector(
      "[data-selected='true']",
    );
    if (selectedEl) selectedEl.scrollIntoView({ block: "nearest" });
  }, [open, menuRect]);

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

  // React Flow v12 uses `pointerdown` (not `mousedown`) for node
  // drag + selection. Stopping propagation on every pointer-ish
  // event family — pointerdown, mousedown, click — keeps the canvas
  // from grabbing the click and the node from drifting under the
  // cursor. The `nodrag nopan` class set on the wrapper covers the
  // CSS-based opt-outs React Flow checks via `closest()`.
  function stop(e) {
    e.stopPropagation();
  }
  return (
    <div className="nodrag nopan relative">
      <button
        ref={triggerRef}
        type="button"
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`nodrag nopan w-full text-[13px] bg-ink-50 rounded-lg px-2.5 py-2 text-left flex items-center justify-between gap-2 outline-none transition ${
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
              maxHeight: menuRect.maxHeight,
            }}
            className="z-[60] bg-white rounded-lg border border-ink-200 shadow-floating overflow-y-auto overscroll-contain scroll-thin py-1"
            onPointerDown={stop}
            onMouseDown={stop}
            onWheel={stop}
          >
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-selected={selected ? "true" : "false"}
                  onPointerDown={stop}
                  onMouseDown={stop}
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
