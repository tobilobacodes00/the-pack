import { wolfLabel } from '@/features/reward/lib/wolf-label'

/**
 * A short title for one activity beat, derived client-side from the wolf and its narration (the beat
 * stores only the wolf_id + body text — no authored title). Renders as the muted heading above the
 * body line in the collapsed status log, e.g. "Scout update", "Tracker working", "Sentinel challenging".
 *
 * Best-effort labels: the role sets the default verb (a Howler writes, a Sentinel challenges, a
 * Tracker cross-references), and a light read of the text upgrades it to a handoff ("Scout passing to
 * Tracker") when the beat clearly narrates one. This is decoration over the real body text below it,
 * so a slightly generic title is fine — the body always carries the specifics.
 */

// The default action verb per role — what that wolf is doing when it narrates a beat.
const ROLE_ACTION: Record<string, string> = {
  alpha: 'directing',
  beta: 'planning',
  scout: 'update',
  tracker: 'working',
  howler: 'writing',
  sentinel: 'challenging',
  elder: 'reviewing',
  hunter: 'chasing',
  doctor: 'healing',
  warden: 'healing',
}

/** Match "… passing/handing (off) to Tracker" style handoffs so the title can name the receiver. */
const HANDOFF_RE = /\b(?:passing|hands?|handing|handoff|passes)\b.*?\bto\s+([a-z]+)/i

export function beatTitle(wolfId: string, text: string): string {
  const { label, role } = wolfLabel(wolfId)
  const roleWord = role ? role.charAt(0).toUpperCase() + role.slice(1) : label

  const handoff = HANDOFF_RE.exec(text ?? '')
  if (handoff) {
    const to = handoff[1]
    const To = to.charAt(0).toUpperCase() + to.slice(1)
    return `${roleWord} passing to ${To}`
  }

  const action = ROLE_ACTION[role] ?? 'update'
  return `${roleWord} ${action}`
}
