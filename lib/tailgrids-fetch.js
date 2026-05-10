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
import { fetchTailgridsPreviewSpecs } from "./tailgrids-mdx.js";

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

  // Phase 2: discover every preview the docs page renders for this
  // component (from its MDX file), then fetch + compose each one and
  // stack them. tailgrids.com shows a full showcase per component —
  // Button has Variants/Appearances/Sizes/With Icons/Disabled/Custom
  // — so mirroring that gives users the same view they'd see on the
  // upstream docs.
  //
  // Compose failures are non-fatal per section — sections that fail
  // are simply omitted from the stacked output. If no sections
  // compose at all, we fall back to source-only.
  let previewSource = null;
  let previewSourceUrl = null;
  let html = null;
  let jsx = null;
  let previewSections = [];

  try {
    // 1. Discover preview specs via the MDX. Falls back to the
    //    canonical `<slug>-preview.tsx` (and its name alternates)
    //    when no MDX exists.
    let specs = [];
    try {
      specs = await fetchTailgridsPreviewSpecs(slug);
    } catch (err) {
      console.warn(`[tailgrids] mdx fetch failed for ${slug}:`, err.message);
    }
    if (specs.length === 0) {
      specs = [
        { filename: `${slug}-preview`, label: "Default" },
        { filename: `${slug}-basic-preview`, label: "Default" },
        { filename: `${slug}-default-preview`, label: "Default" },
        { filename: `${slug}-simple-preview`, label: "Default" },
      ];
    }

    // 2. Fetch theme once (cached) — every section uses it.
    const themeMap = await fetchTailgridsTheme();

    // 3. Compose each spec in order. Sibling registries get fetched
    //    on demand and shared across sections so we don't refetch
    //    Button.tsx for every Card example that imports it.
    const siblingSources = {};
    async function ensureSibling(slugName) {
      if (slugName === slug) return source;
      if (siblingSources[slugName]) return siblingSources[slugName];
      try {
        const res = await fetchFirstAvailable(candidateUrls(slugName));
        if (res) siblingSources[slugName] = res.text;
        return siblingSources[slugName] ?? null;
      } catch {
        return null;
      }
    }

    for (const spec of specs) {
      const previewUrl = `${PREVIEW_BASE}/${slug}/${spec.filename}.tsx`;
      let previewResult = null;
      try {
        previewResult = await fetchFirstAvailable([previewUrl]);
      } catch {
        continue;
      }
      if (!previewResult) continue;

      // Track the *first* preview's raw source and URL so the UI can
      // still link to "the canonical preview" when it shows source-
      // only. This mirrors pre-stack behaviour.
      if (!previewSource) {
        previewSource = previewResult.text;
        previewSourceUrl = previewResult.url;
      }

      // Resolve every sibling registry the preview imports.
      const imports = detectAllComponentImports(previewResult.text);
      for (const imp of imports) await ensureSibling(imp.slug);

      const composed = composePreview({
        registrySource: source,
        previewSource: previewResult.text,
        themeMap,
        siblingSources,
        primarySlug: slug,
      });
      if (!composed) continue;
      previewSections.push({
        label: spec.label,
        jsx: composed.jsx,
        html: composed.html,
      });
    }

    if (previewSections.length > 0) {
      html = buildStackedPreviewHtml(previewSections);
      jsx = buildStackedJsx(previewSections, slug);
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
    // Phase 2C: per-section composed previews so the UI can show the
    // stacked showcase tailgrids.com renders (Variants, Appearances,
    // Sizes, ...). Each entry has { label, jsx } — the html field
    // above is the same content stacked into one iframe doc.
    sections: previewSections,
  };
  setCached(slug, value);
  return value;
}

// Build a single iframe HTML document that stacks every composed
// section with a section header above each. Renders the same vertical
// showcase tailgrids.com shows on its component pages.
function buildStackedPreviewHtml(sections) {
  const bodyChunks = sections.map((s) => {
    // Convert JSX-only attribute names back to HTML for the iframe's
    // HTML parser. Keep arbitrary-value Tailwind classes untouched —
    // the play CDN handles those.
    const html = s.jsx
      .replace(/className=/g, "class=")
      .replace(/htmlFor=/g, "for=")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
    return [
      `<section class="section">`,
      `  <header class="section-label">${escapeHtml(s.label)}</header>`,
      `  <div class="stage">${html}</div>`,
      `</section>`,
    ].join("\n");
  });
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "<script src=\"https://cdn.tailwindcss.com\"></script>",
    "<style>",
    "  html, body { margin: 0; padding: 0; background: #f8fafc; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #0f172a; }",
    "  .section { border-bottom: 1px solid #e2e8f0; padding: 16px 24px 24px; }",
    "  .section:last-of-type { border-bottom: 0; }",
    "  .section-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 12px; }",
    "  .stage { display: flex; align-items: center; justify-content: center; min-height: 100px; padding: 12px 0; }",
    "  .stage > * { max-width: 100%; }",
    "</style>",
    "</head>",
    "<body>",
    bodyChunks.join("\n"),
    "</body>",
    "</html>",
  ].join("\n");
}

// Build the React component payload for the Copy CTA. Wraps every
// section in a proper React function component with imports + a
// default export so the user can paste straight into their codebase
// and have it compile — same ordering tailgrids.com uses for the
// stacked demos.
//
// Component name: PascalCase from the slug + "Showcase" suffix
// (e.g. "button" → "ButtonShowcase"). The body is a Fragment when
// there are multiple sections, otherwise the single section's JSX
// is returned directly so trivial components don't get extra
// boilerplate.
function buildStackedJsx(sections, slug) {
  const componentName = toPascalCase(slug) + "Showcase";

  // Indent every line of section JSX so it sits cleanly inside the
  // return ( ... ); wrapper. Two spaces per level — matches the
  // upstream codebase's style.
  function indent(s, spaces) {
    const pad = " ".repeat(spaces);
    return s
      .split("\n")
      .map((line) => (line.length > 0 ? pad + line : line))
      .join("\n");
  }

  let body;
  if (sections.length === 1) {
    body = indent(sections[0].jsx, 4);
  } else {
    const inner = sections
      .map(
        (s) =>
          `${" ".repeat(6)}{/* ${s.label} */}\n${indent(s.jsx, 6)}`,
      )
      .join("\n\n");
    body = `    <>\n${inner}\n    </>`;
  }

  return [
    `export default function ${componentName}() {`,
    `  return (`,
    body,
    `  );`,
    `}`,
  ].join("\n");
}

// "button-group" → "ButtonGroup", "alert-dialog" → "AlertDialog".
function toPascalCase(slug) {
  return String(slug || "")
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
