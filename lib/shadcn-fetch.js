// Live fetch + parse shadcn/ui components from the public registry.
//
// shadcn ships every component as JSON at
//   https://ui.shadcn.com/r/styles/new-york/<slug>.json
// The payload's `files[].content` is the raw `.tsx`. Most components
// define their variants via `cva(baseClasses, { variants: { variant:
// {…}, size: {…} } })` — we extract that block, parse the
// variant/size maps, resolve every Tailwind class to a concrete token
// (height in px, hex colour, radius in px, etc.) and compose a matrix
// object the existing renderer can consume.
//
// On any failure (network error, timeout, no cva block, parse miss),
// `fetchShadcnMatrix` returns null so the caller can fall through to
// the hardcoded preset table. This keeps the agent resilient to
// upstream refactors.

const REGISTRY_BASES = [
  "https://ui.shadcn.com/r/styles/new-york",
  "https://ui.shadcn.com/r/styles/default",
];
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const cache = new Map(); // slug -> { matrix, ts }

// shadcn default zinc theme — CSS-var values resolved to hex.
// Source of truth: https://ui.shadcn.com/themes (default zinc).
// Each entry mirrors a `--<key>` CSS custom property in shadcn's
// globals.css. Used to resolve semantic Tailwind classes like
// `bg-primary` to a concrete colour for the matrix renderer.
const THEME = {
  background: "#ffffff",
  foreground: "#0f172a",
  primary: "#0f172a",
  "primary-foreground": "#fafafa",
  destructive: "#dc2626",
  "destructive-foreground": "#fafafa",
  secondary: "#f1f5f9",
  "secondary-foreground": "#0f172a",
  accent: "#f1f5f9",
  "accent-foreground": "#0f172a",
  muted: "#f1f5f9",
  "muted-foreground": "#64748b",
  border: "#e2e8f0",
  input: "#e2e8f0",
  ring: "#0f172a",
  card: "#ffffff",
  "card-foreground": "#0f172a",
  popover: "#ffffff",
  "popover-foreground": "#0f172a",
};

const STATE_COLUMNS = [
  { id: "default", label: "Default", modifier: "rest" },
  { id: "hover", label: "Hover", modifier: "hover" },
  { id: "focus", label: "Focus", modifier: "focus" },
  { id: "loading", label: "Loading", modifier: "loading" },
  { id: "disabled", label: "Disabled", modifier: "disabled" },
  { id: "pressed", label: "Pressed", modifier: "pressed" },
];

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

export async function fetchShadcnMatrix(componentName) {
  const slug = normaliseSlug(componentName);
  if (!slug) return null;

  // Cache hit?
  const cached = cache.get(slug);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.matrix;
  }

  // Try each registry base in order; new-york is shadcn's current
  // default style, but some older keys / forks point at /default.
  let tsx = null;
  for (const base of REGISTRY_BASES) {
    tsx = await fetchComponentTsx(`${base}/${slug}.json`);
    if (tsx) break;
  }
  if (!tsx) return null;

  const cva = extractCvaBlock(tsx);
  if (!cva) return null;

  const matrix = composeMatrix(slug, cva);
  if (!matrix) return null;

  // Attach the raw shadcn TSX so the client's "Copy code" button can
  // emit the original React component source (with cva, forwardRef,
  // semantic Tailwind tokens) rather than the resolved matrix JSX.
  // The matrix is still used for the visual preview.
  matrix.source = tsx;
  matrix.sourceLanguage = "tsx";
  matrix.sourceUrl = `https://ui.shadcn.com/r/styles/new-york/${slug}.json`;

  cache.set(slug, { matrix, ts: Date.now() });
  return matrix;
}

function normaliseSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "");
}

