// Special-case renderer for Alert.
//
// Alert is a multi-cva primitive (wrapper / icon / title / message /
// close button / action button — each a separate cva spec composed
// inside Alert's render function). The general composer in
// tailgrids-compose.js only handles single-cva primitives, so Alert
// previously fell back to source-only and didn't render anything in
// the iframe.
//
// This module:
//   1. Reads the upstream preview .tsx files (which call
//      `<Alert variant="..." title="..." message="..." icon={...} />`)
//   2. For each call, looks up the resolved alert-{variant}-* theme
//      tokens and emits the full Alert markup as a plain HTML string
//      using arbitrary-value Tailwind classes — the same kind the
//      Tailwind play CDN inside the iframe can paint
//   3. Returns one combined HTML doc, plus a JSX form for the Copy
//      payload that preserves the upstream `<Alert>` API calls
//
// Variants supported: success, danger, warning, info, gray (default)
// — every variant shipped by TailGrids' alert primitive. Anything
// else falls back to a neutral gray treatment so the renderer
// degrades gracefully rather than throwing.

const VARIANT_KEYS = ["success", "danger", "warning", "info", "gray"];

// Map the preview's variant name to the theme key prefix. TailGrids
// uses "gray" in props but `alert-default-*` in tokens, so we
// translate.
const VARIANT_TO_TOKEN = {
  success: "success",
  danger: "danger",
  warning: "warning",
  info: "info",
  gray: "default",
};

function tokens(themeMap, variant) {
  const key = VARIANT_TO_TOKEN[variant] ?? "default";
  return {
    border: themeMap[`alert-${key}-border`] ?? "#e5e7eb",
    bg: themeMap[`alert-${key}-background`] ?? "#f9fafb",
    iconBg: themeMap[`alert-${key}-icon-background`] ?? "#6b7280",
    title: themeMap[`alert-${key}-title`] ?? "#1f2937",
    description: themeMap[`alert-${key}-description`] ?? "#4b5563",
    closeIcon: themeMap[`alert-${key}-close-icon`] ?? "#6b7280",
    btnBg: themeMap[`alert-${key}-button-background`] ?? "#6b7280",
    btnHoverBg: themeMap[`alert-${key}-button-hover-background`] ?? "#4b5563",
  };
}

