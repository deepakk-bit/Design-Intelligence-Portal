import { Handle, Position } from "@xyflow/react";
import {
  Trash2,
  AlertCircle,
  Sparkles,
  ListChecks,
  ThumbsUp,
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
};

const SEVERITY = {
  critical: { label: "Critical", color: "#dc2626", bg: "#fef2f2" },
  major: { label: "Major", color: "#ea580c", bg: "#fff7ed" },
  minor: { label: "Minor", color: "#ca8a04", bg: "#fefce8" },
  nit: { label: "Nit", color: "#64748b", bg: "#f1f5f9" },
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
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-900 truncate">
            {meta.label}
          </div>
          <div className="text-[11px] text-ink-500 truncate">
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
      <div className="nowheel max-h-[520px] overflow-y-auto scroll-thin px-4 py-3">
        {kind === "overview" && <OverviewBody result={result} />}
        {kind === "suggestions" && <SuggestionsBody result={result} />}
        {kind === "actionPlan" && <ActionPlanBody result={result} />}
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
