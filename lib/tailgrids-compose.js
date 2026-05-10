// Compose a renderable preview from a TailGrids registry source +
// preview source pair.
//
// Pipeline:
//   1. Parse cva spec from the registry .tsx (lib/tailgrids-cva.js)
//   2. Strip imports + function wrapper from the preview .tsx, leaving
//      just the JSX expression
//   3. Walk the JSX text, replacing every `<ComponentName ... />` (or
//      open/close pair) with a resolved `<htmlTag className="...">...
//      </htmlTag>`. The class string is composed by running the cva
//      interpreter against the props extracted from the JSX call.
//   4. Run the theme resolver over the final string so any remaining
//      theme-class references (e.g. on layout `<div>`s in the
//      preview's wrapper) get rewritten to arbitrary values
//   5. Wrap the result in a self-contained HTML document for the
//      iframe — Tailwind play CDN handles the arbitrary values.
//
// What this currently handles
// ---------------------------
//   - Single cva-based component per file
//   - Preview files with a single default export
//   - Component tags with string-literal or boolean (`{true}/{false}`)
//     props
//   - Text children, or simple nested HTML children
//
// Edge cases not yet supported (Phase 2B):
//   - Polymorphic / `asChild` slot components
//   - Multiple cva-styled components used in one preview
//   - Preview imports of non-cva primitives (icons, etc.)

import { parseCvaFromSource, applyCva } from "./tailgrids-cva.js";
import { resolveClassNames } from "./tailgrids-theme.js";

// Component imports inside preview files always come from the
// registry. We accept both default imports (`import Alert from
// "@/registry/core/alert"`) and named imports (`import { Button }
// from "@/registry/core/button"`). For multi-export files (Card and
// its CardHeader/CardTitle/...) we return the first import name since
// the composer rewrites all capitalised tags it finds, not just the
// detected one.
export function detectComponentImport(previewSource) {
  const named =
    /import\s*\{\s*([A-Za-z_$][\w$]*)/g;
  const def = /import\s+([A-Za-z_$][\w$]*)\s+from\s*["']@\/registry\/core\/([^"']+)["']/;

  // Try default-import first since it's unambiguous.
  const dm = def.exec(previewSource);
  if (dm) return { tag: dm[1], slug: dm[2] };

  // Otherwise scan named imports — pick the first that comes from the
  // registry. The same line may import multiple symbols, but for
  // single-cva components there's only one.
  const blockRe = /import\s*\{([^}]+)\}\s*from\s*["']@\/registry\/core\/([^"']+)["']/g;
  let m;
  while ((m = blockRe.exec(previewSource))) {
    const symbols = m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);
    if (symbols.length > 0) {
      return { tag: symbols[0], slug: m[2] };
    }
  }
  return null;
}

// Extract just the JSX expression returned from the preview's default
// export. We look for `return (` and capture up to the matching close
// paren. Robust enough for the simple structure TailGrids ships;
// brittle if a preview file ever grows complex JS logic.
export function extractPreviewJsx(source) {
  const idx = source.indexOf("return (");
  if (idx < 0) return null;
  const start = idx + "return (".length;
  let depth = 1;
  let i = start;
  let inString = null;
  while (i < source.length) {
    const ch = source[i];
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i++;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(start, i).trim();
    }
    i++;
  }
  return null;
}

