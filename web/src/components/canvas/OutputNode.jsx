import { Handle, Position } from "@xyflow/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Trash2,
  AlertCircle,
  Sparkles,
  ListChecks,
  ThumbsUp,
  Layers,
  Star,
  GitCompare,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
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
  qaReport: {
    label: "QA Report",
    icon: GitCompare,
    accent: "#db2777",
    sub: "Design vs build diff",
  },
  qaReportFull: {
    label: "QA Report",
    icon: GitCompare,
    accent: "#9333ea",
    sub: "Live audit vs design reference",
  },
  references: {
    label: "References",
    icon: Compass,
    accent: "#0891b2",
    sub: "Real product screens via Refero",
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
      <div className="w-[520px] bg-white rounded-2xl shadow-floating border border-ink-200 p-5 text-sm text-ink-500">
        No result yet.
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
        <button
          onClick={() => removeNode(id)}
          className="p-1 rounded text-ink-400 hover:text-red-600 hover:bg-red-50"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* `nowheel` lets the cursor scroll the node body instead of panning the canvas */}
      <div className="nowheel text-left max-h-[520px] overflow-y-auto scroll-thin px-4 py-3">
        {kind === "overview" && <OverviewBody result={result} />}
        {kind === "suggestions" && <SuggestionsBody result={result} />}
        {kind === "actionPlan" && <ActionPlanBody result={result} />}
        {kind === "checklist" && <ChecklistBody result={result} />}
        {kind === "recommendations" && <RecommendationsBody result={result} />}
        {kind === "qaReportFull" && <QaReportFullBody result={result} />}
        {kind === "qaReport" && <QaReportBody result={result} />}
        {kind === "references" && <ReferencesBody result={result} />}
      </div>
    </div>
  );
}

