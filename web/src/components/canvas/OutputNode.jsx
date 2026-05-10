import { Handle, Position } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Trash2,
  AlertCircle,
  Sparkles,
  ListChecks,
  ThumbsUp,
  Layers,
  Star,
  ClipboardCheck,
  ClipboardList,
  Compass,
  Component,
  Copy,
  Download,
  ExternalLink,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CircleX,
  CircleAlert,
} from "lucide-react";
import { useCanvasStore } from "../../store.js";
import { getAgentDef } from "../../agents.js";

// Output nodes are categorical: each one bundles a coherent set of related
// feedback. Three kinds total — keeps the canvas readable while preserving
// the canonical structure of the analyst's response.

const KINDS = {
  overview: {
    label: "Overview",
    icon: AlertCircle,
    accent: "#0f172a",
    sub: "Summary + findings",
  },
  suggestions: {
    label: "Suggestions",
    icon: Sparkles,
    accent: "#7c3aed",
    sub: "Proposed UI changes",
  },
  actionPlan: {
    label: "Action plan",
    icon: ListChecks,
    accent: "#059669",
    sub: "Strengths + next steps",
  },
  checklist: {
    label: "States & Variants",
    icon: Layers,
    accent: "#2563eb",
    sub: "Design checklist by category",
  },
  recommendations: {
    label: "Priority & Best Practices",
    icon: Star,
    accent: "#d97706",
    sub: "Where to start + recommendations",
  },
  qaReview: {
    label: "QA Review",
    icon: ClipboardCheck,
    accent: "#9333ea",
    sub: "Design vs built — checkable issue log",
  },
  previews: {
    label: "Component Matrix",
    icon: Layers,
    accent: "#1d4ed8",
    sub: "React + Tailwind code, ready for Figma",
  },
  handoff: {
    label: "Dev Handoff Checklist",
    icon: ClipboardList,
    accent: "#0d9488",
    sub: "Frame readiness — what's complete vs missing",
  },
  references: {
    label: "References",
    icon: Compass,
    accent: "#0891b2",
    sub: "Real product screens via Refero",
  },
  tailgrids: {
    label: "Component (TailGrids)",
    icon: Component,
    accent: "#3056D3",
    sub: "Live preview + React (Tailwind) JSX",
  },
};

const SEVERITY = {
  critical: { label: "Critical", color: "#dc2626", bg: "#fef2f2" },
  major: { label: "Major", color: "#ea580c", bg: "#fff7ed" },
  minor: { label: "Minor", color: "#ca8a04", bg: "#fefce8" },
  nit: { label: "Nit", color: "#64748b", bg: "#f1f5f9" },
  high: { label: "High", color: "#dc2626", bg: "#fef2f2" },
  medium: { label: "Medium", color: "#ea580c", bg: "#fff7ed" },
  low: { label: "Low", color: "#ca8a04", bg: "#fefce8" },
  info: { label: "Info", color: "#0284c7", bg: "#f0f9ff" },
};

export default function OutputNode({ id, data, selected }) {
  const removeNode = useCanvasStore((s) => s.removeNode);
  const def = getAgentDef(data.agentDefId);
  // Backward compat: map old single-section kinds to the new combined kinds
  // so previously-saved canvases still render without breaking.
  const kind = mapLegacyKind(data.kind ?? "overview");
  const meta = KINDS[kind] ?? KINDS.overview;
  const Icon = meta.icon;
  const result = data.result?.result;

  if (!result) {
    return (
      <div className="w-[520px] bg-white rounded-2xl shadow-floating border border-ink-200 p-5 flex items-center gap-2.5 text-sm text-ink-500">
        <AlertCircle size={14} aria-hidden="true" className="text-ink-400" />
        <span>
          No result yet — run the source agent to populate this card.
        </span>
      </div>
    );
  }

  return (
    <div
      className={`w-[520px] bg-white rounded-2xl shadow-floating border overflow-hidden flex flex-col ${
        selected ? "border-brand-500" : "border-ink-200"
      }`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />

      <div className="px-4 py-3 flex items-center gap-3 border-b border-ink-100 shrink-0">
        <div
          aria-hidden="true"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ background: meta.accent }}
        >
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="text-sm font-semibold text-ink-900 truncate text-left">
            {meta.label}
          </div>
          <div className="text-[11px] text-ink-500 truncate text-left">
            {def?.name ?? "Output"} · {meta.sub}
          </div>
        </div>
        {/* Card-header Copy code, only on the matrix previews card. Keeps
            the primary CTA at eye-level instead of buried in the body. */}
        {kind === "previews" && result?.matrix && (
          <PreviewsCopyButton
            matrix={result.matrix}
            componentName={result.componentName ?? "Component"}
            library={result.library ?? "shadcn"}
          />
        )}
        {kind === "tailgrids" && result?.tailgrids?.source && (
          <TailgridsCopyButton
            source={result.tailgrids.source}
            jsx={result.tailgrids.jsx}
          />
        )}
        <button
          onClick={() => removeNode(id)}
          aria-label={`Delete ${meta.label} output`}
          title="Delete"
          className="p-1 rounded text-ink-400 hover:text-red-600 hover:bg-red-50 outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      {/* `nowheel` lets the cursor scroll the node body instead of panning the canvas */}
      <div className="nowheel text-left max-h-[520px] overflow-y-auto scroll-thin px-4 py-3">
        {kind === "overview" && <OverviewBody result={result} />}
        {kind === "suggestions" && <SuggestionsBody result={result} />}
        {kind === "actionPlan" && <ActionPlanBody result={result} />}
        {kind === "checklist" && <ChecklistBody result={result} />}
        {kind === "recommendations" && <RecommendationsBody result={result} />}
        {kind === "qaReview" && (
          <QaReviewBody nodeId={id} data={data} result={result} />
        )}
        {kind === "previews" && <PreviewsBody result={result} />}
        {kind === "handoff" && (
          <HandoffBody nodeId={id} data={data} result={result} />
        )}
        {kind === "references" && <ReferencesBody result={result} />}
        {kind === "tailgrids" && <TailgridsBody result={result} />}
      </div>
    </div>
  );
}

function mapLegacyKind(kind) {
  if (kind === "summary" || kind === "findings") return "overview";
  if (kind === "strengths" || kind === "nextSteps") return "actionPlan";
  // Older canvases used the split QA outputs — show them in the unified card.
  if (kind === "qaReport" || kind === "qaReportFull") return "qaReview";
  return kind;
}

function SectionLabel({ icon: Icon, color, count, children }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon size={13} style={{ color }} />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-700">
        {children}
      </span>
      {count != null && (
        <span className="text-[10px] font-medium text-ink-500 bg-ink-100 rounded-full px-1.5 py-0.5">
          {count}
        </span>
      )}
    </div>
  );
}

