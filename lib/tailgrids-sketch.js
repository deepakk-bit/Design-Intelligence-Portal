// TailGrids → Sketch (.sketch) exporter.
//
// Pipeline:
//   1. parseJsxTree   — convert resolved JSX string into a tree of
//                       { tag, classes, text, children }
//   2. computeStyles  — for each node, parse its Tailwind utility
//                       classes into a typed style object (display,
//                       flex, padding, colors, typography, ...)
//   3. layoutTree     — depth-first flex/block layout pass; assigns
//                       x/y/w/h to every node. Flex containers
//                       expand to fit children; leaf elements
//                       compute intrinsic size from text + padding
//   4. emitSketch     — walk the layout tree, emit Sketch JSON
//                       layer objects (Group, Rectangle, Text,
//                       Symbol Master, Symbol Instance)
//   5. zipSketchFile  — package the document + meta + user + pages
//                       JSON into a valid .sketch ZIP archive
//
// Phase 1 emits Groups + Rectangle + Text layers — fully editable
// in Sketch. Phase 2 promotes repeated TailGrids primitives (Button,
// CardHeader, ...) into Symbol Masters with Smart Layout so resizing
// the master propagates to every instance — Sketch's closest
// equivalent to Figma's Auto Layout.

import JSZip from "jszip";

// ---------------------------------------------------------------------
// Tailwind class parser. Covers the subset of utilities TailGrids'
// composed output actually uses. Anything we don't recognise is
// silently dropped — won't affect rendering since unknown classes
// have no visual effect in Sketch.
// ---------------------------------------------------------------------

const UNIT_PX = 4; // Tailwind 1u = 4px

// Convert a Tailwind size token to pixels. Accepts:
//   "4"        → 16
//   "0.5"      → 2
//   "2.5"      → 10
//   "[12px]"   → 12
//   "[1.5rem]" → 24
//   "px"       → 1   (special "1px" alias)
//   "full"     → null  (caller should treat as 100%)
function parseSize(token) {
  if (token == null) return null;
  if (token === "full" || token === "screen" || token === "auto" || token === "fit") {
    return { kind: token };
  }
  const arb = token.match(/^\[(-?\d*\.?\d+)(px|rem|em|%)?\]$/);
  if (arb) {
    const n = parseFloat(arb[1]);
    const unit = arb[2] || "px";
    if (unit === "rem" || unit === "em") return { kind: "px", value: n * 16 };
    if (unit === "%") return { kind: "pct", value: n };
    return { kind: "px", value: n };
  }
  if (token === "px") return { kind: "px", value: 1 };
  const num = parseFloat(token);
  if (Number.isFinite(num)) return { kind: "px", value: num * UNIT_PX };
  return null;
}

function pxOrNull(size) {
  return size && size.kind === "px" ? size.value : null;
}

// Standard Tailwind font-size scale (text-xs, text-sm, ...). Maps to
// the same px values used by stock Tailwind.
const FONT_SIZE_SCALE = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
  "7xl": 72,
  "8xl": 96,
  "9xl": 128,
};

const FONT_WEIGHT_SCALE = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

// Default rounded-* scale matches Tailwind's defaults.
const RADIUS_SCALE = {
  none: 0,
  sm: 2,
  "": 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24,
  full: 9999,
};

// Parse an arbitrary-value bracket: bg-[#3758f9] → "#3758f9"
function bracketValue(token) {
  const m = token.match(/^\[(.*)\]$/);
  return m ? m[1].replace(/_/g, " ") : null;
}

// Default style values — any field left unset stays here. The layout
// engine reads from this shape, the emitter consumes it directly.
function emptyStyle() {
  return {
    display: "block", // block | inline | inline-block | flex | inline-flex
    flexDirection: "row", // row | column | row-reverse | column-reverse
    alignItems: null, // start | center | end | stretch | baseline
    justifyContent: null, // start | center | end | between | around | evenly
    flexWrap: false,
    gap: 0,
    gapX: null,
    gapY: null,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    width: null, // px or { kind: "full" | "fit" | "auto" | "screen" | "pct" }
    height: null,
    minWidth: null,
    maxWidth: null,
    minHeight: null,
    background: null, // hex string or null
    color: null, // hex string for text
    fontSize: null,
    fontWeight: null,
    lineHeight: null,
    textAlign: null,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: null,
    opacity: 1,
    shadow: null,
  };
}