function mapLegacyKind(kind) {
  if (kind === "summary" || kind === "findings") return "overview";
  if (kind === "strengths" || kind === "nextSteps") return "actionPlan";
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

function QaReportFullBody({ result }) {
  const sum = result.summary ?? {};
  const verdict = result.verdict ?? {};
  const issues = result.issues ?? [];
  const cov = result.checkCoverage ?? {};
  const recs = result.recommendations ?? {};

  const verdictColor = {
    ready: "#10b981",
    conditional: "#d97706",
    blocked: "#dc2626",
  }[verdict.status] ?? "#64748b";
  const verdictLabel = {
    ready: "Ready",
    conditional: "Conditional",
    blocked: "Blocked",
  }[verdict.status] ?? verdict.status;

  return (
    <div className="space-y-4">
      {result.url && (
        <div className="text-[12px] text-ink-500 break-all">
          <span className="text-ink-400">URL: </span>
          <span className="font-mono text-ink-900">{result.url}</span>
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
            {sum.totalIssues ?? 0} issue{sum.totalIssues === 1 ? "" : "s"}
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

      <div>
        <SectionLabel icon={GitCompare} color="#9333ea" count={issues.length}>
          Issue log
        </SectionLabel>
        {issues.length === 0 ? (
          <div className="text-[11px] text-ink-400 italic">No issues found.</div>
        ) : (
          <div className="space-y-2">
            {issues.map((it, i) => (
              <QaReportIssueRow key={i} index={i + 1} issue={it} />
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionLabel icon={ListChecks} color="#2563eb">
          Check coverage
        </SectionLabel>
        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-ink-700">
          <CoverageRow label="UI consistency" count={cov.ui} />
          <CoverageRow label="Copy & typography" count={cov.copy} />
          <CoverageRow label="Design system" count={cov.designSystem} />
          <CoverageRow label="Accessibility" count={cov.accessibility} />
          <CoverageRow label="Responsiveness" count={cov.responsiveness} />
        </div>
      </div>

      {(recs.doNow?.length || recs.thisSprint?.length || recs.backlog?.length) && (
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
      )}
    </div>
  );
}

function QaReportIssueRow({ index, issue }) {
  const sev = SEVERITY[issue.severity] ?? SEVERITY.low;
  const catLabel = {
    ui: "UI",
    copy: "Copy",
    "design-system": "Design system",
    accessibility: "A11y",
    responsiveness: "Responsive",
  }[issue.category] ?? issue.category;
  return (
    <div className="rounded-lg border border-ink-200 p-2.5 bg-white text-[12px] text-ink-700 leading-snug">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] text-ink-400 font-mono">#{index}</span>
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: sev.bg, color: sev.color }}
        >
          {sev.label}
        </span>
        <span className="text-[10px] text-ink-500 uppercase tracking-wide">
          {catLabel}
        </span>
      </div>
      <div className="font-medium text-ink-900 mb-1">{issue.name}</div>
      <div className="space-y-1">
        <div>
          <span className="text-ink-500">What: </span>
          {issue.description}
        </div>
        <div>
          <span className="text-ink-500">Fix: </span>
          {issue.recommendation}
        </div>
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
      <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color }}>
        {label}
      </div>
      <ul className="space-y-1 text-[12px] text-ink-700">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span style={{ color }} className="shrink-0">•</span>
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QaReportBody({ result }) {
  const sections = result.sections ?? [];
  const sum = result.summary ?? {};
  const actionLabel = {
    pass: "Pass",
    "fix-and-requa": "Fix & Re-QA",
    "needs-design-clarification": "Needs design clarification",
  }[sum.recommendedAction] ?? sum.recommendedAction;
  const actionColor = {
    pass: "#10b981",
    "fix-and-requa": "#dc2626",
    "needs-design-clarification": "#d97706",
  }[sum.recommendedAction] ?? "#64748b";

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
      {sum.recommendedAction && (
        <div className="rounded-lg border border-ink-200 p-3 bg-white">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold text-white"
              style={{ background: actionColor }}
            >
              {actionLabel}
            </span>
            <span className="text-[12px] text-ink-500">
              {sum.totalIssues ?? 0} issue{sum.totalIssues === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex gap-2 text-[11px]">
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
        </div>
      )}
      {sections.map((s, i) => (
        <QaSection key={i} section={s} />
      ))}
    </div>
  );
}

function QaSection({ section }) {
  const issues = section.issues ?? [];
  if (issues.length === 0) {
    return (
      <div>
        <SectionLabel icon={GitCompare} color="#db2777" count={0}>
          {section.title}
        </SectionLabel>
        <div className="text-[11px] text-ink-400 italic pl-1">
          No issues found.
        </div>
      </div>
    );
  }
  return (
    <div>
      <SectionLabel icon={GitCompare} color="#db2777" count={issues.length}>
        {section.title}
      </SectionLabel>
      <div className="space-y-2">
        {issues.map((it, i) => (
          <QaIssueCard key={i} issue={it} />
        ))}
      </div>
    </div>
  );
}

function QaIssueCard({ issue }) {
  const sev = SEVERITY[issue.severity] ?? {
    label: "Info",
    color: "#0284c7",
    bg: "#f0f9ff",
  };
  return (
    <div className="text-left rounded-lg border border-ink-200 bg-white text-[12px] text-ink-700 leading-snug overflow-hidden">
      <div className="px-2.5 pt-2 pb-1.5 flex items-center gap-1.5 border-b border-ink-100 bg-ink-50/50">
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
        <div className="text-[11px] text-ink-500 truncate flex-1 text-right">
          {issue.location}
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-ink-100">
        <DiffCell label="Design" value={issue.designed} tone="design" />
        <DiffCell label="Built" value={issue.built} tone="built" />
      </div>
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
        {value}
      </div>
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
            title="Close (Esc)"
            className="p-1.5 rounded text-ink-500 hover:text-ink-900 hover:bg-ink-100"
          >
            <X size={16} />
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
