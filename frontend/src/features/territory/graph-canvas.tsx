import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { ReactFlow } from '@xyflow/react'
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react'
import { AgentNode } from './agent-node'
import type { AgentNodeData, AgentTone } from './agent-node'
import { WolfInspector } from './wolf-inspector'
import { ROLE_COLOR } from './roles'
import { wolfIds, planRoleList } from './formation-editor/formation-model'
import type { HuntState, WolfState } from '@/events/schema'
import { color } from '@/lib/theme'

const nodeTypes = { agentNode: AgentNode }

// One role per tier down a single vertical spine, matching the idle-state design;
// only the scouts share a tier (they spread horizontally).
const TIER: Record<string, number> = {
  alpha: 0, beta: 1, scout: 2, tracker: 3, hunter: 3,
  sentinel: 4, howler: 5, elder: 6, doctor: 6, warden: 6,
}

// Roles that aren't part of the plan formation but roam onto the canvas mid-hunt to heal a faulted
// agent. They get a transient node (positioned beside their patient) that isn't in `planRoleList`.
const TRANSIENT_HEALER_ROLES = new Set(['warden'])

export const NODE = 80
const CENTER_X = 300
const Y_STEP = 150
const X_SPREAD = 230
// How far a roaming healer (Warden) sits from the wolf it's tending (px, to the right).
const HEALER_OFFSET = NODE + 24

