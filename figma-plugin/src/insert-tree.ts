// Sandbox-side tree → figma.* nodes. Receives the serialized tree from
// the UI iframe and creates real Figma nodes mirroring it.

type FigmaRGB = { r: number; g: number; b: number };
type FigmaRGBA = { r: number; g: number; b: number; a: number };
// Mirrors Figma's SolidPaint — color is RGB (no alpha), opacity carries
// transparency. Wire shape from html-to-tree.ts.
type FigmaSolidFill = { type: "SOLID"; color: FigmaRGB; opacity: number };
type EffectSpec = {
  type: "DROP_SHADOW";
  color: FigmaRGBA;
  offset: { x: number; y: number };
  radius: number;
  spread: number;
};

type FrameSpec = {
  kind: "frame";
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fills: FigmaSolidFill[];
  strokes: FigmaSolidFill[];
  strokeWeight: number;
  cornerRadii: [number, number, number, number];
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL";
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  itemSpacing: number;
  effects: EffectSpec[];
  clipsContent: boolean;
  children: NodeSpec[];
};

type TextSpec = {
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
};

type VectorSpec = {
  kind: "vector";
  x: number;
  y: number;
  w: number;
  h: number;
  svg: string;
};

type ImageSpec = {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  cornerRadii: [number, number, number, number];
};

type NodeSpec = FrameSpec | TextSpec | VectorSpec | ImageSpec;

// Map computed weight → closest Inter style so loadFontAsync succeeds.
function weightToStyle(weight: number): string {
  if (weight <= 250) return "Thin";
  if (weight <= 350) return "Light";
  if (weight <= 450) return "Regular";
  if (weight <= 550) return "Medium";
  if (weight <= 650) return "Semi Bold";
  if (weight <= 750) return "Bold";
  if (weight <= 850) return "Extra Bold";
  return "Black";
}

async function loadInter(weight: number): Promise<FontName> {
  const fontName: FontName = { family: "Inter", style: weightToStyle(weight) };
  try {
    await figma.loadFontAsync(fontName);
    return fontName;
  } catch (_err) {
    const fallback: FontName = { family: "Inter", style: "Regular" };
    await figma.loadFontAsync(fallback);
    return fallback;
  }
}

function applyCorners(
  node: FrameNode | RectangleNode,
  radii: [number, number, number, number],
) {
  const [tl, tr, br, bl] = radii;
  if (tl === tr && tr === br && br === bl) {
    node.cornerRadius = tl;
  } else {
    node.topLeftRadius = tl;
    node.topRightRadius = tr;
    node.bottomRightRadius = br;
    node.bottomLeftRadius = bl;
  }
}

async function createNode(spec: NodeSpec): Promise<SceneNode | null> {
  if (spec.kind === "frame") return createFrame(spec);
  if (spec.kind === "text") return createText(spec);
  if (spec.kind === "vector") return createVector(spec);
  if (spec.kind === "image") return createImage(spec);
  return null;
}

async function createFrame(spec: FrameSpec): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = spec.name || "Frame";
  frame.resize(Math.max(1, spec.w), Math.max(1, spec.h));
  frame.x = spec.x;
  frame.y = spec.y;
  frame.fills = spec.fills as Paint[];
  frame.strokes = spec.strokes as Paint[];
  frame.strokeWeight = spec.strokeWeight;
  frame.strokeAlign = "INSIDE";
  applyCorners(frame, spec.cornerRadii);
  frame.clipsContent = spec.clipsContent;
  if (spec.effects.length > 0) {
    const effects: DropShadowEffect[] = spec.effects.map((e) => ({
      type: "DROP_SHADOW",
      color: e.color,
      offset: e.offset,
      radius: e.radius,
      spread: e.spread,
      visible: true,
      blendMode: "NORMAL",
      showShadowBehindNode: false,
    }));
    frame.effects = effects;
  }

  // Auto-layout when the source used flex; otherwise free-form so
  // children land at their absolute positions.
  if (spec.layoutMode !== "NONE") {
    frame.layoutMode = spec.layoutMode;
    frame.paddingTop = spec.paddingTop;
    frame.paddingRight = spec.paddingRight;
    frame.paddingBottom = spec.paddingBottom;
    frame.paddingLeft = spec.paddingLeft;
    frame.itemSpacing = spec.itemSpacing;
    frame.primaryAxisSizingMode = "FIXED";
    frame.counterAxisSizingMode = "FIXED";
  }

  for (const child of spec.children) {
    const node = await createNode(child);
    if (!node) continue;
    frame.appendChild(node);
    // Children come positioned relative to their parent's bounding box,
    // but auto-layout will re-flow them. We still set x/y so the
    // free-form fallback path renders correctly.
    if (spec.layoutMode === "NONE" && "x" in node) {
      node.x = (child as any).x ?? 0;
      node.y = (child as any).y ?? 0;
    }
  }
  return frame;
}