async function fetchComponentTsx(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const file = (json.files || []).find(
      (f) => f.type === "registry:ui" || (f.path || "").endsWith(".tsx"),
    );
    return file?.content || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// CVA extraction — find `cva("base", { variants: {…}, defaultVariants:
// {…} })` and pull out the pieces. We use brace-counting rather than a
// fragile mega-regex so nested objects parse cleanly.
// ---------------------------------------------------------------------

function extractCvaBlock(tsx) {
  const idx = tsx.indexOf("cva(");
  if (idx < 0) return null;
  let i = idx + 4;

  // Read base classes — first quoted (possibly multi-line concatenated)
  // string. shadcn occasionally wraps it across lines with `\n`.
  while (i < tsx.length && /\s/.test(tsx[i])) i++;
  if (tsx[i] !== '"' && tsx[i] !== "'" && tsx[i] !== "`") return null;
  const { value: baseClasses, next } = readString(tsx, i);
  i = next;

  // Skip whitespace, comma, whitespace.
  while (i < tsx.length && /[\s,]/.test(tsx[i])) i++;
  if (tsx[i] !== "{") return null;

  // Read the config object as a balanced-brace span.
  const configStart = i;
  let depth = 0;
  while (i < tsx.length) {
    const c = tsx[i];
    if (c === '"' || c === "'" || c === "`") {
      const r = readString(tsx, i);
      i = r.next;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    i++;
  }
  const configBlock = tsx.slice(configStart, i);

  const variantsBlock = extractObjectValue(configBlock, "variants");
  return { baseClasses, variantsBlock };
}

// Read a quoted string starting at `i` (where `s[i]` is the opening
// quote). Handles backslash escapes and adjacent string concatenation
// (TS allows `"a" + "b"` and shadcn occasionally wraps long class
// strings that way; we approximate by joining adjacent strings).
function readString(s, i) {
  let result = "";
  while (i < s.length) {
    const quote = s[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") break;
    i++;
    let part = "";
    while (i < s.length && s[i] !== quote) {
      if (s[i] === "\\" && i + 1 < s.length) {
        const esc = s[i + 1];
        if (esc === "n") part += " ";
        else if (esc === "t") part += " ";
        else part += esc;
        i += 2;
      } else {
        part += s[i];
        i++;
      }
    }
    i++; // skip closing quote
    result += part;
    // Skip whitespace; if the next non-whitespace is `+` and another
    // string follows, continue concatenating.
    let j = i;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] === "+") {
      j++;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '"' || s[j] === "'" || s[j] === "`") {
        i = j;
        continue;
      }
    }
    break;
  }
  return { value: result, next: i };
}

// Find `key: { ... }` inside `block` and return the inner span.
function extractObjectValue(block, key) {
  const re = new RegExp(`${key}\\s*:\\s*\\{`);
  const m = block.match(re);
  if (!m) return null;
  let i = m.index + m[0].length - 1; // position of `{`
  let depth = 0;
  const start = i;
  while (i < block.length) {
    const c = block[i];
    if (c === '"' || c === "'" || c === "`") {
      const r = readString(block, i);
      i = r.next;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    i++;
  }
  return block.slice(start, i);
}

// Parse `{ default: "...", destructive: "...", … }` into a flat
// object of { key: classString }.
function parseFlatStringObject(block) {
  if (!block) return {};
  const inner = block.slice(1, -1); // strip `{` and `}`
  const out = {};
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    let key = "";
    while (i < inner.length && /[a-zA-Z0-9_]/.test(inner[i])) {
      key += inner[i];
      i++;
    }
    if (!key) break;
    while (i < inner.length && /[\s:]/.test(inner[i])) i++;
    if (
      inner[i] !== '"' &&
      inner[i] !== "'" &&
      inner[i] !== "`"
    ) {
      // Skip non-string values gracefully.
      while (i < inner.length && inner[i] !== ",") i++;
      continue;
    }
    const r = readString(inner, i);
    out[key] = r.value;
    i = r.next;
  }
  return out;
}

// ---------------------------------------------------------------------
// Compose the matrix object from the parsed cva pieces.
// ---------------------------------------------------------------------

