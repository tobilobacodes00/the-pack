// Single source of truth for wolf-role copy + colour, shared by the roster
// (left-panel) and the graph hover-tooltip (agent-node) so they never drift.

export const ROLE_DESC: Record<string, string> = {
  alpha:    'Reading your task, building the plan, keeping the pack on track',
  beta:     'Breaking your goal into steps before the hunt begins',
  scout:    'Ranging ahead to find ground truth',
  tracker:  'Reading what the Scouts bring back and giving it shape',
  howler:   'Crafting the final deliverable from verified findings',
  sentinel: 'Challenging any claim not traceable back to a Scout finding',
  elder:    "The pack's memory — recalls lessons from past hunts, records one for next time",
  doctor:   'Verifying integrity and correcting factual errors',
  hunter:   'Running targeted retrieval and deep-dive extraction',
  warden:   'Roaming field-medic — reaches faulted agents and reroutes them so the hunt keeps moving',
}

// The app chrome is monochrome (cream + charcoal), but the AGENTS carry colour — each role a distinct,
// vivid, cream-legible hue so an active pack reads at a glance. Green-free (kept off the therapy sage).
export const ROLE_COLOR: Record<string, string> = {
  alpha:    '#E0912B', // amber — the lead
  beta:     '#6C5CE7', // indigo — the planner
  scout:    '#2D7DD2', // blue — ranges ahead
  tracker:  '#E14434', // red — reads the trail
  howler:   '#B24592', // magenta — the voice
  sentinel: '#5C6B7A', // slate — the challenger
  elder:    '#1E88C4', // cerulean — the counsel
  doctor:   '#1E88C4',
  hunter:   '#E14434',
  warden:   '#E67E22', // orange — the field-medic
}

// The pack shown idle on the canvas + roster before Alpha proposes a real
// formation — the spine + three-scout diamond from the "idle state" design.
export const DEFAULT_IDLE_TEAM = [
  'alpha', 'beta', 'scout', 'scout', 'scout',
  'tracker', 'sentinel', 'howler', 'elder', 'warden',
]

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
]

/** Small-number to word (1–10), falling back to the digit. */
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n)
}
