import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect } from 'vitest'
import { huntReducer, initialHuntState } from './reducer'
import { HuntEventSchema } from './schema'
import type { HuntState } from './schema'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../../../backend/fixtures')

function replayFixture(filename: string): HuntState {
  const lines = readFileSync(resolve(FIXTURES, filename), 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)

  return lines.reduce((state, line) => {
    const result = HuntEventSchema.safeParse(JSON.parse(line))
    if (!result.success) return state
    return huntReducer(state, result.data)
  }, initialHuntState)
}

describe('huntReducer fixture replay', () => {
  it('flow_a_researcher: hunt completes', () => {
    const state = replayFixture('flow_a_researcher.jsonl')
    expect(state.status).toBe('completed')
    expect(Object.keys(state.wolves).length).toBeGreaterThan(0)
    expect(state.final_artifact_id).not.toBeNull()
  })

  it('flow_b_meeting: hunt completes', () => {
    const state = replayFixture('flow_b_meeting.jsonl')
    expect(state.status).toBe('completed')
  })

  it('boundary_halt: hunt halts at spend cap', () => {
    const state = replayFixture('boundary_halt.jsonl')
    expect(state.status).toBe('halted_boundary')
    expect(state.boundary.status).toBe('halted')
    expect(state.boundary.checkpoint_id).not.toBeNull()
  })

  it('standoff_stray: standoff opens and resolves', () => {
    const state = replayFixture('standoff_stray.jsonl')
    expect(['running', 'completed', 'stopped', 'failed']).toContain(state.status)
    expect(state.last_seq).toBeGreaterThan(0)
  })

  it('reducer is pure: same input always produces same output', () => {
    const state1 = replayFixture('flow_a_researcher.jsonl')
    const state2 = replayFixture('flow_a_researcher.jsonl')
    expect(state1).toEqual(state2)
  })
})

// --- Warden healing flow -----------------------------------------------------------------
// The roaming Warden heals a faulted wolf. Events ride the frozen `doctor_*` types with the Warden's
// id in `doctor_id` (see backend healing.py). Drives the arc: patient strays (grey) → Warden dispatched
// (patient healing, healer→patient recorded) → healed (patient active, healer stands down + cleared).

let seq = 0
function ev(type: string, actor: string, payload: Record<string, unknown>) {
  const raw = { event_id: `e${seq}`, hunt_id: 'h', seq: seq++, ts: '2026-07-12T00:00:00Z', actor, type, payload }
  const parsed = HuntEventSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`bad event ${type}: ${parsed.error.message}`)
  return parsed.data
}
function spawn(wolf_id: string, role: string) {
  return ev('wolf_spawned', 'engine', { wolf_id, role, model_tier: 'flash', thinking: false, prompt_version: `${role}/v1` })
}
function apply(state: HuntState, ...events: ReturnType<typeof ev>[]): HuntState {
  return events.reduce(huntReducer, state)
}

// --- Spend/time counter -----------------------------------------------------------------
// tokens_spent SETS the hunt total from the event's authoritative cumulative_usd (never adds the
// incremental cost_usd), so it's idempotent under stream replay/reconnect, follows backend refunds,
// and agrees with boundary_warning (which sets the same absolute field). plan_approved anchors the
// live clock via the server ts.

// --- Per-wolf enrichment (drives the canvas wolf-inspector) -------------------------------
describe('wolf enrichment: phase trail + last tool + latency', () => {
  it('builds a phase trail, collapsing consecutive repeats, and records the last tool/latency', () => {
    seq = 0
    let s = apply(initialHuntState, spawn('scout-1', 'scout'))
    s = apply(s, ev('tool_called', 'scout-1', { wolf_id: 'scout-1', tool: 'web_search', args_summary: 'ev market' }))
    s = apply(s, ev('tool_result', 'scout-1', { wolf_id: 'scout-1', tool: 'web_search', ok: true, latency_ms: 820 }))
    s = apply(s, ev('wolf_progress', 'scout-1', { wolf_id: 'scout-1', phase: 'reading', text: 'reading the top page' }))
    // a repeat of the current phase must NOT add a second trail entry
    s = apply(s, ev('wolf_progress', 'scout-1', { wolf_id: 'scout-1', phase: 'reading', text: 'still reading' }))
    s = apply(s, ev('wolf_progress', 'scout-1', { wolf_id: 'scout-1', phase: 'thinking', text: 'now summarizing' }))

    const w = s.wolves['scout-1']
    expect(w.phaseHistory).toEqual(['web_search', 'reading', 'thinking'])
    expect(w.phase).toBe('thinking')
    expect(w.last_text).toBe('now summarizing')
    expect(w.lastTool).toEqual({ tool: 'web_search', ok: true, latency_ms: 820 })
    expect(w.toolCalls).toBe(1)
  })

  it('records model-call latency from tokens_spent', () => {
    seq = 0
    let s = apply(initialHuntState, spawn('tracker', 'tracker'))
    s = apply(s, ev('tokens_spent', 'tracker', { wolf_id: 'tracker', model: 'm', in_tokens: 5, out_tokens: 2, cost_usd: 0.02, cumulative_usd: 0.02, latency_ms: 1900 }))
    expect(s.wolves['tracker'].lastLatencyMs).toBe(1900)
  })

  it('spawns a wolf with empty enrichment fields (never undefined)', () => {
    seq = 0
    const s = apply(initialHuntState, spawn('howler', 'howler'))
    const w = s.wolves['howler']
    expect(w.phaseHistory).toEqual([])
    expect(w.lastTool).toBeNull()
    expect(w.lastLatencyMs).toBeNull()
    expect(w.toolCalls).toBe(0)
  })
})

