// TailGrids component-docs MDX parser.
//
// Each TailGrids component's docs page is an MDX file at:
//   apps/docs/content/components/<slug>.mdx
//
// The MDX is a vertical stack of demo blocks, each shaped like:
//
//   ### <Section heading>            (markdown h3)
//   <ComponentPreview codeSnippet={getFileContent(
//     "/src/components/preview/<slug>/<file>.tsx"
//   )}>
//     <FooPreview />
//   </ComponentPreview>
//
// This matches what tailgrids.com renders on each component's page —
// a sequence of labelled previews. The first <ComponentPreview> has
// no heading (it's the canonical "default" demo); subsequent ones
// live under `## Examples` with `### Variants`, `### Sizes`, etc.
//
// We pull two things from the MDX:
//   1. The ordered list of preview filenames the page renders.
//   2. The section label for each (or "Default" for the headless one).
//
// Together they tell us *what* tailgrids.com shows for this component —
// our fetcher then pulls every preview file and the composer renders
// them stacked in the iframe with matching section headers.

const MDX_BASE =
  "https://raw.githubusercontent.com/tailgrids/tailgrids/main/apps/docs/content/components";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // slug → { value, expiresAt }

async function fetchMdx(slug, timeoutMs = 5000) {
  const url = `${MDX_BASE}/${slug}.mdx`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`MDX fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error(`MDX fetch ${slug} timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

// Extract the ordered preview specs from an MDX string.
//
// Walks the MDX once and pairs every `<ComponentPreview ... codeSnippet=
// {getFileContent("...path...")}>` with the most recent `###`-level
// heading. Headings that appear *after* a preview don't apply to it.
// The first preview (always shown above `## Installation`) gets the
// label "Default" — that mirrors what tailgrids.com displays.
//
// Returns an array of `{ label, filename }` records in document order.
// `filename` is the basename without `.tsx` (e.g. "button-preview"),
// matching our existing fetch convention.
export function extractPreviewSpecs(mdx, slug) {
  if (!mdx) return [];

  const specs = [];
  let lastHeading = "Default";
  let alreadyHaveDefault = false;

  // Split into segments at each `###` heading or each `<ComponentPreview`
  // boundary. Linear scan is fine — these MDX files are small (<5KB).
  const headingRe = /^###\s+(.+)$/gm;
  const previewRe =
    /<ComponentPreview[\s\S]*?codeSnippet=\{getFileContent\(\s*["']\/src\/components\/preview\/[^/]+\/([^"']+)\.tsx["']\s*\)\s*\}/g;

  // Collect heading positions and preview positions, then merge in
  // document order.
  const events = [];
  let m;
  while ((m = headingRe.exec(mdx))) {
    events.push({ pos: m.index, kind: "heading", text: m[1].trim() });
  }
  while ((m = previewRe.exec(mdx))) {
    events.push({ pos: m.index, kind: "preview", filename: m[1] });
  }
  events.sort((a, b) => a.pos - b.pos);

  for (const ev of events) {
    if (ev.kind === "heading") {
      lastHeading = ev.text;
    } else {
      // The very first preview always lives above `## Installation`
      // with no `###` heading above it. Tag it "Default" so it
      // matches the docs page's implicit naming.
      const label = alreadyHaveDefault ? lastHeading : "Default";
      alreadyHaveDefault = true;
      specs.push({ filename: ev.filename, label });
    }
  }

  return specs;
}

export async function fetchTailgridsPreviewSpecs(slug) {
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const mdx = await fetchMdx(slug);
  const value = extractPreviewSpecs(mdx, slug);
  cache.set(slug, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
