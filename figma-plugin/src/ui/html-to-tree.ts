// HTML → serializable node tree. Runs in the UI iframe, loads the saved
// design's HTML into a hidden offscreen iframe, walks the rendered DOM,
// and produces a JSON-safe tree the sandbox can turn into figma.* nodes.
//
// The agent's system prompt already restricts what JSX makes it here:
//   - Only named Tailwind utilities (no arbitrary CSS-in-JS)
//   - No hooks / state / loops
//   - Inline <svg>, no icon libraries
//   - Real <img> URLs only
// So we can stick to computed styles + a small set of tag→node mappings.

export type FigmaRGB = { r: number; g: number; b: number };
export type FigmaRGBA = { r: number; g: number; b: number; a: number };

// SolidPaint matches Figma's actual contract: color is RGB (no alpha)
// and transparency lives in a separate opacity field. Earlier versions
// packed alpha into color.a and Figma's `set_fills` rejected the paint
// with "Unrecognized key 'a' at [0].color" before any children could
// render.
export type FigmaSolidFill = {
  type: "SOLID";
  color: FigmaRGB;
  opacity: number;
};

// Effect shadows use RGBA because Figma's DropShadowEffect.color *does*
// include alpha. Keep both shapes distinct so they can't be confused.
export type Effect = {
  type: "DROP_SHADOW";
  color: FigmaRGBA;
  offset: { x: number; y: number };
  radius: number;
  spread: number;
};

export interface FrameNodeSpec {
  kind: "frame";
  x: number;
  y: number;
  w: number;
  h: number;
  fills: FigmaSolidFill[];
  strokes: FigmaSolidFill[];
  strokeWeight: number;
  cornerRadii: [number, number, number, number]; // tl, tr, br, bl
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL";
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  itemSpacing: number;
  effects: Effect[];
  clipsContent: boolean;
  children: NodeSpec[];
  name: string;
}

export interface TextNodeSpec {
  kind: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  characters: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number | null;
  letterSpacing: number;
  textAlign: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  fills: FigmaSolidFill[];
}

export interface VectorNodeSpec {
  kind: "vector";
  x: number;
  y: number;
  w: number;
  h: number;
  svg: string;
}

export interface ImageNodeSpec {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  cornerRadii: [number, number, number, number];
}

export type NodeSpec =
  | FrameNodeSpec
  | TextNodeSpec
  | VectorNodeSpec
  | ImageNodeSpec;

export type Warning = string;

// Public entry: load `html` in a hidden iframe, walk the body, produce a
// tree rooted at a frame matching the body's used bounding box.
export async function htmlToTree(html: string): Promise<{
  root: FrameNodeSpec;
  warnings: Warning[];
}> {
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;left:-99999px;top:0;width:800px;height:1200px;border:0;visibility:hidden;";
  // We need a same-origin iframe so getComputedStyle works. Using srcDoc
  // gives us an about:srcdoc origin which the parent can read.
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
    });
    // Tailwind's CDN injects styles asynchronously after load. A two-frame
    // wait + a 250ms grace period is enough on every preview we've tested.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 250));

    const doc = iframe.contentDocument!;
    const body = doc.body;
    const warnings: Warning[] = [];

    // Use the bounding box of the body's first meaningful child as the
    // root, falling back to the body itself. This avoids a giant page-
    // sized root frame when the design is centered with body padding.
    const rootEl = pickRoot(body);
    const rootBox = rootEl.getBoundingClientRect();

    const root = walkElement(rootEl, rootBox, warnings) as FrameNodeSpec;
    // Snap root to (0,0) — the sandbox positions the whole tree at the
    // viewport center, then children are positioned relative to root.
    shiftToOrigin(root);
    return { root, warnings };
  } finally {
    iframe.remove();
  }
}

function pickRoot(body: HTMLElement): HTMLElement {
  // Skip whitespace text nodes; first element child wins. Designs we
  // generate always have a single outer element (a <div> wrapper).
  for (const child of Array.from(body.children)) {
    if (child instanceof HTMLElement && hasSize(child)) return child;
  }
  return body;
}

