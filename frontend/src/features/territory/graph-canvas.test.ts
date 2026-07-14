import { describe, it, expect } from 'vitest'
import { buildGraph } from './graph-canvas'
import { DEFAULT_IDLE_TEAM } from './roles'
import type { WolfState } from '@/events/schema'

// A live wolf, with sensible defaults you can override per-case.
function wolf(role: string, over: Partial<WolfState> = {}): WolfState {
  return {
    wolf_id: role, role: role as WolfState['role'], model_tier: 'flash', thinking: false,
    phase: null, last_text: null, status: 'active', cost_usd: 0, parent_wolf_id: null, ...over,
  }
}

const nodeById = (nodes: ReturnType<typeof buildGraph>['nodes'], id: string) =>
  nodes.find((n) => n.id === id)

describe('buildGraph — the standing Warden roams to heal', () => {
  it('renders the standing Warden as a formation node on every hunt (idle, at home)', () => {
    // DEFAULT_IDLE_TEAM now includes the Warden — it is always on the canvas, even with no wolves live.
    const { nodes } = buildGraph(DEFAULT_IDLE_TEAM, {}, {})
    const w = nodeById(nodes, 'warden')
    expect(w).toBeDefined()
    expect(w!.data.role).toBe('warden')
  })

  it('roams the standing Warden beside its patient when healing, and greys the sick agent', () => {
    const wolves = {
      'scout-1': wolf('scout-1', { role: 'scout', status: 'strayed' }),
      warden: wolf('warden', { role: 'warden' }),
    }
    const { nodes } = buildGraph(DEFAULT_IDLE_TEAM, wolves, { warden: 'scout-1' })
    const patient = nodeById(nodes, 'scout-1')!
    const warden = nodeById(nodes, 'warden')!
    // roamed beside the patient: same row, offset to the right
    expect(warden.position.y).toBe(patient.position.y)
    expect(warden.position.x).toBeGreaterThan(patient.position.x)
    // the faulted patient reads as sick (grey 'strayed' tone)
    expect(patient.data.tone).toBe('strayed')
    // the Warden carries the class the roam animation hooks onto
    expect(warden.className).toBe('warden-roam')
  })

  it('returns the standing Warden to its home slot when not healing', () => {
    const homeGraph = buildGraph(DEFAULT_IDLE_TEAM, { warden: wolf('warden', { role: 'warden' }) }, {})
    const home = nodeById(homeGraph.nodes, 'warden')!.position
    // while healing, it's elsewhere (beside the patient)…
    const healing = buildGraph(
      DEFAULT_IDLE_TEAM,
      { 'scout-1': wolf('scout-1', { role: 'scout' }), warden: wolf('warden', { role: 'warden' }) },
      { warden: 'scout-1' },
    )
    expect(nodeById(healing.nodes, 'warden')!.position).not.toEqual(home)
  })

  it('spawns overflow clones (warden-2) that roam to their own patients in parallel', () => {
    const wolves = {
      'scout-1': wolf('scout-1', { role: 'scout' }),
      'scout-2': wolf('scout-2', { role: 'scout' }),
      warden: wolf('warden', { role: 'warden' }),
      'warden-2': wolf('warden-2', { role: 'warden' }),
    }
    const { nodes } = buildGraph(DEFAULT_IDLE_TEAM, wolves, { warden: 'scout-1', 'warden-2': 'scout-2' })
    const w1 = nodeById(nodes, 'warden')! // standing (formation node)
    const w2 = nodeById(nodes, 'warden-2')! // overflow clone (transient node)
    expect(w1).toBeDefined()
    expect(w2).toBeDefined()
    expect(w2.className).toBe('warden-roam')
    // each sits beside a DIFFERENT patient → different positions
    expect(w1.position).not.toEqual(w2.position)
  })

  it('overflow clone disappears once its heal completes (leaves `wolves`), Warden stays', () => {
    // clone cleared; the standing Warden remains (it's a formation member, always present).
    const { nodes } = buildGraph(DEFAULT_IDLE_TEAM, { warden: wolf('warden', { role: 'warden' }) }, {})
    expect(nodeById(nodes, 'warden-2')).toBeUndefined()
    expect(nodeById(nodes, 'warden')).toBeDefined()
  })
})
