// Sandbox-context entry. Runs in Figma's V8 sandbox (no DOM). Bridges
// the UI iframe to the figma.* API.
//
// P2 scope: open the UI, persist/read pairing config, place a labeled
// placeholder frame when the UI requests `insert-placeholder`. The real
// HTML→Figma converter lands in P3 with a new `insert-tree` message.

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
