import type { HuntEvent, HuntState, WolfState } from './schema'

export const initialHuntState: HuntState = {
  hunt_id: null,
  status: 'idle',
  wolves: {},
  boundary: {
    budget_usd: 0,
    spent_usd: 0,
    pct: 0,
    status: 'ok',
    checkpoint_id: null,
    resume_options: [],
  },
  plan: null,
  holds: [],
  active_standoff: null,
  artifacts: [],
  final_artifact_id: null,
  scorecard: null,
  totals: null,
  started_at: null,
  ended_at: null,
  activity: [],
  healers: {},
  last_seq: -1,
}

/** Append a pack beat to the activity log (skips empty text). */
function pushActivity(state: HuntState, seq: number, wolfId: string, text: unknown): HuntState {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return state
  return { ...state, activity: [...state.activity, { seq, wolfId, text: t }] }
}

/** Coerce a wire team payload (items are unknown; backend sends {role,count,tier,thinking,budget})
 *  down to the {role,count} the UI cares about. Returns undefined for a non-array. */
function coerceTeam(raw: unknown): Array<{ role: string; count: number }> | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.map((t) => {
    const e = t as Record<string, unknown>
    return { role: String(e.role), count: Number(e.count) }
  })
}

function setWolf(state: HuntState, wolf_id: string, patch: Partial<WolfState>): HuntState {
  const existing = state.wolves[wolf_id]
  if (!existing) return state
  return {
    ...state,
    wolves: { ...state.wolves, [wolf_id]: { ...existing, ...patch } },
  }
}

/** Settle the roster when a hunt ends: mid-flight wolves become 'done', the standing Warden goes
 *  dormant, faulted wolves keep 'strayed'/'error'. Replay-safe. */
function settleWolves(state: HuntState): HuntState {
  const wolves: HuntState['wolves'] = {}
  for (const [id, w] of Object.entries(state.wolves)) {
    let status = w.status
    if (w.status === 'active' || w.status === 'healing') status = w.role === 'warden' ? 'idle' : 'done'
    wolves[id] = status === w.status ? w : { ...w, status, phase: null }
  }
  return { ...state, wolves, healers: {} }
}

/** Record a phase/tool step in a wolf's timeline, collapsing a repeat of the current phase so
 *  "reading, reading, reading" stays one "reading" step. Rebuilt on replay → replay-safe. */
function pushPhase(state: HuntState, wolf_id: string, phase: string): HuntState {
  const w = state.wolves[wolf_id]
  if (!w || !phase) return state
  // A cached/rehydrated wolf may predate this field — assuming it exists would throw mid-hunt.
  const hist = w.phaseHistory ?? []
  const nextHist = hist[hist.length - 1] === phase ? hist : [...hist, phase]
  return setWolf(state, wolf_id, { phase, phaseHistory: nextHist })
}