async function createText(spec: TextSpec): Promise<TextNode> {
  const fontName = await loadInter(spec.fontWeight);
  const text = figma.createText();
  text.fontName = fontName;
  text.fontSize = spec.fontSize;
  text.characters = spec.characters;
  if (spec.lineHeight != null && spec.lineHeight > 0) {
    text.lineHeight = { value: spec.lineHeight, unit: "PIXELS" };
  }
  if (spec.letterSpacing) {
    text.letterSpacing = { value: spec.letterSpacing, unit: "PIXELS" };
  }
  text.textAlignHorizontal = spec.textAlign;
  text.fills = spec.fills as Paint[];
  text.resize(Math.max(1, spec.w), Math.max(1, spec.h));
  text.x = spec.x;
  text.y = spec.y;
  return text;
}

function createVector(spec: VectorSpec): SceneNode | null {
  try {
    const node = figma.createNodeFromSvg(spec.svg);
    node.x = spec.x;
    node.y = spec.y;
    node.resize(Math.max(1, spec.w), Math.max(1, spec.h));
    return node;
  } catch (_err) {
    // Malformed SVG — return a placeholder rect so the layout doesn't
    // collapse.
    const rect = figma.createRectangle();
    rect.resize(Math.max(1, spec.w), Math.max(1, spec.h));
    rect.x = spec.x;
    rect.y = spec.y;
    rect.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }];
    return rect;
  }
}

async function createImage(spec: ImageSpec): Promise<RectangleNode> {
  const rect = figma.createRectangle();
  rect.resize(Math.max(1, spec.w), Math.max(1, spec.h));
  rect.x = spec.x;
  rect.y = spec.y;
  applyCorners(rect, spec.cornerRadii);
  try {
    const img = await figma.createImageAsync(spec.url);
    rect.fills = [
      {
        type: "IMAGE",
        scaleMode: "FILL",
        imageHash: img.hash,
      },
    ];
  } catch (_err) {
    rect.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.94, b: 0.97 } }];
  }
  return rect;
}

export async function insertTree(
  root: FrameSpec,
  meta: { componentName: string; sectionLabel: string | null },
): Promise<string> {
  // Pre-load every text node's font so all loadFontAsync calls are batched
  // into one round-trip before we start creating nodes.
  const weights = new Set<number>();
  collectWeights(root, weights);
  await Promise.all(
    Array.from(weights).map((w) =>
      figma
        .loadFontAsync({ family: "Inter", style: weightToStyle(w) })
        .catch(() => figma.loadFontAsync({ family: "Inter", style: "Regular" })),
    ),
  );

  // Track the partial root so we can delete it on failure. Without this
  // a validation error mid-walk (bad fill shape, malformed SVG, font
  // miss) leaves a half-built frame on the canvas that the user has to
  // clean up by hand.
  let node: FrameNode | null = null;
  try {
    node = await createFrame({
      ...root,
      name: meta.sectionLabel
        ? `${meta.componentName} · ${meta.sectionLabel}`
        : meta.componentName,
    });
    const center = figma.viewport.center;
    node.x = Math.round(center.x - root.w / 2);
    node.y = Math.round(center.y - root.h / 2);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    return node.id;
  } catch (err) {
    if (node) {
      try {
        node.remove();
      } catch {
        /* node may already be detached if the failure happened during append */
      }
    }
    throw err;
  }
}

function collectWeights(spec: NodeSpec, out: Set<number>) {
  if (spec.kind === "text") {
    out.add(spec.fontWeight);
    return;
  }
  if (spec.kind === "frame") {
    for (const child of spec.children) collectWeights(child, out);
  }
}
