// Mirrors backend/app/engine/supervisor.py EXACTLY so the editor is WYSIWYG. Drift here silently
// breaks note-keying (keyed by the deterministic wolf_id) — keep in lockstep with
// `_wolf_ids` (:82-89) and `_build_team` (:92-118).

import { DEFAULT_IDLE_TEAM } from '../roles'

export type TeamEntry = { role: string; count: number }

export const LEAD_ROLES = ['alpha', 'beta'] as const
export const SUPPORT_ROLES = ['tracker', 'sentinel', 'howler', 'elder'] as const
// Warden is a fixed ×1 standing member, locked like the leads. Mirrors backend roster.FIXED_ROLES.
export const FIXED_ROLES = ['warden'] as const
// Canonical build order — supervisor `build_team` iterates exactly this (leads, scout, support, fixed).
export const CORE_ORDER = ['alpha', 'beta', 'scout', 'tracker', 'sentinel', 'howler', 'elder', 'warden'] as const

export const DEFAULT_SCOUTS = 3
export const MIN_SCOUTS = 1
export const MAX_SCOUTS = 5
export const MIN_SUPPORT = 1
export const MAX_SUPPORT = 3

// Roles the user may add/increase. Warden is fixed (locked ×1); doctor/hunter aren't real roles;
// leads are locked at 1.
export const SPAWNABLE_ROLES = ['scout', 'tracker', 'sentinel', 'howler', 'elder'] as const

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** The count range the user may set for a role (leads + the Warden locked at 1). Mirrors `build_team`. */
export function roleBounds(role: string): { min: number; max: number } {
  if (role === 'alpha' || role === 'beta' || role === 'warden') return { min: 1, max: 1 }
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
  // Non-scout primary keeps its bare id ("tracker", not "tracker-1") — the engine addresses the
  // primary by bare id, so a "tracker-1" primary would KeyError. Mirror backend/app/engine/roster.py.
  const n = Math.max(1, count)
  return [role, ...Array.from({ length: n - 1 }, (_, i) => `${role}-${i + 2}`)]
}

/** Build the canonical 7-role team from a counts map — mirror of `_build_team` (:92-118).
 *  Core roles are always present; leads forced to 1; scout 1–5; support 1–3. */
export function buildTeam(counts: Record<string, number>): TeamEntry[] {
  return CORE_ORDER.map((role) => {
    if (role === 'alpha' || role === 'beta' || role === 'warden') return { role, count: 1 }
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

/** The canonical role list to display for a plan. `plan.wolves` is wolf-ids (no leads), which breaks
 *  role-keyed lookups; `plan.team` carries real roles + counts + leads. Prefer team, fall back to
 *  normalizing wolves, else the idle pack. */
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