export function huntReducer(state: HuntState, event: HuntEvent): HuntState {
  const next = { ...state, last_seq: Math.max(state.last_seq, event.seq) }

  switch (event.type) {
    case 'hunt_created':
      return { ...next, hunt_id: event.hunt_id, status: 'planning', activity: [] }

    case 'input_added':
      return next

    case 'transcript_ready':
      return next

    case 'plan_proposed':
      return {
        ...next,
        status: 'plan_ready',
        plan: {
          steps: event.payload.steps,
          wolves: event.payload.wolves,
          team: coerceTeam(event.payload.team),
          pattern: event.payload.pattern,
          assumptions: event.payload.assumptions,
          est_cost: event.payload.est_cost,
          est_time: event.payload.est_time,
          est_by_depth: event.payload.est_by_depth,
          est_detail: event.payload.est_detail,
          queries: event.payload.queries,
          strategy: event.payload.strategy,
          depth: event.payload.depth,
        },
      }

    case 'plan_edited': {
      // Same shape the optimistic local edit produces, so the two are idempotent.
      if (!next.plan) return next
      const diff = event.payload.diff as Record<string, unknown>
      const plan = { ...next.plan }
      const team = coerceTeam(diff.team)
      if (team) {
        plan.team = team
        plan.wolves = team.flatMap((t) => Array(Math.max(1, t.count)).fill(t.role))
      }
      if (Array.isArray(diff.queries)) plan.queries = (diff.queries as unknown[]).map(String)
      if (Array.isArray(diff.assumptions)) plan.assumptions = (diff.assumptions as unknown[]).map(String)
      return { ...next, plan }
    }

    case 'plan_approved':
      return {
        ...next,
        status: 'running',
        // Known residual: after a Boundary halt→resume no resume event re-anchors this, so the live
        // clock over-reads by the halt gap until completion snaps it to the true totals.time_s.
        // Mitigated by freezing the clock during halted_boundary; full fix needs a resume event.
        started_at: event.ts,
        boundary: {
          ...next.boundary,
          budget_usd: event.payload.boundary_usd,
        },
      }

    case 'wolf_spawned':
      return {
        ...next,
        wolves: {
          ...next.wolves,
          [event.payload.wolf_id]: {
            wolf_id: event.payload.wolf_id,
            role: event.payload.role,
            model_tier: event.payload.model_tier,
            thinking: event.payload.thinking,
            phase: null,
            last_text: null,
            // The Warden is a standing medic, dormant until a wolf faults; every other wolf starts 'active'.
            status: event.payload.role === 'warden' ? 'idle' : 'active',
            cost_usd: 0,
            parent_wolf_id: event.payload.parent_wolf_id ?? null,
            phaseHistory: [],
            lastTool: null,
            lastLatencyMs: null,
            toolCalls: 0,
          },
        },
      }

    case 'step_started':
      return pushActivity(
        setWolf(next, event.payload.wolf_id, { status: 'active' }),
        event.seq, event.payload.wolf_id, event.payload.summary,
      )

    case 'step_completed':
      return setWolf(next, event.payload.wolf_id, { status: 'done', phase: null })

    case 'message_passed':
      return pushActivity(next, event.seq, event.payload.from_wolf, event.payload.summary)

    case 'wolf_progress':
      return pushPhase(
        setWolf(next, event.payload.wolf_id, { last_text: event.payload.text }),
        event.payload.wolf_id,
        event.payload.phase,
      )

    case 'tool_called': {
      const w = next.wolves[event.payload.wolf_id]
      const withCount = w
        ? setWolf(next, event.payload.wolf_id, { toolCalls: (w.toolCalls ?? 0) + 1 })
        : next
      return pushPhase(withCount, event.payload.wolf_id, event.payload.tool)
    }

    case 'tool_result':
      return setWolf(next, event.payload.wolf_id, {
        lastTool: {
          tool: event.payload.tool,
          ok: event.payload.ok,
          latency_ms: event.payload.latency_ms,
        },
      })

    case 'tokens_spent': {
      // SET (not add) from the authoritative cumulative_usd — the backend Boundary owns the running
      // total and can *decrement* it on a refund, which an additive model can't follow and would
      // drift on any stream gap/reconnect. Matches boundary_warning's same absolute field.
      const spent = event.payload.cumulative_usd
      const pct = next.boundary.budget_usd > 0 ? spent / next.boundary.budget_usd : 0
      // Per-wolf cost stays additive (payload has no per-wolf cumulative) — replay-unsafe, but
      // tolerated since WolfState.cost_usd isn't displayed anywhere (shown costs read hunt/scorecard
      // totals). Switch to SET if a per-wolf cost is ever surfaced.
      const cost = event.payload.cost_usd
      const wolf = next.wolves[event.payload.wolf_id]
      return {
        ...next,
        boundary: { ...next.boundary, spent_usd: spent, pct },
        wolves: wolf
          ? {
              ...next.wolves,
              [event.payload.wolf_id]: {
                ...wolf,
                cost_usd: wolf.cost_usd + cost,
                // toolCalls is additive, like cost_usd — live-only, never trusted after a replay.
                lastLatencyMs: event.payload.latency_ms ?? wolf.lastLatencyMs ?? null,
                toolCalls: (wolf.toolCalls ?? 0) + 1,
              },
            }
          : next.wolves,
      }
    }

    case 'hold_opened':
      return {
        ...next,
        status: 'hold',
        holds: [
          ...next.holds,
          {
            hold_id: event.payload.hold_id,
            question: event.payload.question,
            options: event.payload.options,
            recommended: event.payload.recommended,
            context_ref: event.payload.context_ref ?? null,
          },
        ],
      }

    case 'hold_resolved':
      return {
        ...next,
        status: next.holds.length > 1 ? 'hold' : (next.active_standoff ? 'standoff' : 'running'),
        holds: next.holds.filter((h) => h.hold_id !== event.payload.hold_id),
      }

    case 'standoff_opened':
      return {
        ...next,
        status: 'standoff',
        active_standoff: {
          standoff_id: event.payload.standoff_id,
          challenger: event.payload.challenger,
          defendant: event.payload.defendant,
          claim_ref: event.payload.claim_ref,
          turns: [],
          outcome: null,
        },
      }

    case 'standoff_turn':
      if (!next.active_standoff) return next
      return {
        ...next,
        active_standoff: {
          ...next.active_standoff,
          turns: [
            ...next.active_standoff.turns,
            { turn_no: event.payload.turn_no, argument_summary: event.payload.argument_summary },
          ],
        },
      }

    case 'standoff_resolved':
      return {
        ...next,
        status: event.payload.outcome === 'hold_opened' ? 'hold' : 'running',
        active_standoff: next.active_standoff
          ? { ...next.active_standoff, outcome: event.payload.outcome }
          : null,
      }

    case 'stray_detected':
      return setWolf(next, event.payload.wolf_id, { status: 'strayed' })

    case 'stray_recovered':
      return pushActivity(
        setWolf(next, event.payload.wolf_id, { status: 'active' }),
        event.seq, event.payload.wolf_id, event.payload.note_plain_english,
      )

    case 'doctor_dispatched': {
      // Record healer→patient so the canvas can glide the transient healer node beside its patient.
      const healed = setWolf(next, event.payload.target_wolf_id, { status: 'healing' })
      return {
        ...healed,
        healers: { ...healed.healers, [event.payload.doctor_id]: event.payload.target_wolf_id },
      }
    }

    case 'doctor_healed': {
      // Standing Warden ("warden") goes back to idle; a transient clone (warden-2, …) finishes 'done'.
      const { [event.payload.doctor_id]: _done, ...healers } = next.healers
      const healer = next.wolves[event.payload.doctor_id]
      const healerRests: WolfState['status'] =
        healer?.role === 'warden' && event.payload.doctor_id === 'warden' ? 'idle' : 'done'
      const recovered = setWolf(
        setWolf(next, event.payload.target_wolf_id, { status: 'active' }),
        event.payload.doctor_id, { status: healerRests },
      )
      return pushActivity(
        { ...recovered, healers },
        event.seq, event.payload.target_wolf_id, event.payload.note_plain_english,
      )
    }

    case 'boundary_warning':
      return {
        ...next,
        boundary: {
          ...next.boundary,
          status: 'warn',
          pct: event.payload.pct,
          spent_usd: event.payload.cumulative_usd,
        },
      }

    case 'boundary_downgrade': {
      const wolf = next.wolves[event.payload.wolf_id]
      return {
        ...next,
        boundary: { ...next.boundary, status: 'downgraded' },
        wolves: wolf
          ? {
              ...next.wolves,
              [event.payload.wolf_id]: {
                ...wolf,
                model_tier: event.payload.to_tier,
                thinking: !event.payload.thinking_off,
              },
            }
          : next.wolves,
      }
    }

    case 'boundary_halt':
      return {
        ...next,
        status: 'halted_boundary',
        boundary: {
          ...next.boundary,
          status: 'halted',
          checkpoint_id: event.payload.checkpoint_id,
          resume_options: event.payload.resume_options,
        },
      }

    case 'artifact_created':
      return {
        ...next,
        artifacts: [
          ...next.artifacts,
          {
            artifact_id: event.payload.artifact_id,
            kind: event.payload.kind,
            produced_by: event.payload.produced_by,
          },
        ],
      }

    case 'forge_started':
      return next

    case 'forge_completed':
      return next

    case 'hunt_completed':
      return {
        ...settleWolves(next),
        status: 'completed',
        final_artifact_id: event.payload.final_artifact_id,
        totals: event.payload.totals as Record<string, unknown>,
        ended_at: event.ts,
      }

    case 'hunt_failed':
      return { ...settleWolves(next), status: 'failed', ended_at: event.ts }

    case 'hunt_stopped':
      return { ...settleWolves(next), status: 'stopped', ended_at: event.ts }

    case 'benchmark_started':
      return next

    case 'benchmark_completed':
      return { ...next, scorecard: event.payload.scorecard }

    // A deep_scout picking its next tool — narrated on the wolf node via wolf_progress already;
    // no state to fold in. Explicit no-op so the exhaustiveness guard below stays airtight.
    case 'tool_selected':
      return next

    default: {
      const _exhaustive: never = event
      void _exhaustive
      return state
    }
  }
}