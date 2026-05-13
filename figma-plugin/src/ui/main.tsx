// Preact entry for the plugin UI. Two views: pairing (first-run) and
// gallery (lists saves). The bridge to the sandbox is parent.postMessage
// with `{ pluginMessage }` envelopes, plus window message listeners.

import { h, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Pairing } from "./Pairing";
import { Gallery } from "./Gallery";
import { listSaves } from "./api";

type Config = { apiBase: string; libraryCode: string } | null;

function sandboxPost(msg: any) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

export type SandboxEvent =
  | { type: "init"; config: Partial<NonNullable<Config>> }
  | { type: "config-saved" }
  | { type: "config-cleared" }
  | { type: "inserted"; nodeId: string; sectionLabel: string | null };

function App() {
  const [config, setConfig] = useState<Config>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data?.pluginMessage as SandboxEvent | undefined;
      if (!data) return;
      if (data.type === "init") {
        const cfg = data.config;
        if (cfg?.apiBase && cfg?.libraryCode) {
          setConfig({ apiBase: cfg.apiBase, libraryCode: cfg.libraryCode });
        } else {
          setConfig(null);
        }
        setReady(true);
      } else if (data.type === "config-cleared") {
        setConfig(null);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!ready) {
    return (
      <div style={{ padding: 16, color: "var(--text-dim)" }}>Loading…</div>
    );
  }

  if (!config) {
    return (
      <Pairing
        onPaired={(cfg) => {
          sandboxPost({ type: "save-config", config: cfg });
          setConfig(cfg);
        }}
        validate={async (cfg) => {
          // 200 from /api/library/saves with the candidate code proves the
          // host is reachable AND the code is well-formed. A bad code
          // returns 401, a missing DB returns 503, both surface as errors.
          await listSaves(cfg.apiBase, cfg.libraryCode);
        }}
      />
    );
  }

  return (
    <Gallery
      config={config}
      onInsert={(save, section) =>
        sandboxPost({
          type: "insert-placeholder",
          componentName: save.componentName,
          sectionLabel: section?.label ?? null,
          saveId: save.id,
        })
      }
      onUnpair={() => sandboxPost({ type: "clear-config" })}
    />
  );
}

render(<App />, document.getElementById("root")!);