function composeMatrix(slug, { baseClasses, variantsBlock }) {
  const variantBlock = variantsBlock
    ? extractObjectValue(variantsBlock, "variant")
    : null;
  const sizeBlock = variantsBlock
    ? extractObjectValue(variantsBlock, "size")
    : null;

  const variantMap = parseFlatStringObject(variantBlock);
  const sizeMap = parseFlatStringObject(sizeBlock);

  // Bail if neither axis parsed anything useful — caller falls through
  // to the hardcoded preset.
  if (
    Object.keys(variantMap).length === 0 &&
    Object.keys(sizeMap).length === 0
  ) {
    return null;
  }

  const archetype = detectArchetype(slug);
  const label = labelFor(slug, archetype);

  const rowGroups =
    Object.keys(variantMap).length > 0
      ? Object.entries(variantMap).map(([id, classes]) => ({
          id,
          label: capitalise(id),
          tokens: resolveVariantTokens(classes, baseClasses),
        }))
      : [
          {
            id: "default",
            label: "Default",
            tokens: resolveVariantTokens("", baseClasses),
          },
        ];

  const rowSubItems =
    Object.keys(sizeMap).length > 0
      ? Object.entries(sizeMap).map(([id, classes]) => ({
          id,
          label: id,
          tokens: resolveSizeTokens(classes, baseClasses),
        }))
      : [
          {
            id: "default",
            label: "default",
            tokens: resolveSizeTokens("", baseClasses),
          },
        ];

  const columns = pickColumns(slug, baseClasses);
  const skipCells = inferSkipCells(slug, rowGroups, rowSubItems, columns);

  return {
    archetype,
    label,
    glyph: glyphFor(slug),
    rowGroups,
    rowSubItems,
    columns,
    skipCells,
  };
}

function detectArchetype(slug) {
  if (slug === "button") return "button";
  if (slug === "badge" || slug === "chip") return "badge";
  if (slug === "input" || slug === "textfield" || slug === "textinput")
    return "input";
  if (slug === "card") return "card";
  if (slug === "checkbox") return "checkbox";
  if (slug === "switch" || slug === "toggle") return "toggle";
  if (slug === "avatar") return "avatar";
  return "button";
}

function labelFor(slug, archetype) {
  if (archetype === "checkbox" || archetype === "toggle") return "";
  if (archetype === "avatar") return "DK";
  if (slug === "input") return "Email";
  return capitalise(slug);
}

function glyphFor(slug) {
  if (slug === "checkbox") return "check";
  if (slug === "switch" || slug === "toggle") return "circle";
  if (slug === "avatar") return "user";
  return "circle";
}

function capitalise(s) {
  if (!s) return "";
  return s[0].toUpperCase() + s.slice(1);
}

// shadcn rarely models loading or pressed in cva, so we keep all six
// state columns by default and let the renderer derive what it can.
function pickColumns(_slug, _baseClasses) {
  return STATE_COLUMNS;
}

// Skip combinations that can't render meaningfully:
//   - "link" variant with an icon size has no native shadcn equivalent.
//   - non-icon variants in the loading column when there's an `icon`
//     size (the icon cell would have nothing to show — we use a
//     spinner glyph instead).
function inferSkipCells(slug, rowGroups, rowSubItems, columns) {
  const skips = [];
  const hasLink = rowGroups.some((g) => g.id === "link");
  const hasIconSize = rowSubItems.some((s) => s.tokens.iconOnly);
  if (hasLink && hasIconSize) {
    for (const c of columns) {
      skips.push({ rowGroup: "link", rowSub: "icon", column: c.id });
    }
  }
  if (slug === "button" && hasIconSize) {
    for (const g of rowGroups) {
      if (g.id === "link") continue;
      skips.push({ rowGroup: g.id, rowSub: "icon", column: "loading" });
    }
  }
  return skips;
}

// ---------------------------------------------------------------------
// Tailwind class → token resolution.
// ---------------------------------------------------------------------

function resolveVariantTokens(variantClasses, baseClasses) {
  const all = [
    ...splitClasses(baseClasses),
    ...splitClasses(variantClasses),
  ];
  return {
    bg: pickBg(all),
    bgHover: pickHoverBg(all),
    bgPressed: pickActiveBg(all),
    border: pickBorder(all),
    text: pickText(all),
    underline: all.some((c) => c === "underline" || c === "hover:underline"),
  };
}

