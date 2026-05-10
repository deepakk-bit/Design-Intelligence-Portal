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

// Compose a full preview given the raw registry + preview sources and
// a theme map. Returns { jsx, html } or null if any stage fails.
export function composePreview({ registrySource, previewSource, themeMap }) {
  const cvaSpec = parseCvaFromSource(registrySource);
  if (!cvaSpec) return null;
  const importInfo = detectComponentImport(previewSource);
  if (!importInfo) return null;
  const htmlTag = detectHtmlTag(registrySource);
  const innerJsx = extractPreviewJsx(previewSource);
  if (!innerJsx) return null;

  const rewritten = rewriteComponentTags({
    jsx: innerJsx,
    componentTag: importInfo.tag,
    cvaSpec,
    htmlTag,
    themeMap,
  });
  const finalJsx = resolveAllClassNames(rewritten, themeMap);
  return {
    jsx: finalJsx,
    html: buildPreviewHtml(finalJsx),
  };
}
