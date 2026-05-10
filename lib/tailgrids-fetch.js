// TailGrids component pipeline.
//
// Input  : a component id (e.g. "primary-button")
// Output : { id, name, category, html, jsx, themeMap }
//
// Pipeline stages:
//
//   1. Look up the raw HTML in tailgrids-components.js
//   2. Resolve TailGrids-specific theme classes (bg-primary, text-dark,
//      text-body-color, ...) into arbitrary-value equivalents
//      (bg-[#3056D3], text-[#111928], ...) so the HTML renders correctly
//      outside TailGrids' Tailwind config — both in our preview iframe
//      (no tailwind.config.js available) and in the Figma React (Tailwind)
//      to Design plugin (also no config). This mirrors the approach we
//      use for any other Tailwind preset library.
//   3. Convert HTML → JSX: rewrite attribute names, self-close void
//      elements, transform inline `style=""` strings into JSX style
//      objects, normalise SVG attributes.
//
// The output `html` is what we render in the OutputNode preview iframe
// (so designers see the resolved-colour, ready-to-paint markup). The
// `jsx` is what the Copy button puts on the clipboard.

import {
  getTailgridsComponent,
  listTailgridsComponents,
} from "./tailgrids-components.js";

// TailGrids' default theme, lifted from their tailwind.config.js. These
// are the custom class names they use on top of stock Tailwind. Any
// class on this list gets rewritten to its arbitrary-value form so the
// output renders the same in any Tailwind context.
//
// Source: https://github.com/tailgrids/tailgrids — colors in
// tailwind.config.js under `theme.extend.colors`.
const TAILGRIDS_COLOURS = {
  primary: "#3056D3",
  secondary: "#13C296",
  dark: "#111928",
  "dark-2": "#1F2A37",
  "dark-3": "#374151",
  "dark-4": "#4B5563",
  "dark-5": "#6B7280",
  "dark-6": "#9CA3AF",
  "dark-7": "#D1D5DB",
  "dark-8": "#E5E7EB",
  "body-color": "#637381",
  "blue-dark": "#1B44C8",
  "blue-light": "#5B73E8",
  stroke: "#E7E7E7",
  "stroke-dark": "#34495E",
  "gray-1": "#F9FAFB",
  "gray-2": "#F4F7FF",
  "gray-3": "#F2F5FF",
  "gray-4": "#EFF0F6",
  "gray-5": "#E4E7EC",
  "gray-6": "#DFE4EA",
  "gray-7": "#637381",
  white: "#FFFFFF",
  black: "#000000",
};

// Tailwind property prefixes that take a colour. We rewrite each one
// when its argument matches a custom theme name. e.g. "bg-primary" →
// "bg-[#3056D3]". The full list is small because TailGrids only uses
// these utilities — we don't need to cover every Tailwind colour prop.
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

// Shadow utilities that TailGrids defines on top of Tailwind. Resolved
// to arbitrary-value box-shadow expressions so they render the same
// without their config. Add more here as we encounter them.
const TAILGRIDS_SHADOWS = {
  card: "0px 1px 3px rgba(0, 0, 0, 0.08)",
  "card-2": "0px 4px 8px rgba(0, 0, 0, 0.06)",
  testimonial: "0px 10px 20px rgba(92, 115, 160, 0.07)",
};

// Resolve every class on an element. Each class is checked against:
//   1. A direct shadow lookup (shadow-card → shadow-[...]) which we
//      handle first because shadow names overlap with colour names.
//   2. A colour-prefix rewrite (bg-primary → bg-[#3056D3]). Catches
//      both bare prefixes (bg-primary) and pseudo prefixes
//      (hover:bg-primary, md:text-dark, focus:border-primary).
//   3. Anything else is left untouched.
function resolveClasses(classStr) {
  const parts = String(classStr || "")
    .split(/\s+/)
    .filter(Boolean);
  return parts
    .map((cls) => {
      // Strip leading pseudo/modifier prefixes (hover:, md:, dark:,
      // focus-visible:, etc.) so the colour matcher can look at the
      // bare utility. Multiple prefixes are common (e.g.
      // "md:hover:bg-primary") — we preserve all of them on output.
      const m = cls.match(/^((?:[a-z0-9-]+:)+)?(.*)$/);
      const prefix = m?.[1] || "";
      const bare = m?.[2] || "";

      // Shadow lookup. Tailwind's arbitrary-value parser uses spaces as
      // class separators, so we encode the box-shadow expression with
      // underscores — Tailwind decodes them back to spaces when it
      // generates the CSS. Same convention as `bg-[length:200%_100%]`.
      if (bare.startsWith("shadow-")) {
        const key = bare.slice("shadow-".length);
        if (TAILGRIDS_SHADOWS[key]) {
          const encoded = TAILGRIDS_SHADOWS[key].replace(/\s+/g, "_");
          return `${prefix}shadow-[${encoded}]`;
        }
      }

      // Colour-prefix rewrite. Match e.g. "bg-primary" or "border-stroke".
      for (const pfx of COLOUR_PREFIXES) {
        if (bare.startsWith(`${pfx}-`)) {
          const value = bare.slice(pfx.length + 1);
          // Strip alpha slash if present (bg-primary/80 → keep the /80).
          const slashIdx = value.indexOf("/");
          const name = slashIdx >= 0 ? value.slice(0, slashIdx) : value;
          const alpha = slashIdx >= 0 ? value.slice(slashIdx) : "";
          if (TAILGRIDS_COLOURS[name]) {
            return `${prefix}${pfx}-[${TAILGRIDS_COLOURS[name]}]${alpha}`;
          }
        }
      }

      return cls;
    })
    .join(" ");
}

