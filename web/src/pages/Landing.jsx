import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  Sparkles,
} from "lucide-react";
import {
  listWorkspaces,
  createWorkspace,
  deleteWorkspace,
  duplicateWorkspace,
  updateWorkspace,
} from "../lib/storage.js";
import { aggregateCost, estimateCost, fmtDollars } from "../lib/pricing.js";

export default function Landing() {
  const [, navigate] = useLocation();
  const [workspaces, setWorkspaces] = useState([]);
  const [menuOpen, setMenuOpen] = useState(null);
  const [renaming, setRenaming] = useState(null);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    setWorkspaces(listWorkspaces());
  }

  function handleNew() {
    const ws = createWorkspace();
    navigate(`/w/${ws.id}`);
  }

  function handleDelete(id) {
    if (!confirm("Delete this workspace? This cannot be undone.")) return;
    deleteWorkspace(id);
    refresh();
  }

  function handleDuplicate(id) {
    duplicateWorkspace(id);
    refresh();
  }

  function handleRename(id, name) {
    updateWorkspace(id, { name: name.trim() || "Untitled workspace" });
    setRenaming(null);
    refresh();
  }

  return (
    <div className="min-h-full bg-ink-50">
      <header className="px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/assets/logo-icon.svg" alt="" className="w-8 h-8" />
          <div>
            <div className="font-semibold text-ink-900">Design Intelligence</div>
            <div className="text-xs text-ink-500">
              Multi-agent canvas for design workflows
            </div>
          </div>
        </div>
        <button
          onClick={handleNew}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink-900 text-white text-sm font-medium hover:bg-ink-700 transition"
        >
          <Plus size={16} /> New workspace
        </button>
      </header>

      <main className="px-8 pb-16 max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold text-ink-900 mt-2 mb-1">
          Your workspaces
        </h1>
        <p className="text-sm text-ink-500 mb-6">
          Each workspace is an infinite canvas where you can drop agents, feed
          them screenshots, and chain their outputs.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          <NewCard onClick={handleNew} />
          {workspaces.map((w) => (
            <WorkspaceCard
              key={w.id}
              ws={w}
              onOpen={() => navigate(`/w/${w.id}`)}
              menuOpen={menuOpen === w.id}
              onMenuToggle={() =>
                setMenuOpen(menuOpen === w.id ? null : w.id)
              }
              onMenuClose={() => setMenuOpen(null)}
              renaming={renaming === w.id}
              onStartRename={() => {
                setRenaming(w.id);
                setMenuOpen(null);
              }}
              onRename={(name) => handleRename(w.id, name)}
              onDuplicate={() => {
                handleDuplicate(w.id);
                setMenuOpen(null);
              }}
              onDelete={() => {
                handleDelete(w.id);
                setMenuOpen(null);
              }}
            />
          ))}
        </div>

        {workspaces.length === 0 && (
          <div className="mt-10 text-center text-ink-500 text-sm">
            No workspaces yet — click <span className="font-medium">New
            workspace</span> to start.
          </div>
        )}
      </main>
    </div>
  );
}

function NewCard({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Create new workspace"
      className="aspect-[4/3] rounded-2xl border-2 border-dashed border-ink-200 hover:border-brand-500 hover:bg-white transition flex flex-col items-center justify-center gap-2 text-ink-500 hover:text-brand-600 outline-none focus-visible:border-brand-500 focus-visible:bg-white focus-visible:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <div
        aria-hidden="true"
        className="w-12 h-12 rounded-full bg-ink-100 flex items-center justify-center"
      >
        <Plus size={20} />
      </div>
      <div className="text-sm font-medium">New workspace</div>
    </button>
  );
}

function WorkspaceCard({
  ws,
  onOpen,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  renaming,
  onStartRename,
  onRename,
  onDuplicate,
  onDelete,
}) {
  const [name, setName] = useState(ws.name);
  useEffect(() => setName(ws.name), [ws.name]);

  return (
    <div className="group relative bg-white rounded-2xl border border-ink-200 hover:shadow-floating-lg hover:border-ink-300 transition overflow-hidden">
      <button
        onClick={onOpen}
        aria-label={`Open workspace ${ws.name}`}
        className="block w-full aspect-[4/3] bg-gradient-to-br from-ink-50 to-ink-100 relative outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-inset"
      >
        {ws.thumbnail ? (
          <img
            src={ws.thumbnail}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover"
          />
        ) : (
          <EmptyThumb id={ws.id} />
        )}
      </button>

      <div className="px-4 py-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => onRename(name)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename(name);
                if (e.key === "Escape") onRename(ws.name);
              }}
              className="w-full text-sm font-medium text-ink-900 bg-ink-50 px-2 py-1 -mx-2 -my-1 rounded outline-none ring-1 ring-brand-500"
            />
          ) : (
            <button
              onClick={onOpen}
              className="block w-full text-left text-sm font-medium text-ink-900 truncate hover:text-brand-600"
            >
              {ws.name}
            </button>
          )}
          <div className="text-xs text-ink-500 mt-0.5">
            {timeAgo(ws.updatedAt)}
            {ws.canvas?.nodes?.length
              ? ` · ${ws.canvas.nodes.length} node${ws.canvas.nodes.length === 1 ? "" : "s"}`
              : ""}
            {ws.usage?.runs > 0 && (
              <>
                {" · "}
                <span title="Estimated workspace spend">
                  {fmtDollars(workspaceCost(ws))}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="relative">
          <button
            onClick={onMenuToggle}
            aria-label={`Workspace actions for ${ws.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Workspace actions"
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-100 outline-none transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={onMenuClose}
                aria-hidden="true"
              />
              <div
                role="menu"
                className="absolute right-0 top-8 z-20 w-40 bg-white rounded-lg shadow-floating-lg border border-ink-200 py-1 text-sm"
              >
                <MenuItem icon={Pencil} onClick={onStartRename}>
                  Rename
                </MenuItem>
                <MenuItem icon={Copy} onClick={onDuplicate}>
                  Duplicate
                </MenuItem>
                <MenuItem icon={Trash2} onClick={onDelete} danger>
                  Delete
                </MenuItem>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left outline-none focus-visible:bg-ink-50 hover:bg-ink-50 ${
        danger ? "text-red-600" : "text-ink-700"
      }`}
    >
      <Icon size={14} aria-hidden="true" />
      {children}
    </button>
  );
}

function EmptyThumb({ id }) {
  // Stable hue from id so each workspace looks distinct.
  const hue = [...id].reduce((h, c) => (h + c.charCodeAt(0)) % 360, 0);
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 80% 96%), hsl(${(hue + 40) % 360} 80% 92%))`,
      }}
    >
      <Sparkles size={28} className="text-ink-300" />
    </div>
  );
}

function workspaceCost(ws) {
  const u = ws.usage;
  if (!u) return 0;
  // Prefer the pre-accumulated dollars total (locked in at each run's model
  // rate). Fall back to a fresh estimate for workspaces saved before the
  // dollars field existed.
  if (typeof u.dollars === "number") return u.dollars;
  if (Array.isArray(u.history) && u.history.length > 0) {
    return aggregateCost(u.history).dollars;
  }
  return estimateCost(u, null).dollars;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
