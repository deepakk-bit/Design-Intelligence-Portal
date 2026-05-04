import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
} from "@xyflow/react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "../../store.js";
import { getAgentDef } from "../../agents.js";
import AgentNode from "./AgentNode.jsx";
import OutputNode from "./OutputNode.jsx";

const nodeTypes = {
  agent: AgentNode,
  output: OutputNode,
};

export default function Canvas() {
  const wrapperRef = useRef(null);
  const rf = useReactFlow();
  const { screenToFlowPosition } = rf;

  // Figma-style canvas controls. Hooked at the wrapper level in the
  // capture phase so modifier-scrolls work even over `.nowheel` nodes.
  //   Cmd/Ctrl + scroll → zoom in/out, anchored at cursor
  //   Shift + scroll    → pan horizontally
  //   Plain scroll      → React Flow handles (pan canvas / scroll node)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!(e.metaKey || e.ctrlKey || e.shiftKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const vp = rf.getViewport();

      if (e.metaKey || e.ctrlKey) {
        // Zoom anchored at the cursor — keep the flow point under the
        // cursor in the same screen position after zoom changes.
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const minZ = 0.2;
        const maxZ = 2;
        const newZoom = Math.min(maxZ, Math.max(minZ, vp.zoom * factor));
        if (newZoom === vp.zoom) return;
        const flowX = (cx - vp.x) / vp.zoom;
        const flowY = (cy - vp.y) / vp.zoom;
        rf.setViewport({
          x: cx - flowX * newZoom,
          y: cy - flowY * newZoom,
          zoom: newZoom,
        });
        return;
      }

      if (e.shiftKey) {
        // Horizontal pan. Browsers translate vertical wheel deltas to
        // deltaX when shift is held on some platforms; honour whichever
        // is non-zero so trackpad + mouse-wheel both work.
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        rf.setViewport({ ...vp, x: vp.x - delta });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [rf]);

  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const viewport = useCanvasStore((s) => s.viewport);
  const setNodes = useCanvasStore((s) => s.setNodes);
  const setEdges = useCanvasStore((s) => s.setEdges);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const addNode = useCanvasStore((s) => s.addNode);

  const onNodesChange = useCallback(
    (changes) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [setNodes],
  );
  const onEdgesChange = useCallback(
    (changes) => setEdges((es) => applyEdgeChanges(changes, es)),
    [setEdges],
  );
  const onConnect = useCallback(
    (conn) => setEdges((es) => addEdge({ ...conn, animated: false }, es)),
    [setEdges],
  );

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      const agentId = e.dataTransfer.getData("application/agent-id");
      if (!agentId) return;
      const def = getAgentDef(agentId);
      if (!def || def.disabled) return;

      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      const node = {
        id: nanoid(8),
        type: "agent",
        position: { x: position.x - 160, y: position.y - 40 },
        data: {
          agentId: def.id,
          status: "idle", // idle | running | done | error
          image: null, // { dataUrl, mediaType, data, name }
          result: null,
          error: null,
          messages: [],
        },
      };
      addNode(node);
      selectNode(node.id);
    },
    [screenToFlowPosition, addNode, selectNode],
  );

  const onPaneClick = useCallback(() => selectNode(null), [selectNode]);
  const onNodeClick = useCallback(
    (_e, node) => selectNode(node.id),
    [selectNode],
  );

  const defaultViewport = useMemo(() => viewport, []); // initial only

  return (
    <div ref={wrapperRef} className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        defaultViewport={defaultViewport}
        onMove={(_e, vp) => setViewport(vp)}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onPaneClick={onPaneClick}
        onNodeClick={onNodeClick}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{}}
        minZoom={0.2}
        maxZoom={2}
        panOnScroll
        selectionOnDrag
        panOnDrag={[1, 2]}
        panActivationKeyCode="Space"
        zoomOnScroll={false}
        zoomOnPinch
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1.4}
          color="#d6dce6"
        />
      </ReactFlow>
    </div>
  );
}
