import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, ChevronUp, Download, X } from "lucide-react";
import { useCanvasStore } from "../../store.js";
import { getAgentDef } from "../../agents.js";
import {
  estimateCost,
  cacheHitRate,
  fmtDollars,
} from "../../lib/pricing.js";

// Compact token formatting (12_345 → "12.3k", 1_200_000 → "1.2M").
function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

export default function UsageChip() {
  const usage = useCanvasStore((s) => s.usage);
  const resetUsage = useCanvasStore((s) => s.resetUsage);
  const workspaceName = useCanvasStore((s) => s.workspaceName);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Derived metrics.
  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  const cacheRead = usage?.cacheRead ?? 0;
  const cacheWrite = usage?.cacheWrite ?? 0;
  const runs = usage?.runs ?? 0;
  const totalTokens = input + output + cacheRead + cacheWrite;
  const history = usage?.history ?? [];

  // Dollar totals are accumulated at run time in the store — pre-rated using
  // each run's own model. Render just reads them. For older saves that have
  // tokens but no `dollars` field we fall back to a re-estimate.
  const recentModel =
    history.length > 0 ? history[history.length - 1].model : null;
  const dollars =
    usage?.dollars ??
    estimateCost({ input, output, cacheRead, cacheWrite }, recentModel)
      .dollars;
  // "approx" surfaces when at least one accumulated run had to use fallback
  // rates because we didn't know its model.
  const approx = useMemo(() => {
    if (history.length === 0) return false;
    return history.some((r) => estimateCost(r, r.model).approx);
  }, [history]);

  const hitRate = cacheHitRate({ input, cacheRead, cacheWrite });

  // Sort agents by cost descending. Top 3 visible by default; rest behind expand.
  // Dollar field is also pre-accumulated per-agent in the store.
  const byAgent = useMemo(() => {
    const rows = Object.entries(usage?.byAgent ?? {}).map(([agentId, u]) => ({
      agentId,
      ...u,
      dollars:
        u?.dollars ?? estimateCost(u, recentModel).dollars,
      total:
        (u.input ?? 0) +
        (u.output ?? 0) +
        (u.cacheRead ?? 0) +
        (u.cacheWrite ?? 0),
    }));
    return rows.sort((a, b) => b.dollars - a.dollars);
  }, [usage?.byAgent, recentModel]);

  const visibleAgents = expanded ? byAgent : byAgent.slice(0, 3);
  const hiddenCount = byAgent.length - visibleAgents.length;

  function exportCsv() {
    if (history.length === 0) return;
    const header = [
      "timestamp",
      "agent",
      "model",
      "input",
      "output",
      "cache_read",
      "cache_write",
      "estimated_usd",
    ].join(",");
    const lines = history.map((r) => {
      const { dollars: d } = estimateCost(r, r.model);
      return [
        new Date(r.ts).toISOString(),
        r.agentId,
        r.model ?? "",
        r.input,
        r.output,
        r.cacheRead,
        r.cacheWrite,
        d.toFixed(6),
      ].join(",");
    });
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = (workspaceName || "workspace")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    a.download = `${safe}-usage.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Chip headline matches popover headline (consistency).
  const chipLabel = runs === 0 ? "$0.00" : fmtDollars(dollars);

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium ${
          open
            ? "text-brand-600 bg-brand-500/10"
            : "text-ink-700 hover:text-ink-900 hover:bg-ink-100"
        }`}
        title={`Estimated cost · ${fmtTokens(totalTokens)} tokens · ${runs} runs`}
      >
        <Activity size={13} />
        <span className="tabular-nums">{chipLabel}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] bg-white rounded-xl shadow-floating border border-ink-200 z-40 overflow-hidden">
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Workspace usage
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-0.5 rounded text-ink-400 hover:text-ink-700 hover:bg-ink-100"
              title="Close (Esc)"
            >
              <X size={12} />
            </button>
          </div>

          <div className="px-4 pb-3">
            {runs === 0 ? (
              <div className="py-3">
                <div className="text-[20px] font-semibold text-ink-300 leading-tight">
                  No runs yet
                </div>
                <div className="text-[11px] text-ink-400 mt-1">
                  Run an agent to start tracking spend.
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-[28px] font-semibold text-ink-900 tabular-nums leading-none">
                    {fmtDollars(dollars)}
                  </span>
                  {approx && (
                    <span className="text-[10px] text-ink-400">est.</span>
                  )}
                  <Sparkline runs={history} />
                </div>
                <div className="text-[11px] text-ink-500 mt-1.5 tabular-nums">
                  {fmtTokens(totalTokens)} tokens
                  <span className="text-ink-300 mx-1.5">·</span>
                  {fmtTokens(input)} in
                  <span className="text-ink-300 mx-1.5">·</span>
                  {fmtTokens(output)} out
                  {hitRate != null && (
                    <>
                      <span className="text-ink-300 mx-1.5">·</span>
                      <span title="Share of input tokens served from cache">
                        {Math.round(hitRate * 100)}% cached
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {byAgent.length > 0 && (
            <div className="border-t border-ink-100 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500 mb-2">
                Top agents
              </div>
              <div className="space-y-2.5">
                {visibleAgents.map((row) => (
                  <ByAgentRow
                    key={row.agentId}
                    row={row}
                    totalDollars={dollars}
                  />
                ))}
              </div>
              {hiddenCount > 0 && (
                <button
                  onClick={() => setExpanded(true)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900"
                >
                  <ChevronDown size={11} />
                  Show {hiddenCount} more
                </button>
              )}
              {expanded && byAgent.length > 3 && (
                <button
                  onClick={() => setExpanded(false)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900"
                >
                  <ChevronUp size={11} />
                  Show less
                </button>
              )}
            </div>
          )}

          <div className="border-t border-ink-100 px-4 py-2 flex items-center justify-between bg-ink-50/40">
            <div className="text-[10px] text-ink-400">
              Estimate · check Anthropic for billing.
            </div>
            <div className="flex items-center gap-3">
              {history.length > 0 && (
                <button
                  onClick={exportCsv}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-500 hover:text-ink-900"
                  title="Export run history as CSV"
                >
                  <Download size={10} /> Export
                </button>
              )}
              <button
                onClick={() => {
                  if (
                    confirm(
                      "Reset workspace usage counters and run history? This can't be undone.",
                    )
                  )
                    resetUsage();
                }}
                className="text-[10px] font-medium text-ink-500 hover:text-red-600"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline sparkline of cost-per-run over the kept history. Renders nothing if
// there's only a single point (no signal in a single dot).
function Sparkline({ runs }) {
  const points = useMemo(() => {
    if (!runs || runs.length < 2) return [];
    const costs = runs.map((r) => {
      const { dollars } = estimateCost(r, r.model);
      return dollars;
    });
    const max = Math.max(...costs);
    if (max === 0) return [];
    const w = 80;
    const h = 18;
    const step = w / (costs.length - 1);
    return costs.map((c, i) => [i * step, h - (c / max) * h]);
  }, [runs]);

  if (points.length === 0) return null;
  const path = points
    .map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`))
    .join(" ");
  return (
    <svg
      viewBox="0 0 80 18"
      preserveAspectRatio="none"
      className="ml-auto h-[18px] w-[80px] shrink-0"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="#7c3aed"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={points[points.length - 1][0]}
        cy={points[points.length - 1][1]}
        r="1.5"
        fill="#7c3aed"
      />
    </svg>
  );
}

function ByAgentRow({ row, totalDollars }) {
  const def = getAgentDef(row.agentId);
  const Icon = def?.icon;
  const accent = def?.accent ?? "#64748b";
  const share = totalDollars > 0 ? row.dollars / totalDollars : 0;
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] mb-1">
        <span
          className="w-4 h-4 rounded flex items-center justify-center text-white shrink-0"
          style={{ background: accent }}
        >
          {Icon && <Icon size={10} />}
        </span>
        <span className="flex-1 truncate text-ink-700 font-medium">
          {def?.name ?? row.agentId}
        </span>
        <span className="text-ink-900 tabular-nums shrink-0 font-medium">
          {fmtDollars(row.dollars)}
        </span>
      </div>
      <div className="h-1 rounded-full bg-ink-100 overflow-hidden ml-6">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(share * 100, share > 0 ? 4 : 0)}%`,
            background: accent,
          }}
        />
      </div>
      <div className="ml-6 mt-1 text-[10px] text-ink-400 tabular-nums">
        {row.runs} run{row.runs === 1 ? "" : "s"} ·{" "}
        {fmtTokens((row.input ?? 0) + (row.output ?? 0))} tokens
      </div>
    </div>
  );
}
