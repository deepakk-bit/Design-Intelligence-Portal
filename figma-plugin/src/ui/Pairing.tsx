// First-run pairing screen. User pastes their library code (UUID) from
// the web app, plus the deployment URL (defaults to the production host
// but editable for local dev). We validate by listing the library — a
// 200 proves both fields work.

import { h } from "preact";
import { useState } from "preact/hooks";

const DEFAULT_API_BASE = "https://design-intelligence-portal.vercel.app";

type Config = { apiBase: string; libraryCode: string };

export function Pairing(props: {
  onPaired: (cfg: Config) => void;
  validate: (cfg: Config) => Promise<void>;
}) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [libraryCode, setLibraryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: Event) {
    e.preventDefault();
    setError(null);
    const cfg: Config = {
      apiBase: apiBase.trim(),
      libraryCode: libraryCode.trim(),
    };
    if (!cfg.apiBase || !cfg.libraryCode) {
      setError("Both fields are required.");
      return;
    }
    setBusy(true);
    try {
      await props.validate(cfg);
      props.onPaired(cfg);
    } catch (err: any) {
      setError(err?.message || "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Pair with your library</div>
        <p style={{ color: "var(--text-dim)", marginTop: 6, lineHeight: 1.5 }}>
          Paste the pairing code from the web app (top-right bookmark icon).
          The code is the same UUID that owns your saved designs.
        </p>
      </div>

      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Library code
          </span>
          <input
            type="text"
            value={libraryCode}
            onInput={(e: any) => setLibraryCode(e.currentTarget.value)}
            placeholder="paste UUID"
            autoFocus
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Deployment URL
          </span>
          <input
            type="text"
            value={apiBase}
            onInput={(e: any) => setApiBase(e.currentTarget.value)}
            placeholder="https://your-deployment.vercel.app"
          />
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            Use http://localhost:4000 when running the web app locally.
          </span>
        </label>

        {error && (
          <div style={{ background: "var(--error-bg)", color: "var(--error)", padding: "8px 10px", borderRadius: 6, fontSize: 12, lineHeight: 1.4 }}>
            {error}
          </div>
        )}

        <button type="submit" class="primary" disabled={busy}>
          {busy ? "Checking…" : "Pair plugin"}
        </button>
      </form>

      <div style={{ marginTop: "auto", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
        New here? Open the web app, click the Bookmark icon in the top
        bar, and copy your pairing code. Saves you make there will show
        up in the gallery below once you pair.
      </div>
    </div>
  );
}