// Rewrite every `class="..."` attribute in the source by running its
// value through the resolver. We don't parse HTML — this is a robust
// regex pass that handles the markup TailGrids actually publishes
// (no malformed quotes, no attributes split across lines).
function rewriteClasses(html) {
  return html.replace(
    /\bclass=("([^"]*)"|'([^']*)')/g,
    (_, _quoted, dq, sq) => {
      const value = dq != null ? dq : sq;
      const resolved = resolveClasses(value);
      return `class="${resolved}"`;
    },
  );
}

// Void HTML elements that JSX requires to be self-closing.
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// HTML attribute names that change case in JSX. The list covers what
// TailGrids actually uses — extend as new components come in.
const ATTR_MAP = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  spellcheck: "spellCheck",
  contenteditable: "contentEditable",
  crossorigin: "crossOrigin",
  enctype: "encType",
  formaction: "formAction",
  formenctype: "formEncType",
  formmethod: "formMethod",
  formnovalidate: "formNoValidate",
  formtarget: "formTarget",
  usemap: "useMap",
  // SVG
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "text-anchor": "textAnchor",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "xlink:href": "xlinkHref",
};

// Parse a CSS-style declaration string ("color: red; padding: 8px") into
// a JSX object literal ({ color: "red", padding: "8px" }). Keys are
// camelCased; values are kept as strings except for numeric pixel-less
// numbers — React happily accepts string values everywhere, so we keep
// it simple and quote everything.
function styleStringToJsxObject(styleStr) {
  const decls = String(styleStr || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const parts = [];
  for (const decl of decls) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    const camel = prop
      .replace(/^-ms-/, "ms-")
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    parts.push(`${JSON.stringify(camel)}: ${JSON.stringify(value)}`);
  }
  return `{${parts.join(", ")}}`;
}

// HTML → JSX. Operates on already-class-resolved HTML so the output is
// valid JSX with no library-specific class names left over.
function htmlToJsx(html) {
  let out = String(html || "");

  // Strip HTML comments. We could convert them to {/* */} but that
  // complicates the regex and TailGrids doesn't use them inside their
  // components — only as section banners we'd rather drop anyway.
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Rewrite attribute names. We process attributes one at a time so we
  // don't risk matching content inside strings. The match pattern is
  // permissive — any non-space, non-equals, non-> chars before `=`.
  out = out.replace(/(\s)([a-zA-Z][a-zA-Z0-9:-]*)=/g, (_, sp, name) => {
    const lower = name.toLowerCase();
    const mapped = ATTR_MAP[lower];
    if (mapped) return `${sp}${mapped}=`;
    // Pass through any attribute we don't recognise. JSX accepts
    // standard HTML attributes (id, href, src, alt, role, aria-*, etc.)
    // without rewriting. aria-* and data-* are kept as-is.
    return `${sp}${name}=`;
  });

  // Inline style="..." → style={{ ... }}.
  out = out.replace(/style=("([^"]*)"|'([^']*)')/g, (_, _q, dq, sq) => {
    const value = dq != null ? dq : sq;
    return `style={${styleStringToJsxObject(value)}}`;
  });

  // Self-close void elements. Match `<TAG ...>` where TAG is a void
  // element and the tag isn't already self-closed. The regex is greedy
  // up to the next `>` that's not inside an attribute value — JSX
  // tolerates an extra space before /> so we keep this simple.
  out = out.replace(/<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (m, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!VOID_ELEMENTS.has(lower)) return m;
    if (attrs.trim().endsWith("/")) return m; // already self-closed
    return `<${tag}${attrs} />`;
  });

  return out.trim();
}

export function fetchTailgridsComponent(id) {
  const comp = getTailgridsComponent(id);
  if (!comp) return null;
  const resolvedHtml = rewriteClasses(comp.html);
  const jsx = htmlToJsx(resolvedHtml);
  return {
    id: comp.id,
    name: comp.name,
    category: comp.category,
    // Both html and jsx use only standard or arbitrary-value Tailwind
    // classes, so they render identically without TailGrids' config.
    html: resolvedHtml,
    jsx,
  };
}

export { listTailgridsComponents };
