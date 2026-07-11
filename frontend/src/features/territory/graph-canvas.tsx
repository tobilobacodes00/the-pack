import { useMemo, useRef, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { ReactFlow } from '@xyflow/react'
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react'
import { AgentNode } from './agent-node'
import type { AgentNodeData, AgentTone } from './agent-node'
import { ROLE_COLOR } from './roles'
import { wolfIds, planRoleList } from './formation-editor/formation-model'
import type { HuntState, WolfState } from '@/events/schema'
import { color } from '@/lib/theme'

const nodeTypes = { agentNode: AgentNode }

// One role per tier down a single vertical spine, matching the idle-state design;
// only the scouts share a tier (they spread horizontally).
const TIER: Record<string, number> = {
  alpha: 0, beta: 1, scout: 2, tracker: 3, hunter: 3,
  sentinel: 4, howler: 5, elder: 6, doctor: 6,
}

export const NODE = 80
const CENTER_X = 300
const Y_STEP = 150
const X_SPREAD = 230

/** Map a live wolf's status to a canvas tone. Absent wolf (idle/plan states) → grey idle. */
function wolfTone(w?: WolfState): AgentTone {
  if (!w) return 'idle'
  if (w.status === 'done') return 'done'
  if (w.status === 'strayed' || w.status === 'error') return 'strayed'
  if (w.status === 'healing') return 'healing'
  return 'active' // 'active'
}

/** Deterministic tier layout: role list → positioned spine nodes + dashed edges. Reused by the
 *  read-only canvas AND the Edit Formations editor (it is the "auto-arrange" — no dagre/elk).
 *  Node ids equal the backend wolf_ids (scout-1, tracker, …) so `wolves[node.id]` resolves to live
 *  state; `wolves` colours the nodes/edges when a hunt is running (undefined → grey idle). */
export function buildGraph(
  roles: string[],
  wolves?: Record<string, WolfState>,
): {
  nodes: Node<AgentNodeData>[]
  edges: Edge[]
} {
  // Assign each role occurrence its deterministic wolf_id (mirrors backend _wolf_ids).
  const roleTotals: Record<string, number> = {}
  for (const r of roles) roleTotals[r] = (roleTotals[r] ?? 0) + 1
  const seen: Record<string, number> = {}
  const items = roles.map((role) => {
    const k = seen[role] ?? 0
    seen[role] = k + 1
    return { role, id: wolfIds(role, roleTotals[role])[k] }
  })
  const idToRole = new Map(items.map((it) => [it.id, it.role]))

  // Elder is the memory/advisor — it sits BESIDE Alpha (its "tap"), not down the execution spine.
  const spine = items.filter((it) => it.role !== 'elder')
  const elders = items.filter((it) => it.role === 'elder')

  // Group the spine ids by tier so same-tier peers (the scouts) spread horizontally.
  const tierGroups: Record<number, string[]> = {}
  spine.forEach(({ role, id }) => {
    const tier = TIER[role] ?? 6
    ;(tierGroups[tier] ??= []).push(id)
  })

  const pos = new Map<string, { x: number; y: number }>()
  spine.forEach(({ role, id }) => {
    const tier = TIER[role] ?? 6
    const ids = tierGroups[tier]
    const posInTier = ids.indexOf(id)
    const totalInTier = ids.length
    const x = CENTER_X + (posInTier - (totalInTier - 1) / 2) * X_SPREAD - NODE / 2
    pos.set(id, { x, y: tier * Y_STEP })
  })

  // Seat the Elder(s) on Alpha's row, offset to its side.
  const alpha = spine.find((it) => it.role === 'alpha')
  const alphaPos = (alpha && pos.get(alpha.id)) || { x: CENTER_X - NODE / 2, y: 0 }
  elders.forEach(({ id }, i) => pos.set(id, { x: alphaPos.x + (i + 1) * X_SPREAD, y: alphaPos.y }))

  const nodes: Node<AgentNodeData>[] = items.map(({ role, id }) => ({
    id,
    type: 'agentNode',
    position: pos.get(id) ?? { x: CENTER_X - NODE / 2, y: 0 },
    data: { role, wolfId: id, tone: wolfTone(wolves?.[id]), live: wolves?.[id] },
    selectable: false,
    draggable: false,
  }))

  // Dashed spine: connect each populated tier to the next; plus Elder → Alpha (the advisor tap). An
  // edge lights up in the source agent's colour once it's working (animated) or done (solid).
  const edges: Edge[] = []
  const pushEdge = (src: string, tgt: string, handles?: { sourceHandle: string; targetHandle: string }) => {
    const tone = wolfTone(wolves?.[src])
    const lit = tone === 'active' || tone === 'done'
    const color = lit ? ROLE_COLOR[idToRole.get(src) ?? ''] ?? '#404040' : '#404040'
    edges.push({
      id: `e-${src}-${tgt}`,
      source: src,
      target: tgt,
      ...(handles ?? {}),
      type: 'straight',
      style: { 
        stroke: color, 
        strokeDasharray: '4 4', 
        strokeWidth: lit ? 2.5 : 2,
        ...(tone === 'active' ? { animationDuration: '3s' } : {})
      },
      animated: tone === 'active',
      selectable: false,
    })
  }
  const sortedTiers = Object.keys(tierGroups).map(Number).sort((a, b) => a - b)
  for (let t = 0; t < sortedTiers.length - 1; t++) {
    for (const src of tierGroups[sortedTiers[t]]) {
      for (const tgt of tierGroups[sortedTiers[t + 1]]) pushEdge(src, tgt)
    }
  }
  // Elder sits on Alpha's row to its right — connect its left handle to Alpha's right for a clean
  // horizontal straight line (not the diagonal a bottom→top edge would draw).
  if (alpha) for (const e of elders) pushEdge(e.id, alpha.id, { sourceHandle: 'ls', targetHandle: 'rt' })

  return { nodes, edges }
}

interface GraphCanvasProps {
  huntState: HuntState
}

export function GraphCanvas({ huntState }: GraphCanvasProps) {
  // Roles come from the plan's canonical team (with leads), NOT plan.wolves (which is wolf-ids); this
  // is what keeps every icon/tier/colour correct. Idle → the default pack.
  const roles = useMemo(() => planRoleList(huntState.plan), [huntState.plan])
  const wolves = huntState.wolves
  const forming = huntState.status === 'planning'

  // Recompute when the roster changes OR any wolf's live state changes (colours the spine).
  const { nodes, edges } = useMemo(() => buildGraph(roles, wolves), [roles, wolves])

  const wrapRef = useRef<HTMLDivElement>(null)
  const rf = useRef<ReactFlowInstance<Node<AgentNodeData>, Edge> | null>(null)

  const refit = () => { void rf.current?.fitView({ padding: 0.2, duration: 200 }) }

  // The panel is measured while the door-fold animation is still running, so the
  // initial fitView locks in a zoomed-in view. Re-fit once the container settles
  // to its real size (and whenever the pack changes).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(refit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { refit() }, [roles])

  return (
    <div ref={wrapRef} style={{ flex: 1, background: color.canvas, position: 'relative' }}>
      {/* Gentle breathing while Alpha forms the pack, so the canvas doesn't read as dead. */}
      <div className={forming ? 'animate-pulse' : undefined} style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(inst) => { rf.current = inst; inst.fitView({ padding: 0.2 }) }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          panOnDrag
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          elementsSelectable={false}
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        />
      </div>

      {forming && (
        <div
          style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 5,
            display: 'flex', alignItems: 'center', gap: 8, background: color.surface,
            border: '1px solid #404040', borderRadius: 20, padding: '8px 16px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <Loader2 size={14} className="animate-spin" color="#A3A3A3" />
          <span style={{ fontSize: 13, color: '#E5E5E5', fontWeight: 500 }}>Alpha is forming the pack…</span>
        </div>
      )}
    </div>
  )
}
