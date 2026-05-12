// Renders the React+Tailwind Component Generator's structured output
// into the shape the canvas needs: per-section HTML for the iframe
// preview, plus a single combined .jsx payload for the copy button.
//
// The generator is constrained by its system prompt to emit static
// JSX — no hooks, no .map(), no imports beyond `export default
// function`. That lets us do a cheap regex-based JSX→HTML conversion
// here instead of pulling in Babel.

const RAW_HTML_TAGS = new Set(["script", "style"]);

// Strip the `export default function Foo() { return ( ... ); }` wrapper
// and return just the JSX inside `return (...)`. Falls back to the
// trimmed input if the wrapper isn't there (defensive — the model is
// instructed to emit the wrapper, but follow-up turns occasionally
// regress).
function extractReturnBody(jsx) {
  const src = String(jsx ?? "").trim();
  if (!src) return "";
  const returnMatch = src.match(/return\s*\(/);
  if (!returnMatch) {
    // No return( wrapper. Either the model emitted a fragment directly,
    // or returned a one-line `return <div .../>;`. Try the one-liner
    // first.
    const oneLiner = src.match(/return\s+([\s\S]+?);?\s*}/);
    if (oneLiner) return oneLiner[1].trim();
    return src;
  }
  const start = returnMatch.index + returnMatch[0].length;
  // Walk parens to find the matching closing one. Inside JSX, parens
  // only appear in expressions like className={`x ${y}`}, which the
  // model is told to avoid — but we walk anyway so legitimate
  // attribute expressions don't trip us up.
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0) break;
    i++;
  }
  return src.slice(start, i).trim();
}

// Convert the JSX body into something a browser can render. The model
// is constrained to a small subset — static attributes, no
// expressions, no children expressions — so the conversion is mostly
// renaming a few JSX-specific attributes.
function jsxToHtml(jsxBody) {
  let html = jsxBody;

  // className → class. Self-closing void elements (img, br, hr, input,
  // etc.) get rewritten by the browser's parser, so we don't need to
  // touch them. JSX boolean attributes (e.g. `disabled`) are already
  // valid HTML when serialized.
  html = html.replace(/\bclassName=/g, "class=");
  html = html.replace(/\bhtmlFor=/g, "for=");

  // JSX style={{ foo: 'bar' }} — generator is told to avoid inline
  // styles, but if one slips through, strip it rather than rendering
  // [object Object]. (Lossy on purpose: the spec says use Tailwind
  // utilities.)
  html = html.replace(/\bstyle=\{\{[^}]*\}\}/g, "");

  // Replace JSX-style attribute expressions that wrap a single string
  // literal: `href={"https://..."}` → `href="https://..."`. Anything
  // more complex (template literals, identifiers) gets stripped to
  // avoid producing `[object Object]` in the rendered HTML.
  html = html.replace(
    /=\{(['"])((?:\\.|(?!\1).)*)\1\}/g,
    (_, _q, val) => `="${val.replace(/"/g, "&quot;")}"`,
  );
  html = html.replace(/=\{[^}]*\}/g, "");

  // {/* JSX comments */} → drop. They never render in real React
  // either, so this matches expected behavior.
  html = html.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  // Curly braces around a static string in children, e.g. `>{"Foo"}<`
  // → `>Foo<`. Same defensiveness as above.
  html = html.replace(/\{(['"])((?:\\.|(?!\1).)*)\1\}/g, (_, _q, val) => val);

  return html;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Wrap a single section's JSX into a self-contained HTML doc with the
// Tailwind play CDN loaded, so the preview iframe paints accurately.
// Mirrors the structure of lib/tailgrids-alert-render.js so the canvas
// renders both kinds of preview consistently.
export function buildPreviewHtml(jsx) {
  const body = jsxToHtml(extractReturnBody(jsx));
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<script src="https://cdn.tailwindcss.com"></script>',
    "<style>",
    "  html, body { margin: 0; padding: 24px; background: #f8fafc; font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; }",
    "  body { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 48px); }",
    "</style>",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

// Build a single self-contained .jsx payload for the Copy button.
// The first section is exported as the canonical component; additional
// states are appended as commented-out blocks so the file stays a
// single valid default export while letting the user uncomment any
// state for closer inspection.
export function assembleCombinedFile({ componentName, description, sections }) {
  const name = String(componentName || "Component").trim() || "Component";
  const safeDescription = String(description || "").trim();
  const first = sections?.[0];
  if (!first?.jsx) return "";

  const header = [
    "// Generated by React+Tailwind Component Generator.",
    "// Paste into the \"React (Tailwind) to Design\" Figma plugin.",
    `// Component: ${name}`,
    ...(safeDescription
      ? safeDescription
          .split(/\r?\n/)
          .map((line) => `// ${line.trim()}`)
      : []),
  ].join("\n");

  const rest = sections.slice(1).map((s) => {
    const label = String(s.label || "Variant").trim();
    const block = String(s.jsx || "")
      .split(/\r?\n/)
      .map((line) => `// ${line}`)
      .join("\n");
    return `// — ${label} state — uncomment to inspect this state individually.\n${block}`;
  });

  return [header, first.jsx.trim(), ...rest].join("\n\n");
}

// Take the raw schema-shaped result from the model and produce the
// canvas-shaped payload the OutputNode renders. Wraps everything under
// `jsxGen` so AgentNode can detect the result type from a single field.
export function postProcessJsxGenResult(parsed) {
  const componentName = String(parsed?.componentName || "Component").trim();
  const description = String(parsed?.description || "").trim();
  const incoming = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const sections = incoming
    .filter((s) => s && typeof s.jsx === "string" && s.jsx.trim())
    .map((s) => ({
      label: String(s.label || "Default").trim() || "Default",
      jsx: s.jsx.trim(),
      html: buildPreviewHtml(s.jsx),
    }));
  const combinedJsx = assembleCombinedFile({
    componentName,
    description,
    sections,
  });
  return {
    jsxGen: {
      componentName,
      description,
      sections,
      combinedJsx,
    },
  };
}

// Reverse of postProcessJsxGenResult for chat continuations. Strips
// the canvas-derived fields (`html`, `combinedJsx`) so the model sees
// its previous output in the schema shape it knows how to update.
export function unwrapJsxGenForChat(initialResult) {
  const g = initialResult?.jsxGen;
  if (!g) return initialResult;
  return {
    componentName: g.componentName,
    description: g.description,
    sections: (g.sections || []).map((s) => ({
      label: s.label,
      jsx: s.jsx,
    })),
  };
}