function resolveSizeTokens(sizeClasses, baseClasses) {
  const all = [
    ...splitClasses(baseClasses),
    ...splitClasses(sizeClasses),
  ];
  const fontSize = pickFontSize(all) ?? 14;
  const padY = pickPaddingY(all);
  // Components like Badge declare no explicit `h-N`; derive height
  // from line-height (~1.4 × font-size) plus vertical padding so the
  // matrix renders Badge as a pill, not a 36px slab.
  let height = pickHeight(all);
  if (height == null) {
    if (padY != null) {
      height = Math.round(fontSize * 1.4 + padY * 2);
    } else {
      height = 36;
    }
  }
  const width = pickWidth(all);
  const hasPaddingX = all.some(
    (c) => /^px-/.test(c) || /^pl-/.test(c) || /^pr-/.test(c) || /^p-/.test(c),
  );
  const iconOnly = !!(width && width === height && !hasPaddingX);
  return {
    height,
    paddingX: pickPaddingX(all) ?? (iconOnly ? 0 : 16),
    fontSize,
    fontWeight: pickFontWeight(all) ?? 500,
    radius: pickRadius(all) ?? 6,
    iconOnly,
    iconSize: 16,
  };
}

function pickPaddingY(classes) {
  for (const c of classes) {
    const m = c.match(/^py-(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(parseFloat(m[1]) * 4);
  }
  for (const c of classes) {
    const m = c.match(/^p-(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(parseFloat(m[1]) * 4);
  }
  return null;
}

function splitClasses(s) {
  if (!s) return [];
  return s.split(/\s+/).filter(Boolean);
}

// --- backgrounds -----------------------------------------------------

function pickBg(classes) {
  for (const c of classes) {
    if (c.includes(":")) continue;
    const m = c.match(/^bg-(.+)$/);
    if (!m) continue;
    if (m[1] === "transparent") return null;
    const hex = resolveColour(m[1]);
    if (hex) return hex;
  }
  return null;
}
function pickHoverBg(classes) {
  for (const c of classes) {
    const m = c.match(/^hover:bg-(.+)$/);
    if (!m) continue;
    if (m[1] === "transparent") return null;
    const hex = resolveColour(m[1]);
    if (hex) return hex;
  }
  return null;
}
function pickActiveBg(classes) {
  for (const c of classes) {
    const m = c.match(/^active:bg-(.+)$/);
    if (!m) continue;
    if (m[1] === "transparent") return null;
    const hex = resolveColour(m[1]);
    if (hex) return hex;
  }
  return null;
}

// --- borders ---------------------------------------------------------

function pickBorder(classes) {
  // `border-transparent` is shadcn's idiom for "no border" on coloured
  // pills (Badge default/secondary/destructive). It must clear the
  // default `border` from the base classes — return null definitively
  // and don't fall through to the input-colour default.
  if (classes.includes("border-transparent")) return null;
  // Last colour wins (variant overrides base).
  let last = null;
  for (const c of classes) {
    if (c.includes(":")) continue;
    const m = c.match(/^border-([a-zA-Z0-9_-]+(?:\/\d+)?|\[#[0-9a-fA-F]+\])$/);
    if (!m) continue;
    if (/^\d+$/.test(m[1])) continue; // border-2 etc. is width, not colour
    const hex = resolveColour(m[1]);
    if (hex) last = hex;
  }
  if (last) return last;
  if (classes.includes("border") || classes.some((c) => /^border-\d+$/.test(c))) {
    return THEME.input;
  }
  return null;
}

// --- text colour -----------------------------------------------------

function pickText(classes) {
  for (const c of classes) {
    if (c.includes(":")) continue;
    const m = c.match(/^text-(.+)$/);
    if (!m) continue;
    // Skip text-size classes.
    if (/^(xs|sm|base|lg|xl|\dxl)$/.test(m[1])) continue;
    if (/^(left|center|right|justify)$/.test(m[1])) continue;
    const hex = resolveColour(m[1]);
    if (hex) return hex;
  }
  return THEME.foreground;
}

// --- height / width / padding ----------------------------------------

function pickHeight(classes) {
  for (const c of classes) {
    let m = c.match(/^h-(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(parseFloat(m[1]) * 4);
    m = c.match(/^size-(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(parseFloat(m[1]) * 4);
    m = c.match(/^h-\[(\d+)px\]$/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function pickWidth(classes) {
  for (const c of classes) {
    let m = c.match(/^w-(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(parseFloat(m[1]) * 4);
    m = c.match(/^size-(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(parseFloat(m[1]) * 4);
  }
  return null;
}

function pickPaddingX(classes) {
  for (const c of classes) {
    const m = c.match(/^px-(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(parseFloat(m[1]) * 4);
  }
  for (const c of classes) {
    const m = c.match(/^p-(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(parseFloat(m[1]) * 4);
  }
  return null;
}

// --- typography ------------------------------------------------------

function pickFontSize(classes) {
  // Last text-size wins (shadcn often layers `text-base md:text-sm`).
  let last = null;
  for (const c of classes) {
    if (c.includes(":")) continue; // skip responsive prefixes
    if (c === "text-xs") last = 12;
    else if (c === "text-sm") last = 14;
    else if (c === "text-base") last = 16;
    else if (c === "text-lg") last = 18;
    else if (c === "text-xl") last = 20;
    else if (c === "text-2xl") last = 24;
  }
  return last;
}

function pickFontWeight(classes) {
  for (const c of classes) {
    if (c === "font-normal") return 400;
    if (c === "font-medium") return 500;
    if (c === "font-semibold") return 600;
    if (c === "font-bold") return 700;
  }
  return null;
}

// --- radius ----------------------------------------------------------

function pickRadius(classes) {
  // Last rounded class wins (variant can override base).
  let last = null;
  for (const c of classes) {
    if (c.includes(":")) continue;
    if (c === "rounded-none") last = 0;
    else if (c === "rounded-sm") last = 2;
    else if (c === "rounded") last = 4;
    else if (c === "rounded-md") last = 6;
    else if (c === "rounded-lg") last = 8;
    else if (c === "rounded-xl") last = 12;
    else if (c === "rounded-2xl") last = 16;
    else if (c === "rounded-3xl") last = 24;
    else if (c === "rounded-full") last = 999;
    else {
      const m = c.match(/^rounded-\[(\d+)px\]$/);
      if (m) last = parseInt(m[1], 10);
    }
  }
  return last;
}

// --- colour resolver --------------------------------------------------

// Resolve a Tailwind colour token (`primary`, `primary-foreground`,
// `primary/90`, `[#16a34a]`, `slate-200`, …) to a concrete hex.
// Returns null when we can't decide.
function resolveColour(name) {
  if (!name) return null;
  // Arbitrary value: bg-[#xxx]
  const arb = name.match(/^\[#([0-9a-fA-F]{3,8})\]$/);
  if (arb) return "#" + arb[1];
  // Strip alpha modifier (primary/90).
  const [base, alphaStr] = name.split("/");
  let hex = THEME[base] || resolveTailwindNamed(base);
  if (!hex) return null;
  if (alphaStr) {
    const a = parseInt(alphaStr, 10) / 100;
    if (Number.isFinite(a)) hex = blendOnWhite(hex, a);
  }
  return hex;
}

// Tiny Tailwind-named palette resolver — just the slate / red / blue
// rows we actually see in shadcn defaults. Add more as needed.
const TAILWIND_PALETTE = {
  white: "#ffffff",
  black: "#000000",
  "slate-50": "#f8fafc",
  "slate-100": "#f1f5f9",
  "slate-200": "#e2e8f0",
  "slate-300": "#cbd5e1",
  "slate-400": "#94a3b8",
  "slate-500": "#64748b",
  "slate-700": "#334155",
  "slate-900": "#0f172a",
  "zinc-100": "#f4f4f5",
  "zinc-200": "#e4e4e7",
  "zinc-500": "#71717a",
  "zinc-900": "#18181b",
  "red-500": "#ef4444",
  "red-600": "#dc2626",
  "red-700": "#b91c1c",
  "blue-500": "#3b82f6",
  "blue-600": "#2563eb",
  "green-600": "#16a34a",
};
function resolveTailwindNamed(name) {
  return TAILWIND_PALETTE[name] || null;
}

// `bg-primary/90` = primary at 90% alpha layered over white. We
// approximate by linearly blending hex toward white, which matches
// shadcn's visual intent on light backgrounds.
function blendOnWhite(hex, alpha) {
  const m = /^#?([\da-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const nr = Math.round(r * alpha + 255 * (1 - alpha));
  const ng = Math.round(g * alpha + 255 * (1 - alpha));
  const nb = Math.round(b * alpha + 255 * (1 - alpha));
  return (
    "#" +
    [nr, ng, nb].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}

// Exported for testing.
export const __test = {
  extractCvaBlock,
  parseFlatStringObject,
  resolveColour,
  pickHeight,
  pickRadius,
};
