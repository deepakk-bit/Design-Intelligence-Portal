import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useReactFlow } from "@xyflow/react";
import { nanoid } from "nanoid";
import {
  Bookmark,
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCanvasStore } from "../../store.js";
import {
  refreshLibrary,
  deleteDesign,
} from "../../lib/library-actions.js";
import { getLibrarySave } from "../../lib/api.js";
import {
  getLibraryCode,
  setLibraryCode,
} from "../../lib/identity.js";

// One-stop UI surface for the saved library: pairing code + Re-open
// buttons + delete. Lives as a portalled modal so it sits above the
// canvas without polluting the layout tree.
export default function LibraryModal({ onClose }) {
  const library = useCanvasStore((s) => s.library);
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const nodes = useCanvasStore((s) => s.nodes);
  const { screenToFlowPosition } = useReactFlow();

  // Fetch on open. Reuses the cache if it's fresh (<30s), otherwise
  // refetches so newly saved cards on another tab show up.
  useEffect(() => {
    const stale = Date.now() - (library.lastFetchedAt ?? 0) > 30_000;
    if (stale || library.saves.length === 0) {
      refreshLibrary().catch(() => {
        /* the store records the error; the UI surfaces it */
      });
    }
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function onReopen(save) {
    // Fetch full record (the list payload omits JSX) and spawn an
    // OutputNode on the canvas with the same kind the agent emitted.
    try {
      const full = await getLibrarySave(save.id);
      if (!full) return;
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const offset = (nodes.length % 6) * 32;
      addNode({
        id: nanoid(8),
        type: "output",
        position: {
          x: center.x - 260 + offset,
          y: center.y - 200 + offset,
        },
        data: {
          agentDefId: full.agentId,
          kind: "jsxGen",
          result: {
            // OutputNode reads `data.result.result` (the wire shape from
            // /api/analyze). Re-open mimics that envelope.
            result: {
              jsxGen: {
                componentName: full.componentName,
                description: full.description,
                sections: full.sections,
                // combinedJsx: the first section's jsx, same shape the
                // generator's post-process produces (cheap to rebuild
                // client-side; avoids storing redundant bytes).
                combinedJsx: (full.sections?.[0]?.jsx || "").trim(),
              },
            },
          },
        },
      });
      onClose();
    } catch {
      /* swallow; the user can retry */
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Saved library"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 nodrag nowheel"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[960px] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "calc(100vh - 48px)" }}
      >
        <div className="flex items-center px-5 py-3 border-b border-ink-100 shrink-0">
          <Bookmark size={16} className="text-brand-600 mr-2" aria-hidden="true" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink-900">Saved library</div>
            <div className="text-[11px] text-ink-500">
              Designs you saved from the generator, plus your pairing code for the Figma plugin.
            </div>
          </div>
          <button
            onClick={() => refreshLibrary()}
            disabled={library.status === "loading"}
            title="Refresh"
            aria-label="Refresh library"
            className="p-1.5 rounded text-ink-500 hover:text-ink-900 hover:bg-ink-100 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 mr-1 disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={library.status === "loading" ? "animate-spin" : ""}
            />
          </button>
          <button
            onClick={onClose}
            aria-label="Close library"
            title="Close (Esc)"
            className="p-1.5 rounded text-ink-500 hover:text-ink-900 hover:bg-ink-100 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin">
          <PairingBlock />
          <LibraryGrid
            library={library}
            onReopen={onReopen}
            onDelete={(id) => deleteDesign(id).catch(() => {})}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Top section showing the user's library code + export/import controls.
function PairingBlock() {
  const [code, setCode] = useState(() => getLibraryCode());
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  async function exportLibrary() {
    // Export = the full record (with JSX), so the user can re-import on
    // another device. We re-fetch each save individually because the
    // list endpoint omits JSX.
    const saves = useCanvasStore.getState().library.saves;
    const full = await Promise.all(
      saves.map((s) => getLibrarySave(s.id).catch(() => null)),
    );
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      libraryCode: code,
      saves: full.filter(Boolean),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `design-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function applyCode(newCode) {
    try {
      const clean = setLibraryCode(newCode);
      setCode(clean);
      // Force a fresh fetch under the new code.
      refreshLibrary().catch(() => {});
    } catch (err) {
      setImportError(err.message || "invalid code");
      setTimeout(() => setImportError(""), 4000);
    }
  }

  function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (parsed?.libraryCode) {
          applyCode(parsed.libraryCode);
        }
        setImporting(false);
      } catch {
        setImportError("invalid JSON");
        setImporting(false);
        setTimeout(() => setImportError(""), 4000);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="px-5 py-4 border-b border-ink-100 bg-ink-50/40">
      <div className="text-[11px] font-semibold text-ink-700 uppercase tracking-wide mb-2">
        Pairing code · paste into Figma plugin
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-[12px] bg-white border border-ink-200 rounded-lg px-3 py-2 text-ink-900 truncate">
          {code}
        </code>
        <button
          onClick={copyCode}
          title="Copy pairing code"
          className={`inline-flex items-center gap-1.5 text-[12px] font-medium rounded-md px-2.5 py-1.5 transition outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
            copied
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-brand-500 text-white hover:bg-brand-600"
          }`}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={exportLibrary}
          title="Download library as JSON"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium rounded-md px-2.5 py-1.5 bg-white text-ink-700 border border-ink-200 hover:border-brand-400 hover:text-brand-600 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          <Download size={13} aria-hidden="true" />
          Export
        </button>
        <label
          title="Import a library code or backup file"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium rounded-md px-2.5 py-1.5 bg-white text-ink-700 border border-ink-200 hover:border-brand-400 hover:text-brand-600 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          {importing ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Upload size={13} />
          )}
          Import
          <input
            type="file"
            accept="application/json"
            onChange={onImportFile}
            className="hidden"
          />
        </label>
      </div>
      <p className="text-[11px] text-ink-500 mt-2 leading-snug">
        This code IS your identity — every saved design is scoped to it. Paste it into the Figma plugin once to pair. Keep a backup via Export if you switch devices.
      </p>
      {importError && (
        <div className="text-[11px] text-red-600 mt-2">{importError}</div>
      )}
    </div>
  );
}

// Grid of saved designs. Each card thumbnails the Default section's HTML
// in a small iframe.
function LibraryGrid({ library, onReopen, onDelete }) {
  if (library.status === "error") {
    return (
      <div className="px-5 py-10 text-center">
        <div className="text-sm text-red-700 font-medium mb-2">Library unavailable</div>
        <div className="text-[12px] text-ink-500 max-w-md mx-auto leading-snug">
          {library.error}
        </div>
      </div>
    );
  }
  if (library.status === "loading" && library.saves.length === 0) {
    return (
      <div className="px-5 py-10 text-center text-[12px] text-ink-500">
        <Loader2 size={16} className="inline animate-spin text-ink-400 mr-2" />
        Loading library…
      </div>
    );
  }
  if (library.saves.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <div className="text-sm text-ink-700 font-medium mb-1">No saves yet</div>
        <p className="text-[12px] text-ink-500 max-w-sm mx-auto leading-snug">
          Generate a component, then click <strong>Save</strong> on its output card. Saves show up here and in the Figma plugin once you pair it.
        </p>
      </div>
    );
  }
  return (
    <div className="px-5 py-4 grid grid-cols-2 gap-4">
      {library.saves.map((save) => (
        <LibraryCard
          key={save.id}
          save={save}
          onReopen={() => onReopen(save)}
          onDelete={() => onDelete(save.id)}
        />
      ))}
    </div>
  );
}

function LibraryCard({ save, onReopen, onDelete }) {
  const defaultSection = useMemo(
    () =>
      save.sections?.find((s) => /default/i.test(s.label ?? "")) ??
      save.sections?.[0] ??
      null,
    [save.sections],
  );
  const age = formatAge(save.createdAt);

  return (
    <div className="rounded-xl border border-ink-200 overflow-hidden hover:border-brand-400 transition flex flex-col">
      <div className="bg-ink-50 border-b border-ink-100">
        {defaultSection?.html ? (
          <iframe
            title={`${save.componentName} preview`}
            sandbox="allow-scripts"
            srcDoc={defaultSection.html}
            className="block w-full h-[220px] border-0 pointer-events-none"
          />
        ) : (
          <div className="h-[220px] flex items-center justify-center text-[11px] text-ink-400">
            Preview unavailable
          </div>
        )}
      </div>
      <div className="px-3 py-2.5 flex-1 flex flex-col gap-2">
        <div>
          <div className="text-sm font-semibold text-ink-900 truncate">
            {save.componentName}
          </div>
          {save.description && (
            <p className="text-[11px] text-ink-500 leading-snug mt-0.5 line-clamp-2">
              {save.description}
            </p>
          )}
          <div className="text-[10px] text-ink-400 mt-1.5">
            {save.sections?.length ?? 0} state
            {(save.sections?.length ?? 0) === 1 ? "" : "s"} · {age}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-auto">
          <button
            onClick={onReopen}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-[12px] font-medium rounded-md px-2 py-1.5 bg-brand-500 text-white hover:bg-brand-600 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            Re-open on canvas
          </button>
          <button
            onClick={onDelete}
            title="Delete from library"
            aria-label="Delete from library"
            className="p-1.5 rounded text-ink-500 hover:text-red-600 hover:bg-red-50 outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatAge(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h ago`;
  return new Date(iso).toLocaleDateString();
}
