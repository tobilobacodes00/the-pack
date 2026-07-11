import { describe, it, expect } from 'vitest'
import type { PlanState } from '@/events/schema'
import { buildInstinctPayload } from './instinct-spec'

const plan = (over: Partial<PlanState>): PlanState =>
  ({ team: null, wolves: [], strategy: undefined, ...over }) as unknown as PlanState

describe('buildInstinctPayload', () => {
  it('prefers the explicit plan.team', () => {
    const team = [{ role: 'scout', count: 3 }]
    const p = buildInstinctPayload('L', 'task', plan({ team }))
    expect(p.spec.team).toBe(team)
  })

  it('derives the team from wolves when no plan.team (strips -N, counts roles)', () => {
    const p = buildInstinctPayload('L', 'task', plan({ wolves: ['scout-1', 'scout-2', 'tracker'] }))
    expect(p.spec.team).toContainEqual({ role: 'scout', count: 2 })
    expect(p.spec.team).toContainEqual({ role: 'tracker', count: 1 })
  })

  it('label falls back label → task → "Saved hunt" and caps at 200 chars', () => {
    expect(buildInstinctPayload('', 'the task', null).label).toBe('the task')
    expect(buildInstinctPayload('', '', null).label).toBe('Saved hunt')
    expect(buildInstinctPayload('x'.repeat(300), '', null).label).toHaveLength(200)
  })

  it('defaults strategy to orchestrate', () => {
    expect(buildInstinctPayload('L', 't', null).spec.strategy).toBe('orchestrate')
    expect(buildInstinctPayload('L', 't', plan({ strategy: 'deep_dive' })).spec.strategy).toBe(
      'deep_dive',
    )
  })
})
