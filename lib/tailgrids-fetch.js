// TailGrids component fetcher — Phase 1.
//
// Pulls the canonical .tsx source for any TailGrids component straight
// from the upstream repo on GitHub. The output is the actual React
// component file, byte-for-byte the same as what `npx @tailgrids/cli
// add <component>` would write into a developer's project.
//
// Phase 1 returns the source as-is. The components depend on TailGrids'
// CSS variable theme (e.g. `bg-button-primary-background`) so the source
// is not yet plugin-ready — Phase 2 will add a cva interpreter + theme
// resolver that emits arbitrary-value Tailwind suitable for the Figma
// React (Tailwind) to Design plugin.
//
// Source paths (TailGrids repo, default branch):
//   apps/docs/src/registry/core/<slug>.tsx        — flat components
//   apps/docs/src/registry/core/<slug>/index.tsx  — directory components
//                                                    (combobox, spinner)
//   apps/docs/src/registry/core/<slug>/index.ts   — combobox edge case
//
// We fetch via raw.githubusercontent.com — no auth needed for public
// repos, no API rate limit concerns at the volumes we expect.

import { getTailgridsManifestEntry } from "./tailgrids-manifest.js";

const REPO_BASE =
  "https://raw.githubusercontent.com/tailgrids/tailgrids/main/apps/docs/src/registry/core";

// 24h in-memory cache. The component sources change rarely — caching
// avoids hammering GitHub on every run and keeps the agent feeling
// instant after the first hit.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // slug → { value, expiresAt }

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Try a series of candidate URLs in order; return the first 200. If
// they all 404, return null (caller treats as "component not found").
// Other failure modes (network, 5xx) bubble up so the handler can
// surface a clear error.
async function fetchFirstAvailable(urls, timeoutMs = 5000) {
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        // Treat as plain text — these are .tsx source files.
        headers: { Accept: "text/plain, */*" },
      });
      clearTimeout(timer);
      if (res.status === 404) continue;
      if (!res.ok) {
        throw new Error(
          `TailGrids fetch ${url} failed: ${res.status} ${res.statusText}`,
        );
      }
      const text = await res.text();
      return { url, text };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error(`TailGrids fetch ${url} timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }
  return null;
}

// Some components ship as a directory of multiple sibling files with
// no index. We concatenate those files (clearly delimited) so the user
// gets every primitive in one paste. The keys are slugs; values are
// ordered file lists relative to the registry root. Verified against
// the upstream tree on 2026-05.
const MULTI_FILE_COMPONENTS = {
  "date-picker": ["date-picker/single-date.tsx", "date-picker/range-date.tsx"],
  combobox: ["combobox/combobox.tsx", "combobox/multi-combobox.tsx"],
  spinner: [
    "spinner/default.tsx",
    "spinner/dotted.tsx",
    "spinner/dotted-round.tsx",
  ],
};

// Resolve a slug to its source file. We try the flat .tsx first since
// that covers ~50 of the 54 components, then the directory index
// variants. Order matters — index.tsx before index.ts because some
// directories ship both (the .ts is a barrel re-export, .tsx the
// actual primitive).
function candidateUrls(slug) {
  return [
    `${REPO_BASE}/${slug}.tsx`,
    `${REPO_BASE}/${slug}/index.tsx`,
    `${REPO_BASE}/${slug}/index.ts`,
  ];
}

export async function fetchTailgridsComponent(slug) {
  if (!slug || typeof slug !== "string") return null;

  const manifestEntry = getTailgridsManifestEntry(slug);
  if (!manifestEntry) {
    // Unknown slug — refuse rather than guess. Keeps the picker the
    // single source of truth for what we support.
    return null;
  }

  const cached = getCached(slug);
  if (cached) return cached;

  let source = "";
  let sourceUrl = null;

  if (MULTI_FILE_COMPONENTS[slug]) {
    // Concatenate every sibling file with a clear delimiter so devs
    // can split the paste in their editor and see exactly which file
    // each block belongs in.
    const parts = [];
    for (const rel of MULTI_FILE_COMPONENTS[slug]) {
      const url = `${REPO_BASE}/${rel}`;
      const r = await fetchFirstAvailable([url]);
      if (!r) continue;
      parts.push(`// ── ${rel} ──────────────────────────────\n${r.text}`);
    }
    if (parts.length === 0) return null;
    source = parts.join("\n\n");
    sourceUrl = `${REPO_BASE}/${slug}`;
  } else {
    const result = await fetchFirstAvailable(candidateUrls(slug));
    if (!result) return null;
    source = result.text;
    sourceUrl = result.url;
  }

  const value = {
    id: slug,
    name: manifestEntry.name,
    category: manifestEntry.category,
    // Raw .tsx content — what `npx @tailgrids/cli add <slug>` writes.
    // Includes imports, cva variants, TypeScript types, the React
    // component itself.
    source,
    sourceUrl,
    // Phase 1: we don't yet have a runnable preview HTML or
    // plugin-ready JSX. Both fields stay null so the UI can branch on
    // their absence and show the appropriate "Phase 2" affordance
    // without doing string truthiness checks.
    html: null,
    jsx: null,
  };
  setCached(slug, value);
  return value;
}