// Parse the attributes on a JSX tag. Input is the raw attribute string
// between `<TagName` and the closing `>` or `/>`. Returns
// `{ props, restAttrs }` where `props` are the typed cva props and
// `restAttrs` are everything else (className overrides, type, etc.)
// to preserve on the rewritten tag.
//
// Supported value forms:
//   - `prop="literal"` / `prop='literal'`
//   - `prop={literal}` for booleans / numbers
//   - `prop` (boolean shorthand → true)
export function parseJsxAttrs(attrStr, knownPropNames) {
  const props = {};
  const restAttrs = [];
  let i = 0;
  while (i < attrStr.length) {
    while (i < attrStr.length && /\s/.test(attrStr[i])) i++;
    if (i >= attrStr.length) break;
    // Read attr name.
    let nameEnd = i;
    while (
      nameEnd < attrStr.length &&
      /[A-Za-z0-9_:-]/.test(attrStr[nameEnd])
    ) {
      nameEnd++;
    }
    const name = attrStr.slice(i, nameEnd);
    if (!name) {
      i++;
      continue;
    }
    let next = nameEnd;
    while (next < attrStr.length && /\s/.test(attrStr[next])) next++;
    if (attrStr[next] !== "=") {
      // Boolean shorthand.
      if (knownPropNames.has(name)) {
        props[name] = true;
      } else {
        restAttrs.push({ name, raw: name, value: true });
      }
      i = next;
      continue;
    }
    // Past the `=` — read the value.
    let v = next + 1;
    while (v < attrStr.length && /\s/.test(attrStr[v])) v++;
    let valueRaw;
    let valueParsed;
    if (attrStr[v] === '"' || attrStr[v] === "'") {
      const q = attrStr[v];
      const close = attrStr.indexOf(q, v + 1);
      if (close < 0) break;
      valueRaw = attrStr.slice(v, close + 1);
      valueParsed = attrStr.slice(v + 1, close);
      i = close + 1;
    } else if (attrStr[v] === "{") {
      // Brace expression. We support literal forms only.
      let depth = 1;
      let j = v + 1;
      while (j < attrStr.length && depth > 0) {
        if (attrStr[j] === "{") depth++;
        else if (attrStr[j] === "}") depth--;
        j++;
      }
      valueRaw = attrStr.slice(v, j);
      const inner = attrStr.slice(v + 1, j - 1).trim();
      if (inner === "true") valueParsed = true;
      else if (inner === "false") valueParsed = false;
      else if (/^-?\d+(\.\d+)?$/.test(inner)) valueParsed = Number(inner);
      else if (/^["'].*["']$/.test(inner))
        valueParsed = inner.slice(1, -1);
      else valueParsed = inner; // expression — keep as string
      i = j;
    } else {
      // Bare value — uncommon in JSX but tolerate.
      let j = v;
      while (j < attrStr.length && !/[\s/>]/.test(attrStr[j])) j++;
      valueRaw = attrStr.slice(v, j);
      valueParsed = valueRaw;
      i = j;
    }
    if (knownPropNames.has(name)) {
      props[name] = valueParsed;
    } else {
      restAttrs.push({ name, raw: `${name}=${valueRaw}`, value: valueParsed });
    }
  }
  return { props, restAttrs };
}

// Rewrite every `<Tag ...>` and `<Tag ... />` in the JSX source, where
// Tag matches the registered component name. Each call's props are
// extracted, run through the cva interpreter, and the tag is replaced
// with `<htmlTag className="...">{children}</htmlTag>`.
//
// `htmlTag` defaults to "button" since that's what the Button
// component renders. Future components may need a different mapping
// — we read it from the registry source in `detectHtmlTag` below.
export function rewriteComponentTags({
  jsx,
  componentTag,
  cvaSpec,
  htmlTag,
  themeMap,
}) {
  const propNames = new Set(Object.keys(cvaSpec.variants));
  // Walk forward looking for `<componentTag` boundaries. Manual scan
  // because regex with balanced children is fragile.
  let out = "";
  let i = 0;
  while (i < jsx.length) {
    if (
      jsx[i] === "<" &&
      jsx.slice(i + 1, i + 1 + componentTag.length) === componentTag &&
      /[\s/>]/.test(jsx[i + 1 + componentTag.length] ?? "")
    ) {
      // Found an opening tag for our component.
      const openStart = i;
      // Find end of attribute span: `>` or `/>` not inside a brace.
      let j = i + 1 + componentTag.length;
      let braceDepth = 0;
      let inString = null;
      while (j < jsx.length) {
        const ch = jsx[j];
        if (inString) {
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === inString) inString = null;
          j++;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inString = ch;
          j++;
          continue;
        }
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        if (braceDepth === 0 && (ch === ">" || (ch === "/" && jsx[j + 1] === ">"))) {
          break;
        }
        j++;
      }
      const isSelfClose = jsx[j] === "/" && jsx[j + 1] === ">";
      const attrEnd = j;
      const attrSpan = jsx
        .slice(i + 1 + componentTag.length, attrEnd)
        .trim();
      const tagEnd = isSelfClose ? attrEnd + 2 : attrEnd + 1;

      const { props, restAttrs } = parseJsxAttrs(attrSpan, propNames);

      // Children: from tagEnd up to matching `</componentTag>`. Skip
      // for self-closed tags.
      let children = "";
      let consumedTo = tagEnd;
      if (!isSelfClose) {
        const closeTag = `</${componentTag}>`;
        const closeIdx = jsx.indexOf(closeTag, tagEnd);
        if (closeIdx < 0) {
          // Malformed — bail and keep original.
          out += jsx.slice(i, i + 1);
          i += 1;
          continue;
        }
        children = jsx.slice(tagEnd, closeIdx);
        consumedTo = closeIdx + closeTag.length;
      }

      // Compose className from cva.
      const composed = applyCva(cvaSpec, props);
      const resolved = resolveClassNames(composed, themeMap);

      // Build the rewritten tag. Preserve restAttrs verbatim.
      const restStr = restAttrs.length
        ? " " + restAttrs.map((a) => a.raw).join(" ")
        : "";
      // If the rest attrs include a `className`, we let it merge with
      // ours by appending — same as cva's default behaviour.
      const userClassName = restAttrs.find(
        (a) => a.name === "className" || a.name === "class",
      );
      const finalClass = userClassName
        ? `${resolved} ${userClassName.value}`
        : resolved;
      // Drop the user className from restStr since it's folded in.
      const filteredRest = restAttrs
        .filter((a) => a.name !== "className" && a.name !== "class")
        .map((a) => a.raw)
        .join(" ");
      const filteredRestStr = filteredRest ? " " + filteredRest : "";

      const opener = `<${htmlTag} className="${finalClass}"${filteredRestStr}`;
      out += isSelfClose
        ? `${opener} />`
        : `${opener}>${children}</${htmlTag}>`;
      i = consumedTo;
      continue;
    }
    out += jsx[i];
    i++;
  }
  return out;
}

// Sniff the rendered HTML tag from the registry source. We look for
// the first JSX element returned by the exported component function
// — `<button ...>`, `<div ...>`, `<input ...>`, etc. Falls back to
// "div" when the source isn't obvious.
export function detectHtmlTag(registrySource) {
  // Match the `return ( <tagName ... ` pattern inside the component
  // body. The opening tag is lowercase by JSX convention for HTML
  // primitives.
  const m = /return\s*\(\s*<([a-z][\w-]*)\b/.exec(registrySource);
  return m?.[1] ?? "div";
}

// When a TailGrids primitive wraps a react-aria-components root
// (Label wraps AriaLabel, etc.) the root tag we detect isn't an HTML
// element. This map tells us what HTML the third-party component
// actually renders so we can keep going. Limited to what TailGrids
// actually uses today.
const ARIA_COMPONENT_TAGS = {
  AriaLabel: "label",
  AriaButton: "button",
  AriaInput: "input",
  AriaText: "span",
  AriaHeading: "h2",
};

// Parse every `export function Name(...) { return <tag ... /> }` in a
// registry source and return a primitive map:
//
//   {
//     Name: {
//       htmlTag: "div",
//       baseClasses: "...",      // first cn(...) string arg, or empty
//       hasChildren: true,        // whether the JSX has children to
//                                 // pass through
//     },
//     ...
//   }
//
// Components whose root element is a non-HTML React component
// (Spinner's `<svg>` is fine, but Label's `<AriaLabel>` isn't) get
// flagged with `htmlTag: null` so the composer can skip them.
//
// This is a regex-based parser — it accepts the simple, idiomatic
// shapes TailGrids actually uses. Anything fancier (conditional
// returns, multiple JSX children at the root, JSX expressions inside
// the className arg) gets a null `baseClasses` and bails out.
export function parsePrimitiveExports(registrySource) {
  const out = {};

  // Pattern A: `export function Name(...) { ... }` — the canonical
  // primitive shape.
  // Pattern B: `const Name = React.forwardRef<...>((..., ref) => (...))`
  //            or `const Name = forwardRef(...)` — used by components
  //            that need ref forwarding.
  // We collect candidate {name, bodyStart, bodyEnd} from both and
  // process them uniformly. `bodyStart` is the offset of the first
  // brace of the function body; `bodyEnd` is one past its matching
  // closing brace. For arrow-function bodies (no braces) we just
  // bound to the closing paren of the forwardRef call — `body`
  // includes the JSX expression, which is all our regex matchers
  // need.
  const candidates = [];

  // Pattern A: export function
  const fnRe = /export\s+function\s+([A-Z][\w$]*)\s*\(/g;
  let fm;
  while ((fm = fnRe.exec(registrySource))) {
    candidates.push({ name: fm[1], from: fnRe.lastIndex, kind: "fn" });
  }

  // Pattern B: const Name = (React.)?forwardRef
  const fwdRe =
    /(?:const|let|var)\s+([A-Z][\w$]*)\s*=\s*(?:React\.)?forwardRef\b[^(]*\(/g;
  let fw;
  while ((fw = fwdRe.exec(registrySource))) {
    candidates.push({ name: fw[1], from: fwdRe.lastIndex, kind: "fwd" });
  }

  for (const cand of candidates) {
    const { name, from, kind } = cand;
    // Walk forward past the opening paren until we find either the
    // function body brace (Pattern A) or the JSX return (Pattern B).
    let i = from;
    let parenDepth = 1;
    let inString = null;
    let body = "";
    while (i < registrySource.length && parenDepth > 0) {
      const ch = registrySource[i];
      if (inString) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === inString) inString = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        i++;
        continue;
      }
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
      if (parenDepth === 0) break;
      i++;
    }
    // For Pattern A, the next non-whitespace after the param close
    // paren (and optional `:` return type) is the body `{`.
    if (kind === "fn") {
      let j = i + 1;
      while (j < registrySource.length && registrySource[j] !== "{") j++;
      if (registrySource[j] !== "{") continue;
      let depth = 1;
      let k = j + 1;
      let inS = null;
      while (k < registrySource.length && depth > 0) {
        const c = registrySource[k];
        if (inS) {
          if (c === "\\") { k += 2; continue; }
          if (c === inS) inS = null;
          k++;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          inS = c;
          k++;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        k++;
      }
      body = registrySource.slice(j + 1, k - 1);
    } else {
      // Pattern B: the body is whatever's inside the forwardRef
      // parens — the arrow function with its return expression.
      // Start at the original `from` (just past the opening paren)
      // and read up to the matching close at offset i.
      body = registrySource.slice(from, i);
    }

    // Find the first JSX return. Both `return ( <tag ` and the
    // paren-less `return <tag ` are common in TailGrids — accept
    // either by making the opening paren optional. Match dotted
    // names too (e.g. `RootContext.Provider`) so we can detect
    // transparent wrappers.
    const tagMatch =
      /return\s*\(?\s*<([A-Za-z][\w.-]*)([\s/>])/.exec(body);
    if (!tagMatch) continue;
    const rawTag = tagMatch[1];
    const isHtml = /^[a-z]/.test(rawTag);
    // Transparent wrappers: React Context Providers and Fragments
    // render no DOM, so we represent them as a "fragment" primitive —
    // the rewriter renders the children but no wrapping tag.
    const isFragment =
      rawTag === "Fragment" ||
      rawTag.endsWith(".Provider") ||
      rawTag.endsWith(".Consumer");
    // Capitalised tag at the root = the component returns another
    // React component. If we recognise it (react-aria-components
    // wrappers), substitute the HTML element it renders to. Otherwise
    // we can't render statically and bail.
    let htmlTag = null;
    if (isHtml) htmlTag = rawTag;
    else if (isFragment) htmlTag = "FRAGMENT";
    else if (ARIA_COMPONENT_TAGS[rawTag]) htmlTag = ARIA_COMPONENT_TAGS[rawTag];

    // Extract the className string. Two common shapes:
    //   className={cn("CLASSES", className, ...)}
    //   className="CLASSES"
    //   className={"CLASSES"}
    let baseClasses = "";
    const cnMatch = /className\s*=\s*\{?\s*cn\s*\(\s*["'`]([\s\S]*?)["'`]/.exec(body);
    if (cnMatch) {
      baseClasses = cnMatch[1].replace(/\s+/g, " ").trim();
    } else {
      const directMatch = /className\s*=\s*["'`]([^"'`]*)["'`]/.exec(body);
      if (directMatch) baseClasses = directMatch[1];
    }

    out[name] = {
      htmlTag,
      baseClasses,
      hasChildren: /\{\s*children\s*\}/.test(body),
    };
  }
  return out;
}

// Resolve every className attribute in a JSX/HTML string against the
// theme map. This catches classes outside our component tags (layout
// divs, headings) so the surrounding context paints correctly too.
export function resolveAllClassNames(jsx, themeMap) {
  return jsx.replace(
    /(className|class)=("([^"]*)"|'([^']*)')/g,
    (_, attr, _quoted, dq, sq) => {
      const value = dq != null ? dq : sq;
      const resolved = resolveClassNames(value, themeMap);
      return `${attr}="${resolved}"`;
    },
  );
}

// Wrap composed JSX in a self-contained HTML document for the
// preview iframe. Tailwind play CDN handles arbitrary-value classes
// at runtime; the stage centers the component on a clean background.
export function buildPreviewHtml(jsx) {
  // Convert JSX-only attributes back to HTML for the iframe's HTML
  // parser. The Figma plugin gets the JSX form unchanged.
  const html = jsx
    .replace(/className=/g, "class=")
    .replace(/htmlFor=/g, "for=")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "<script src=\"https://cdn.tailwindcss.com\"></script>",
    "<style>",
    "  html, body { margin: 0; padding: 0; background: #f8fafc; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }",
    "  .stage { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 32px 24px; box-sizing: border-box; }",
    "  .stage > * { max-width: 100%; }",
    "</style>",
    "</head>",
    "<body>",
    "  <div class=\"stage\">",
    html,
    "  </div>",
    "</body>",
    "</html>",
  ].join("\n");
}

// Heuristic gate: when does the composed output actually paint
// faithfully in the iframe / Figma plugin?
//
// Bail if we see signals that the preview depends on things the
// static composer can't reproduce:
//   - JSX child expressions used as attribute values (`icon={<Foo/>}`)
//     — slot props, can't be statically inlined
//   - Capitalised tags left over after rewriting — those are React
//     components we don't have a primitive mapping for (icons,
//     compound children)
//   - Attribute names the cva spec doesn't know about that aren't
//     standard HTML — strongly suggests the parent component
//     consumes them as content / config props
//
// Returning null here forces the fetcher to fall back to the
// source-only view, which is correct: better to show no preview than
// a broken one.
function isCompositionFaithful(jsx) {
  // Slot-style JSX expression in an attribute value — always a bad
  // sign for static rendering.
  if (/=\{\s*</.test(jsx)) {
    if (process.env.TG_DEBUG) console.log("[safety] slot expression");
    return false;
  }
  // Leftover capitalised tags (e.g. `<Link1AngularRight />`,
  // `<CheckCircle1 />`) — these are React components, not HTML.
  // Match `<Capital...` but allow `<!--`, `</`, `<svg` (lowercase).
  if (/<[A-Z][\w]*[\s/>]/.test(jsx)) {
    if (process.env.TG_DEBUG) {
      const m = /<[A-Z][\w]*[\s/>]/.exec(jsx);
      console.log("[safety] leftover capitalised tag:", m?.[0]);
    }
    return false;
  }
  return true;
}

// Detect every component import in a preview source. Returns an
// array of `{ tag: "Button", slug: "button" }` records — one per
// distinct registry imported. Picks up both default imports
// (`import Foo from "@/registry/core/foo"`) and named imports
// (`import { Card, CardHeader } from "@/registry/core/card"`).
//
// Used by the composer to know which registries to fetch. For a
// preview that uses Input + Label, this returns two entries; we
// pull both sources and build a merged component map.
export function detectAllComponentImports(previewSource) {
  const records = [];
  const defaultRe = /import\s+([A-Za-z_$][\w$]*)\s+from\s*["']@\/registry\/core\/([^"']+)["']/g;
  let m;
  while ((m = defaultRe.exec(previewSource))) {
    records.push({ tag: m[1], slug: m[2] });
  }
  const namedRe = /import\s*\{([^}]+)\}\s*from\s*["']@\/registry\/core\/([^"']+)["']/g;
  while ((m = namedRe.exec(previewSource))) {
    const slug = m[2];
    const symbols = m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);
    for (const sym of symbols) records.push({ tag: sym, slug });
  }
  return records;
}

// Build a unified component map from a set of registry sources. Each
// source contributes either:
//   - a cva spec (single primary export) — keyed by the corresponding
//     import name from the preview
//   - one or more primitive exports — keyed by their actual exported
//     function names (Card, CardHeader, ...)
//
// The returned map:
//   { tagName: { kind: "cva" | "primitive", htmlTag, ...rest } }
//
// `kind: "cva"` entries carry the full `cvaSpec`. `kind: "primitive"`
// entries carry `baseClasses` only.
export function buildComponentMap({ sources, imports }) {
  const map = {};
  for (const slug of Object.keys(sources)) {
    const src = sources[slug];
    // First: try cva. If the file has a `cva(...)` call we treat the
    // first one as the primary export's variant spec. Imports that
    // reference this slug map to the cva-based component.
    const cvaSpec = parseCvaFromSource(src);
    if (cvaSpec) {
      const importsForSlug = imports.filter((i) => i.slug === slug);
      for (const imp of importsForSlug) {
        // Heuristic: the *first* import name from a cva slug is
        // assumed to be the cva-based component. Sibling imports
        // from the same slug fall through to the primitive parser.
        if (map[imp.tag]) continue;
        map[imp.tag] = {
          kind: "cva",
          cvaSpec,
          htmlTag: detectHtmlTag(src),
        };
        break;
      }
    }
    // Then: pick up every primitive export from the same file. These
    // cover compound components (Card family) and simple primitives
    // (Skeleton, Progress).
    const primitives = parsePrimitiveExports(src);
    for (const [name, prim] of Object.entries(primitives)) {
      if (map[name]) continue;
      if (!prim.htmlTag) continue; // skip non-HTML roots (AriaLabel, Button-wrapping primitives)
      map[name] = {
        kind: "primitive",
        htmlTag: prim.htmlTag,
        baseClasses: prim.baseClasses,
      };
    }
  }
  return map;
}

// Exposed for tests / debug — same impl as the private walker below.
export function _debugRewrite(args) {
  return rewriteAllComponentTags(args);
}

// Generic rewriter that walks the JSX once, replacing every
// capitalised tag in `componentMap` with its resolved HTML form.
// Handles open/close pairs and self-closing tags, preserves children
// (which are walked recursively via the same string), and merges any
// user-supplied className with the component's base/composed classes.
function rewriteAllComponentTags({ jsx, componentMap, themeMap }) {
  let out = "";
  let i = 0;
  while (i < jsx.length) {
    if (jsx[i] === "<" && /[A-Z]/.test(jsx[i + 1] ?? "")) {
      // Read the tag name.
      let nameEnd = i + 1;
      while (
        nameEnd < jsx.length &&
        /[A-Za-z0-9_$]/.test(jsx[nameEnd])
      ) {
        nameEnd++;
      }
      const tagName = jsx.slice(i + 1, nameEnd);
      const entry = componentMap[tagName];
      if (!entry) {
        // Unknown component — pass through unchanged (the safety net
        // will catch this later and fall back to source-only).
        out += jsx[i];
        i++;
        continue;
      }

      // Find end of attribute span.
      let j = nameEnd;
      let braceDepth = 0;
      let inString = null;
      while (j < jsx.length) {
        const ch = jsx[j];
        if (inString) {
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === inString) inString = null;
          j++;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inString = ch;
          j++;
          continue;
        }
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        if (
          braceDepth === 0 &&
          (ch === ">" || (ch === "/" && jsx[j + 1] === ">"))
        ) {
          break;
        }
        j++;
      }
      const isSelfClose = jsx[j] === "/" && jsx[j + 1] === ">";
      const attrEnd = j;
      const attrSpan = jsx.slice(nameEnd, attrEnd).trim();
      const tagEnd = isSelfClose ? attrEnd + 2 : attrEnd + 1;

      const propNames =
        entry.kind === "cva"
          ? new Set(Object.keys(entry.cvaSpec.variants))
          : new Set();
      const { props, restAttrs } = parseJsxAttrs(attrSpan, propNames);

      // Compose className for this tag.
      let composed = "";
      if (entry.kind === "cva") {
        composed = applyCva(entry.cvaSpec, props);
      } else {
        composed = entry.baseClasses ?? "";
      }
      const resolved = resolveClassNames(composed, themeMap);

      // Merge user className (from restAttrs) with our composed one.
      const userClassName = restAttrs.find(
        (a) => a.name === "className" || a.name === "class",
      );
      const finalClass = userClassName
        ? `${resolved} ${userClassName.value}`.trim()
        : resolved;
      const filteredRest = restAttrs
        .filter((a) => a.name !== "className" && a.name !== "class")
        .map((a) => a.raw)
        .join(" ");
      const restStr = filteredRest ? " " + filteredRest : "";

      // Children: capture and recurse so nested capitalised tags get
      // rewritten too. Skip when self-closed.
      let children = "";
      let consumedTo = tagEnd;
      if (!isSelfClose) {
        const closeTag = `</${tagName}>`;
        const closeIdx = jsx.indexOf(closeTag, tagEnd);
        if (closeIdx < 0) {
          // Unbalanced — pass through.
          out += jsx[i];
          i++;
          continue;
        }
        const rawChildren = jsx.slice(tagEnd, closeIdx);
        children = rewriteAllComponentTags({
          jsx: rawChildren,
          componentMap,
          themeMap,
        });
        consumedTo = closeIdx + closeTag.length;
      }

      if (entry.htmlTag === "FRAGMENT") {
        // Transparent wrapper — emit only the children. Self-closed
        // fragments are a no-op.
        out += isSelfClose ? "" : children;
      } else {
        const opener = `<${entry.htmlTag} className="${finalClass}"${restStr}`;
        out += isSelfClose
          ? `${opener} />`
          : `${opener}>${children}</${entry.htmlTag}>`;
      }
      i = consumedTo;
      continue;
    }
    out += jsx[i];
    i++;
  }
  return out;
}

// Compose a full preview given the raw registry source, preview
// source, and theme map. Phase 2B: accepts a `siblingSources` map of
// additional registries the preview imports from, so we can resolve
// compound components (Card family) and sibling components (Input +
// Label). Returns { jsx, html } when the result is faithful;
// null otherwise (the fetcher then surfaces source-only).
export function composePreview({
  registrySource,
  previewSource,
  themeMap,
  siblingSources = {},
  primarySlug,
}) {
  const innerJsx = extractPreviewJsx(previewSource);
  if (!innerJsx) return null;

  const imports = detectAllComponentImports(previewSource);
  if (imports.length === 0) return null;

  // The primary slug is the registry the agent was invoked for — the
  // caller (fetcher) knows it. Fall back to the first import's slug
  // when not provided, but that's lossy: a Card preview imports
  // Button first, and assuming imports[0] would shadow the real Card
  // source with the Button source.
  const slug = primarySlug ?? imports[0]?.slug;
  const sources = { ...siblingSources };
  if (slug) sources[slug] = registrySource;

  const componentMap = buildComponentMap({ sources, imports });
  if (Object.keys(componentMap).length === 0) return null;

  const rewritten = rewriteAllComponentTags({
    jsx: innerJsx,
    componentMap,
    themeMap,
  });
  const finalJsx = resolveAllClassNames(rewritten, themeMap);
  if (!isCompositionFaithful(finalJsx)) return null;
  return {
    jsx: finalJsx,
    html: buildPreviewHtml(finalJsx),
  };
}