export function parseClasses(classStr) {
  const style = emptyStyle();
  const tokens = String(classStr || "").split(/\s+/).filter(Boolean);
  for (let raw of tokens) {
    // Strip modifier prefixes (hover:, focus:, md:, lg:, dark:, etc.).
    // Sketch can't render states, so we apply ONLY the base style.
    const prefixed = raw.match(/^([a-z0-9-]+:)+(.+)$/);
    if (prefixed) continue;
    // Important flag at the end (text-current!).
    const cls = raw.replace(/!$/, "");

    // Display
    if (cls === "flex") {
      style.display = "flex";
      continue;
    }
    if (cls === "inline-flex") {
      style.display = "inline-flex";
      continue;
    }
    if (cls === "block") {
      style.display = "block";
      continue;
    }
    if (cls === "inline-block") {
      style.display = "inline-block";
      continue;
    }
    if (cls === "inline") {
      style.display = "inline";
      continue;
    }
    if (cls === "hidden") {
      style.display = "none";
      continue;
    }
    if (cls === "grid" || cls === "inline-grid") {
      // Treat grid like flex-row for layout purposes — close enough
      // for our showcase patterns and saves a separate engine.
      style.display = "flex";
      continue;
    }

    // Flex direction
    if (cls === "flex-row") { style.flexDirection = "row"; continue; }
    if (cls === "flex-col") { style.flexDirection = "column"; continue; }
    if (cls === "flex-row-reverse") { style.flexDirection = "row-reverse"; continue; }
    if (cls === "flex-col-reverse") { style.flexDirection = "column-reverse"; continue; }
    if (cls === "flex-wrap") { style.flexWrap = true; continue; }

    // Alignment
    if (cls.startsWith("items-")) {
      style.alignItems = cls.slice("items-".length);
      continue;
    }
    if (cls.startsWith("justify-")) {
      style.justifyContent = cls.slice("justify-".length);
      continue;
    }

    // Gap
    const gapMatch = cls.match(/^gap(?:-([xy]))?-(.+)$/);
    if (gapMatch) {
      const axis = gapMatch[1];
      const px = pxOrNull(parseSize(gapMatch[2]));
      if (px != null) {
        if (axis === "x") style.gapX = px;
        else if (axis === "y") style.gapY = px;
        else style.gap = px;
      }
      continue;
    }

    // Padding
    const padMatch = cls.match(/^p([xytrbl])?-(.+)$/);
    if (padMatch) {
      const side = padMatch[1];
      const px = pxOrNull(parseSize(padMatch[2]));
      if (px == null) continue;
      switch (side) {
        case undefined:
          style.paddingTop = px;
          style.paddingRight = px;
          style.paddingBottom = px;
          style.paddingLeft = px;
          break;
        case "x":
          style.paddingLeft = px;
          style.paddingRight = px;
          break;
        case "y":
          style.paddingTop = px;
          style.paddingBottom = px;
          break;
        case "t": style.paddingTop = px; break;
        case "r": style.paddingRight = px; break;
        case "b": style.paddingBottom = px; break;
        case "l": style.paddingLeft = px; break;
      }
      continue;
    }

    // Sizing — w-N, h-N, size-N, min-w-N, max-w-N
    const wMatch = cls.match(/^w-(.+)$/);
    if (wMatch) {
      style.width = parseSize(wMatch[1]);
      continue;
    }
    const hMatch = cls.match(/^h-(.+)$/);
    if (hMatch) {
      style.height = parseSize(hMatch[1]);
      continue;
    }
    const sizeMatch = cls.match(/^size-(.+)$/);
    if (sizeMatch) {
      const s = parseSize(sizeMatch[1]);
      style.width = s;
      style.height = s;
      continue;
    }
    const minWMatch = cls.match(/^min-w-(.+)$/);
    if (minWMatch) { style.minWidth = parseSize(minWMatch[1]); continue; }
    const maxWMatch = cls.match(/^max-w-(.+)$/);
    if (maxWMatch) { style.maxWidth = parseSize(maxWMatch[1]); continue; }
    const minHMatch = cls.match(/^min-h-(.+)$/);
    if (minHMatch) { style.minHeight = parseSize(minHMatch[1]); continue; }

    // Colors — bg-[#hex], text-[#hex], border-[#hex]
    if (cls.startsWith("bg-")) {
      const v = bracketValue(cls.slice(3));
      if (v) style.background = normaliseColour(v);
      else if (cls === "bg-transparent") style.background = null;
      else if (cls === "bg-white") style.background = "#ffffff";
      else if (cls === "bg-black") style.background = "#000000";
      continue;
    }
    if (cls.startsWith("text-")) {
      // `text-[#hex]` → color
      const v = bracketValue(cls.slice(5));
      if (v && /^(?:#|rgb)/.test(v)) {
        style.color = normaliseColour(v);
        continue;
      }
      // `text-[14px]` → font-size
      const sizeArb = cls.slice(5).match(/^\[(-?\d*\.?\d+)(px|rem|em)\]$/);
      if (sizeArb) {
        const n = parseFloat(sizeArb[1]);
        const unit = sizeArb[2] || "px";
        style.fontSize = unit === "rem" || unit === "em" ? n * 16 : n;
        continue;
      }
      // `text-xs`, `text-lg`, ...
      const scaleKey = cls.slice(5);
      if (FONT_SIZE_SCALE[scaleKey] != null) {
        style.fontSize = FONT_SIZE_SCALE[scaleKey];
        continue;
      }
      // `text-center`, `text-left`, `text-right`, `text-justify`
      if (["center", "left", "right", "justify"].includes(scaleKey)) {
        style.textAlign = scaleKey;
        continue;
      }
      if (scaleKey === "white") { style.color = "#ffffff"; continue; }
      if (scaleKey === "black") { style.color = "#000000"; continue; }
      continue;
    }
    if (cls.startsWith("border-")) {
      const v = bracketValue(cls.slice(7));
      if (v && /^(?:#|rgb)/.test(v)) {
        style.borderColor = normaliseColour(v);
        if (!style.borderWidth) style.borderWidth = 1;
        continue;
      }
      const w = cls.slice(7).match(/^(\d+)$/);
      if (w) {
        style.borderWidth = parseFloat(w[1]);
        continue;
      }
      continue;
    }
    if (cls === "border") {
      style.borderWidth = style.borderWidth || 1;
      continue;
    }

    // Border radius
    if (cls === "rounded") {
      style.borderRadius = RADIUS_SCALE[""];
      continue;
    }
    const radiusMatch = cls.match(/^rounded-(.+)$/);
    if (radiusMatch) {
      const key = radiusMatch[1];
      const arb = bracketValue(`[${key.replace(/^\[|\]$/g, "")}]`);
      if (key.startsWith("[") && arb) {
        const m = arb.match(/^(-?\d*\.?\d+)(px|rem|em)?$/);
        if (m) {
          const n = parseFloat(m[1]);
          const unit = m[2] || "px";
          style.borderRadius = unit === "rem" || unit === "em" ? n * 16 : n;
        }
      } else if (RADIUS_SCALE[key] != null) {
        style.borderRadius = RADIUS_SCALE[key];
      }
      continue;
    }

    // Font weight
    const weightMatch = cls.match(/^font-(.+)$/);
    if (weightMatch && FONT_WEIGHT_SCALE[weightMatch[1]] != null) {
      style.fontWeight = FONT_WEIGHT_SCALE[weightMatch[1]];
      continue;
    }

    // Line height / tracking — partial support
    const leadingMatch = cls.match(/^leading-(.+)$/);
    if (leadingMatch) {
      const px = pxOrNull(parseSize(leadingMatch[1]));
      if (px != null) style.lineHeight = px;
      else if (leadingMatch[1] === "tight") style.lineHeight = 1.25;
      else if (leadingMatch[1] === "snug") style.lineHeight = 1.375;
      else if (leadingMatch[1] === "normal") style.lineHeight = 1.5;
      else if (leadingMatch[1] === "relaxed") style.lineHeight = 1.625;
      else if (leadingMatch[1] === "loose") style.lineHeight = 2;
      continue;
    }

    // Opacity
    const opacityMatch = cls.match(/^opacity-(\d+)$/);
    if (opacityMatch) {
      style.opacity = parseInt(opacityMatch[1], 10) / 100;
      continue;
    }
  }
  return style;
}

// Normalise a CSS colour value to lower-case hex with #. rgba/rgb
// pass through unchanged — the Sketch emitter handles both.
function normaliseColour(v) {
  if (!v) return null;
  return v.trim().toLowerCase();
}

// ---------------------------------------------------------------------
// JSX → tree. Lightweight parser tuned for our composed-output shape:
// no JS expressions in attribute values, no nested function calls,
// no JSX fragments at the root (we synthesize one).
// ---------------------------------------------------------------------

// Self-closing HTML tags Sketch emission treats as leaf rectangles.
const VOID_TAGS = new Set(["input", "img", "br", "hr", "svg"]);

export function parseJsxTree(jsx) {
  const src = String(jsx || "").trim();
  if (!src) return null;
  const ctx = { src, i: 0 };
  const nodes = [];
  while (ctx.i < src.length) {
    skipWhitespace(ctx);
    if (ctx.i >= src.length) break;
    if (src[ctx.i] === "<") {
      const node = parseElement(ctx);
      if (node) nodes.push(node);
    } else {
      // Text content at root — capture until next tag.
      const text = readTextUntilTag(ctx);
      if (text.trim()) nodes.push({ kind: "text", text: text.trim() });
    }
  }
  if (nodes.length === 1) return nodes[0];
  return { kind: "element", tag: "div", classes: "", children: nodes };
}

function skipWhitespace(ctx) {
  while (ctx.i < ctx.src.length && /\s/.test(ctx.src[ctx.i])) ctx.i++;
}

function readTextUntilTag(ctx) {
  const start = ctx.i;
  while (ctx.i < ctx.src.length && ctx.src[ctx.i] !== "<") ctx.i++;
  return ctx.src.slice(start, ctx.i);
}

function parseElement(ctx) {
  if (ctx.src[ctx.i] !== "<") return null;
  // Comments {/* ... */} get stripped before reaching here, but a
  // raw `<!--` shouldn't appear in JSX — skip if it does.
  if (ctx.src.startsWith("<!--", ctx.i)) {
    const end = ctx.src.indexOf("-->", ctx.i);
    ctx.i = end >= 0 ? end + 3 : ctx.src.length;
    return null;
  }
  // JSX expression / comment shapes that aren't elements.
  if (ctx.src[ctx.i + 1] === "/") {
    ctx.i = ctx.src.indexOf(">", ctx.i) + 1;
    return null;
  }
  // Read tag name.
  let i = ctx.i + 1;
  while (i < ctx.src.length && /[A-Za-z0-9.]/.test(ctx.src[i])) i++;
  const tag = ctx.src.slice(ctx.i + 1, i);
  if (!tag) {
    ctx.i++;
    return null;
  }
  // Read attrs.
  const attrs = {};
  while (i < ctx.src.length) {
    while (i < ctx.src.length && /\s/.test(ctx.src[i])) i++;
    if (ctx.src[i] === "/" || ctx.src[i] === ">") break;
    // Attr name
    const aStart = i;
    while (i < ctx.src.length && /[A-Za-z0-9_-]/.test(ctx.src[i])) i++;
    const name = ctx.src.slice(aStart, i);
    if (!name) {
      i++;
      continue;
    }
    while (i < ctx.src.length && /\s/.test(ctx.src[i])) i++;
    if (ctx.src[i] !== "=") {
      attrs[name] = true;
      continue;
    }
    i++; // past =
    while (i < ctx.src.length && /\s/.test(ctx.src[i])) i++;
    if (ctx.src[i] === '"' || ctx.src[i] === "'") {
      const q = ctx.src[i];
      const vStart = ++i;
      while (i < ctx.src.length && ctx.src[i] !== q) i++;
      attrs[name] = ctx.src.slice(vStart, i);
      i++;
    } else if (ctx.src[i] === "{") {
      // Brace expression — read until matching brace, store the
      // literal inside (we don't evaluate JS).
      let depth = 1;
      const vStart = ++i;
      while (i < ctx.src.length && depth > 0) {
        if (ctx.src[i] === "{") depth++;
        else if (ctx.src[i] === "}") depth--;
        if (depth === 0) break;
        i++;
      }
      attrs[name] = ctx.src.slice(vStart, i);
      i++;
    } else {
      // Bare value — read to whitespace.
      const vStart = i;
      while (i < ctx.src.length && !/[\s/>]/.test(ctx.src[i])) i++;
      attrs[name] = ctx.src.slice(vStart, i);
    }
  }
  const selfClose = ctx.src[i] === "/";
  ctx.i = ctx.src.indexOf(">", i) + 1;

  const isVoid = VOID_TAGS.has(tag.toLowerCase()) || selfClose;
  const node = {
    kind: "element",
    tag,
    classes: attrs.className || attrs.class || "",
    attrs,
    children: [],
  };
  if (isVoid) return node;

  // Read children until </tag>.
  const closeTag = `</${tag}>`;
  while (ctx.i < ctx.src.length) {
    // Skip JSX comments {/* ... */}
    if (ctx.src.startsWith("{/*", ctx.i)) {
      const end = ctx.src.indexOf("*/}", ctx.i);
      ctx.i = end >= 0 ? end + 3 : ctx.src.length;
      continue;
    }
    if (ctx.src.startsWith(closeTag, ctx.i)) {
      ctx.i += closeTag.length;
      break;
    }
    if (ctx.src[ctx.i] === "<") {
      const child = parseElement(ctx);
      if (child) node.children.push(child);
    } else {
      const text = readTextUntilTag(ctx);
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (trimmed) node.children.push({ kind: "text", text: trimmed });
    }
  }
  return node;
}

// ---------------------------------------------------------------------
// Layout engine. Computes width/height for every node based on
// parsed Tailwind styles + intrinsic content sizing for text.
// ---------------------------------------------------------------------

// Rough text width — Tailwind's default font (Inter/system-sans) at
// the medium weight averages roughly 0.55 of font-size per character.
// Good enough for layout calculations; designers will reflow in
// Sketch anyway.
const TEXT_WIDTH_RATIO = 0.55;

function intrinsicText(node, style) {
  const fs = style.fontSize ?? 14;
  const lh = style.lineHeight ?? fs * 1.4;
  const text = collectText(node);
  // For multi-word text we'll let Sketch wrap — width is one-line
  // measurement; height grows during layout if needed.
  const width = Math.ceil(text.length * fs * TEXT_WIDTH_RATIO);
  return { width, height: lh };
}

function collectText(node) {
  if (!node) return "";
  if (node.kind === "text") return node.text;
  if (!node.children) return "";
  return node.children.map(collectText).join(" ").trim();
}

export function layoutTree(node) {
  if (!node) return null;
  layoutNode(node, null);
  return node;
}

function layoutNode(node, parent) {
  if (node.kind === "text") {
    node.style = parent?.style ?? emptyStyle();
    const t = intrinsicText(node, node.style);
    node.width = t.width;
    node.height = t.height;
    return;
  }
  node.style = parseClasses(node.classes);
  if (node.tag === "svg") {
    // Honour explicit width/height attributes from the SVG itself —
    // our icon placeholders set them, and TailGrids' inline SVGs do
    // too. Falls back to 16×16 when nothing's specified.
    const w = parseFloat(node.attrs?.width ?? "16") || 16;
    const h = parseFloat(node.attrs?.height ?? "16") || 16;
    node.width = w;
    node.height = h;
    return;
  }
  // Lay out children first so we know their sizes.
  for (const child of node.children ?? []) layoutNode(child, node);

  const s = node.style;
  // Explicit width/height: take it, else fit children.
  let w = explicitSize(s.width);
  let h = explicitSize(s.height);

  if (s.display === "flex" || s.display === "inline-flex") {
    const axis = s.flexDirection.startsWith("column") ? "y" : "x";
    const gap = axis === "x" ? s.gapX ?? s.gap : s.gapY ?? s.gap;
    const children = (node.children ?? []).filter(
      (c) => c.kind !== "text" || c.text.trim().length > 0,
    );
    const totalGap = Math.max(0, children.length - 1) * (gap || 0);
    if (axis === "x") {
      const childW = children.reduce((acc, c) => acc + (c.width ?? 0), 0);
      const childH = children.reduce(
        (acc, c) => Math.max(acc, c.height ?? 0),
        0,
      );
      if (w == null) w = childW + totalGap + s.paddingLeft + s.paddingRight;
      if (h == null) h = childH + s.paddingTop + s.paddingBottom;
    } else {
      const childH = children.reduce((acc, c) => acc + (c.height ?? 0), 0);
      const childW = children.reduce(
        (acc, c) => Math.max(acc, c.width ?? 0),
        0,
      );
      if (w == null) w = childW + s.paddingLeft + s.paddingRight;
      if (h == null) h = childH + totalGap + s.paddingTop + s.paddingBottom;
    }
    // Position children along the axis.
    let cursor = axis === "x" ? s.paddingLeft : s.paddingTop;
    for (const c of children) {
      if (axis === "x") {
        c.x = cursor;
        c.y = alignCross(s.alignItems, c.height ?? 0, h, s.paddingTop, s.paddingBottom);
        cursor += (c.width ?? 0) + (gap || 0);
      } else {
        c.x = alignCross(s.alignItems, c.width ?? 0, w, s.paddingLeft, s.paddingRight);
        c.y = cursor;
        cursor += (c.height ?? 0) + (gap || 0);
      }
    }
  } else {
    // Block-ish layout: stack children vertically.
    const children = (node.children ?? []).filter(
      (c) => c.kind !== "text" || c.text.trim().length > 0,
    );
    let cursor = s.paddingTop;
    let maxW = 0;
    for (const c of children) {
      c.x = s.paddingLeft;
      c.y = cursor;
      cursor += c.height ?? 0;
      maxW = Math.max(maxW, c.width ?? 0);
    }
    if (w == null) w = maxW + s.paddingLeft + s.paddingRight;
    if (h == null) h = cursor + s.paddingBottom;
  }
  node.width = w;
  node.height = h;
}

function alignCross(align, childSize, parentSize, padStart, padEnd) {
  const inner = parentSize - padStart - padEnd;
  switch (align) {
    case "center":
      return padStart + (inner - childSize) / 2;
    case "end":
      return padStart + (inner - childSize);
    case "stretch":
      return padStart;
    default:
      return padStart;
  }
}

function explicitSize(token) {
  if (!token) return null;
  if (token.kind === "px") return token.value;
  if (token.kind === "full" || token.kind === "screen") return null; // resolved later by parent
  return null;
}

// ---------------------------------------------------------------------
// Sketch JSON emitter. Builds layer objects matching the
// developer.sketch.com file-format spec (version 154+).
// ---------------------------------------------------------------------

let _idCounter = 0;
function nextId() {
  // Sketch uses uppercase UUIDs. Approximate with deterministic
  // counter-based IDs — Sketch tolerates any uppercase UUID-shaped
  // string and our generation never repeats within a file.
  _idCounter += 1;
  const hex = _idCounter.toString(16).toUpperCase().padStart(12, "0");
  return `00000000-0000-0000-0000-${hex}`;
}

function rect(x, y, w, h) {
  return {
    _class: "rect",
    constrainProportions: false,
    height: h,
    width: w,
    x,
    y,
  };
}

// 8-digit hex → RGBA components in 0–1 range. Accepts 3, 4, 6, 8-digit
// hex; rgba(r,g,b,a) and rgb(r,g,b) too.
function colorObject(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (s.startsWith("rgba(") || s.startsWith("rgb(")) {
    const parts = s.replace(/^rgba?\(|\)$/g, "").split(",").map((p) => p.trim());
    const r = parseFloat(parts[0]) / 255;
    const g = parseFloat(parts[1]) / 255;
    const b = parseFloat(parts[2]) / 255;
    const a = parts[3] != null ? parseFloat(parts[3]) : 1;
    return { _class: "color", red: r, green: g, blue: b, alpha: a };
  }
  s = s.replace(/^#/, "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (s.length === 4) s = s.split("").map((c) => c + c).join("");
  if (s.length === 6) s += "ff";
  if (s.length !== 8) return null;
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  const a = parseInt(s.slice(6, 8), 16) / 255;
  return { _class: "color", red: r, green: g, blue: b, alpha: a };
}

function styleBlock({ fill, border, borderWidth }) {
  const fills = [];
  const borders = [];
  if (fill) {
    fills.push({
      _class: "fill",
      isEnabled: true,
      fillType: 0,
      color: fill,
      contextSettings: defaultContextSettings(),
      gradient: defaultGradient(),
      noiseIndex: 0,
      noiseIntensity: 0,
      patternFillType: 1,
      patternTileScale: 1,
    });
  }
  if (border && borderWidth > 0) {
    borders.push({
      _class: "border",
      isEnabled: true,
      fillType: 0,
      color: border,
      contextSettings: defaultContextSettings(),
      gradient: defaultGradient(),
      position: 1,
      thickness: borderWidth,
    });
  }
  return {
    _class: "style",
    do_objectID: nextId(),
    endMarkerType: 0,
    miterLimit: 10,
    startMarkerType: 0,
    windingRule: 1,
    blur: {
      _class: "blur",
      isEnabled: false,
      center: "{0.5, 0.5}",
      motionAngle: 0,
      radius: 10,
      saturation: 1,
      type: 0,
    },
    borderOptions: {
      _class: "borderOptions",
      isEnabled: true,
      dashPattern: [],
      lineCapStyle: 0,
      lineJoinStyle: 0,
    },
    borders,
    colorControls: {
      _class: "colorControls",
      isEnabled: false,
      brightness: 0,
      contrast: 1,
      hue: 0,
      saturation: 1,
    },
    contextSettings: defaultContextSettings(),
    fills,
    innerShadows: [],
    shadows: [],
    textStyle: null,
  };
}

function defaultContextSettings() {
  return { _class: "graphicsContextSettings", blendMode: 0, opacity: 1 };
}

function defaultGradient() {
  return {
    _class: "gradient",
    elipseLength: 0,
    from: "{0.5, 0}",
    gradientType: 0,
    to: "{0.5, 1}",
    stops: [
      {
        _class: "gradientStop",
        position: 0,
        color: { _class: "color", red: 1, green: 1, blue: 1, alpha: 1 },
      },
      {
        _class: "gradientStop",
        position: 1,
        color: { _class: "color", red: 0, green: 0, blue: 0, alpha: 1 },
      },
    ],
  };
}

// Build a Rectangle layer used for fills/borders.
function rectangleLayer({ name, x, y, width, height, fill, border, borderWidth, radius }) {
  const cornerRadius = radius ?? 0;
  return {
    _class: "rectangle",
    do_objectID: nextId(),
    name,
    booleanOperation: -1,
    edited: false,
    exportOptions: defaultExportOptions(),
    fixedRadius: cornerRadius,
    frame: rect(x, y, width, height),
    hasClippingMask: false,
    hasConvertedToNewRoundCorners: true,
    isClosed: true,
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isTemplate: false,
    isVisible: true,
    layerListExpandedType: 0,
    nameIsFixed: false,
    needsConvertionToNewRoundCorners: false,
    pointRadiusBehaviour: 1,
    points: rectanglePoints(cornerRadius),
    resizingConstraint: 63,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    style: styleBlock({ fill, border, borderWidth }),
  };
}

function rectanglePoints(radius) {
  const r = radius || 0;
  return [
    { _class: "curvePoint", cornerRadius: r, curveFrom: "{0, 0}", curveMode: 1, curveTo: "{0, 0}", hasCurveFrom: false, hasCurveTo: false, point: "{0, 0}" },
    { _class: "curvePoint", cornerRadius: r, curveFrom: "{1, 0}", curveMode: 1, curveTo: "{1, 0}", hasCurveFrom: false, hasCurveTo: false, point: "{1, 0}" },
    { _class: "curvePoint", cornerRadius: r, curveFrom: "{1, 1}", curveMode: 1, curveTo: "{1, 1}", hasCurveFrom: false, hasCurveTo: false, point: "{1, 1}" },
    { _class: "curvePoint", cornerRadius: r, curveFrom: "{0, 1}", curveMode: 1, curveTo: "{0, 1}", hasCurveFrom: false, hasCurveTo: false, point: "{0, 1}" },
  ];
}

function defaultExportOptions() {
  return {
    _class: "exportOptions",
    includedLayerIds: [],
    layerOptions: 0,
    shouldTrim: false,
    exportFormats: [],
  };
}

function textLayer({ name, x, y, width, height, text, color, fontSize, fontWeight, textAlign }) {
  const fontName = fontWeight >= 700 ? "Inter-Bold"
    : fontWeight >= 600 ? "Inter-SemiBold"
    : fontWeight >= 500 ? "Inter-Medium"
    : "Inter-Regular";
  return {
    _class: "text",
    do_objectID: nextId(),
    name: name || text.slice(0, 32),
    booleanOperation: -1,
    exportOptions: defaultExportOptions(),
    frame: rect(x, y, width, height),
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isTemplate: false,
    isVisible: true,
    layerListExpandedType: 0,
    nameIsFixed: false,
    resizingConstraint: 63,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    attributedString: {
      _class: "attributedString",
      string: text,
      attributes: [
        {
          _class: "stringAttribute",
          location: 0,
          length: text.length,
          attributes: {
            MSAttributedStringFontAttribute: {
              _class: "fontDescriptor",
              attributes: { name: fontName, size: fontSize ?? 14 },
            },
            MSAttributedStringColorAttribute: color ?? {
              _class: "color",
              red: 0,
              green: 0,
              blue: 0,
              alpha: 1,
            },
            paragraphStyle: {
              _class: "paragraphStyle",
              alignment: textAlignIdx(textAlign),
            },
            kerning: 0,
          },
        },
      ],
    },
    automaticallyDrawOnUnderlyingPath: false,
    dontSynchroniseWithSymbol: false,
    glyphBounds: "",
    heightIsClipped: false,
    lineSpacingBehaviour: 2,
    textBehaviour: 0,
    style: styleBlock({ fill: null, border: null, borderWidth: 0 }),
  };
}

function textAlignIdx(a) {
  switch (a) {
    case "center": return 2;
    case "right": return 1;
    case "justify": return 3;
    default: return 0;
  }
}

function groupLayer({ name, x, y, width, height, layers, smartLayout }) {
  const out = {
    _class: smartLayout ? "symbolMaster" : "group",
    do_objectID: nextId(),
    name,
    booleanOperation: -1,
    exportOptions: defaultExportOptions(),
    frame: rect(x, y, width, height),
    hasClickThrough: false,
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isTemplate: false,
    isVisible: true,
    layerListExpandedType: 0,
    layers,
    nameIsFixed: false,
    resizingConstraint: 63,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    style: styleBlock({ fill: null, border: null, borderWidth: 0 }),
  };
  if (smartLayout) {
    out.allowsOverrides = true;
    out.backgroundColor = { _class: "color", red: 1, green: 1, blue: 1, alpha: 0 };
    out.hasBackgroundColor = false;
    out.includeBackgroundColorInExport = true;
    out.includeBackgroundColorInInstance = false;
    out.includeInCloudUpload = true;
    out.isFlowHome = false;
    out.overrideProperties = [];
    out.presetDictionary = {};
    out.resizesContent = true;
    out.symbolID = nextId();
    out.groupLayout = smartLayout;
  }
  return out;
}

// Smart Layout config for a Symbol Master. Sketch's axis enum:
//   0 = horizontal, 1 = vertical
function smartLayoutFor(style) {
  if (style.display !== "flex" && style.display !== "inline-flex") return null;
  const isVertical = style.flexDirection.startsWith("column");
  return {
    _class: "MSImmutableInferredGroupLayout",
    axis: isVertical ? 1 : 0,
    layoutAnchor: 0,
    minSize: 0,
  };
}

// Walk the layout tree and emit Sketch layers.
//
// For each element node:
//   - If it has a background or border → emit a Rectangle behind
//     a Group containing the children.
//   - If it has children → emit a Group (or Symbol Master if marked)
//     containing each child's layers.
//   - If it's a leaf with text → emit a Text layer.
//
// Phase 2: layers tagged as a TailGrids primitive (Button, etc.)
// are emitted as Symbol Masters with Smart Layout from their flex
// config. Instances would be SymbolInstances pointing at the master,
// but for v1 we inline the master at each call site — Sketch will
// recognise duplicate masters by name on import.
export function emitSketchLayers(node, { asSymbol = false } = {}) {
  if (!node) return [];
  if (node.kind === "text") {
    const style = node.style ?? emptyStyle();
    return [
      textLayer({
        name: node.text.slice(0, 40),
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? 0,
        height: node.height ?? 0,
        text: node.text,
        color: colorObject(style.color ?? "#000000"),
        fontSize: style.fontSize ?? 14,
        fontWeight: style.fontWeight ?? 400,
        textAlign: style.textAlign,
      }),
    ];
  }
  const style = node.style ?? emptyStyle();
  const inner = [];
  // Background rectangle if there's a fill, border, or radius.
  if (style.background || style.borderColor || style.borderRadius) {
    inner.push(
      rectangleLayer({
        name: "Background",
        x: 0,
        y: 0,
        width: node.width ?? 0,
        height: node.height ?? 0,
        fill: style.background ? colorObject(style.background) : null,
        border: style.borderColor ? colorObject(style.borderColor) : null,
        borderWidth: style.borderWidth ?? 0,
        radius: style.borderRadius ?? 0,
      }),
    );
  }
  for (const child of node.children ?? []) {
    inner.push(...emitSketchLayers(child));
  }
  const name = node.attrs?.["data-name"] || node.tag || "Group";
  const smartLayout = asSymbol ? smartLayoutFor(style) : null;
  return [
    groupLayer({
      name,
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? 0,
      height: node.height ?? 0,
      layers: inner,
      smartLayout,
    }),
  ];
}

// ---------------------------------------------------------------------
// Document + ZIP assembly.
// ---------------------------------------------------------------------

function makePage({ name, layers, width, height }) {
  return {
    _class: "page",
    do_objectID: nextId(),
    booleanOperation: -1,
    exportOptions: defaultExportOptions(),
    frame: rect(0, 0, width, height),
    hasClickThrough: true,
    horizontalRulerData: { _class: "rulerData", base: 0, guides: [] },
    verticalRulerData: { _class: "rulerData", base: 0, guides: [] },
    includeInCloudUpload: true,
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isVisible: true,
    layerListExpandedType: 0,
    layers,
    name,
    nameIsFixed: false,
    resizingConstraint: 63,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    style: styleBlock({ fill: null, border: null, borderWidth: 0 }),
  };
}

function makeDocument(pageId) {
  return {
    _class: "document",
    do_objectID: nextId(),
    documentState: { _class: "documentState" },
    colorSpace: 0,
    currentPageIndex: 0,
    assets: {
      _class: "assetCollection",
      do_objectID: nextId(),
      colors: [],
      gradients: [],
      images: [],
      colorAssets: [],
      gradientAssets: [],
      imageCollection: { _class: "imageCollection", images: {} },
    },
    foreignLayerStyles: [],
    foreignSymbols: [],
    foreignTextStyles: [],
    foreignSwatches: [],
    layerStyles: { _class: "sharedStyleContainer", objects: [] },
    layerSymbols: { _class: "symbolContainer", objects: [] },
    layerTextStyles: { _class: "sharedTextStyleContainer", objects: [] },
    pages: [
      {
        _class: "MSJSONFileReference",
        _ref_class: "MSImmutablePage",
        _ref: `pages/${pageId}`,
      },
    ],
  };
}

function makeMeta({ pageId, pageName }) {
  return {
    commit: "0",
    pagesAndArtboards: {
      [pageId]: { name: pageName, artboards: {} },
    },
    version: 154,
    fonts: ["Inter-Regular", "Inter-Medium", "Inter-SemiBold", "Inter-Bold"],
    compatibilityVersion: 99,
    app: "com.bohemiancoding.sketch3",
    autosaved: 0,
    variant: "NONAPPSTORE",
    created: {
      commit: "0",
      appVersion: "99.5",
      build: 99000,
      app: "com.bohemiancoding.sketch3",
      compatibilityVersion: 99,
      version: 154,
      variant: "NONAPPSTORE",
    },
    saveHistory: [],
    appVersion: "99.5",
    build: 99000,
  };
}

function makeUser({ pageId }) {
  return {
    document: { pageListHeight: 110 },
    [pageId]: { scrollOrigin: "{0, 0}", zoomValue: 1 },
  };
}

// ---------------------------------------------------------------------
// Symbol library. Phase 2: scan the showcase tree for repeated
// TailGrids primitives, emit a Symbol Master for each, replace every
// inline occurrence with a Symbol Instance. The Symbol Master carries
// a Smart Layout config so resizing the master (or any instance)
// reflows children along the right axis with the right gap.
//
// "Primitive" detection is structural: we mark any node whose tag
// matches a known TailGrids primitive name (Button, Card, etc.) — but
// since our JSX is already lowered to plain HTML (button, div, ...),
// we use a tagging pass over the JSX *before* lowering. For v1 we
// promote every flex container at a leaf-ish boundary (button/div
// that contains text or icons only) to a Symbol Master. This catches
// the most-repeated visual units without over-promoting layout-only
// wrappers.
// ---------------------------------------------------------------------

// Two trees are "symbol-equivalent" if they share the same tag, the
// same style, and equivalent children (recursively). We serialise to
// a stable string and use it as a Symbol cache key.
function symbolKey(node) {
  if (!node) return "null";
  if (node.kind === "text") return `t:${node.text.length}:${node.style?.fontSize ?? 0}:${node.style?.fontWeight ?? 0}`;
  const s = node.style ?? emptyStyle();
  const sig = [
    node.tag,
    s.display,
    s.flexDirection,
    s.background ?? "-",
    s.color ?? "-",
    s.borderColor ?? "-",
    s.borderRadius,
    s.borderWidth,
    s.fontSize ?? "-",
    s.fontWeight ?? "-",
    s.paddingTop,
    s.paddingRight,
    s.paddingBottom,
    s.paddingLeft,
    s.gap,
  ].join("|");
  const kids = (node.children ?? []).map(symbolKey).join(";");
  return `e[${sig}](${kids})`;
}

// Decide whether a node is a Smart-Layout-worthy primitive. Heuristic:
//   - Must be a flex container (Smart Layout only makes sense here)
//   - Must have at least one child
//   - Total subtree text content under 40 chars (excludes wrapper divs
//     containing entire sentences/paragraphs)
function isPromotablePrimitive(node) {
  if (!node || node.kind !== "element") return false;
  const s = node.style ?? emptyStyle();
  if (s.display !== "flex" && s.display !== "inline-flex") return false;
  if (!node.children || node.children.length === 0) return false;
  const text = collectText(node);
  if (text.length > 40) return false;
  return true;
}

// Walk the tree and collect every promotable primitive's structural
// key. Returns a Map<key, { tree, count }> where each entry holds
// the canonical subtree (first occurrence) and how many times it
// appeared. Anything appearing once isn't worth a Symbol — we only
// promote keys with count > 1 to avoid Symbol-noise in the file.
function collectSymbolCandidates(node, into = new Map()) {
  if (!node || node.kind !== "element") return into;
  if (isPromotablePrimitive(node)) {
    const key = symbolKey(node);
    const existing = into.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      into.set(key, { key, tree: cloneTree(node), count: 1 });
    }
  }
  for (const c of node.children ?? []) collectSymbolCandidates(c, into);
  return into;
}

function cloneTree(node) {
  if (!node) return null;
  if (node.kind === "text") return { ...node };
  return {
    ...node,
    attrs: { ...(node.attrs ?? {}) },
    children: (node.children ?? []).map(cloneTree),
  };
}

// Build a SymbolInstance layer referencing a Symbol Master.
function symbolInstanceLayer({ name, x, y, width, height, symbolID }) {
  return {
    _class: "symbolInstance",
    do_objectID: nextId(),
    name,
    booleanOperation: -1,
    exportOptions: defaultExportOptions(),
    frame: rect(x, y, width, height),
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isVisible: true,
    layerListExpandedType: 0,
    nameIsFixed: false,
    resizingConstraint: 63,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    horizontalSpacing: 0,
    verticalSpacing: 0,
    scale: 1,
    style: styleBlock({ fill: null, border: null, borderWidth: 0 }),
    symbolID,
    overrideValues: [],
  };
}

// Build a complete .sketch file for one component slug.
//
// `fetchResult` is what fetchTailgridsComponent returns —
// `{ sections: [{ jsx, label }] }`. We lay each section out vertically
// with section labels above them so the document mirrors the
// on-canvas preview. Repeated primitives across sections become
// Symbol Masters on a dedicated Symbols page with Smart Layout —
// resizing a master propagates to every instance, matching what
// Figma users expect from Auto Layout.
export async function buildSketchFileForComponent(fetchResult) {
  _idCounter = 0;
  const name = fetchResult.name ?? "Component";
  const sections = (fetchResult.sections ?? []).filter((s) => s.jsx);
  if (sections.length === 0) {
    throw new Error("no composable sections for this component");
  }

  // First pass: parse and lay out every section's tree.
  const sectionTrees = [];
  for (const sec of sections) {
    const tree = parseJsxTree(sec.jsx);
    if (!tree) continue;
    layoutTree(tree);
    sectionTrees.push({ label: sec.label, tree });
  }

  // Second pass: find repeated primitives across all sections.
  const candidates = new Map();
  for (const { tree } of sectionTrees) {
    collectSymbolCandidates(tree, candidates);
  }
  const symbolDefs = [];
  const keyToSymbolId = new Map();
  let symbolNameCounter = 0;
  for (const { key, tree, count } of candidates.values()) {
    if (count < 2) continue;
    // Build the Symbol Master's child layers from the canonical tree.
    // The master sits on the Symbols page; instances reference its ID.
    const masterLayers = emitSketchLayers(tree, { asSymbol: false })[0]
      ?.layers ?? [];
    const smartLayout = smartLayoutFor(tree.style ?? emptyStyle());
    const symbolID = nextId();
    symbolNameCounter += 1;
    const master = {
      ...groupLayer({
        name: `${name} / ${labelForTree(tree, symbolNameCounter)}`,
        x: 0,
        y: 0,
        width: tree.width ?? 100,
        height: tree.height ?? 40,
        layers: masterLayers,
        smartLayout,
      }),
    };
    master.symbolID = symbolID;
    symbolDefs.push(master);
    keyToSymbolId.set(key, {
      id: symbolID,
      width: tree.width ?? 100,
      height: tree.height ?? 40,
    });
  }

  // Third pass: emit page layers, replacing promoted subtrees with
  // SymbolInstance layers pointing at the masters we just built.
  function emitWithSymbols(node) {
    if (!node) return [];
    if (node.kind === "text") return emitSketchLayers(node);
    if (isPromotablePrimitive(node)) {
      const key = symbolKey(node);
      const ref = keyToSymbolId.get(key);
      if (ref) {
        return [
          symbolInstanceLayer({
            name: node.tag,
            x: node.x ?? 0,
            y: node.y ?? 0,
            width: node.width ?? ref.width,
            height: node.height ?? ref.height,
            symbolID: ref.id,
          }),
        ];
      }
    }
    const style = node.style ?? emptyStyle();
    const inner = [];
    if (style.background || style.borderColor || style.borderRadius) {
      inner.push(
        rectangleLayer({
          name: "Background",
          x: 0,
          y: 0,
          width: node.width ?? 0,
          height: node.height ?? 0,
          fill: style.background ? colorObject(style.background) : null,
          border: style.borderColor ? colorObject(style.borderColor) : null,
          borderWidth: style.borderWidth ?? 0,
          radius: style.borderRadius ?? 0,
        }),
      );
    }
    for (const child of node.children ?? []) inner.push(...emitWithSymbols(child));
    return [
      groupLayer({
        name: node.tag,
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? 0,
        height: node.height ?? 0,
        layers: inner,
      }),
    ];
  }

  const showcaseLayers = [];
  let cursorY = 32;
  const pageWidth = 720;
  const horizontalPad = 32;
  for (const { label, tree } of sectionTrees) {
    const labelHeight = 18;
    showcaseLayers.push(
      textLayer({
        name: `Label · ${label}`,
        x: horizontalPad,
        y: cursorY,
        width: pageWidth - horizontalPad * 2,
        height: labelHeight,
        text: label.toUpperCase(),
        color: colorObject("#64748b"),
        fontSize: 11,
        fontWeight: 600,
        textAlign: "left",
      }),
    );
    cursorY += labelHeight + 12;
    tree.x = 0;
    tree.y = 0;
    const sectionInner = emitWithSymbols(tree);
    showcaseLayers.push(
      groupLayer({
        name: label,
        x: horizontalPad,
        y: cursorY,
        width: tree.width ?? pageWidth - horizontalPad * 2,
        height: tree.height ?? 80,
        layers: sectionInner,
      }),
    );
    cursorY += (tree.height ?? 80) + 32;
  }

  const showcasePage = makePage({
    name,
    layers: showcaseLayers,
    width: pageWidth,
    height: cursorY + 32,
  });
  const showcasePageId = showcasePage.do_objectID;

  // Symbols page: lay each master out in a 3-column grid for tidy
  // navigation when designers open the Symbols panel.
  const symbolsPageLayers = [];
  if (symbolDefs.length > 0) {
    const cols = 3;
    const cellWidth = 240;
    const cellHeight = 100;
    symbolDefs.forEach((m, i) => {
      m.frame.x = (i % cols) * cellWidth + 16;
      m.frame.y = Math.floor(i / cols) * cellHeight + 16;
      symbolsPageLayers.push(m);
    });
  }
  const symbolsPage = makePage({
    name: "Symbols",
    layers: symbolsPageLayers,
    width: 800,
    height: 600,
  });
  const symbolsPageId = symbolsPage.do_objectID;

  const doc = makeDocument(showcasePageId);
  // Reference both pages from the document.
  doc.pages = [
    {
      _class: "MSJSONFileReference",
      _ref_class: "MSImmutablePage",
      _ref: `pages/${showcasePageId}`,
    },
    {
      _class: "MSJSONFileReference",
      _ref_class: "MSImmutablePage",
      _ref: `pages/${symbolsPageId}`,
    },
  ];
  const meta = makeMeta({ pageId: showcasePageId, pageName: name });
  meta.pagesAndArtboards[symbolsPageId] = { name: "Symbols", artboards: {} };
  const user = makeUser({ pageId: showcasePageId });
  user[symbolsPageId] = { scrollOrigin: "{0, 0}", zoomValue: 1 };

  const zip = new JSZip();
  zip.file("document.json", JSON.stringify(doc, null, 2));
  zip.file("meta.json", JSON.stringify(meta, null, 2));
  zip.file("user.json", JSON.stringify(user, null, 2));
  zip.file(`pages/${showcasePageId}.json`, JSON.stringify(showcasePage, null, 2));
  zip.file(`pages/${symbolsPageId}.json`, JSON.stringify(symbolsPage, null, 2));
  return zip.generateAsync({ type: "nodebuffer" });
}

function labelForTree(tree, fallbackIndex) {
  const text = collectText(tree).trim();
  if (text) return text.slice(0, 24);
  return `Symbol ${fallbackIndex}`;
}
