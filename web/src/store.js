import { create } from "zustand";
import { estimateCost } from "./lib/pricing.js";

// We keep the last `RUN_HISTORY_LIMIT` runs as a small time-series for the
// sparkline. Older runs are dropped (they're still counted in the totals
// because we maintain rolling dollar/token accumulators separately).
const RUN_HISTORY_LIMIT = 50;

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    runs: 0,
    dollars: 0,
    byAgent: {},
    history: [],
  };
}

function normalizeUsage(u) {
  // Backward-compat: workspaces saved before the usage field existed will pass
  // undefined here. Coerce any partial shape into the canonical one.
  return {
    input: u?.input ?? 0,
    output: u?.output ?? 0,
    cacheRead: u?.cacheRead ?? 0,
    cacheWrite: u?.cacheWrite ?? 0,
    runs: u?.runs ?? 0,
    dollars: u?.dollars ?? 0,
    byAgent: u?.byAgent ?? {},
    history: Array.isArray(u?.history) ? u.history : [],
  };
}

// Per-workspace canvas store. Initialized when entering a workspace.
export const useCanvasStore = create((set, get) => ({
  workspaceId: null,
  workspaceName: "Untitled workspace",
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  // Cumulative token usage across every successful agent run in this
  // workspace — survives reruns (which would otherwise overwrite the
  // per-node `data.result.usage` field). Persisted alongside canvas.
  usage: emptyUsage(),
  selectedNodeId: null,
  rightPanelOpen: false,
  rightPanelTab: "chat", // "chat" | "properties"
  leftPanelOpen: true,

  init({ id, name, canvas, usage }) {
    set({
      workspaceId: id,
      workspaceName: name,
      nodes: canvas?.nodes ?? [],
      edges: canvas?.edges ?? [],
      viewport: canvas?.viewport ?? { x: 0, y: 0, zoom: 1 },
      usage: normalizeUsage(usage),
      selectedNodeId: null,
      rightPanelOpen: false,
    });
  },

  // Add a single agent run's usage onto the workspace accumulator. Resilient
  // to undefined/null fields (older agent responses, error paths). Computes
  // dollar cost at run time using the run's specific model so workspace and
  // per-agent totals reconcile by construction (no inference at render time).
  recordUsage(u, agentId, model) {
    const cur = get().usage;
    const run = {
      ts: Date.now(),
      agentId: agentId ?? "unknown",
      model: model ?? null,
      input: u?.input ?? 0,
      output: u?.output ?? 0,
      cacheRead: u?.cacheRead ?? 0,
      cacheWrite: u?.cacheWrite ?? 0,
    };
    const { dollars: runDollars } = estimateCost(run, run.model);
    run.dollars = runDollars;
    const history = [...(cur.history ?? []), run].slice(-RUN_HISTORY_LIMIT);
    const prevAgent = cur.byAgent?.[run.agentId] ?? {};
    set({
      usage: {
        input: (cur.input ?? 0) + run.input,
        output: (cur.output ?? 0) + run.output,
        cacheRead: (cur.cacheRead ?? 0) + run.cacheRead,
        cacheWrite: (cur.cacheWrite ?? 0) + run.cacheWrite,
        runs: (cur.runs ?? 0) + 1,
        dollars: (cur.dollars ?? 0) + runDollars,
        byAgent: {
          ...(cur.byAgent ?? {}),
          [run.agentId]: {
            input: (prevAgent.input ?? 0) + run.input,
            output: (prevAgent.output ?? 0) + run.output,
            cacheRead: (prevAgent.cacheRead ?? 0) + run.cacheRead,
            cacheWrite: (prevAgent.cacheWrite ?? 0) + run.cacheWrite,
            runs: (prevAgent.runs ?? 0) + 1,
            dollars: (prevAgent.dollars ?? 0) + runDollars,
          },
        },
        history,
      },
    });
  },
  resetUsage() {
    set({ usage: emptyUsage() });
  },

  setNodes(updater) {
    set({
      nodes:
        typeof updater === "function" ? updater(get().nodes) : updater,
    });
  },
  setEdges(updater) {
    set({
      edges:
        typeof updater === "function" ? updater(get().edges) : updater,
    });
  },
  setViewport(viewport) {
    set({ viewport });
  },
  setWorkspaceName(name) {
    set({ workspaceName: name });
  },

  selectNode(id) {
    set({ selectedNodeId: id });
  },

  toggleRightPanel(open) {
    set({ rightPanelOpen: open ?? !get().rightPanelOpen });
  },
  setRightPanelTab(tab) {
    set({ rightPanelTab: tab });
  },
  toggleLeftPanel(open) {
    set({ leftPanelOpen: open ?? !get().leftPanelOpen });
  },

  addNode(node) {
    set({ nodes: [...get().nodes, node] });
  },
  updateNodeData(id, patch) {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: typeof patch === "function" ? patch(n.data) : { ...n.data, ...patch },
            }
          : n,
      ),
    });
  },
  removeNode(id) {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    });
  },
  addEdge(edge) {
    set({ edges: [...get().edges, edge] });
  },
}));