describe('spend counter: tokens_spent is authoritative + idempotent', () => {
  it('sets spent_usd from cumulative_usd, not the additive sum of cost_usd', () => {
    seq = 0
    let s = apply(initialHuntState, spawn('scout-1', 'scout'))
    s = apply(s, ev('plan_approved', 'user', { mode: 'on_signal', boundary_usd: 1.0 }))
    // cumulative jumps 0.10 → 0.25 → 0.40; each event's cost_usd is its increment.
    s = apply(s, ev('tokens_spent', 'scout-1', { wolf_id: 'scout-1', model: 'm', in_tokens: 1, out_tokens: 1, cost_usd: 0.10, cumulative_usd: 0.10 }))
    s = apply(s, ev('tokens_spent', 'scout-1', { wolf_id: 'scout-1', model: 'm', in_tokens: 1, out_tokens: 1, cost_usd: 0.15, cumulative_usd: 0.25 }))
    s = apply(s, ev('tokens_spent', 'scout-1', { wolf_id: 'scout-1', model: 'm', in_tokens: 1, out_tokens: 1, cost_usd: 0.15, cumulative_usd: 0.40 }))
    expect(s.boundary.spent_usd).toBeCloseTo(0.40, 6) // == last cumulative_usd
    expect(s.boundary.pct).toBeCloseTo(0.40, 6) // recomputed against budget 1.0
  })

  it('follows a backend refund: a later, LOWER cumulative_usd lowers the total (additive could not)', () => {
    seq = 0
    let s = apply(initialHuntState, spawn('scout-1', 'scout'), ev('plan_approved', 'user', { mode: 'on_signal', boundary_usd: 1.0 }))
    s = apply(s, ev('tokens_spent', 'scout-1', { wolf_id: 'scout-1', model: 'm', in_tokens: 1, out_tokens: 1, cost_usd: 0.30, cumulative_usd: 0.30 }))
    // A failed call is refunded on the backend, so the NEXT event's cumulative is lower than before.
    s = apply(s, ev('tokens_spent', 'scout-1', { wolf_id: 'scout-1', model: 'm', in_tokens: 0, out_tokens: 0, cost_usd: 0.05, cumulative_usd: 0.22 }))
    expect(s.boundary.spent_usd).toBeCloseTo(0.22, 6)
  })

  it('is idempotent under replay: re-applying the same tokens_spent does not inflate the total', () => {
    seq = 0
    let s = apply(initialHuntState, spawn('scout-1', 'scout'), ev('plan_approved', 'user', { mode: 'on_signal', boundary_usd: 1.0 }))
    const spend = ev('tokens_spent', 'scout-1', { wolf_id: 'scout-1', model: 'm', in_tokens: 1, out_tokens: 1, cost_usd: 0.20, cumulative_usd: 0.20 })
    s = apply(s, spend)
    s = apply(s, spend) // a reconnect/gap re-delivers the same event
    expect(s.boundary.spent_usd).toBeCloseTo(0.20, 6) // NOT 0.40
  })

  it('boundary_warning and a following tokens_spent AGREE (both absolute) — no jump', () => {
    seq = 0
    let s = apply(initialHuntState, spawn('scout-1', 'scout'), ev('plan_approved', 'user', { mode: 'on_signal', boundary_usd: 1.0 }))
    s = apply(s, ev('tokens_spent', 'scout-1', { wolf_id: 'scout-1', model: 'm', in_tokens: 1, out_tokens: 1, cost_usd: 0.70, cumulative_usd: 0.70 }))
    // Boundary warns at 70% and sets the absolute cumulative — the SAME field tokens_spent sets.
    s = apply(s, ev('boundary_warning', 'engine', { pct: 0.70, cumulative_usd: 0.70 }))
    expect(s.boundary.spent_usd).toBeCloseTo(0.70, 6)
    expect(s.boundary.status).toBe('warn')
    // The next spend continues smoothly from the warned truth — no snap/jump.
    s = apply(s, ev('tokens_spent', 'scout-1', { wolf_id: 'scout-1', model: 'm', in_tokens: 1, out_tokens: 1, cost_usd: 0.10, cumulative_usd: 0.80 }))
    expect(s.boundary.spent_usd).toBeCloseTo(0.80, 6)
  })

  it('plan_approved anchors the live clock with the server ts', () => {
    seq = 0
    const approve = ev('plan_approved', 'user', { mode: 'on_signal', boundary_usd: 1.0 })
    const s = apply(initialHuntState, approve)
    expect(s.status).toBe('running')
    expect(s.started_at).toBe(approve.ts)
    // Replaying the same approval re-sets the identical anchor (reconnect-safe).
    const s2 = apply(s, approve)
    expect(s2.started_at).toBe(approve.ts)
  })
})