function hasSize(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function walkElement(
  el: HTMLElement,
  parentBox: DOMRect,
  warnings: Warning[],
): NodeSpec | null {
  const tag = el.tagName.toLowerCase();
  const box = el.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  const style = getComputedStyle(el);

  // <svg> → vector node, never recurse into children (Figma handles
  // SVG parsing internally via createNodeFromSvg).
  if (tag === "svg") {
    return {
      kind: "vector",
      x: box.left - parentBox.left,
      y: box.top - parentBox.top,
      w: box.width,
      h: box.height,
      svg: el.outerHTML,
    };
  }

  // <img> → image-filled rectangle. Skip if no src.
  if (tag === "img") {
    const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
    if (!src) return null;
    return {
      kind: "image",
      x: box.left - parentBox.left,
      y: box.top - parentBox.top,
      w: box.width,
      h: box.height,
      url: src,
      cornerRadii: readRadii(style),
    };
  }

  // Element with no element children and visible text → text node.
  const childElements = Array.from(el.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement,
  );
  const text = el.childNodes.length === 0 ? "" : directText(el);
  const isText = childElements.length === 0 && text.length > 0 && isTextTag(tag);
  if (isText) {
    return {
      kind: "text",
      x: box.left - parentBox.left,
      y: box.top - parentBox.top,
      w: box.width,
      h: box.height,
      characters: text,
      fontFamily: pickFontFamily(style.fontFamily, warnings),
      fontWeight: parseInt(style.fontWeight, 10) || 400,
      fontSize: parseFloat(style.fontSize) || 14,
      lineHeight: parseLineHeight(style),
      letterSpacing: parseFloat(style.letterSpacing) || 0,
      textAlign: parseTextAlign(style.textAlign),
      fills: solidFill(style.color),
    };
  }

  // Otherwise → frame. Walk children for non-text and elements that
  // have text *and* element children (e.g. a button with text + icon —
  // we represent the text as a child text node).
  const layoutMode = pickLayoutMode(style);
  const padding = readPadding(style);
  const itemSpacing = parseFloat(style.rowGap || style.columnGap || "0") || 0;
  const children: NodeSpec[] = [];

  // Anonymous direct text (inside a button or div) becomes a text child.
  if (text && isTextTag(tag)) {
    const fakeBox = box; // approximate; the text usually fills the parent
    children.push({
      kind: "text",
      x: padding.left,
      y: padding.top,
      w: Math.max(0, box.width - padding.left - padding.right),
      h: Math.max(0, box.height - padding.top - padding.bottom),
      characters: text,
      fontFamily: pickFontFamily(style.fontFamily, warnings),
      fontWeight: parseInt(style.fontWeight, 10) || 400,
      fontSize: parseFloat(style.fontSize) || 14,
      lineHeight: parseLineHeight(style),
      letterSpacing: parseFloat(style.letterSpacing) || 0,
      textAlign: parseTextAlign(style.textAlign),
      fills: solidFill(style.color),
    } satisfies TextNodeSpec);
    // Silence "fakeBox unused" without the cost of a linter pragma.
    void fakeBox;
  }

  for (const child of childElements) {
    const node = walkElement(child, box, warnings);
    if (node) children.push(node);
  }

  return {
    kind: "frame",
    name: tag,
    x: box.left - parentBox.left,
    y: box.top - parentBox.top,
    w: box.width,
    h: box.height,
    fills: solidFill(style.backgroundColor),
    strokes: borderStroke(style),
    strokeWeight: parseFloat(style.borderTopWidth) || 0,
    cornerRadii: readRadii(style),
    layoutMode,
    paddingTop: padding.top,
    paddingRight: padding.right,
    paddingBottom: padding.bottom,
    paddingLeft: padding.left,
    itemSpacing,
    effects: parseBoxShadow(style.boxShadow, warnings),
    clipsContent: style.overflow === "hidden",
    children,
  };
}

function directText(el: HTMLElement): string {
  let out = "";
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
  }
  return out.replace(/\s+/g, " ").trim();
}

const TEXT_TAGS = new Set([
  "span",
  "p",
  "a",
  "label",
  "small",
  "strong",
  "em",
  "b",
  "i",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "button",
  "div",
]);

function isTextTag(tag: string): boolean {
  return TEXT_TAGS.has(tag);
}

function shiftToOrigin(frame: FrameNodeSpec) {
  const dx = frame.x;
  const dy = frame.y;
  frame.x = 0;
  frame.y = 0;
  // Children are already relative to the parent's box, so no recursion.
  void dx;
  void dy;
}

