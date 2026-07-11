// Mirrors backend/app/engine/supervisor.py formation logic EXACTLY so the editor is WYSIWYG:
// what the user builds here is precisely what the backend spawns. Any drift here silently
// breaks note-keying (notes are keyed by the deterministic wolf_id) — keep these in lockstep
// with `_wolf_ids` (:82-89) and `_build_team` (:92-118).

import { DEFAULT_IDLE_TEAM } from '../roles'

export type TeamEntry = { role: string; count: number }

export const LEAD_ROLES = ['alpha', 'beta'] as const
export const SUPPORT_ROLES = ['tracker', 'sentinel', 'howler', 'elder'] as const
// Canonical build order — supervisor `_build_team` iterates exactly this (:102).
export const CORE_ORDER = ['alpha', 'beta', 'scout', 'tracker', 'sentinel', 'howler', 'elder'] as const

export const DEFAULT_SCOUTS = 3
export const MIN_SCOUTS = 1
export const MAX_SCOUTS = 5
export const MIN_SUPPORT = 1
export const MAX_SUPPORT = 3

// Roles the user may add / increase. doctor is spawned mid-hunt only; hunter has no `_ROLE_SPEC`
// (would be silently dropped). Leads are locked at 1, so they aren't addable either.
export const SPAWNABLE_ROLES = ['scout', 'tracker', 'sentinel', 'howler', 'elder'] as const

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** The count range the user may set for a role (leads locked at 1). Mirrors `_build_team` clamps. */
export function roleBounds(role: string): { min: number; max: number } {
  if (role === 'alpha' || role === 'beta') return { min: 1, max: 1 }
  if (role === 'scout') return { min: MIN_SCOUTS, max: MAX_SCOUTS }
  return { min: MIN_SUPPORT, max: MAX_SUPPORT }
}

/** Mint wolf ids for a role — EXACT mirror of supervisor `_wolf_ids` (:82-89).
 *  scout → scout-1..N; a single non-scout keeps its bare role name; count>1 → role-1..N (all suffixed). */
export function wolfIds(role: string, count: number): string[] {
  if (role === 'scout') {
    const n = Math.max(1, count)
    return Array.from({ length: n }, (_, i) => `scout-${i + 1}`)
  }
  if (count <= 1) return [role]
  return Array.from({ length: count }, (_, i) => `${role}-${i + 1}`)
}

/** Build the canonical 7-role team from a counts map — mirror of `_build_team` (:92-118).
 *  Core roles are always present; leads forced to 1; scout 1–5; support 1–3. */
export function buildTeam(counts: Record<string, number>): TeamEntry[] {
  return CORE_ORDER.map((role) => {
    if (role === 'alpha' || role === 'beta') return { role, count: 1 }
    if (role === 'scout') return { role, count: clamp(counts.scout || DEFAULT_SCOUTS, MIN_SCOUTS, MAX_SCOUTS) }
    return { role, count: clamp(counts[role] || 1, MIN_SUPPORT, MAX_SUPPORT) }
  })
}

/** Team → counts map. */
export function teamToCounts(team: TeamEntry[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const t of team) m[t.role] = t.count
  return m
}

/** Flatten a team into a flat role list (canvas/roster order) for `buildGraph`. */
export function expandTeamToWolves(team: TeamEntry[]): string[] {
  return team.flatMap((t) => Array.from({ length: Math.max(1, t.count) }, () => t.role))
}

/** Seed editor counts from the plan. Prefers the exact `team` (support clone counts); falls back to
 *  counting `wolves` (which lists one of each support), always re-forced through `buildTeam`. */
export function seedCounts(plan: { team?: TeamEntry[] | null; wolves?: string[] | null } | null): Record<string, number> {
  if (plan?.team && plan.team.length) return teamToCounts(plan.team)
  const counts: Record<string, number> = {}
  for (const w of plan?.wolves ?? []) {
    const role = w.replace(/-\d+$/, '') // scout-1 → scout, tracker-2 → tracker
    counts[role] = (counts[role] ?? 0) + 1
  }
  return counts
}

/** The canonical role list to DISPLAY for a plan — the single source of truth for the roster + canvas.
 *  `plan.wolves` is a list of wolf-ids (scouts suffixed, support bare, NO leads), which breaks every
 *  role-keyed lookup; `plan.team` carries the real roles + counts + leads. Prefer team; fall back to
 *  normalizing wolves (strip the -N and re-force the canonical structure); else the idle pack. */
export function planRoleList(
  plan: { team?: TeamEntry[] | null; wolves?: string[] | null } | null,
): string[] {
  if (plan?.team && plan.team.length) return expandTeamToWolves(plan.team)
  if (plan?.wolves && plan.wolves.length) return expandTeamToWolves(buildTeam(seedCounts(plan)))
  return DEFAULT_IDLE_TEAM
}

/** The instances present in `edited` beyond `base` (per role) — the agents the user ADDED.
 *  Each carries its deterministic wolf_id so a note can be keyed to that exact agent. */
export function addedInstances(
  base: TeamEntry[],
  edited: TeamEntry[],
): Array<{ role: string; wolfId: string; index: number }> {
  const baseCounts = teamToCounts(base)
  const out: Array<{ role: string; wolfId: string; index: number }> = []
  for (const t of edited) {
    const b = baseCounts[t.role] ?? 0
    if (t.count <= b) continue
    const ids = wolfIds(t.role, t.count) // positional: [b..count) are the added ones
    for (let i = b; i < t.count; i++) {
      out.push({ role: t.role, wolfId: ids[i], index: i + 1 })
    }
  }
  return out
}