// Inline SVGs for the icon-name placeholders the preview imports
// (CheckCircle1, Xmark2x, InfoTriangle, InfoCircle, etc.). We don't
// try to fetch the actual @tailgrids/icons SVGs — a small
// hand-crafted set covers every variant the previews use.
const ICONS = {
  CheckCircle1: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  Xmark2x: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  InfoTriangle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  InfoCircle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

const CLOSE_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

// Parse a single Alert JSX call into a props object.
// Accepts: <Alert variant="success" title="..." message="..." icon={<CheckCircle1 />} />
// and the actions={{ primary: {...}, secondary: {...} }} variant.
function parseAlertCall(jsxFragment) {
  const props = {};
  // String attributes
  for (const key of ["variant", "title", "message"]) {
    const m = new RegExp(`${key}=("([^"]*)"|'([^']*)')`).exec(jsxFragment);
    if (m) props[key] = m[2] ?? m[3];
  }
  // Icon expression: icon={<IconName />} — capture the icon name
  const iconMatch = /icon=\{\s*<([A-Za-z0-9_$]+)/.exec(jsxFragment);
  if (iconMatch) props.iconName = iconMatch[1];
  // Actions block: look for `actions={{ primary: { label: "...", ... }, secondary: { label: "..." } }}`
  const actionsMatch = /actions=\{\{([\s\S]*?)\}\}/.exec(jsxFragment);
  if (actionsMatch) {
    const inner = actionsMatch[1];
    const primary = /primary\s*:\s*\{\s*label:\s*["']([^"']+)["']/.exec(inner);
    const secondary = /secondary\s*:\s*\{\s*label:\s*["']([^"']+)["']/.exec(inner);
    props.actions = {
      primary: primary ? { label: primary[1] } : null,
      secondary: secondary ? { label: secondary[1] } : null,
    };
  }
  return props;
}

// Find every `<Alert ... />` (self-closing) in the preview source.
function findAlertCalls(source) {
  // Match <Alert ... />, allowing newlines and nested braces in
  // attribute values. The outer regex looks for the literal tag plus
  // any chars (lazy) up to a `/>`.
  const re = /<Alert\b([\s\S]*?)\/>/g;
  const out = [];
  let m;
  while ((m = re.exec(source))) {
    out.push({ raw: m[0], inner: m[1] });
  }
  return out;
}

// Build the HTML for one Alert based on its parsed props.
function renderAlertHtml(props, themeMap) {
  const variant = VARIANT_KEYS.includes(props.variant) ? props.variant : "gray";
  const t = tokens(themeMap, variant);
  const icon = props.iconName && ICONS[props.iconName]
    ? ICONS[props.iconName]
    : ICONS.InfoCircle;
  const hasTitle = !!props.title;
  const hasActions = props.actions && (props.actions.primary || props.actions.secondary);
  const titleHtml = hasTitle
    ? `<h4 class="font-semibold text-[${t.title}]">${escape(props.title)}</h4>`
    : "";
  const messageClass = hasTitle ? "col-span-full" : "font-medium";
  const actionsHtml = hasActions
    ? `<div class="mt-5 flex gap-3">${
        props.actions.primary
          ? `<button class="rounded-md px-4 py-2 text-sm font-medium text-white bg-[${t.btnBg}] hover:bg-[${t.btnHoverBg}]">${escape(props.actions.primary.label)}</button>`
          : ""
      }${
        props.actions.secondary
          ? `<button class="rounded-md px-4 py-2 text-sm font-medium border border-[${t.border}] text-[${t.title}]">${escape(props.actions.secondary.label)}</button>`
          : ""
      }</div>`
    : "";
  return `<div class="relative w-full max-w-4xl rounded-lg border px-5 py-4 border-[${t.border}] bg-[${t.bg}]">
  <button class="absolute top-3 right-3 flex items-center justify-center p-1 text-[${t.closeIcon}]" aria-label="Close">${CLOSE_ICON_SVG}</button>
  <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3.5">
    <div class="flex w-7 h-7 items-center justify-center rounded-lg text-white bg-[${t.iconBg}]">${icon}</div>
    ${titleHtml}
    <p class="text-sm ${messageClass} text-[${t.description}]">${escape(props.message ?? "")}</p>
  </div>
  ${actionsHtml}
</div>`;
}

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Render every Alert in every preview file into one stacked HTML
// document. Sections are labelled with the preview file's
// human-readable label (Default · Variants · With Actions · …) so
// the rendered iframe mirrors tailgrids.com's docs page layout.
export function renderAlertSections(previewFiles, themeMap) {
  const sections = [];
  for (const f of previewFiles) {
    const calls = findAlertCalls(f.source);
    if (calls.length === 0) continue;
    const alertsHtml = calls
      .map((c) => renderAlertHtml(parseAlertCall(c.inner), themeMap))
      .join("\n");
    sections.push({
      label: f.label,
      html: `<div class="flex flex-col gap-6 w-full">${alertsHtml}</div>`,
    });
  }
  return sections;
}

export function buildAlertStackedHtml(sections) {
  const bodyChunks = sections.map(
    (s) => `<section class="section">
      <header class="section-label">${escape(s.label)}</header>
      <div class="stage">${s.html}</div>
    </section>`,
  );
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<script src=\"https://cdn.tailwindcss.com\"></script>",
    "<style>",
    "  html, body { margin: 0; padding: 0; background: #f8fafc; font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; }",
    "  .section { border-bottom: 1px solid #e2e8f0; padding: 20px 32px 28px; }",
    "  .section:last-of-type { border-bottom: 0; }",
    "  .section-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 14px; }",
    "  .stage { display: flex; flex-direction: column; gap: 16px; }",
    "</style>",
    "</head>",
    "<body>",
    bodyChunks.join("\n"),
    "</body>",
    "</html>",
  ].join("\n");
}
