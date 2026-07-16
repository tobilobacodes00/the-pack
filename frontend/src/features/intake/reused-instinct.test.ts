import { describe, it, expect } from 'vitest'
import { toReusedInstinct, formationSummary } from './use-intake'

describe('toReusedInstinct', () => {
  it('keeps the SHAPE (team + strategy) and drops the baked-in task', () => {
    const r = toReusedInstinct({
      label: 'Market Scan',
      spec: {
        task: 'the old job that must NOT ride along',
        strategy: 'deep_dive',
        team: [
          { role: 'scout', count: 4 },
          { role: 'tracker', count: 2 },
        ],
      },
    })
    expect(r.label).toBe('Market Scan')
    expect(r.strategy).toBe('deep_dive')
    expect(r.team).toEqual([
      { role: 'scout', count: 4 },
      { role: 'tracker', count: 2 },
    ])
    // No task field leaks through — the whole point of the fix.
    expect((r as Record<string, unknown>).task).toBeUndefined()
  })

  it('drops junk entries (missing role, zero/NaN count) and coerces types', () => {
    const r = toReusedInstinct({
      label: 'Messy',
      spec: {
        team: [
          { role: 'scout', count: '3' }, // string count → coerced
          { role: '', count: 2 }, // no role → dropped
          { role: 'tracker', count: 0 }, // zero → dropped
          { count: 5 }, // no role → dropped
          { role: 'sentinel', count: Number.NaN }, // NaN → dropped
        ],
      },
    })
    expect(r.team).toEqual([{ role: 'scout', count: 3 }])
  })

  it('a malformed/empty spec yields an empty team (caller treats as "no seed")', () => {
    expect(toReusedInstinct({ label: 'X', spec: {} }).team).toEqual([])
    expect(toReusedInstinct({ label: 'X', spec: { team: 'nope' as unknown } }).team).toEqual([])
    expect(toReusedInstinct({}).team).toEqual([])
    expect(toReusedInstinct({}).label).toBe('Saved pack') // sane default label
    expect(toReusedInstinct({ spec: { strategy: 42 as unknown } }).strategy).toBeUndefined()
  })
})

describe('formationSummary', () => {
  it('names only the tuned roles, pluralizing, with an Oxford-style join', () => {
    expect(
      formationSummary([
        { role: 'alpha', count: 1 },
        { role: 'beta', count: 1 },
        { role: 'scout', count: 3 },
        { role: 'tracker', count: 2 },
        { role: 'sentinel', count: 1 },
        { role: 'warden', count: 1 },
      ]),
    ).toBe('3 scouts, 2 trackers and 1 sentinel')
  })

  it('single tuned role → no join word', () => {
    expect(formationSummary([{ role: 'scout', count: 1 }])).toBe('1 scout')
  })

  it('leads/warden-only or empty → a graceful fallback phrase', () => {
    expect(formationSummary([{ role: 'alpha', count: 1 }, { role: 'warden', count: 1 }])).toBe(
      'your saved pack',
    )
    expect(formationSummary([])).toBe('your saved pack')
  })
})