function solidFill(css: string): FigmaSolidFill[] {
  const c = parseColor(css);
  if (!c || c.a === 0) return [];
  return [
    {
      type: "SOLID",
      color: { r: c.r, g: c.g, b: c.b },
      opacity: c.a,
    },
  ];
}

function parseColor(css: string): FigmaRGBA | null {
  if (!css || css === "none") return null;
  const m =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*(?:[,/]\s*(\d*(?:\.\d+)?)\s*)?\)$/.exec(
      css.trim(),
    );
  if (!m) return null;
  return {
    r: clamp01(Number(m[1]) / 255),
    g: clamp01(Number(m[2]) / 255),
    b: clamp01(Number(m[3]) / 255),
    a: m[4] != null ? clamp01(Number(m[4])) : 1,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function borderStroke(style: CSSStyleDeclaration): FigmaSolidFill[] {
  // Tailwind borders are uniform across the four sides for the utilities
  // we support. Use the top side as the source of truth.
  const w = parseFloat(style.borderTopWidth) || 0;
  if (w <= 0) return [];
  const c = parseColor(style.borderTopColor);
  if (!c || c.a === 0) return [];
  return [
    {
      type: "SOLID",
      color: { r: c.r, g: c.g, b: c.b },
      opacity: c.a,
    },
  ];
}

function readRadii(
  style: CSSStyleDeclaration,
): [number, number, number, number] {
  return [
    parseFloat(style.borderTopLeftRadius) || 0,
    parseFloat(style.borderTopRightRadius) || 0,
    parseFloat(style.borderBottomRightRadius) || 0,
    parseFloat(style.borderBottomLeftRadius) || 0,
  ];
}

function readPadding(style: CSSStyleDeclaration) {
  return {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
}

function pickLayoutMode(
  style: CSSStyleDeclaration,
): "NONE" | "HORIZONTAL" | "VERTICAL" {
  const display = style.display;
  if (!display.includes("flex")) return "NONE";
  return style.flexDirection?.startsWith("col") ? "VERTICAL" : "HORIZONTAL";
}

function parseLineHeight(style: CSSStyleDeclaration): number | null {
  const lh = style.lineHeight;
  if (!lh || lh === "normal") return null;
  const px = parseFloat(lh);
  return Number.isFinite(px) ? px : null;
}

function parseTextAlign(
  align: string,
): "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" {
  if (align === "center") return "CENTER";
  if (align === "right") return "RIGHT";
  if (align === "justify") return "JUSTIFIED";
  return "LEFT";
}

function pickFontFamily(css: string, warnings: Warning[]): string {
  // Computed `font-family` is a comma list of fallbacks. Pick the first
  // and strip quotes. Figma usually has Inter; if the family is
  // anything else, warn so the sandbox can fall back gracefully.
  const first = (css.split(",")[0] || "").trim().replace(/^["']|["']$/g, "");
  const family = first || "Inter";
  if (!/inter|system-ui|ui-sans-serif|sans-serif/i.test(family)) {
    if (!warnings.includes(`font:${family}`)) {
      warnings.push(`font:${family}`);
    }
  }
  return family;
}

function parseBoxShadow(css: string, warnings: Warning[]): Effect[] {
  if (!css || css === "none") return [];
  // Handle a single shadow: `<color> <x> <y> <blur> [spread]`. Tailwind
  // emits this form for shadow-{sm,md,lg,…}. Multi-shadow strings get
  // a warning but produce no effect (Figma supports them via an array
  // of effects, but parsing them robustly is gnarly).
  if (css.split("),").length > 1) {
    warnings.push("multi-shadow");
    return [];
  }
  const m = /^rgba?\([^)]+\)\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px(?:\s+(-?\d+(?:\.\d+)?)px)?/.exec(
    css.trim(),
  );
  if (!m) return [];
  const colorMatch = /^rgba?\([^)]+\)/.exec(css);
  const color = colorMatch ? parseColor(colorMatch[0]) : null;
  if (!color) return [];
  return [
    {
      type: "DROP_SHADOW",
      color,
      offset: { x: Number(m[1]), y: Number(m[2]) },
      radius: Number(m[3]),
      spread: Number(m[4] ?? 0),
    },
  ];
}