function OverviewBody({ result }) {
  const score = result.usabilityScore ?? null;
  const findings = result.findings ?? [];
  return (
    <div className="space-y-4">
      {(score != null || result.summary) && (
        <div>
          <div className="flex items-start gap-3">
            {score != null && <ScoreBlock score={score} />}
            {result.summary && (
              <p className="text-[13px] leading-relaxed text-ink-700 flex-1">
                {result.summary}
              </p>
            )}
          </div>
        </div>
      )}
      {findings.length > 0 && (
        <div>
          <SectionLabel icon={AlertCircle} color="#dc2626" count={findings.length}>
            Findings
          </SectionLabel>
          <div className="space-y-2">
            {findings.map((f, i) => (
              <FindingCard key={i} f={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionsBody({ result }) {
  const items = result.suggestions ?? [];
  if (items.length === 0)
    return (
      <div className="text-[12px] text-ink-400 italic py-2">No suggestions.</div>
    );
  return (
    <div className="space-y-3">
      {items.map((s, i) => (
        <SuggestionCard key={i} s={s} />
      ))}
    </div>
  );
}

function ActionPlanBody({ result }) {
  const strengths = result.strengths ?? [];
  const nextSteps = result.nextSteps ?? [];
  return (
    <div className="space-y-4">
      {strengths.length > 0 && (
        <div>
          <SectionLabel icon={ThumbsUp} color="#10b981" count={strengths.length}>
            Strengths
          </SectionLabel>
          <ul className="space-y-1.5 text-[13px] text-ink-700">
            {strengths.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-emerald-500 shrink-0">✓</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {nextSteps.length > 0 && (
        <div>
          <SectionLabel icon={ListChecks} color="#2563eb" count={nextSteps.length}>
            Next steps
          </SectionLabel>
          <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-ink-700">
            {nextSteps.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ChecklistBody({ result }) {
  const sections = result.sections ?? [];
  return (
    <div className="space-y-4">
      {result.componentName && (
        <div className="text-[12px] text-ink-500">
          Component:{" "}
          <span className="font-semibold text-ink-900">
            {result.componentName}
          </span>
        </div>
      )}
      {result.summary && (
        <p className="text-[13px] leading-relaxed text-ink-700">
          {result.summary}
        </p>
      )}
      {sections.map((s, i) => (
        <div key={i}>
          <SectionLabel
            icon={Layers}
            color="#2563eb"
            count={s.states?.length ?? 0}
          >
            {s.title}
          </SectionLabel>
          <ul className="space-y-1.5">
            {(s.states ?? []).map((st, j) => (
              <li
                key={j}
                className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-[12px]"
              >
                <div className="font-medium text-ink-900">{st.name}</div>
                {st.note && (
                  <div className="text-[11px] text-ink-600 mt-0.5 leading-snug">
                    {st.note}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RecommendationsBody({ result }) {
  const order = result.priorityOrder ?? [];
  const recs = result.recommendations ?? [];
  return (
    <div className="space-y-4">
      {order.length > 0 && (
        <div>
          <SectionLabel icon={ListChecks} color="#2563eb" count={order.length}>
            Priority order
          </SectionLabel>
          <ol className="list-decimal pl-5 space-y-1 text-[13px] text-ink-700">
            {order.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {recs.length > 0 && (
        <div>
          <SectionLabel icon={Star} color="#d97706" count={recs.length}>
            Recommendations
          </SectionLabel>
          <ul className="space-y-1.5 text-[13px] text-ink-700">
            {recs.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-amber-500 shrink-0">★</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const CATEGORY_LABELS = {
  spacing: "Spacing & Layout",
  color: "Colour",
  typography: "Typography",
  states: "States",
  components: "Components",
  responsive: "Responsive",
  accessibility: "Accessibility",
  // Legacy categories from older runs:
  copy: "Copy",
  ui: "UI",
  "design-system": "Design system",
  responsiveness: "Responsive",
};

const COVERAGE_LABELS = {
  ...CATEGORY_LABELS,
  spacing: "Spacing",
};

const CATEGORY_ORDER = [
  "spacing",
  "color",
  "typography",
  "states",
  "components",
  "responsive",
  "accessibility",
];

function QaReviewBody({ nodeId, data, result }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  // Pull both the DESIGN and BUILT images off the source agent node so
  // the side-by-side comparison view can render them without duplicating
  // bytes onto the output node.
  const builtImage = useCanvasStore((s) => {
    const src = s.nodes.find((n) => n.id === data.sourceAgentId);
    return src?.data?.images?.builtImage ?? null;
  });
  const designImage = useCanvasStore((s) => {
    const src = s.nodes.find((n) => n.id === data.sourceAgentId);
    return src?.data?.images?.designImage ?? null;
  });
  const sum = result.summary ?? {};
  const verdict = sum.verdict ?? result.verdict ?? {};
  const issues = result.issues ?? [];
  const cov = result.checkCoverage ?? {};
  const recs = result.recommendations ?? {};
  const fixedSet = new Set(data.fixedIssues ?? []);
  const fixedCount = issues.reduce(
    (n, _, i) => (fixedSet.has(i) ? n + 1 : n),
    0,
  );
  const issuesWithPoints = issues.filter(
    (it) => it.point && typeof it.point.x === "number",
  );

  // Pin/row linking state. Hovering or clicking either side highlights
  // its counterpart; clicking a pin also scrolls the matching row into view.
  const [activeIndex, setActiveIndex] = useState(null);
  const rowRefsRef = useRef(new Map());
  function setRowRef(idx, el) {
    if (el) rowRefsRef.current.set(idx, el);
    else rowRefsRef.current.delete(idx);
  }
  function focusIssue(idx) {
    setActiveIndex(idx);
    const el = rowRefsRef.current.get(idx);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  const verdictColor =
    {
      ready: "#10b981",
      conditional: "#d97706",
      blocked: "#dc2626",
    }[verdict.status] ?? "#64748b";
  const verdictLabel =
    {
      ready: "Ready",
      conditional: "Conditional",
      blocked: "Blocked",
    }[verdict.status] ?? verdict.status ?? "—";

  function toggleFixed(idx) {
    updateNodeData(nodeId, (prev) => {
      const cur = new Set(prev.fixedIssues ?? []);
      if (cur.has(idx)) cur.delete(idx);
      else cur.add(idx);
      return { ...prev, fixedIssues: [...cur].sort((a, b) => a - b) };
    });
  }
  function clearAllFixed() {
    updateNodeData(nodeId, (prev) => ({ ...prev, fixedIssues: [] }));
  }

  return (
    <div className="space-y-4">
      {result.componentName && (
        <div className="text-[12px] text-ink-500">
          Component:{" "}
          <span className="font-semibold text-ink-900">
            {result.componentName}
          </span>
        </div>
      )}

      <div className="rounded-lg border border-ink-200 p-3 bg-white">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold text-white"
            style={{ background: verdictColor }}
          >
            {verdictLabel}
          </span>
          <span className="text-[12px] text-ink-500">
            {sum.totalIssues ?? issues.length} issue
            {(sum.totalIssues ?? issues.length) === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex gap-2 text-[11px] mb-2">
          <Pill color="#dc2626" bg="#fef2f2">
            {sum.highSeverity ?? 0} high
          </Pill>
          <Pill color="#ea580c" bg="#fff7ed">
            {sum.mediumSeverity ?? 0} medium
          </Pill>
          <Pill color="#ca8a04" bg="#fefce8">
            {sum.lowSeverity ?? 0} low
          </Pill>
        </div>
        {verdict.reason && (
          <p className="text-[12px] leading-snug text-ink-700">
            {verdict.reason}
          </p>
        )}
      </div>

      {builtImage?.dataUrl && (
        <div>
          <SectionLabel
            icon={ClipboardCheck}
            color="#9333ea"
            count={issuesWithPoints.length}
          >
            Design vs Built
          </SectionLabel>
          <div className="space-y-3">
            {designImage?.dataUrl ? (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                    Design
                  </span>
                </div>
                <div className="rounded-lg overflow-hidden border border-ink-200 bg-ink-50">
                  <img
                    src={designImage.dataUrl}
                    alt="Design reference"
                    className="block w-full select-none"
                    draggable={false}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/50 p-4 text-[11px] text-ink-400 flex items-center justify-center text-center">
                Design image not available — agent node may have been
                deleted.
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                  Built
                </span>
                {issuesWithPoints.length > 0 && (
                  <span className="text-[10px] text-ink-400">
                    · {issuesWithPoints.length} pin
                    {issuesWithPoints.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <AnnotatedBuiltImage
                image={builtImage}
                issues={issues}
                activeIndex={activeIndex}
                onPinClick={(i) => focusIssue(i)}
                onPinHover={(i) => setActiveIndex(i)}
              />
            </div>
          </div>
          {issuesWithPoints.length > 0 && (
            <p className="text-[10px] text-ink-400 mt-1.5">
              Pins land on the built image. Click a pin to jump to its
              issue; hover an issue row to highlight its pin.
            </p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <SectionLabel
            icon={ClipboardCheck}
            color="#9333ea"
            count={issues.length}
          >
            Issue log
          </SectionLabel>
          {issues.length > 0 && (
            <div className="flex items-center gap-2 -mt-2">
              <span className="text-[10px] text-ink-500 tabular-nums">
                {fixedCount}/{issues.length} fixed
              </span>
              {fixedCount > 0 && (
                <button
                  onClick={clearAllFixed}
                  className="text-[10px] text-ink-400 hover:text-ink-700 underline underline-offset-2"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
        {issues.length === 0 ? (
          <div className="text-[11px] text-ink-400 italic">No issues found.</div>
        ) : (
          <QaReviewIssueGroups
            issues={issues}
            fixedSet={fixedSet}
            onToggle={toggleFixed}
            activeIndex={activeIndex}
            onRowHover={setActiveIndex}
            setRowRef={setRowRef}
          />
        )}
      </div>

      <div>
        <SectionLabel icon={ListChecks} color="#2563eb">
          Check coverage
        </SectionLabel>
        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-ink-700">
          {[
            "spacing",
            "color",
            "typography",
            "states",
            "components",
            "responsive",
            "accessibility",
          ].map((key) => (
            <CoverageRow
              key={key}
              label={COVERAGE_LABELS[key]}
              count={cov[key]}
            />
          ))}
        </div>
      </div>

      {(recs.doNow?.length || recs.thisSprint?.length || recs.backlog?.length) ? (
        <div>
          <SectionLabel icon={Star} color="#d97706">
            Recommendations
          </SectionLabel>
          <RecommendationGroup
            label="Do now"
            color="#dc2626"
            items={recs.doNow ?? []}
          />
          <RecommendationGroup
            label="This sprint"
            color="#ea580c"
            items={recs.thisSprint ?? []}
          />
          <RecommendationGroup
            label="Backlog"
            color="#ca8a04"
            items={recs.backlog ?? []}
          />
        </div>
      ) : null}
    </div>
  );
}

// Built screenshot with numbered pins overlaid at each issue's normalised
// coordinate. The pins are buttons so they're keyboard-focusable; clicking
// scrolls the matching list row into view, hovering highlights it.
function AnnotatedBuiltImage({
  image,
  issues,
  activeIndex,
  onPinClick,
  onPinHover,
}) {
  return (
    <div className="relative rounded-lg overflow-hidden border border-ink-200 bg-ink-50">
      <img
        src={image.dataUrl}
        alt="Built screenshot annotated with QA issue pins"
        className="block w-full select-none"
        draggable={false}
      />
      <div className="absolute inset-0 pointer-events-none">
        {issues.map((issue, i) => {
          if (!issue.point || typeof issue.point.x !== "number") return null;
          return (
            <Pin
              key={i}
              number={i + 1}
              severity={issue.severity}
              x={issue.point.x}
              y={issue.point.y}
              active={activeIndex === i}
              dim={activeIndex != null && activeIndex !== i}
              onClick={() => onPinClick?.(i)}
              onMouseEnter={() => onPinHover?.(i)}
              onMouseLeave={() => onPinHover?.(null)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Pin({
  number,
  severity,
  x,
  y,
  active,
  dim,
  onClick,
  onMouseEnter,
  onMouseLeave,
}) {
  const sev = SEVERITY[severity] ?? SEVERITY.low;
  // Clamp to keep pins inside the image even if the model emits a value
  // a hair past 1.
  const cx = Math.max(0, Math.min(1, x)) * 100;
  const cy = Math.max(0, Math.min(1, y)) * 100;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={`Issue #${number} · ${sev.label}`}
      style={{
        left: `${cx}%`,
        top: `${cy}%`,
        background: sev.color,
      }}
      className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-white text-[11px] font-semibold tabular-nums flex items-center justify-center shadow-md ring-2 ring-white outline-none transition-all duration-150 ${
        active
          ? "scale-125 z-20 ring-brand-500"
          : dim
            ? "opacity-60 hover:opacity-100 hover:scale-110"
            : "hover:scale-110 z-10"
      }`}
    >
      {number}
    </button>
  );
}

function QaReviewIssueGroups({
  issues,
  fixedSet,
  onToggle,
  activeIndex,
  onRowHover,
  setRowRef,
}) {
  // Bucket issues by category, preserving the original index so checkbox
  // state stays aligned with the model's flat array.
  const byCategory = new Map();
  issues.forEach((it, i) => {
    const key = it.category ?? "other";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push({ issue: it, index: i });
  });
  // Render in canonical category order, then any unknown categories last.
  const orderedKeys = [
    ...CATEGORY_ORDER.filter((k) => byCategory.has(k)),
    ...Array.from(byCategory.keys()).filter((k) => !CATEGORY_ORDER.includes(k)),
  ];

  return (
    <div className="space-y-3">
      {orderedKeys.map((key) => {
        const rows = byCategory.get(key);
        return (
          <div key={key}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-pink-600">
                {CATEGORY_LABELS[key] ?? key}
              </span>
              <span className="text-[10px] font-medium text-ink-500 bg-ink-100 rounded-full px-1.5 py-0.5">
                {rows.length}
              </span>
            </div>
            <div className="space-y-2">
              {rows.map(({ issue, index }) => (
                <QaReviewIssueCard
                  key={index}
                  index={index + 1}
                  issue={issue}
                  fixed={fixedSet.has(index)}
                  onToggle={() => onToggle(index)}
                  active={activeIndex === index}
                  onMouseEnter={() => onRowHover?.(index)}
                  onMouseLeave={() => onRowHover?.(null)}
                  cardRef={(el) => setRowRef?.(index, el)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QaReviewIssueCard({
  index,
  issue,
  fixed,
  onToggle,
  active,
  onMouseEnter,
  onMouseLeave,
  cardRef,
}) {
  const sev = SEVERITY[issue.severity] ?? SEVERITY.low;
  return (
    <div
      ref={cardRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`text-left rounded-lg border bg-white text-[12px] text-ink-700 leading-snug overflow-hidden transition ${
        fixed
          ? "border-emerald-200 bg-emerald-50/40 opacity-70"
          : active
            ? "border-brand-500 ring-2 ring-brand-500/30"
            : "border-ink-200"
      }`}
    >
      <div className="px-2.5 pt-2 pb-1.5 flex items-center gap-1.5 border-b border-ink-100 bg-ink-50/50">
        <button
          type="button"
          role="checkbox"
          aria-checked={fixed}
          aria-label={fixed ? "Mark as not fixed" : "Mark as fixed"}
          onClick={onToggle}
          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition ${
            fixed
              ? "bg-emerald-500 border-emerald-500 text-white"
              : "bg-white border-ink-300 hover:border-ink-500"
          }`}
        >
          {fixed && <Check size={11} strokeWidth={3} />}
        </button>
        <span className="text-[10px] text-ink-400 font-mono">#{index}</span>
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: sev.bg, color: sev.color }}
        >
          {sev.label}
        </span>
        {issue.property && (
          <code className="text-[11px] font-mono text-ink-700 bg-ink-100 rounded px-1.5 py-0.5">
            {issue.property}
          </code>
        )}
        {issue.location && (
          <div className="text-[11px] text-ink-500 truncate flex-1 text-right">
            {issue.location}
          </div>
        )}
      </div>
      {(issue.title ?? issue.name) && (
        <div
          className={`px-2.5 pt-2 font-medium text-ink-900 ${
            fixed ? "line-through decoration-ink-400" : ""
          }`}
        >
          {issue.title ?? issue.name}
        </div>
      )}
      <div className="grid grid-cols-2 divide-x divide-ink-100 mt-1.5">
        <DiffCell label="Design" value={issue.designed} tone="design" />
        <DiffCell label="Built" value={issue.built} tone="built" />
      </div>
      {(issue.fix ?? issue.recommendation) && (
        <div className="px-2.5 py-1.5 border-t border-ink-100 text-[11px] text-ink-600 bg-white">
          <span className="text-ink-500">Fix: </span>
          {issue.fix ?? issue.recommendation}
        </div>
      )}
    </div>
  );
}

function DiffCell({ label, value, tone }) {
  const dot = tone === "design" ? "#10b981" : "#dc2626";
  return (
    <div className="px-2.5 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: dot }}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
          {label}
        </span>
      </div>
      <div className="text-[12px] text-ink-900 leading-snug break-words">
        {value ?? "—"}
      </div>
    </div>
  );
}

function CoverageRow({ label, count }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-ink-50 px-2 py-1">
      <span>{label}</span>
      <span className="font-semibold tabular-nums text-ink-900">
        {count ?? 0}
      </span>
    </div>
  );
}

function RecommendationGroup({ label, color, items }) {
  if (!items?.length) return null;
  return (
    <div className="mb-2">
      <div
        className="text-[10px] font-semibold uppercase tracking-wide mb-1"
        style={{ color }}
      >
        {label}
      </div>
      <ul className="space-y-1 text-[12px] text-ink-700">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span style={{ color }} className="shrink-0">
              •
            </span>
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pill({ color, bg, children }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-medium"
      style={{ background: bg, color }}
    >
      {children}
    </span>
  );
}

// Dev Handoff Checklist body. Renders verdict + stats bar + blockers
// + per-category checklist with completion icons. Each row is checkable
// so the designer can mark items resolved as they fix the file (state
// persists into the canvas store via `data.resolvedChecks`, keyed by a
// stable `category-id::index` so a re-run with the same shape preserves
// progress).
const HANDOFF_STATUS_META = {
  complete: {
    label: "Complete",
    color: "#10b981",
    bg: "#ecfdf5",
    icon: Check,
  },
  partial: {
    label: "Partial",
    color: "#d97706",
    bg: "#fffbeb",
    icon: CircleAlert,
  },
  missing: {
    label: "Missing",
    color: "#dc2626",
    bg: "#fef2f2",
    icon: CircleX,
  },
  unknown: {
    label: "Unknown",
    color: "#64748b",
    bg: "#f1f5f9",
    icon: CircleHelp,
  },
};

const HANDOFF_VERDICT_META = {
  ready: { label: "Ready", color: "#10b981" },
  conditional: { label: "Conditional", color: "#d97706" },
  "not-ready": { label: "Not ready", color: "#dc2626" },
};

function HandoffBody({ nodeId, data, result }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const componentName = result.componentName ?? "Handoff";
  const summary = result.summary ?? "";
  const verdict = result.verdict ?? {};
  const stats = result.stats ?? {};
  const blockers = result.blockers ?? [];
  const categories = result.categories ?? [];
  const resolvedSet = new Set(data.resolvedChecks ?? []);

  const verdictMeta =
    HANDOFF_VERDICT_META[verdict.status] ?? {
      label: verdict.status ?? "—",
      color: "#64748b",
    };

  const total = stats.total ?? 0;
  const segments = ["complete", "partial", "missing", "unknown"]
    .map((s) => ({ s, n: stats[s] ?? 0 }))
    .filter((seg) => seg.n > 0);

  function toggleResolved(key) {
    updateNodeData(nodeId, (prev) => {
      const cur = new Set(prev.resolvedChecks ?? []);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      return { ...prev, resolvedChecks: [...cur] };
    });
  }

  function clearResolved() {
    updateNodeData(nodeId, (prev) => ({ ...prev, resolvedChecks: [] }));
  }

  return (
    <div className="space-y-4">
      {componentName && (
        <div className="text-[12px] text-ink-500">
          Frame:{" "}
          <span className="font-semibold text-ink-900">{componentName}</span>
        </div>
      )}

      <div className="rounded-lg border border-ink-200 p-3 bg-white">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold text-white"
            style={{ background: verdictMeta.color }}
          >
            {verdictMeta.label}
          </span>
          <span className="text-[12px] text-ink-500">
            {total} check{total === 1 ? "" : "s"}
          </span>
        </div>
        {/* Stats progress bar — segmented by status. */}
        {total > 0 && (
          <div className="h-1.5 rounded-full overflow-hidden flex bg-ink-100 mb-2">
            {segments.map(({ s, n }) => (
              <div
                key={s}
                style={{
                  width: `${(n / total) * 100}%`,
                  background: HANDOFF_STATUS_META[s].color,
                }}
              />
            ))}
          </div>
        )}
        <div className="flex gap-1.5 text-[11px] flex-wrap mb-2">
          <Pill color="#059669" bg="#ecfdf5">
            {stats.complete ?? 0} complete
          </Pill>
          <Pill color="#d97706" bg="#fffbeb">
            {stats.partial ?? 0} partial
          </Pill>
          <Pill color="#dc2626" bg="#fef2f2">
            {stats.missing ?? 0} missing
          </Pill>
          {(stats.unknown ?? 0) > 0 && (
            <Pill color="#64748b" bg="#f1f5f9">
              {stats.unknown} unknown
            </Pill>
          )}
        </div>
        {summary && (
          <p className="text-[12px] leading-snug text-ink-700">{summary}</p>
        )}
      </div>

      {blockers.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <CircleX size={13} className="text-red-600" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-red-700">
              Blockers ({blockers.length})
            </span>
          </div>
          <ul className="space-y-1 text-[12px] text-ink-900">
            {blockers.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-red-500 shrink-0">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <SectionLabel
            icon={ClipboardList}
            color="#0d9488"
            count={categories.reduce((n, c) => n + (c.checks?.length ?? 0), 0)}
          >
            Checks
          </SectionLabel>
          {resolvedSet.size > 0 && (
            <button
              onClick={clearResolved}
              className="text-[10px] text-ink-400 hover:text-ink-700 underline underline-offset-2 -mt-2"
            >
              Reset {resolvedSet.size} resolved
            </button>
          )}
        </div>
        <div className="space-y-3">
          {categories.map((cat) => (
            <HandoffCategory
              key={cat.id}
              category={cat}
              resolvedSet={resolvedSet}
              onToggle={toggleResolved}
            />
          ))}
        </div>
      </div>

      {verdict.reason && (
        <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500 mb-1">
            Verdict reason
          </div>
          <p className="text-[12px] leading-snug text-ink-700">
            {verdict.reason}
          </p>
        </div>
      )}
    </div>
  );
}

function HandoffCategory({ category, resolvedSet, onToggle }) {
  const checks = category.checks ?? [];
  if (checks.length === 0) {
    return (
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 mb-1.5">
          {category.title}
        </div>
        <div className="text-[11px] text-ink-400 italic pl-1">
          No checks for this category.
        </div>
      </div>
    );
  }
  // Split: open work first (missing / partial / unknown), then complete.
  const order = (s) =>
    s === "missing" ? 0 : s === "partial" ? 1 : s === "unknown" ? 2 : 3;
  const sorted = [...checks]
    .map((c, i) => ({ check: c, idx: i }))
    .sort((a, b) => order(a.check.status) - order(b.check.status));
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 mb-1.5">
        {category.title}
      </div>
      <div className="space-y-1.5">
        {sorted.map(({ check, idx }) => (
          <HandoffCheckRow
            key={`${category.id}-${idx}`}
            check={check}
            resolvedKey={`${category.id}::${idx}`}
            resolved={resolvedSet.has(`${category.id}::${idx}`)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function HandoffCheckRow({ check, resolvedKey, resolved, onToggle }) {
  const meta = HANDOFF_STATUS_META[check.status] ?? HANDOFF_STATUS_META.unknown;
  const StatusIcon = meta.icon;
  const sev = check.severity;
  const sevMeta =
    sev === "high"
      ? { label: "High", color: "#dc2626", bg: "#fef2f2" }
      : sev === "medium"
        ? { label: "Med", color: "#ea580c", bg: "#fff7ed" }
        : { label: "Low", color: "#ca8a04", bg: "#fefce8" };

  // Hide low-severity sev pill on Complete rows — the row's check icon
  // already says "all good", a "Low" pill would just add noise.
  const showSeverity = check.status !== "complete";

  return (
    <div
      className={`rounded-lg border bg-white text-[12px] text-ink-700 leading-snug transition ${
        resolved
          ? "border-emerald-200 bg-emerald-50/40 opacity-70"
          : "border-ink-200"
      }`}
    >
      <div className="flex items-start gap-2 px-2.5 py-2">
        {/* Status icon — also acts as a colour cue. */}
        <div
          className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0"
          style={{ background: meta.bg, color: meta.color }}
          title={meta.label}
        >
          <StatusIcon size={10} strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`font-medium text-ink-900 ${
                resolved ? "line-through decoration-ink-400" : ""
              }`}
            >
              {check.name}
            </span>
            {showSeverity && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: sevMeta.bg, color: sevMeta.color }}
              >
                {sevMeta.label}
              </span>
            )}
          </div>
          {check.evidence && (
            <div className="text-[11px] text-ink-600 mt-1">
              <span className="text-ink-500">Saw: </span>
              {check.evidence}
            </div>
          )}
          {check.fix && (
            <div className="text-[11px] text-ink-600 mt-0.5">
              <span className="text-ink-500">Fix: </span>
              {check.fix}
            </div>
          )}
        </div>
        {check.status !== "complete" && (
          <button
            type="button"
            role="checkbox"
            aria-checked={resolved}
            aria-label={resolved ? "Mark as unresolved" : "Mark as resolved"}
            onClick={() => onToggle(resolvedKey)}
            className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition ${
              resolved
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "bg-white border-ink-300 hover:border-ink-500"
            }`}
            title={resolved ? "Mark as unresolved" : "Mark as resolved"}
          >
            {resolved && <Check size={11} strokeWidth={3} />}
          </button>
        )}
      </div>
    </div>
  );
}

// State Previews body. Renders the agent's component matrix
// (rowGroups × rowSubItems × columns) as a single Figma-importable SVG
// composed from design tokens — variant fills, size paddings, state
// modifiers — exactly like the structured component-documentation page
// the user pasted as the spec.
function PreviewsBody({ result }) {
  const componentName = result.componentName ?? "Component";
  const library = result.library ?? "shadcn";
  const matrix = result.matrix;

  const hasMatrix =
    !!matrix &&
    Array.isArray(matrix.rowGroups) &&
    Array.isArray(matrix.rowSubItems) &&
    Array.isArray(matrix.columns);

  if (!hasMatrix) {
    return (
      <div className="text-[12px] text-ink-400 italic">
        No matrix produced for this run.
      </div>
    );
  }

  const totalCells =
    matrix.rowGroups.length *
      matrix.rowSubItems.length *
      matrix.columns.length -
    (matrix.skipCells?.length ?? 0);

  // Two artifacts share the same matrix tokens:
  //   - HTML drives the in-canvas iframe preview (so what you see is a
  //     faithful render of what the plugin will produce).
  //   - JSX/Tailwind is what the user copies — generated on click in
  //     `PreviewsCopyButton`, which lives in the card header now.
  const html = hasMatrix
    ? buildComponentMatrixHtml(matrix, componentName, library)
    : "";

  const srcDoc = html;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-[12px] text-ink-500">
        <div className="min-w-0">
          <span className="font-semibold text-ink-900">{componentName}</span>
          <span className="mx-1.5">·</span>
          <span className="font-mono text-[11px] bg-ink-100 rounded px-1.5 py-0.5">
            {library}
          </span>
          <span className="ml-2 text-[11px] text-ink-500">
            {totalCells} cell{totalCells === 1 ? "" : "s"} ·{" "}
            {matrix.rowGroups.length}×{matrix.rowSubItems.length}×
            {matrix.columns.length}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-ink-500 leading-snug">
        Hit{" "}
        <span className="font-medium text-ink-900">Copy code</span> in the
        card header, then open the{" "}
        <span className="font-medium text-ink-900">
          React (Tailwind) to Design
        </span>{" "}
        plugin in Figma and paste — every variant × size × state lands as
        a named frame.
      </p>

      <MatrixPreview srcDoc={srcDoc} title={`${componentName} matrix`} />
    </div>
  );
}

// Standalone Copy-code button rendered in the OutputNode card header
// for the previews kind, so the primary CTA is always visible without
// scrolling the body. Recomputes the JSX on click — no shared state
// with PreviewsBody needed.
function PreviewsCopyButton({ matrix, componentName, library }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      // Prefer the raw shadcn TSX (attached to the matrix when the live
      // registry fetch succeeded) so the copy is the actual React
      // component source — `cva`, `forwardRef`, semantic Tailwind tokens
      // and all — followed by an auto-generated usage block exercising
      // every variant. Falls back to the resolved matrix JSX (for the
      // Figma plugin) when no shadcn source is available.
      const code = matrix?.source
        ? buildShadcnComponentExport(matrix, componentName)
        : buildComponentMatrixJsx(matrix, componentName, library);
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <button
      onClick={copy}
      title="Copy React + Tailwind code"
      aria-label={
        copied
          ? "Code copied to clipboard"
          : "Copy React and Tailwind code for this matrix"
      }
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium rounded-md px-2.5 py-1.5 shrink-0 transition outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
        copied
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-brand-500 hover:bg-brand-600 text-white"
      }`}
    >
      {copied ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}

function MatrixPreview({ srcDoc, title }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Click to open at full size"
        className="block w-full text-left rounded-lg border border-ink-200 bg-ink-50 overflow-hidden hover:border-brand-400 transition cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <iframe
          title={title}
          sandbox=""
          srcDoc={srcDoc}
          className="w-full border-0 block pointer-events-none"
          style={{ height: 540 }}
        />
      </button>
      {open && (
        <MatrixLightbox srcDoc={srcDoc} title={title} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function MatrixLightbox({ srcDoc, title, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 nodrag nowheel"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[1280px] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ height: "calc(100vh - 48px)" }}
      >
        <div className="flex items-center px-4 py-2.5 border-b border-ink-100 shrink-0">
          <div className="text-sm font-semibold text-ink-900 truncate flex-1">
            {title}
          </div>
          <button
            onClick={onClose}
            aria-label="Close (Escape)"
            title="Close (Esc)"
            className="p-1.5 rounded text-ink-500 hover:text-ink-900 hover:bg-ink-100 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <iframe
          title={title}
          sandbox=""
          srcDoc={srcDoc}
          className="flex-1 w-full border-0 bg-ink-50 min-h-0"
        />
      </div>
    </div>,
    document.body,
  );
}

// --- TailGrids component output ----------------------------------------

// Body for the TailGrids Component Generator output card. Phase 2:
// when the composer succeeded (single-cva components), show a live
// preview iframe with arbitrary-value Tailwind painting via the play
// CDN. When composition was skipped (multi-cva, slot-based, or
// non-cva components), fall back to a source-only view — the user
// still gets the canonical .tsx so the agent is never useless.
function TailgridsBody({ result }) {
  const tg = result?.tailgrids;
  if (!tg || typeof tg.source !== "string") {
    return (
      <div className="text-[12px] text-ink-400 italic">
        No component produced for this run.
      </div>
    );
  }

  const composed = !!tg.html && !!tg.jsx;
  const lineCount = tg.source.split("\n").length;
  const byteCount = tg.source.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-[12px] text-ink-500">
        <div className="min-w-0">
          <span className="font-semibold text-ink-900">{tg.name}</span>
          {tg.category && (
            <>
              <span className="mx-1.5">·</span>
              <span className="font-mono text-[11px] bg-ink-100 rounded px-1.5 py-0.5">
                {tg.category}
              </span>
            </>
          )}
          <span className="ml-2 text-[11px] text-ink-500">
            {lineCount} lines · {(byteCount / 1024).toFixed(1)} KB
          </span>
        </div>
        {tg.sourceUrl && (
          <a
            href={tg.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:underline shrink-0"
            aria-label="Open canonical source on GitHub"
            title="Open on GitHub"
          >
            <ExternalLink size={11} aria-hidden="true" /> source
          </a>
        )}
      </div>

      {composed ? (
        <>
          {/* Live preview — Tailwind play CDN inside the iframe handles
              every arbitrary-value class the composer emitted. The
              stacked showcase (Default → Variants → Sizes → …) mirrors
              what tailgrids.com shows on the component's docs page.
              Click to expand at full size. */}
          {Array.isArray(tg.sections) && tg.sections.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="text-ink-500">Showcase:</span>
              {tg.sections.map((s, i) => (
                <span
                  key={i}
                  className="font-mono bg-ink-100 text-ink-700 rounded px-1.5 py-0.5"
                >
                  {s.label}
                </span>
              ))}
            </div>
          )}
          <MatrixPreview srcDoc={tg.html} title={`${tg.name} preview`} />

          <p className="text-[11px] text-ink-500 leading-snug">
            Hit <span className="font-medium text-ink-900">Copy JSX</span> in
            the card header to grab plugin-ready code with TailGrids'
            theme tokens already resolved to hex — paste into the
            React (Tailwind) to Design plugin in Figma.
          </p>
        </>
      ) : (
        // Composition skipped — multi-cva component (Alert, Toast,
        // Tabs) or slot-based primitive (Card, Dialog). The static
        // composer can't reproduce these without a real React
        // renderer; surface the reason rather than burying it.
        <div className="rounded-lg border border-dashed border-ink-300 bg-ink-50/60 px-4 py-5 text-center">
          <div className="text-[12px] font-medium text-ink-700 mb-1">
            Live preview not available for this component
          </div>
          <p className="text-[11px] text-ink-500 leading-snug max-w-md mx-auto">
            This component composes multiple cva primitives or relies
            on slot props — beyond what the static composer covers
            today. The raw .tsx below is still the canonical source.
            Compound-component preview support is a later phase.
          </p>
        </div>
      )}

      {/* Source viewer. Always shown so the user can verify what was
          fetched and grab it for their codebase. The Copy button in
          the card header pulls JSX when available, source otherwise. */}
      <div className="rounded-lg border border-ink-200 bg-ink-900 text-ink-50 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-ink-800 text-[11px] text-ink-400">
          <span className="font-mono">{tg.id}.tsx</span>
          <span>raw source</span>
        </div>
        <pre className="px-3 py-2 text-[11px] leading-relaxed font-mono overflow-x-auto max-h-[280px] scroll-thin">
          <code>{tg.source}</code>
        </pre>
      </div>
    </div>
  );
}

// Standalone Copy button rendered in the OutputNode card header for
// the tailgrids kind. Prefers the resolved plugin-ready JSX when the
// composer produced one; falls back to the raw .tsx for components
// that didn't compose. The label flips so the user knows what
// they're getting on click.
function TailgridsCopyButton({ source, jsx }) {
  const [copied, setCopied] = useState(false);
  const hasJsx = typeof jsx === "string" && jsx.length > 0;
  const payload = hasJsx ? jsx : source;
  async function copy() {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <button
      onClick={copy}
      title={
        hasJsx
          ? "Copy plugin-ready React + Tailwind JSX"
          : "Copy raw .tsx source"
      }
      aria-label={
        copied
          ? "Code copied to clipboard"
          : hasJsx
            ? "Copy plugin-ready JSX for this component"
            : "Copy the raw .tsx source for this component"
      }
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium rounded-md px-2.5 py-1.5 shrink-0 transition outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
        copied
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-brand-500 text-white hover:bg-brand-600"
      }`}
    >
      {copied ? (
        <>
          <Check size={13} aria-hidden="true" /> Copied
        </>
      ) : (
        <>
          <Copy size={13} aria-hidden="true" />{" "}
          {hasJsx ? "Copy JSX" : "Copy source"}
        </>
      )}
    </button>
  );
}

// --- SVG helpers ---------------------------------------------------------

function escapeXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

function escapeAttr(s) {
  return escapeXml(s);
}

// Linearly darken a #rgb / #rrggbb hex by `amount` (0–1). Returns null
// for null input — null bg means "transparent" (Ghost / Link variants),
// and a darkened transparent is still transparent.
function darkenHex(hex, amount) {
  if (!hex) return null;
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex);
  if (!m) return hex;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const r = Math.max(0, Math.round(parseInt(s.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(s.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(s.slice(4, 6), 16) * (1 - amount)));
  return (
    "#" +
    [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}


// Render a single cell as an HTML fragment positioned by CSS grid. The
// returned string is dropped into the cell <div> in `buildComponentMatrixHtml`.
function renderArchetypeCellHtml({
  archetype,
  variantTokens,
  sizeTokens,
  modifier,
  label,
  glyph,
}) {
  const v = variantTokens ?? {};
  const s = sizeTokens ?? {};
  const height = s.height ?? 36;
  const paddingX = s.paddingX ?? 16;
  const fontSize = s.fontSize ?? 13;
  const fontWeight = s.fontWeight ?? 500;
  const radius = s.radius ?? 6;
  const iconOnly = !!s.iconOnly;
  const iconSize = s.iconSize ?? Math.max(12, fontSize + 1);
  const textColor = v.text ?? "#0f172a";
  const underline = !!v.underline;

  // Effective fill for the requested state modifier.
  let fill = v.bg ?? null;
  if (modifier === "hover")
    fill = v.bgHover ?? darkenHex(v.bg, 0.08) ?? v.bg ?? null;
  else if (modifier === "pressed")
    fill = v.bgPressed ?? darkenHex(v.bg, 0.16) ?? v.bg ?? null;
  const border = v.border ?? null;
  const opacity =
    modifier === "disabled" ? 0.5 : modifier === "loading" ? 0.85 : 1;

  const isIcon = archetype === "iconButton" || iconOnly;
  const isLink = archetype === "link";

  const styles = [];
  if (!isLink) {
    styles.push(`height:${height}px`);
    if (isIcon) {
      styles.push(`width:${height}px`);
      styles.push(`padding:0`);
    } else {
      styles.push(`padding:0 ${paddingX}px`);
    }
    styles.push(`border-radius:${radius}px`);
    styles.push(`background:${fill ?? "transparent"}`);
    if (border) styles.push(`border:1px solid ${border}`);
    else styles.push(`border:none`);
    styles.push(`color:${textColor}`);
    styles.push(`font-size:${fontSize}px`);
    styles.push(`font-weight:${fontWeight}`);
    styles.push(`font-family:inherit`);
    styles.push(`cursor:${modifier === "disabled" ? "not-allowed" : "pointer"}`);
    styles.push(`display:inline-flex`);
    styles.push(`align-items:center`);
    styles.push(`justify-content:center`);
    styles.push(`gap:6px`);
    styles.push(`opacity:${opacity}`);
    if (modifier === "focus") {
      const ringColor = v.bg ?? v.border ?? "#3b82f6";
      styles.push(`outline:2px solid ${ringColor}`);
      styles.push(`outline-offset:2px`);
    }
  } else {
    // Link archetype — text-only, no background.
    styles.push(`color:${textColor}`);
    styles.push(`font-size:${fontSize}px`);
    styles.push(`font-weight:${fontWeight}`);
    styles.push(`text-decoration:${underline || modifier === "hover" ? "underline" : "none"}`);
    styles.push(`opacity:${opacity}`);
    styles.push(`cursor:${modifier === "disabled" ? "not-allowed" : "pointer"}`);
    if (modifier === "focus") {
      styles.push(`outline:2px solid ${textColor}`);
      styles.push(`outline-offset:2px`);
      styles.push(`border-radius:2px`);
    }
  }

  const tag = isLink ? "a" : "button";
  const extraAttrs = [];
  if (modifier === "disabled" && !isLink) extraAttrs.push("disabled");
  if (isLink) extraAttrs.push(`href="#"`, `onclick="return false"`);
  const styleAttr = ` style="${styles.join(";")}"`;
  const attrs = `${extraAttrs.join(" ")}${styleAttr}`;

  // Inner content.
  let inner;
  if (isIcon) {
    inner = inlineGlyphSvg(glyph || "circle", iconSize, textColor);
  } else if (modifier === "loading") {
    inner = `${inlineSpinnerSvg(iconSize, textColor)}<span>${escapeXml(label)}</span>`;
  } else {
    const decoration =
      underline && !isLink ? ' style="text-decoration:underline"' : "";
    inner = `<span${decoration}>${escapeXml(label)}</span>`;
  }

  return `<${tag} ${attrs}>${inner}</${tag}>`;
}

// Inline SVG glyph used for iconOnly cells. The outer wrapper sets the
// pixel size; the inner viewBox is normalized so colour is taken from
// `currentColor` whenever convenient.
function inlineGlyphSvg(name, size, color) {
  const c = escapeAttr(color);
  switch (name) {
    case "plus":
      return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="8" x2="13" y2="8"/><line x1="8" y1="3" x2="8" y2="13"/></svg>`;
    case "search":
      return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4"/><line x1="10" y1="10" x2="13" y2="13"/></svg>`;
    case "check":
      return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,8 7,12 13,4"/></svg>`;
    case "arrow":
      return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="8" x2="13" y2="8"/><polyline points="9,4 13,8 9,12"/></svg>`;
    case "user":
      return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.5"><circle cx="8" cy="6" r="3"/><path d="M3 14 Q 8 10 13 14"/></svg>`;
    case "settings":
      return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 1 L8 3 M8 13 L8 15 M1 8 L3 8 M13 8 L15 8 M3 3 L4.5 4.5 M11.5 11.5 L13 13 M3 13 L4.5 11.5 M11.5 4.5 L13 3"/></svg>`;
    case "chevronDown":
      return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"><polyline points="4,6 8,11 12,6"/></svg>`;
    case "circle":
    default:
      return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.5"><circle cx="8" cy="8" r="6"/></svg>`;
  }
}

// CSS-animated spinner so the loading state actually spins in the
// preview (Figma flattens this on import — fine, the still frame still
// reads as "loading").
function inlineSpinnerSvg(size, color) {
  return `<svg class="dip-spinner" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${escapeAttr(color)}" stroke-width="1.5" stroke-linecap="round"><path d="M14 8 a6 6 0 1 1 -6 -6"/></svg>`;
}

// Generate the matrix as a self-contained React component using Tailwind
// utility classes (with arbitrary values for dynamic tokens). Pasted
// straight into the "React (Tailwind) to Design" Figma plugin, every
// cell turns into a named frame with the correct fill, padding, and
// state styling baked in.
// Compose the "real" shadcn React export: the raw component TSX from
// the registry, followed by a usage block showing every variant/size
// combination. This is what `Copy code` emits whenever the live shadcn
// fetcher attached `matrix.source` — i.e. the user gets paste-ready
// React source for their codebase, not a resolved matrix JSX grid.
function buildShadcnComponentExport(matrix, componentName) {
  const tsx = String(matrix?.source || "").trim();
  if (!tsx) return "";

  const slug = String(componentName || matrix?.archetype || "Component")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  const exportName = (slug.charAt(0).toUpperCase() + slug.slice(1)) || "Component";
  const showcaseName = `${exportName}Showcase`;
  const url = matrix?.sourceUrl || "https://ui.shadcn.com";
  const label = matrix?.label || componentName || exportName;

  const variants = (matrix?.rowGroups ?? []).map((g) => g.id);
  const sizes = (matrix?.rowSubItems ?? []).map((s) => s.id);
  const hasMultipleSizes = sizes.length > 1;

  const usageRows = variants.map((v) => {
    const cells = (hasMultipleSizes ? sizes : ["default"]).map((sz) => {
      const sizeAttr = hasMultipleSizes && sz !== "default" ? ` size="${sz}"` : "";
      return `        <${exportName} variant="${v}"${sizeAttr}>${label}</${exportName}>`;
    });
    return cells.join("\n");
  });

  const showcase = [
    `// Usage — drop ${slug}.tsx into components/ui/ then render:`,
    `export function ${showcaseName}() {`,
    `  return (`,
    `    <div className="flex flex-col gap-3">`,
    `      <div className="flex flex-wrap items-center gap-2">`,
    usageRows.join("\n      </div>\n      <div className=\"flex flex-wrap items-center gap-2\">\n"),
    `      </div>`,
    `    </div>`,
    `  );`,
    `}`,
  ].join("\n");

  return [
    `// shadcn/ui — ${exportName}`,
    `// Source: ${url}`,
    `// Paste the component below into components/ui/${slug}.tsx`,
    "",
    tsx,
    "",
    showcase,
    "",
  ].join("\n");
}

function buildComponentMatrixJsx(matrix, componentName, library) {
  const archetype = matrix.archetype || "button";
  const label = matrix.label || componentName;
  const glyph = matrix.glyph || "circle";
  const rowGroups = matrix.rowGroups ?? [];
  const rowSubItems = matrix.rowSubItems ?? [];
  const columns = matrix.columns ?? [];
  const skipCells = matrix.skipCells ?? [];

  // Layout constants. We use plain nested flex rows (no CSS grid, no
  // `grid-template-columns: repeat(...)`, no `row-span-N`) because the
  // "React (Tailwind) to Design" Figma plugin's resolver doesn't reliably
  // map those primitives onto Auto Layout — the result in Figma collapses
  // into a stack of misaligned cells. Flex rows with explicit widths
  // round-trip cleanly.
  const VARIANT_LABEL_W = 88;
  const SIZE_LABEL_W = 56;
  const COL_W = 140;
  const CELL_H = 64;

  const skipSet = new Set(
    skipCells.map((s) => `${s.rowGroup}::${s.rowSub}::${s.column}`),
  );

  // Emit a bare JSX expression (no `function` wrapper, no comment
  // preamble). Plugins parse from the first `<` they find — anything
  // before that risks "No JSX found in the code".
  const lines = [];
  lines.push(`<div className="bg-white p-6 inline-block font-sans">`);
  lines.push(
    `  <div className="inline-block px-2 py-1 border border-slate-900 rounded-sm text-[10px] text-slate-900 mb-3">${escapeJsxText(componentName)}</div>`,
  );

  // Header row: leading spacers for the variant + size label columns,
  // then one cell per state column. `shrink-0` is critical — the Figma
  // plugin's flex resolver (and most React-to-Auto-Layout converters)
  // compresses children by default, which collapses the column grid
  // into a single stack. Pinning shrink to 0 preserves widths.
  lines.push(`  <div className="flex items-center">`);
  lines.push(
    `    <div className="shrink-0 w-[${VARIANT_LABEL_W}px]"></div>`,
  );
  lines.push(`    <div className="shrink-0 w-[${SIZE_LABEL_W}px]"></div>`);
  for (const col of columns) {
    lines.push(
      `    <div className="shrink-0 w-[${COL_W}px] text-center text-[11px] text-violet-400 py-2">${escapeJsxText(col.label)}</div>`,
    );
  }
  lines.push(`  </div>`);

  // One outer flex row per variant group. The variant label sits in the
  // left column; the right column is a vertical stack of size rows.
  for (const grp of rowGroups) {
    lines.push(`  <div className="flex items-stretch">`);
    lines.push(
      `    <div className="shrink-0 w-[${VARIANT_LABEL_W}px] flex items-center justify-end pr-2 text-[11px] text-violet-400">${escapeJsxText(grp.label)}</div>`,
    );
    lines.push(`    <div className="shrink-0 flex flex-col">`);

    for (const sub of rowSubItems) {
      lines.push(`      <div className="flex items-stretch">`);
      lines.push(
        `        <div className="shrink-0 w-[${SIZE_LABEL_W}px] flex items-center justify-end pr-2 text-[10px] text-violet-400">${escapeJsxText(sub.label)}</div>`,
      );

      for (const col of columns) {
        const id = `${slugify(grp.id)}-${slugify(sub.id)}-${slugify(col.id)}`;
        const skip = skipSet.has(`${grp.id}::${sub.id}::${col.id}`);
        if (skip) {
          lines.push(
            `        <div data-id="${id}" className="shrink-0 w-[${COL_W}px] h-[${CELL_H}px] border border-dashed border-violet-400 bg-violet-50"></div>`,
          );
        } else {
          const inner = renderArchetypeCellJsx({
            archetype,
            variantTokens: grp.tokens,
            sizeTokens: sub.tokens,
            modifier: col.modifier,
            label,
            glyph,
          });
          lines.push(
            `        <div data-id="${id}" className="shrink-0 w-[${COL_W}px] h-[${CELL_H}px] border border-dashed border-violet-400 flex items-center justify-center">`,
            `          ${inner}`,
            `        </div>`,
          );
        }
      }
      lines.push(`      </div>`);
    }
    lines.push(`    </div>`);
    lines.push(`  </div>`);
  }

  lines.push(
    `  <div className="text-right text-[10px] text-slate-400 mt-2">${escapeJsxText(library)}</div>`,
    `</div>`,
  );

  return lines.join("\n");
}

// Render a single cell as JSX with Tailwind utility classes. Dynamic
// token values use arbitrary values (e.g. `bg-[#16a34a]`) which Tailwind
// JIT and the Figma plugin both handle.
function renderArchetypeCellJsx({
  archetype,
  variantTokens,
  sizeTokens,
  modifier,
  label,
  glyph,
}) {
  const v = variantTokens ?? {};
  const s = sizeTokens ?? {};
  const height = s.height ?? 36;
  const paddingX = s.paddingX ?? 16;
  const fontSize = s.fontSize ?? 13;
  const fontWeight = s.fontWeight ?? 500;
  const radius = s.radius ?? 6;
  const iconOnly = !!s.iconOnly;
  const iconSize = s.iconSize ?? Math.max(12, fontSize + 1);
  const textColor = v.text ?? "#0f172a";
  const underline = !!v.underline;

  let fill = v.bg ?? null;
  if (modifier === "hover")
    fill = v.bgHover ?? darkenHex(v.bg, 0.08) ?? v.bg ?? null;
  else if (modifier === "pressed")
    fill = v.bgPressed ?? darkenHex(v.bg, 0.16) ?? v.bg ?? null;

  const isIcon = archetype === "iconButton" || iconOnly;
  const isLink = archetype === "link";

  const cls = [];
  if (!isLink) {
    cls.push(`h-[${height}px]`);
    if (isIcon) cls.push(`w-[${height}px]`, `p-0`);
    else cls.push(`px-[${paddingX}px]`);
    cls.push(`rounded-[${radius}px]`);
    if (fill) cls.push(`bg-[${fill}]`);
    if (v.border) cls.push("border", `border-[${v.border}]`);
    cls.push(`text-[${textColor}]`);
    cls.push(`text-[${fontSize}px]`);
    cls.push(`font-${tailwindFontWeight(fontWeight)}`);
    cls.push("inline-flex", "items-center", "justify-center", "gap-1.5");
  } else {
    cls.push(`text-[${textColor}]`);
    cls.push(`text-[${fontSize}px]`);
    cls.push(`font-${tailwindFontWeight(fontWeight)}`);
    if (underline || modifier === "hover") cls.push("underline");
  }
  if (modifier === "disabled") cls.push("opacity-50");
  else if (modifier === "loading") cls.push("opacity-[0.85]");
  if (modifier === "focus") {
    const ringColor = v.bg ?? v.border ?? "#3b82f6";
    cls.push(
      "outline",
      "outline-2",
      "outline-offset-2",
      `outline-[${ringColor}]`,
    );
  }
  if (underline && !isLink) cls.push("underline");

  let inner;
  if (isIcon) {
    inner = inlineGlyphJsx(glyph || "circle", iconSize, textColor);
  } else if (modifier === "loading") {
    inner = `${inlineSpinnerJsx(iconSize, textColor)}<span>${escapeJsxText(label)}</span>`;
  } else {
    inner = escapeJsxText(label);
  }

  const tag = isLink ? "a" : "button";
  const extraAttrs = [];
  if (modifier === "disabled" && !isLink) extraAttrs.push("disabled");
  if (isLink) extraAttrs.push(`href="#"`);

  const attrStr =
    (extraAttrs.length ? extraAttrs.join(" ") + " " : "") +
    `className="${cls.join(" ")}"`;
  return `<${tag} ${attrStr}>${inner}</${tag}>`;
}

function inlineGlyphJsx(name, size, color) {
  // Reuse the inline-SVG generator and rewrite SVG attribute names to
  // their JSX casing so the result drops cleanly into a React tree.
  const html = inlineGlyphSvg(name, size, color);
  return svgAttrsToJsx(html);
}

function inlineSpinnerJsx(size, color) {
  return svgAttrsToJsx(inlineSpinnerSvg(size, color));
}

function svgAttrsToJsx(html) {
  return html
    .replace(/stroke-width=/g, "strokeWidth=")
    .replace(/stroke-linecap=/g, "strokeLinecap=")
    .replace(/stroke-linejoin=/g, "strokeLinejoin=")
    .replace(/stroke-dasharray=/g, "strokeDasharray=")
    .replace(/class=/g, "className=");
}

function tailwindFontWeight(w) {
  if (w >= 700) return "bold";
  if (w >= 600) return "semibold";
  if (w >= 500) return "medium";
  return "normal";
}

// JSX text escaping — far simpler than HTML since JSX bodies render as
// React children. We just need to neutralise `{`, `}`, and angle brackets
// so the tokens don't get parsed as expressions or tags.
function escapeJsxText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/{/g, "&#123;")
    .replace(/}/g, "&#125;");
}

// Compose the full plug-and-play matrix HTML. Each cell is a real
// <button>/<a> with inline styles and a stable id, so plugins like
// html.to.design / React-to-Design / Anima ingest it directly.
function buildComponentMatrixHtml(matrix, componentName, library) {
  const archetype = matrix.archetype || "button";
  const label = matrix.label || componentName;
  const glyph = matrix.glyph || "circle";
  const rowGroups = matrix.rowGroups ?? [];
  const rowSubItems = matrix.rowSubItems ?? [];
  const columns = matrix.columns ?? [];
  const skipCells = matrix.skipCells ?? [];

  const VARIANT_LABEL_W = 80;
  const BRACE_W = 22;
  const SIZE_LABEL_W = 56;
  const COL_W = 140;
  const CHROME = "#a78bfa";
  const ROW_VPAD = 12;

  const skipSet = new Set(
    skipCells.map((s) => `${s.rowGroup}::${s.rowSub}::${s.column}`),
  );

  const cells = [];

  // Top-left corner cells (3 empty slots aligned with the variant /
  // brace / size-label columns) before the column headers.
  cells.push(`<div></div><div></div><div></div>`);
  for (const col of columns) {
    cells.push(
      `<div class="dip-col-header">${escapeXml(col.label)}</div>`,
    );
  }

  for (const grp of rowGroups) {
    const span = rowSubItems.length;
    cells.push(
      `<div class="dip-variant-label" style="grid-row:span ${span}">${escapeXml(grp.label)}</div>`,
    );
    cells.push(
      `<div class="dip-brace" style="grid-row:span ${span}"><svg viewBox="0 0 ${BRACE_W} 100" preserveAspectRatio="none" width="100%" height="100%"><path d="M ${BRACE_W - 4} 0 Q ${BRACE_W - 9} 0 ${BRACE_W - 9} 5 L ${BRACE_W - 9} 45 Q ${BRACE_W - 9} 50 ${BRACE_W - 14} 50 Q ${BRACE_W - 9} 50 ${BRACE_W - 9} 55 L ${BRACE_W - 9} 95 Q ${BRACE_W - 9} 100 ${BRACE_W - 4} 100" fill="none" stroke="${CHROME}" stroke-width="0.75" /></svg></div>`,
    );
    for (const sub of rowSubItems) {
      cells.push(
        `<div class="dip-size-label">${escapeXml(sub.label)}</div>`,
      );
      for (const col of columns) {
        const skip = skipSet.has(`${grp.id}::${sub.id}::${col.id}`);
        const id = `${slugify(grp.id)}-${slugify(sub.id)}-${slugify(col.id)}`;
        if (skip) {
          cells.push(`<div class="dip-cell dip-skip" data-id="${escapeAttr(id)}"></div>`);
        } else {
          const cellInner = renderArchetypeCellHtml({
            archetype,
            variantTokens: grp.tokens,
            sizeTokens: sub.tokens,
            modifier: col.modifier,
            label,
            glyph,
          });
          cells.push(
            `<div class="dip-cell" data-id="${escapeAttr(id)}">${cellInner}</div>`,
          );
        }
      }
    }
  }

  const gridCols = `${VARIANT_LABEL_W}px ${BRACE_W}px ${SIZE_LABEL_W}px repeat(${columns.length}, ${COL_W}px)`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeXml(componentName)} matrix</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #fafafb; font-family: Inter, system-ui, -apple-system, sans-serif; padding: 24px; }
  .dip-matrix { display: inline-block; background: #ffffff; padding: 24px; border-radius: 4px; }
  .dip-frame-title { display: inline-block; padding: 4px 8px; border: 0.75px solid #0f172a; border-radius: 2px; font-size: 10px; color: #0f172a; margin-bottom: 12px; }
  .dip-grid { display: grid; grid-template-columns: ${gridCols}; align-items: stretch; }
  .dip-col-header { font-size: 11px; color: ${CHROME}; text-align: center; padding: 6px 0 10px; }
  .dip-variant-label { font-size: 11px; color: ${CHROME}; display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; }
  .dip-size-label { font-size: 10px; color: ${CHROME}; display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; }
  .dip-brace { display: flex; align-items: stretch; padding: 4px 0; }
  .dip-cell { border: 0.75px dashed ${CHROME}; display: flex; align-items: center; justify-content: center; padding: ${ROW_VPAD}px 0; box-sizing: border-box; }
  .dip-skip { background: #f5f3ff; opacity: 0.45; }
  .dip-spinner { animation: dip-spin 0.9s linear infinite; transform-origin: 50% 50%; }
  @keyframes dip-spin { to { transform: rotate(360deg); } }
  .dip-meta { margin-top: 8px; text-align: right; font-size: 10px; color: #94a3b8; }
</style>
</head>
<body>
<div class="dip-matrix" data-component="${escapeAttr(componentName)}" data-library="${escapeAttr(library)}">
  <div class="dip-frame-title">${escapeXml(componentName)}</div>
  <div class="dip-grid">
    ${cells.join("\n    ")}
  </div>
  <div class="dip-meta">${escapeXml(library)}</div>
</div>
</body>
</html>`;
}

function ReferencesBody({ result }) {
  const items = result.references ?? [];
  const [openIdx, setOpenIdx] = useState(null);
  if (items.length === 0) {
    return (
      <div className="text-[12px] text-ink-400 italic py-2">
        No references found for "{result.query ?? "this query"}".
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12px] text-ink-500">
        <span className="text-ink-700">
          {items.length} reference{items.length === 1 ? "" : "s"}
        </span>
        {result.query && (
          <>
            <span>·</span>
            <code className="font-mono text-[11px] bg-ink-100 px-1.5 py-0.5 rounded">
              {result.query}
            </code>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((r, i) => (
          <ReferenceCard
            key={r.id ?? i}
            ref_={r}
            onOpen={() => setOpenIdx(i)}
          />
        ))}
      </div>
      {openIdx !== null && (
        <ReferenceLightbox
          items={items}
          index={openIdx}
          onClose={() => setOpenIdx(null)}
          onNavigate={setOpenIdx}
        />
      )}
    </div>
  );
}

// Shared copy/download behavior for any reference. The card and the lightbox
// both lean on this so a single bug fix benefits both.
function useImageActions(ref_) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [busyError, setBusyError] = useState(null);

  const previewProxyUrl = ref_.imageUrl
    ? `/api/proxy-image?url=${encodeURIComponent(ref_.imageUrl)}`
    : null;
  const fullSrc = ref_.fullImageUrl ?? ref_.imageUrl;
  const fullProxyUrl = fullSrc
    ? `/api/proxy-image?url=${encodeURIComponent(fullSrc)}`
    : null;

  async function copyImage() {
    if (!fullProxyUrl) return;
    setBusyError(null);
    try {
      const resp = await fetch(fullProxyUrl);
      if (!resp.ok) throw new Error("fetch failed");
      const blob = await resp.blob();
      const finalBlob =
        blob.type === "image/png" ? blob : await reEncodeAsPng(blob);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": finalBlob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      try {
        await navigator.clipboard.writeText(fullSrc);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        setBusyError("Copy failed");
      }
    }
  }

  async function downloadImage() {
    if (!fullProxyUrl) return;
    setBusyError(null);
    setDownloading(true);
    try {
      const resp = await fetch(fullProxyUrl);
      if (!resp.ok) throw new Error("fetch failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const safeName = (ref_.title || ref_.product || "reference")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 60);
      a.download = `${safeName || "reference"}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      setBusyError("Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return {
    previewProxyUrl,
    fullProxyUrl,
    copyImage,
    downloadImage,
    copied,
    downloading,
    busyError,
  };
}

function ReferenceCard({ ref_, onOpen }) {
  const {
    previewProxyUrl,
    copyImage,
    downloadImage,
    copied,
    downloading,
    busyError,
  } = useImageActions(ref_);

  return (
    <div className="text-left rounded-lg border border-ink-200 bg-white overflow-hidden flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        title="Open preview"
        className="block aspect-[4/3] bg-ink-50 overflow-hidden cursor-zoom-in group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {ref_.imageUrl ? (
          <img
            src={previewProxyUrl}
            alt={ref_.title}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-ink-400">
            no preview
          </div>
        )}
      </button>
      <div className="px-2.5 py-2 flex-1 flex flex-col gap-1">
        <div className="text-[12px] font-semibold text-ink-900 leading-snug line-clamp-2">
          {ref_.title}
        </div>
        {ref_.category && (
          <div className="text-[10px] text-ink-500 truncate">
            {ref_.category}
          </div>
        )}
      </div>
      <div className="px-2 py-1.5 border-t border-ink-100 flex items-center gap-1 bg-ink-50/50">
        <IconAction
          onClick={copyImage}
          title={copied ? "Copied!" : "Copy image"}
          icon={copied ? Check : Copy}
          tone={copied ? "success" : "default"}
        />
        <IconAction
          onClick={downloadImage}
          title="Download image"
          icon={Download}
          loading={downloading}
        />
        {ref_.sourceUrl && (
          <a
            href={ref_.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            title="Open in Refero"
            className="ml-auto p-1.5 rounded hover:bg-ink-100 text-ink-500 hover:text-ink-900"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
      {busyError && (
        <div className="px-2.5 py-1 text-[10px] text-red-600 bg-red-50">
          {busyError}
        </div>
      )}
    </div>
  );
}

function ReferenceLightbox({ items, index, onClose, onNavigate }) {
  const ref_ = items[index];
  const {
    fullProxyUrl,
    previewProxyUrl,
    copyImage,
    downloadImage,
    copied,
    downloading,
    busyError,
  } = useImageActions(ref_);

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && hasNext) onNavigate(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, hasPrev, hasNext, onClose, onNavigate]);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!ref_) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 nodrag nowheel"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[1100px] max-h-full bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="flex items-start gap-3 px-4 py-3 border-b border-ink-100">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink-900 truncate">
              {ref_.title}
            </div>
            <div className="text-[11px] text-ink-500 truncate">
              {[ref_.product, ref_.category].filter(Boolean).join(" · ") ||
                "Reference"}
            </div>
          </div>
          <div className="text-[11px] text-ink-400 tabular-nums shrink-0">
            {index + 1} / {items.length}
          </div>
          <button
            onClick={onClose}
            aria-label="Close (Escape)"
            title="Close (Esc)"
            className="p-1.5 rounded text-ink-500 hover:text-ink-900 hover:bg-ink-100 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="relative flex-1 min-h-0 bg-ink-50 flex items-center justify-center">
          {ref_.imageUrl ? (
            <img
              src={fullProxyUrl ?? previewProxyUrl}
              alt={ref_.title}
              className="max-w-full max-h-[70vh] object-contain"
            />
          ) : (
            <div className="text-sm text-ink-400 py-12">No preview available</div>
          )}
          {hasPrev && (
            <button
              onClick={() => onNavigate(index - 1)}
              title="Previous (←)"
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 hover:bg-white shadow text-ink-700"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {hasNext && (
            <button
              onClick={() => onNavigate(index + 1)}
              title="Next (→)"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 hover:bg-white shadow text-ink-700"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        {ref_.description && (
          <div className="px-4 py-3 border-t border-ink-100 max-h-[120px] overflow-y-auto scroll-thin text-[12px] text-ink-700 leading-snug">
            {ref_.description}
          </div>
        )}

        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-ink-100 bg-ink-50/50">
          <button
            onClick={copyImage}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition ${
              copied
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-ink-200 bg-white hover:bg-ink-50 text-ink-700"
            }`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy image"}
          </button>
          <button
            onClick={downloadImage}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border border-ink-200 bg-white hover:bg-ink-50 text-ink-700 disabled:opacity-50"
          >
            <Download size={13} />
            {downloading ? "Downloading…" : "Download"}
          </button>
          {ref_.sourceUrl && (
            <a
              href={ref_.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border border-ink-200 bg-white hover:bg-ink-50 text-ink-700 ml-auto"
            >
              <ExternalLink size={13} />
              Open in Refero
            </a>
          )}
          {busyError && (
            <span className="text-[11px] text-red-600 ml-2">{busyError}</span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IconAction({ onClick, title, icon: Icon, tone, loading }) {
  const toneCls =
    tone === "success"
      ? "text-emerald-600"
      : "text-ink-500 hover:text-ink-900";
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={title}
      className={`p-1.5 rounded hover:bg-ink-100 ${toneCls} disabled:opacity-50`}
    >
      <Icon size={12} />
    </button>
  );
}

async function reEncodeAsPng(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
      "image/png",
    );
  });
}

function ScoreBlock({ score }) {
  const color =
    score >= 85
      ? "#10b981"
      : score >= 60
        ? "#f59e0b"
        : score >= 40
          ? "#ea580c"
          : "#dc2626";
  return (
    <div
      className="w-14 h-14 rounded-lg flex flex-col items-center justify-center text-white font-semibold shrink-0"
      style={{ background: color }}
    >
      <span className="text-lg leading-none">{score}</span>
      <span className="text-[9px] uppercase tracking-wide opacity-80 mt-0.5">
        Score
      </span>
    </div>
  );
}

function FindingCard({ f }) {
  const sev = SEVERITY[f.severity] ?? SEVERITY.minor;
  return (
    <div className="rounded-lg border border-ink-200 p-2.5 bg-white text-[12px] text-ink-700 leading-snug">
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: sev.bg, color: sev.color }}
        >
          {sev.label}
        </span>
        <span className="text-[10px] text-ink-500 uppercase tracking-wide">
          {f.category}
        </span>
      </div>
      <div className="font-medium text-ink-900 mb-1">{f.element}</div>
      <div className="space-y-1">
        <div>
          <span className="text-ink-500">Issue: </span>
          {f.observation}
        </div>
        <div>
          <span className="text-ink-500">Impact: </span>
          {f.why}
        </div>
        <div>
          <span className="text-ink-500">Fix: </span>
          {f.recommendation}
        </div>
        {f.heuristic && (
          <div className="text-[10px] text-ink-400 italic">{f.heuristic}</div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({ s }) {
  return (
    <div className="rounded-lg border border-ink-200 overflow-hidden bg-white">
      <div className="px-3 py-2 border-b border-ink-100">
        <div className="text-[12px] font-semibold text-ink-900">{s.title}</div>
        <div className="text-[11px] text-ink-500 mt-0.5">{s.target}</div>
      </div>
      <div className="bg-ink-50 p-2">
        <iframe
          title={s.title}
          sandbox=""
          srcDoc={s.snippetHtml}
          className="w-full h-[200px] rounded bg-white border border-ink-100"
        />
      </div>
      {s.rationale && (
        <div className="px-3 py-2 text-[12px] text-ink-700 leading-snug border-t border-ink-100">
          {s.rationale}
        </div>
      )}
    </div>
  );
}
