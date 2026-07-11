import type { PlanState } from '@/events/schema'

export interface InstinctPayload {
  label: string
  spec: {
    task: string
    strategy: string
    team: Array<{ role: string; count: number }>
  }
}

function deriveTeam(wolves: string[]): Array<{ role: string; count: number }> {
  const counts = new Map<string, number>()
  for (const w of wolves) {
    const role = w.replace(/-?\d+$/, '')
    counts.set(role, (counts.get(role) ?? 0) + 1)
  }
  return [...counts.entries()].map(([role, count]) => ({ role, count }))
}

/** Build the POST /instincts body — a reusable preset from this hunt's task + formation. */
export function buildInstinctPayload(
  label: string,
  task: string,
  plan: PlanState | null,
): InstinctPayload {
  const team = plan?.team ?? deriveTeam(plan?.wolves ?? [])
  return {
    label: (label || task || 'Saved hunt').slice(0, 200),
    spec: {
      task,
      strategy: plan?.strategy ?? 'orchestrate',
      team,
    },
  }
}
