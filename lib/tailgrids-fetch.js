// TailGrids component fetcher.
//
// Pulls the canonical .tsx source for any TailGrids component straight
// from the upstream repo on GitHub. Phase 2 also fetches the matching
// preview file and runs the full composer (cva interpreter + theme
// resolver) so callers get plugin-ready JSX and a self-contained
// preview HTML alongside the raw source.
//
// Output shape:
//   {
//     id, name, category,
//     source     — raw registry .tsx (Phase 1)
//     sourceUrl  — canonical link on GitHub
//     html       — self-contained iframe doc, or null on compose fail
//     jsx        — resolved JSX with arbitrary-value classes, or null
//     previewSource    — raw preview .tsx (for transparency / debug)
//     previewSourceUrl — canonical link to the preview file
//   }
//
// When composition fails (component isn't cva-based, preview file
// missing, parser hits an edge case), we still return the raw source.
// The frontend renders a Phase-1-style "source only" view as a graceful
// degrade — better than refusing the response entirely.
//
// Source paths (TailGrids repo, default branch):
//   apps/docs/src/registry/core/<slug>.tsx        — flat components
//   apps/docs/src/registry/core/<slug>/index.tsx  — directory components
//   apps/docs/src/registry/core/<slug>/index.ts   — combobox edge case
//   apps/docs/src/components/preview/<slug>/<slug>-preview.tsx — primary demo

import { getTailgridsManifestEntry } from "./tailgrids-manifest.js";
import { fetchTailgridsTheme } from "./tailgrids-theme.js";
import {
  composePreview,
  detectAllComponentImports,
} from "./tailgrids-compose.js";

const REPO_BASE =
  "https://raw.githubusercontent.com/tailgrids/tailgrids/main/apps/docs/src/registry/core";

const PREVIEW_BASE =
  "https://raw.githubusercontent.com/tailgrids/tailgrids/main/apps/docs/src/components/preview";

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

  // Phase 2: also fetch the canonical preview file and the theme, then
  // run the composer to produce plugin-ready JSX + a renderable HTML
  // doc for the iframe. Compose failures are non-fatal — we still ship
  // the raw source so the user gets *something* useful.
  //
  // Phase 2B: previews may import sibling components from other
  // registries (Input + Label, SocialButton + Button). We fetch every
  // referenced registry and feed them as siblingSources so the
  // composer can build a unified component map.
  let previewSource = null;
  let previewSourceUrl = null;
  let html = null;
  let jsx = null;
  try {
    // Some components ship multiple preview demos and don't have a
    // canonical `<slug>-preview.tsx`. Try the common alternates
    // (basic, default, simple) before giving up. The list is
    // ordered: the first that returns 200 wins.
    const previewCandidates = [
      `${PREVIEW_BASE}/${slug}/${slug}-preview.tsx`,
      `${PREVIEW_BASE}/${slug}/${slug}-basic-preview.tsx`,
      `${PREVIEW_BASE}/${slug}/${slug}-default-preview.tsx`,
      `${PREVIEW_BASE}/${slug}/${slug}-simple-preview.tsx`,
    ];
    const previewResult = await fetchFirstAvailable(previewCandidates);
    if (previewResult) {
      previewSource = previewResult.text;
      previewSourceUrl = previewResult.url;

      // Resolve any sibling registry imports the preview references.
      // Skip the primary slug since we already have that source.
      const imports = detectAllComponentImports(previewSource);
      const siblingSlugs = new Set(
        imports.map((i) => i.slug).filter((s) => s !== slug),
      );
      const siblingSources = {};
      for (const sib of siblingSlugs) {
        try {
          const sibResult = await fetchFirstAvailable(candidateUrls(sib));
          if (sibResult) siblingSources[sib] = sibResult.text;
        } catch {
          // Sibling fetch failure — leave it out; composer will skip
          // any tags it can't resolve.
        }
      }

      const themeMap = await fetchTailgridsTheme();
      const composed = composePreview({
        registrySource: source,
        previewSource,
        themeMap,
        siblingSources,
        primarySlug: slug,
      });
      if (composed) {
        html = composed.html;
        jsx = composed.jsx;
      }
    }
  } catch (err) {
    // Log but don't fail the request — the raw source is still useful.
    console.warn(
      `[tailgrids] preview compose failed for ${slug}: ${err.message ?? err}`,
    );
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
    previewSource,
    previewSourceUrl,
    html,
    jsx,
  };
  setCached(slug, value);
  return value;
}
