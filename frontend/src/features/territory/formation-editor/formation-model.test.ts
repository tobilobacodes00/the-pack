import { describe, it, expect } from 'vitest'
import {
  roleBounds,
  wolfIds,
  buildTeam,
  teamToCounts,
  expandTeamToWolves,
  seedCounts,
  planRoleList,
  addedInstances,
} from './formation-model'
import { DEFAULT_IDLE_TEAM } from '../roles'

describe('roleBounds', () => {
  it('locks leads at 1, scout 1-5, support 1-3', () => {
    expect(roleBounds('alpha')).toEqual({ min: 1, max: 1 })
    expect(roleBounds('beta')).toEqual({ min: 1, max: 1 })
    expect(roleBounds('scout')).toEqual({ min: 1, max: 5 })
    expect(roleBounds('tracker')).toEqual({ min: 1, max: 3 })
  })
})

describe('wolfIds', () => {
  it('numbers scouts scout-1..N', () => {
    expect(wolfIds('scout', 3)).toEqual(['scout-1', 'scout-2', 'scout-3'])
  })
  it('keeps a single non-scout bare, suffixes when >1', () => {
    expect(wolfIds('tracker', 1)).toEqual(['tracker'])
    expect(wolfIds('tracker', 2)).toEqual(['tracker-1', 'tracker-2'])
  })
})

describe('buildTeam', () => {
  it('always yields the canonical 7 roles with leads at 1 and clamped counts', () => {
    const team = buildTeam({ scout: 99, tracker: 0 })
    expect(team.map((t) => t.role)).toEqual([
      'alpha',
      'beta',
      'scout',
      'tracker',
      'sentinel',
      'howler',
      'elder',
    ])
    expect(team.find((t) => t.role === 'alpha')!.count).toBe(1)
    expect(team.find((t) => t.role === 'scout')!.count).toBe(5) // clamped to MAX_SCOUTS
    expect(team.find((t) => t.role === 'tracker')!.count).toBe(1) // 0 → default 1
  })
})

describe('teamToCounts / expandTeamToWolves', () => {
  it('round-trips counts and flattens to a role list', () => {
    const team = [
      { role: 'scout', count: 2 },
      { role: 'tracker', count: 1 },
    ]
    expect(teamToCounts(team)).toEqual({ scout: 2, tracker: 1 })
    expect(expandTeamToWolves(team)).toEqual(['scout', 'scout', 'tracker'])
  })
})

describe('seedCounts', () => {
  it('prefers the explicit team', () => {
    expect(seedCounts({ team: [{ role: 'scout', count: 4 }] })).toEqual({ scout: 4 })
  })
  it('else counts wolves, stripping the -N suffix', () => {
    expect(seedCounts({ wolves: ['scout-1', 'scout-2', 'tracker'] })).toEqual({
      scout: 2,
      tracker: 1,
    })
  })
})

describe('planRoleList', () => {
  it('expands an explicit team', () => {
    expect(planRoleList({ team: [{ role: 'scout', count: 2 }] })).toEqual(['scout', 'scout'])
  })
  it('normalizes wolves through buildTeam', () => {
    const list = planRoleList({ wolves: ['scout-1', 'scout-2'] })
    expect(list.filter((r) => r === 'scout')).toHaveLength(2)
    expect(list).toContain('alpha') // buildTeam re-adds the canonical structure
  })
  it('falls back to the idle team when the plan is empty', () => {
    expect(planRoleList(null)).toEqual(DEFAULT_IDLE_TEAM)
  })
})

describe('addedInstances', () => {
  it('reports only the instances added beyond the base, with deterministic ids', () => {
    const base = [{ role: 'scout', count: 1 }]
    const edited = [{ role: 'scout', count: 3 }]
    const added = addedInstances(base, edited)
    expect(added).toEqual([
      { role: 'scout', wolfId: 'scout-2', index: 2 },
      { role: 'scout', wolfId: 'scout-3', index: 3 },
    ])
  })
  it('is empty when nothing was added', () => {
    expect(addedInstances([{ role: 'scout', count: 2 }], [{ role: 'scout', count: 2 }])).toEqual([])
  })
})
