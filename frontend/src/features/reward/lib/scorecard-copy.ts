import type { Scorecard, ScorecardSide } from '@/api/hunts'

/** The judge scores quality 0..1; fall back to citation density when it's out of range. */
export function accuracyPct(side: ScorecardSide): number {
  if (side.quality > 0 && side.quality <= 1) return Math.round(side.quality * 100)
  if (side.sources > 0) return Math.min(100, Math.round((side.citations / side.sources) * 100))
  return 0
}

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

/** "1m 30s" / "45s" / "2m" — the Scorecard's Time column format (matches the design). */
export function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m && sec) return `${m}m ${sec}s`
  if (m) return `${m}m`
  return `${sec}s`
}

export function usd(v: number): string {
  return `$${(v ?? 0).toFixed(2)}`
}

/** A derived one-line verdict — presentational, never a backend field. */
export function deriveVerdict(sc: Scorecard): string {
  const p = sc.pack
  const l = sc.lone_wolf
  const moreSources = p.sources - l.sources
  const costlier = p.cost_usd >= l.cost_usd
  const slower = p.time_s >= l.time_s
  const sharper = accuracyPct(p) > accuracyPct(l)

  const cost = `The pack cost ${costlier ? 'more' : 'less'} and took ${slower ? 'longer' : 'less time'}.`
  let caught = ''
  if (moreSources > 0) {
    caught = ` It also caught what the lone wolf missed — ${moreSources} more source${moreSources === 1 ? '' : 's'}.`
  } else if (sharper) {
    caught = ' It also caught what the lone wolf missed.'
  }
  return cost + caught
}
