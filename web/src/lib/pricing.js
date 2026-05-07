// Best-effort cost estimates for the Anthropic Claude family. Rates are
// $ per million tokens and reflect Anthropic's published pricing as of
// May 2026. These are *estimates* — actual billing happens on Anthropic's
// side and is the source of truth. If a model isn't in this table we fall
// back to Sonnet rates with the "approx." flag set so the UI can surface
// uncertainty.

const RATES = {
  // Opus tier — flagship
  "claude-opus-4-7": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-opus-4-6": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-opus-4-5": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  // Sonnet tier — workhorse
  "claude-sonnet-4-7": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  // Haiku tier — fast/cheap
  "claude-haiku-4-7": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1.0,
  },
  "claude-haiku-4-6": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1.0,
  },
};

const DEFAULT_RATE = RATES["claude-sonnet-4-6"];

// Look up rates for a model id. Substring-match so "claude-opus-4-7-20260115"
// or similar variants still hit the right tier.
export function getRates(model) {
  if (!model) return { rates: DEFAULT_RATE, approx: true };
  const exact = RATES[model];
  if (exact) return { rates: exact, approx: false };
  for (const key of Object.keys(RATES)) {
    if (model.includes(key)) return { rates: RATES[key], approx: false };
  }
  if (model.includes("opus"))
    return { rates: RATES["claude-opus-4-7"], approx: true };
  if (model.includes("haiku"))
    return { rates: RATES["claude-haiku-4-7"], approx: true };
  return { rates: DEFAULT_RATE, approx: true };
}

// Estimate dollar cost for a single usage record (or aggregate). All four
// token counts default to 0 if missing.
export function estimateCost(usage, model) {
  const { rates, approx } = getRates(model);
  const u = usage ?? {};
  const dollars =
    ((u.input ?? 0) * rates.input +
      (u.output ?? 0) * rates.output +
      (u.cacheRead ?? 0) * rates.cacheRead +
      (u.cacheWrite ?? 0) * rates.cacheWrite) /
    1_000_000;
  return { dollars, approx };
}

// Sum cost across a list of run records, where each run carries its own model.
// Falls back to the workspace's most recent model if a run is missing one.
export function aggregateCost(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return { dollars: 0, approx: false };
  let dollars = 0;
  let approx = false;
  for (const r of runs) {
    const { dollars: d, approx: a } = estimateCost(r, r.model);
    dollars += d;
    if (a) approx = true;
  }
  return { dollars, approx };
}

// Cache hit rate = cache_read / (cache_read + cache_write + input). If there's
// no cached input at all, returns null so the UI can hide the metric.
export function cacheHitRate({ input = 0, cacheRead = 0, cacheWrite = 0 }) {
  const totalPromptInput = input + cacheRead + cacheWrite;
  if (totalPromptInput === 0 || cacheRead + cacheWrite === 0) return null;
  return cacheRead / totalPromptInput;
}

// Format a dollar amount. Shows extra precision for tiny values.
export function fmtDollars(d) {
  if (!Number.isFinite(d) || d === 0) return "$0.00";
  if (d < 0.01) return "<$0.01";
  if (d < 1) return `$${d.toFixed(3)}`.replace(/0$/, "");
  if (d < 100) return `$${d.toFixed(2)}`;
  return `$${Math.round(d).toLocaleString()}`;
}
