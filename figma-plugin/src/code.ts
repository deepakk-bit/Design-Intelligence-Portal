// Sandbox-context entry. Runs in Figma's V8 sandbox (no DOM). Bridges
// the UI iframe to the figma.* API.
//
// Handles pairing-config persistence plus two insert paths:
//   - `insert-placeholder` — labeled dashed frame (kept as a fallback).
//   - `insert-tree` — the real HTML→Figma converter; the UI walks the
//     rendered DOM, sends a serialized tree here, and we materialize
//     it as figma.* nodes.

import { insertTree } from "./insert-tree";

type ClientConfig = {
  apiBase?: string;
  libraryCode?: string;
};

const CONFIG_KEY = "design-intelligence:config";

async function loadConfig(): Promise<ClientConfig> {
  const raw = (await figma.clientStorage.getAsync(CONFIG_KEY)) as
    | ClientConfig
    | undefined;
  return raw ?? {};
}

async function saveConfig(cfg: ClientConfig) {
  await figma.clientStorage.setAsync(CONFIG_KEY, cfg);
}

figma.showUI(__html__, { width: 380, height: 620, themeColors: true });

(async () => {
  const cfg = await loadConfig();
  figma.ui.postMessage({ type: "init", config: cfg });
})();

figma.ui.onmessage = async (msg: any) => {
  if (!msg || typeof msg.type !== "string") return;

  switch (msg.type) {
    case "save-config": {
      await saveConfig({
        apiBase: msg.config?.apiBase,
        libraryCode: msg.config?.libraryCode,
      });
      figma.ui.postMessage({ type: "config-saved" });
      return;
    }
    case "clear-config": {
      await figma.clientStorage.deleteAsync(CONFIG_KEY);
      figma.ui.postMessage({ type: "config-cleared" });
      return;
    }
    case "insert-placeholder": {
      // P2 plumbing check: drop a labeled frame at the viewport center.
      // P3 swaps this for the html-to-tree node walker.
      const name = String(msg.componentName ?? "Saved component");
      const center = figma.viewport.center;
      const frame = figma.createFrame();
      frame.name = name;
      frame.resize(360, 200);
      frame.x = Math.round(center.x - 180);
      frame.y = Math.round(center.y - 100);
      frame.fills = [
        { type: "SOLID", color: { r: 0.96, g: 0.97, b: 1 } },
      ];
      frame.strokeWeight = 1;
      frame.strokes = [
        { type: "SOLID", color: { r: 0.85, g: 0.88, b: 0.95 } },
      ];
      frame.dashPattern = [4, 4];
      frame.cornerRadius = 16;
      frame.layoutMode = "VERTICAL";
      frame.primaryAxisAlignItems = "CENTER";
      frame.counterAxisAlignItems = "CENTER";
      frame.paddingTop = 24;
      frame.paddingBottom = 24;
      frame.paddingLeft = 24;
      frame.paddingRight = 24;
      frame.itemSpacing = 8;

      await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      const title = figma.createText();
      title.fontName = { family: "Inter", style: "Semi Bold" };
      title.fontSize = 14;
      title.characters = name;
      title.fills = [
        { type: "SOLID", color: { r: 0.06, g: 0.09, b: 0.16 } },
      ];
      frame.appendChild(title);

      const sub = figma.createText();
      sub.fontName = { family: "Inter", style: "Regular" };
      sub.fontSize = 11;
      sub.characters = "P3 will paint real frames here.";
      sub.fills = [
        { type: "SOLID", color: { r: 0.39, g: 0.45, b: 0.55 } },
      ];
      frame.appendChild(sub);

      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);
      figma.ui.postMessage({
        type: "inserted",
        nodeId: frame.id,
        sectionLabel: msg.sectionLabel ?? null,
      });
      return;
    }
    case "insert-tree": {
      try {
        const nodeId = await insertTree(msg.tree, {
          componentName: String(msg.componentName ?? "Saved component"),
          sectionLabel: msg.sectionLabel ?? null,
        });
        if (Array.isArray(msg.warnings) && msg.warnings.length > 0) {
          figma.notify(
            `Inserted with ${msg.warnings.length} warning(s) — see plugin UI.`,
          );
        } else {
          figma.notify("Inserted into canvas");
        }
        figma.ui.postMessage({
          type: "inserted",
          nodeId,
          sectionLabel: msg.sectionLabel ?? null,
        });
      } catch (err: any) {
        figma.notify(`Insert failed: ${err?.message ?? err}`, {
          error: true,
        });
        figma.ui.postMessage({
          type: "insert-failed",
          message: String(err?.message ?? err),
        });
      }
      return;
    }
    case "notify": {
      figma.notify(String(msg.message ?? ""));
      return;
    }
    case "close": {
      figma.closePlugin();
      return;
    }
    default:
      return;
  }
};
