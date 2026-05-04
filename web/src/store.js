import { create } from "zustand";

// Per-workspace canvas store. Initialized when entering a workspace.
export const useCanvasStore = create((set, get) => ({
  workspaceId: null,
  workspaceName: "Untitled workspace",
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeId: null,
  rightPanelOpen: false,
  rightPanelTab: "chat", // "chat" | "properties"
  leftPanelOpen: true,

  init({ id, name, canvas }) {
    set({
      workspaceId: id,
      workspaceName: name,
      nodes: canvas?.nodes ?? [],
      edges: canvas?.edges ?? [],
      viewport: canvas?.viewport ?? { x: 0, y: 0, zoom: 1 },
      selectedNodeId: null,
      rightPanelOpen: false,
    });
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
