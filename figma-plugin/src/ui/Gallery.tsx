// Gallery view. Lists saved designs from the paired library, renders a
// small iframe preview per save (the same Tailwind-CDN HTML the web app
// serves), and lets the user insert a chosen state.
//
// P2: insert posts a placeholder frame to the sandbox so we prove the
// round-trip end-to-end. P3 swaps in the real HTML→Figma converter.

import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { listSaves, getSave, ApiError } from "./api";
import type { Save, Section } from "./api";
import { htmlToTree } from "./html-to-tree";

type Config = { apiBase: string; libraryCode: string };

function sandboxPost(msg: any) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

export function Gallery(props: {
  config: Config;
  onInsert?: (save: Save, section: Section | null) => void;
  onUnpair: () => void;
}) {
  const [saves, setSaves] = useState<Save[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [inserting, setInserting] = useState<string | null>(null);
  const [insertWarnings, setInsertWarnings] = useState<string[]>([]);

  async function refresh() {
    setStatus("loading");
    setError(null);
    try {
      const next = await listSaves(props.config.apiBase, props.config.libraryCode);
      setSaves(next);
      setStatus("idle");
    } catch (err: any) {
      setError(err?.message || "fetch failed");
      setStatus("error");
    }
  }

  // Convert the chosen section's HTML into a Figma node tree and post it
  // to the sandbox. Falls back to a placeholder insert if conversion
  // throws (broken HTML, unsupported source) so the user still gets
  // *something* on canvas and a notify with the reason.
  async function insertSection(save: Save, section: Section | null) {
    setInserting(`${save.id}:${section?.label ?? "default"}`);
    setInsertWarnings([]);
    try {
      // The list payload omits jsx but keeps html. We need the html for
      // the picked section, which is already present — but refetch the
      // full save anyway so we capture any server-side enrichments.
      const full =
        save.sections.some((s) => !s.html)
          ? await getSave(props.config.apiBase, props.config.libraryCode, save.id)
          : save;
      const target =
        (full?.sections ?? save.sections).find(
          (s) => s.label === (section?.label ?? full?.sections?.[0]?.label),
        ) ??
        full?.sections?.[0] ??
        save.sections[0];
      if (!target?.html) {
        sandboxPost({
          type: "insert-placeholder",
          componentName: save.componentName,
          sectionLabel: target?.label ?? null,
        });
        return;
      }
      const { root, warnings } = await htmlToTree(target.html);
      sandboxPost({
        type: "insert-tree",
        tree: root,
        componentName: save.componentName,
        sectionLabel: target.label,
        warnings,
      });
      setInsertWarnings(warnings);
    } catch (err: any) {
      sandboxPost({
        type: "insert-placeholder",
        componentName: save.componentName,
        sectionLabel: section?.label ?? null,
      });
      sandboxPost({
        type: "notify",
        message: `Converter fell back to placeholder: ${err?.message ?? err}`,
      });
    } finally {
      setInserting(null);
    }
  }

  useEffect(() => {
    refresh();
  }, [props.config.apiBase, props.config.libraryCode]);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data?.pluginMessage;
      if (!data) return;
      if (data.type === "insert-failed") {
        setInsertWarnings([`Sandbox: ${data.message}`]);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Saved library</div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={props.config.libraryCode}
          >
            {props.config.libraryCode}
          </div>
        </div>
        <button onClick={refresh} disabled={status === "loading"}>
          {status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
        <button onClick={props.onUnpair} title="Unpair this plugin">
          Unpair
        </button>
      </header>

      <div class="scroll" style={{ flex: 1, padding: "10px 12px" }}>
        {status === "error" && (
          <div
            style={{
              background: "var(--error-bg)",
              color: "var(--error)",
              padding: "10px 12px",
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
        {status !== "error" && saves.length === 0 && status !== "loading" && (
          <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5, padding: "20px 0", textAlign: "center" }}>
            No saves yet. Generate a component in the web app and click <strong>Save</strong> on its output card.
          </div>
        )}
        {insertWarnings.length > 0 && (
          <div
            style={{
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              color: "#9a3412",
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: 11,
              lineHeight: 1.5,
              marginBottom: 10,
            }}
          >
            <strong>Approximate conversion:</strong>
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
              {insertWarnings.slice(0, 4).map((w) => (
                <li key={w}>{warningLabel(w)}</li>
              ))}
            </ul>
          </div>
        )}
        {saves.map((save) => (
          <SaveCard
            key={save.id}
            save={save}
            inserting={inserting}
            onInsert={(s, sec) => insertSection(s, sec)}
          />
        ))}
      </div>
    </div>
  );
}

function SaveCard(props: {
  save: Save;
  inserting: string | null;
  onInsert: (save: Save, section: Section | null) => void;
}) {
  const { save, onInsert, inserting } = props;
  const [selected, setSelected] = useState<string>(
    save.sections?.[0]?.label ?? "Default",
  );
  const activeSection = useMemo(
    () => save.sections.find((s) => s.label === selected) ?? save.sections[0] ?? null,
    [save, selected],
  );
  const isInserting = inserting === `${save.id}:${activeSection?.label ?? "default"}`;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
        marginBottom: 10,
      }}
    >
      <div style={{ background: "var(--bg-soft)", height: 180 }}>
        {activeSection?.html ? (
          <iframe
            title={`${save.componentName} preview`}
            sandbox="allow-scripts"
            srcDoc={activeSection.html}
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              pointerEvents: "none",
            }}
          />
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 11 }}>
            Preview unavailable
          </div>
        )}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{save.componentName}</div>
        {save.description && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 11,
              color: "var(--text-dim)",
              lineHeight: 1.4,
            }}
          >
            {save.description}
          </p>
        )}

        {save.sections.length > 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {save.sections.map((s) => (
              <button
                key={s.label}
                onClick={() => setSelected(s.label)}
                style={{
                  padding: "2px 8px",
                  fontSize: 11,
                  borderColor: s.label === selected ? "var(--accent)" : "var(--border)",
                  color: s.label === selected ? "var(--accent)" : "inherit",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button
            class="primary"
            onClick={() => onInsert(save, activeSection)}
            disabled={isInserting || !activeSection?.html}
            style={{ flex: 1 }}
            title={!activeSection?.html ? "Preview unavailable for this state" : ""}
          >
            {isInserting ? "Inserting…" : "Insert into canvas"}
          </button>
        </div>
      </div>
    </div>
  );
}

function warningLabel(code: string): string {
  if (code === "multi-shadow") return "Multi-stop shadow approximated as none.";
  if (code.startsWith("font:")) {
    return `Font "${code.slice(5)}" not in Figma — fell back to Inter.`;
  }
  return code;
}
