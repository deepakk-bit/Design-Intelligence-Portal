// TailGrids theme: fetches the upstream `themes/light.css`, parses out
// every `--theme-*` CSS variable into a name → value map, and exposes
// a class-resolver that rewrites Tailwind utilities referencing those
// theme tokens into arbitrary-value form.
//
// Why this matters
// ----------------
// TailGrids' components reference custom Tailwind colour names like
// `bg-button-primary-background` and `text-title-50`. Those classes
// only resolve because their `global.css` defines matching CSS
// variables (e.g. `--color-button-primary-background`) which in turn
// reference theme variables (`--theme-button-primary-background:
// #3758f9`). Outside their app — in our preview iframe, in the Figma
// React (Tailwind) to Design plugin — those variables don't exist and
// the classes paint as nothing. Resolving them to arbitrary values
// (`bg-[#3758f9]`) makes the same markup self-contained.
//
// Source URL:
//   https://raw.githubusercontent.com/tailgrids/tailgrids/main/apps/docs/src/app/themes/light.css

const THEME_URL =
  "https://raw.githubusercontent.com/tailgrids/tailgrids/main/apps/docs/src/app/themes/light.css";

// 24h cache. The theme rarely changes — we don't want to refetch on
// every render. Stored as a single { value, expiresAt } slot since
// there's only one theme.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let themeCache = null;

// Tailwind utility prefixes that take a colour as their argument. The
// resolver walks each class, strips any modifier prefixes (hover:,
// focus:, disabled:, dark:, md:, [&>svg]:, ...), and if the bare class
// starts with one of these prefixes followed by a name we know in the
// theme map, rewrites the colour part to its arbitrary-value form.
const COLOUR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "outline",
  "from",
  "via",
  "to",
  "placeholder",
  "fill",
  "stroke",
  "divide",
  "shadow",
  "accent",
  "caret",
];

export async function fetchTailgridsTheme(timeoutMs = 5000) {
  if (themeCache && themeCache.expiresAt > Date.now()) {
    return themeCache.value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(THEME_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(
        `theme fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    const css = await res.text();
    const map = parseThemeCss(css);
    themeCache = {
      value: map,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return map;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error(`theme fetch timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

// Parse `--theme-foo-bar: #hex;` declarations into a flat
// `{ "foo-bar": "#hex" }` map. We pick up every `--theme-*` line in
// the file regardless of which selector it lives under — TailGrids
// only ships one light theme so there's no ambiguity.
export function parseThemeCss(css) {
  const map = {};
  const re = /--theme-([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(css))) {
    const name = m[1].trim();
    const value = m[2].trim();
    map[name] = value;
  }
  return map;
}

// Resolve a single Tailwind class against the theme map. Returns the
// rewritten class if the colour part matches a theme entry, otherwise
// returns the original class untouched. Modifier prefixes (hover:,
// focus:, disabled:, [&>svg]:, etc.) are preserved — we only mutate
// the colour value.
export function resolveOneClass(cls, themeMap) {
  // Match: optional prefixes (any number of pseudo:, [..]:, etc.)
  // followed by the bare utility.
  const m = cls.match(/^((?:[^:]+:)+)?(.*)$/);
  const prefix = m?.[1] ?? "";
  const bare = m?.[2] ?? cls;

  // Try every colour prefix. We stop at the first match so e.g.
  // `bg-foo` doesn't get matched as `border-foo`.
  for (const pfx of COLOUR_PREFIXES) {
    if (bare.startsWith(`${pfx}-`)) {
      const value = bare.slice(pfx.length + 1);
      // Strip alpha slash modifier (e.g. `bg-foo/50`) — the alpha is
      // preserved on output but not part of the theme lookup.
      const slashIdx = value.indexOf("/");
      const name = slashIdx >= 0 ? value.slice(0, slashIdx) : value;
      const alpha = slashIdx >= 0 ? value.slice(slashIdx) : "";
      if (themeMap[name]) {
        const hex = themeMap[name];
        // Arbitrary values can't contain spaces — encode as
        // underscores. Tailwind decodes them back at compile time.
        const encoded = hex.replace(/\s+/g, "_");
        return `${prefix}${pfx}-[${encoded}]${alpha}`;
      }
    }
  }
  return cls;
}

// Resolve every class in a className string. Whitespace-separated.
export function resolveClassNames(classStr, themeMap) {
  if (!classStr) return classStr;
  return classStr
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => resolveOneClass(c, themeMap))
    .join(" ");
}

// Test-only: reset the cache. Used by tests; safe to call in prod.
export function _resetThemeCache() {
  themeCache = null;
}
