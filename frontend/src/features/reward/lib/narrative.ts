import type { RawTrackEvent } from '@/api/hunts'
import { wolfLabel } from './wolf-label'

export interface NarrativeItem {
  id: string
  title: string
  detail: string
  color: string
}

export interface TrackStats {
  costLabel: string
  timeLabel: string
}

const PHASE_WORD: Record<string, string> = {
  thinking: 'thinking',
  searching: 'update',
  reading: 'update',
  merging: 'working',
  writing: 'writing',
  critiquing: 'challenging',
  forge: 'working',
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0) || 0
}

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

/** Turn the raw event log into the Tracks narrative — the human-readable beats of the hunt. */
export function deriveNarrative(events: RawTrackEvent[]): NarrativeItem[] {
  const out: NarrativeItem[] = []
  for (const e of events) {
    const p = e.payload ?? {}
    const id = `${e.seq}`
    switch (e.type) {
      case 'wolf_progress': {
        const w = wolfLabel(str(p.wolf_id) || e.actor)
        const phase = str(p.phase)
        out.push({
          id,
          title: phase === 'forge' ? 'Making the files' : `${w.label} ${PHASE_WORD[phase] ?? 'update'}`,
          detail: str(p.text),
          color: w.color,
        })
        break
      }
      case 'message_passed': {
        const from = wolfLabel(str(p.from_wolf))
        const to = wolfLabel(str(p.to_wolf))
        out.push({
          id,
          title: `${from.label} passing to ${to.label}`,
          detail: str(p.summary),
          color: from.color,
        })
        break
      }
      case 'standoff_opened': {
        const ch = wolfLabel(str(p.challenger))
        const df = wolfLabel(str(p.defendant))
        out.push({
          id,
          title: `${ch.label} challenging`,
          detail: `${ch.label} is challenging ${df.label} on an uncited claim.`,
          color: ch.color,
        })
        break
      }
      case 'standoff_resolved':
        out.push({
          id,
          title: 'Standoff resolved',
          detail: str(p.rationale) || `Resolved by ${str(p.outcome) || 'agreement'}.`,
          color: wolfLabel('sentinel').color,
        })
        break
      case 'hold_resolved':
        // Alpha's autonomous (Wild-mode) conflict call — surface WHY it chose. A human-resolved hold
        // isn't narrated here (the user made that call themselves).
        if (p.auto) {
          out.push({
            id,
            title: 'Alpha made the call',
            detail: str(p.rationale)
              ? `${str(p.resolution)} — ${str(p.rationale)}`
              : str(p.resolution),
            color: wolfLabel('alpha').color,
          })
        }
        break
      case 'stray_recovered':
        out.push({
          id,
          title: 'Stray note',
          detail: str(p.note_plain_english),
          color: '#EF4444',
        })
        break
      case 'boundary_warning':
        out.push({
          id,
          title: `Boundary at ${Math.round(num(p.pct))}%`,
          detail: `$${num(p.cumulative_usd).toFixed(2)} spent · hunt continuing`,
          color: '#EAB308',
        })
        break
      case 'boundary_downgrade':
        out.push({
          id,
          title: 'Boundary downgrade',
          detail: `${wolfLabel(str(p.wolf_id)).label} dropped ${str(p.from_tier)} → ${str(p.to_tier)} to stay in budget.`,
          color: '#EAB308',
        })
        break
      case 'hunt_completed':
        out.push({
          id,
          title: 'Hunt returned',
          detail: 'The pack brought the result home.',
          color: '#1a1a1a',
        })
        break
      default:
        break
    }
  }
  return out
}

/** Header stats for the Tracks drawer: total spend + time worked. */
export function deriveTrackStats(
  events: RawTrackEvent[],
  totals: Record<string, unknown> | null,
): TrackStats {
  let streamCost = 0
  for (const e of events) {
    if (e.type === 'tokens_spent') streamCost = num(e.payload?.cumulative_usd) || streamCost
  }
  const cost = num(totals?.cost_usd) || streamCost
  const timeS = num(totals?.time_s)
  return {
    costLabel: `$${cost.toFixed(2)} spent`,
    timeLabel: `Worked for ${mmss(timeS)}`,
  }
}