/** Map a live wolf's status to a canvas tone. Absent OR idle wolf → grey idle. */
function wolfTone(w?: WolfState): AgentTone {
  if (!w || w.status === 'idle') return 'idle'
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
  healers?: Record<string, string>,
  selection?: { selectedId?: string | null; onSelect?: (wolfId: string) => void },
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

  // Two agents sit OFF the execution spine: the Elder (memory/advisor) beside Alpha, and the Warden
  // (the roaming medic) apart on its own, below the pack — it's not part of the research flow, it
  // just watches and heals. Everything else forms the vertical spine.
  const spine = items.filter((it) => it.role !== 'elder' && it.role !== 'warden')
  const elders = items.filter((it) => it.role === 'elder')
  const wardens = items.filter((it) => it.role === 'warden')

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

  // The standing Warden sits ALONE, set apart from the formation: off to the right and below the
  // deepest spine tier, so it reads as the lone medic on watch. (When healing it roams from here to
  // its patient; see the node builder below.)
  const deepestTier = Math.max(0, ...spine.map((it) => TIER[it.role] ?? 6))
  wardens.forEach(({ id }, i) =>
    pos.set(id, { x: CENTER_X + 1.6 * X_SPREAD - NODE / 2, y: (deepestTier + 1) * Y_STEP + i * Y_STEP }),
  )

  const nodes: Node<AgentNodeData>[] = items.map(({ role, id }) => {
    // The standing Warden is a formation node, but when it's actively healing it ROAMS to its patient
    // (from `healers`) and returns to its home slot afterward — the `.warden-roam` transition glides it.
    const patientId = TRANSIENT_HEALER_ROLES.has(role) ? healers?.[id] : undefined
    const patientPos = patientId ? pos.get(patientId) : undefined
    const home = pos.get(id) ?? { x: CENTER_X - NODE / 2, y: 0 }
    const position = patientPos ? { x: patientPos.x + HEALER_OFFSET, y: patientPos.y } : home
    return {
      id,
      type: 'agentNode',
      position,
      data: {
        role, wolfId: id, tone: wolfTone(wolves?.[id]), live: wolves?.[id],
        selected: selection?.selectedId === id, onSelect: selection?.onSelect,
      },
      selectable: false,
      draggable: false,
      ...(TRANSIENT_HEALER_ROLES.has(role) ? { className: 'warden-roam' } : {}),
    }
  })

  // Dashed spine: connect each populated tier to the next; plus Elder → Alpha (the advisor tap). An
  // edge lights up in the source agent's colour once it's working (animated) or done (solid).
  const edges: Edge[] = []
  const pushEdge = (src: string, tgt: string, handles?: { sourceHandle: string; targetHandle: string }) => {
    const tone = wolfTone(wolves?.[src])
    const lit = tone === 'active' || tone === 'done'
    const color = lit ? ROLE_COLOR[idToRole.get(src) ?? ''] ?? '#9a9a9a' : '#9a9a9a'
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

  // OVERFLOW Wardens: the standing Warden (a formation node, handled above) roams to its patient, but
  // when SEVERAL agents fault at once the engine clones extra Wardens (warden-2, warden-3) that aren't
  // in the formation. Render one transient node per clone, positioned BESIDE its own patient (from
  // `healers`) so the `.warden-roam` CSS transition glides it across the canvas. Cleared automatically
  // when the heal completes and the clone leaves `wolves`.
  if (wolves) {
    const formationIds = new Set(items.map((it) => it.id))
    for (const [wid, w] of Object.entries(wolves)) {
      if (!TRANSIENT_HEALER_ROLES.has(w.role) || formationIds.has(wid)) continue
      const patientId = healers?.[wid]
      const patientPos = patientId ? pos.get(patientId) : undefined
      // Beside the patient once assigned; otherwise idle at Alpha's shoulder (the spawn point).
      const p = patientPos
        ? { x: patientPos.x + HEALER_OFFSET, y: patientPos.y }
        : { x: alphaPos.x + X_SPREAD, y: alphaPos.y - Y_STEP }
      nodes.push({
        id: wid,
        type: 'agentNode',
        position: p,
        data: {
          role: w.role, wolfId: wid, tone: wolfTone(w), live: w,
          selected: selection?.selectedId === wid, onSelect: selection?.onSelect,
        },
        selectable: false,
        draggable: false,
        className: 'warden-roam',
      })
    }
  }

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
  const healers = huntState.healers
  const forming = huntState.status === 'planning'

  // The wolf the user clicked to inspect. Cleared when its node leaves the roster.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const onSelect = useCallback(
    (id: string) => setSelectedId((cur) => (cur === id ? null : id)),
    [],
  )
  const selected = selectedId ? wolves[selectedId] : undefined
  // If a selected wolf vanishes (shouldn't happen mid-hunt, but be safe), drop the selection.
  useEffect(() => {
    if (selectedId && !wolves[selectedId]) setSelectedId(null)
  }, [selectedId, wolves])

  // Recompute when the roster changes, any wolf's live state changes (colours the spine), a heal
  // starts/ends (adds/moves/clears a roaming Warden node), or the selection changes (halo).
  const { nodes, edges } = useMemo(
    () => buildGraph(roles, wolves, healers, { selectedId, onSelect }),
    [roles, wolves, healers, selectedId, onSelect],
  )

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
      {/* A roaming Warden glides to its patient: ReactFlow sets transform:translate(x,y) on the node
          wrapper, so a transform transition animates the move across the canvas (GPU-composited, so it
          survives ReactFlow's per-render transform writes). A gentle fade-in as it appears. */}
      <style>{`
        .react-flow__node.warden-roam { transition: transform 900ms cubic-bezier(0.22, 1, 0.36, 1); }
        @keyframes warden-appear { from { opacity: 0 } to { opacity: 1 } }
        .react-flow__node.warden-roam { animation: warden-appear 300ms ease-out; }

        /* Refined, clearly-alive motion (see AskUserQuestion "Refined & subtle"): */
        /* an active wolf gently breathes so it reads as working, not just coloured. */
        @keyframes node-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.045); }
        }
        .node-breathe { animation: node-breathe 2.4s ease-in-out infinite; transform-origin: center; }

        /* a wolf that just finished settles with a single soft flash, then rests calm. */
        @keyframes node-done-settle {
          0% { transform: scale(1); filter: brightness(1); }
          35% { transform: scale(1.12); filter: brightness(1.35); }
          100% { transform: scale(1); filter: brightness(1); }
        }
        .node-done-settle { animation: node-done-settle 650ms cubic-bezier(0.22, 1, 0.36, 1); transform-origin: center; }

        /* the done check badge pops in once. */
        @keyframes glyph-done-pop {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .glyph-done-pop { animation: glyph-done-pop 450ms cubic-bezier(0.34, 1.56, 0.64, 1) 150ms both; }

        /* the selected wolf's halo breathes softly so the inspected node stays obvious. */
        @keyframes node-selected {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        .node-selected-halo { animation: node-selected 2s ease-in-out infinite; }

        @media (prefers-reduced-motion: reduce) {
          .node-breathe, .node-done-settle, .glyph-done-pop, .node-selected-halo,
          .react-flow__node.warden-roam { animation: none !important; }
        }
      `}</style>
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
          colorMode="light"
          onPaneClick={() => setSelectedId(null)}
        />
      </div>

      {/* The clicked wolf's live detail — activity, phase timeline, what it just produced, and stats.
          Floats over the canvas (top-right of the graph area, clear of the roster/chat overlays). */}
      {selected && (
        <WolfInspector wolf={selected} onClose={() => setSelectedId(null)} />
      )}

      {forming && (
        <div
          style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 5,
            display: 'flex', alignItems: 'center', gap: 8, background: color.surface,
            border: '1px solid #dcdcd8', borderRadius: 20, padding: '8px 16px',
            boxShadow: '0 4px 16px rgba(26,26,26,0.12)',
          }}
        >
          <Loader2 size={14} className="animate-spin" color="#A3A3A3" />
          <span style={{ fontSize: 13, color: '#E5E5E5', fontWeight: 500 }}>Beta is forming the pack…</span>
        </div>
      )}
    </div>
  )
}
