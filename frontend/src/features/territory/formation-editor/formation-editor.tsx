import { useEffect } from 'react'
import { ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { EditableAgentNode } from './editable-agent-node'
import type { EditableNodeData } from './editable-agent-node'
import { AgentPalette } from './agent-palette'
import { useFormationEditor } from './use-formation-editor'
import { color } from '@/lib/theme'
import type { PlanState } from '@/events/schema'
import type { PendingEdits } from '@/store/hunt-store'

const nodeTypes = { editableAgent: EditableAgentNode }

interface Props {
  plan: PlanState | null
  onSave: (edits: PendingEdits) => void
  onCancel: () => void
}

function EditorCanvas({ plan, onSave, onCancel }: Props) {
  const ed = useFormationEditor(plan)
  const rf = useReactFlow()
  const n = ed.nodes.length

  // Re-fit whenever the pack size changes (add/remove re-arranges the spine).
  useEffect(() => {
    const t = setTimeout(() => void rf.fitView({ padding: 0.25, duration: 200 }), 0)
    return () => clearTimeout(t)
  }, [n, rf])

  return (
    <div className="formation-editor" style={{ position: 'absolute', inset: 0, background: color.canvas }}>
      {/* We draw our own selection ring — hide ReactFlow's default selection box. */}
      <style>{`
        .formation-editor .react-flow__node { pointer-events: all; }
        .formation-editor .react-flow__node.selected,
        .formation-editor .react-flow__node:focus,
        .formation-editor .react-flow__node:focus-visible { box-shadow: none; outline: none; }
      `}</style>
      <ReactFlow
        nodes={ed.nodes}
        edges={ed.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.2}
        maxZoom={1.5}
        panOnScroll
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        selectNodesOnDrag={false}
        // Selecting a node drives the inspector (its note + the Remove control). The node's own
        // onClick also selects; this is the ReactFlow-level backstop.
        onNodeClick={(_, node) => ed.selectWolf((node.data as EditableNodeData).wolfId)}
        onPaneClick={() => ed.selectWolf(null)}
        proOptions={{ hideAttribution: true }}
        colorMode="light"
      >
        {/* Plain black canvas (design) — no dot-grid. */}
      </ReactFlow>

      {/* Cancel / Save — sits just left of the 320px palette */}
      <div style={{ position: 'absolute', top: 16, right: 344, zIndex: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={onCancel}
          style={{ background: 'none', border: 'none', color: color.dim, fontSize: 13, fontWeight: 500, padding: '8px 10px', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(ed.savePayload())}
          style={{ background: color.text, color: color.canvas, border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 600, padding: '9px 22px', cursor: 'pointer' }}
        >
          Save
        </button>
      </div>

      <AgentPalette ed={ed} />
    </div>
  )
}

/** Visual Edit-Formations editor. Wrapped in its own ReactFlowProvider (needed for `useReactFlow`);
 *  scoped to the editor so the read-only canvas is unaffected. */
export function FormationEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorCanvas {...props} />
    </ReactFlowProvider>
  )
}