describe('Warden healing flow', () => {
  it('a Warden heals a faulted scout: idle → healing → back to idle, healer map set then cleared', () => {
    seq = 0
    let s = apply(initialHuntState, spawn('scout-1', 'scout'))
    // fault: the scout strays and greys out
    s = apply(s, ev('stray_detected', 'engine', { wolf_id: 'scout-1', pattern: 'timeout', evidence_ref: 'art_x' }))
    expect(s.wolves['scout-1'].status).toBe('strayed')

    // the standing Warden is dormant until a fault: it spawns idle, not "working".
    s = apply(s, spawn('warden', 'warden'))
    expect(s.wolves['warden'].status).toBe('idle')
    s = apply(s, ev('doctor_dispatched', 'warden', { doctor_id: 'warden', target_wolf_id: 'scout-1', reason: 'timeout' }))
    expect(s.wolves['scout-1'].status).toBe('healing')
    expect(s.healers['warden']).toBe('scout-1')

    // healed: patient recovers; the STANDING Warden goes back to dormant/idle (not done), ready again.
    s = apply(s, ev('doctor_healed', 'warden', {
      doctor_id: 'warden', target_wolf_id: 'scout-1', action: 'reroute',
      note_plain_english: 'warden patched scout-1 after it stalled.',
    }))
    expect(s.wolves['scout-1'].status).toBe('active')
    expect(s.wolves['warden'].status).toBe('idle')
    expect(s.healers['warden']).toBeUndefined()
    expect(s.activity.some((a) => a.text.includes('warden'))).toBe(true)
  })

  it('when the hunt ends, no wolf still reads as working (Warden idle, others done)', () => {
    seq = 0
    let s = apply(initialHuntState, spawn('scout-1', 'scout'), spawn('warden', 'warden'))
    expect(s.wolves['scout-1'].status).toBe('active')
    expect(s.wolves['warden'].status).toBe('idle')
    s = apply(s, ev('hunt_completed', 'engine', { final_artifact_id: 'art_final', totals: {} }))
    expect(s.status).toBe('completed')
    expect(s.wolves['scout-1'].status).toBe('done') // was mid-flight → settled to done
    expect(s.wolves['warden'].status).toBe('idle') // the standing medic stays dormant, never "working"
  })

  it('two faults at once → two Wardens, each mapped to its own patient (parallel)', () => {
    seq = 0
    let s = apply(initialHuntState, spawn('scout-1', 'scout'), spawn('scout-2', 'scout'))
    s = apply(s,
      spawn('warden', 'warden'),
      ev('doctor_dispatched', 'warden', { doctor_id: 'warden', target_wolf_id: 'scout-1', reason: 'timeout' }),
      spawn('warden-2', 'warden'),
      ev('doctor_dispatched', 'warden-2', { doctor_id: 'warden-2', target_wolf_id: 'scout-2', reason: 'repeat_fail' }),
    )
    expect(s.healers).toEqual({ warden: 'scout-1', 'warden-2': 'scout-2' })
    // healing one clears only that healer
    s = apply(s, ev('doctor_healed', 'warden', {
      doctor_id: 'warden', target_wolf_id: 'scout-1', action: 'reroute', note_plain_english: 'warden patched scout-1.',
    }))
    expect(s.healers).toEqual({ 'warden-2': 'scout-2' })
  })
})

describe('plan_proposed carries adaptive depth', () => {
  const proposed = (depth?: string) => ev('plan_proposed', 'beta', {
    steps: [], wolves: ['scout-1'], pattern: 'parallel_then_merge', assumptions: [],
    est_cost: 0.7, est_time: 220, ...(depth ? { depth } : {}),
  })

  it('lands the depth on the plan when present', () => {
    seq = 0
    const s = apply(initialHuntState, proposed('deep'))
    expect(s.plan?.depth).toBe('deep')
  })

  it('leaves depth undefined when the event omits it (back-compat)', () => {
    seq = 0
    const s = apply(initialHuntState, proposed())
    expect(s.plan?.depth).toBeUndefined()
  })
})