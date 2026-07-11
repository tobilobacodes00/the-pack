// Single source of truth for wolf-role copy + colour, shared by the roster
// (left-panel) and the graph hover-tooltip (agent-node) so they never drift.

export const ROLE_DESC: Record<string, string> = {
  alpha:    'Reading your task, building the plan, keeping the pack on track',
  beta:     'Breaking your goal into steps before the hunt begins',
  scout:    'Ranging ahead to find ground truth',
  tracker:  'Reading what the Scouts bring back and giving it shape',
  howler:   'Crafting the final deliverable from verified findings',
  sentinel: 'Challenging any claim not traceable back to a Scout finding',
  elder:    'Advising on strategy and historical context',
  doctor:   'Verifying integrity and correcting factual errors',
  hunter:   'Running targeted retrieval and deep-dive extraction',
}

export const ROLE_COLOR: Record<string, string> = {
  alpha:    '#F59E0B',
  beta:     '#22C55E',
  scout:    '#3B82F6',
  tracker:  '#EF4444',
  howler:   '#8B5CF6',
  sentinel: '#727272',
  elder:    '#06B6D4',
  doctor:   '#06B6D4',
  hunter:   '#EF4444',
}

// The pack shown idle on the canvas + roster before Alpha proposes a real
// formation — the spine + three-scout diamond from the "idle state" design.
export const DEFAULT_IDLE_TEAM = [
  'alpha', 'beta', 'scout', 'scout', 'scout',
  'tracker', 'sentinel', 'howler', 'elder',
]

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
]

/** Small-number to word (1–10), falling back to the digit. */
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n)
}
