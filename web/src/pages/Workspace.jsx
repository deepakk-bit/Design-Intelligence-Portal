import { useEffect } from "react";
import { useLocation } from "wouter";
import { ReactFlowProvider } from "@xyflow/react";
import { useCanvasStore } from "../store.js";
import { getWorkspace, updateWorkspace } from "../lib/storage.js";
import Canvas from "../components/canvas/Canvas.jsx";
import TopBar from "../components/panels/TopBar.jsx";
import AgentLibraryPanel from "../components/panels/AgentLibraryPanel.jsx";
import RightPanel from "../components/panels/RightPanel.jsx";
import BottomControls from "../components/panels/BottomControls.jsx";

export default function Workspace({ id }) {
  const [, navigate] = useLocation();
  const init = useCanvasStore((s) => s.init);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const viewport = useCanvasStore((s) => s.viewport);
  const usage = useCanvasStore((s) => s.usage);
  const workspaceId = useCanvasStore((s) => s.workspaceId);
  const workspaceName = useCanvasStore((s) => s.workspaceName);

  // Hydrate the store from localStorage when entering this workspace.
  useEffect(() => {
    const ws = getWorkspace(id);
    if (!ws) {
      navigate("/");
      return;
    }
    init(ws);
  }, [id]);

  // Auto-save (debounced) whenever canvas state changes.
  useEffect(() => {
    if (workspaceId !== id) return;
    const t = setTimeout(() => {
      updateWorkspace(id, {
        name: workspaceName,
        canvas: { nodes, edges, viewport },
        usage,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [id, workspaceId, workspaceName, nodes, edges, viewport, usage]);

  if (workspaceId !== id) {
    return (
      <div className="h-full flex items-center justify-center text-ink-500 text-sm">
        Loading workspace…
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="relative h-full w-full overflow-hidden bg-[#fafafb]">
        <Canvas />
        <TopBar />
        <AgentLibraryPanel />
        <RightPanel />
        <BottomControls />
      </div>
    </ReactFlowProvider>
  );
}
