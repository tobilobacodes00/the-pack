import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormationEditor } from './use-formation-editor'
import type { PlanState } from '@/events/schema'

// A plan the AI proposed: 3 scouts + the core support roles (one each).
const PLAN = {
  team: [
    { role: 'alpha', count: 1 },
    { role: 'beta', count: 1 },
    { role: 'scout', count: 3 },
    { role: 'tracker', count: 1 },
    { role: 'sentinel', count: 1 },
    { role: 'howler', count: 1 },
    { role: 'elder', count: 1 },
  ],
  wolves: ['scout-1', 'scout-2', 'scout-3', 'tracker', 'sentinel', 'howler', 'elder'],
} as unknown as PlanState

const scoutCount = (t: { role: string; count: number }[]) =>
  t.find((e) => e.role === 'scout')?.count ?? 0

describe('useFormationEditor', () => {
  it('seeds counts from the AI plan', () => {
    const { result } = renderHook(() => useFormationEditor(PLAN))
    expect(scoutCount(result.current.savePayload().team)).toBe(3)
    expect(result.current.capacity('scout')).toEqual({ count: 3, min: 3, max: 5 })
    expect(result.current.addedCount).toBe(0)
  })

  it('spawn ADDS an agent (count up, capped at max, reflected in savePayload)', () => {
    const { result } = renderHook(() => useFormationEditor(PLAN))
    act(() => result.current.spawn('scout'))
    expect(scoutCount(result.current.savePayload().team)).toBe(4)
    expect(result.current.addedCount).toBe(1)
    // cap at max=5
    act(() => result.current.spawn('scout'))
    act(() => result.current.spawn('scout'))
    expect(scoutCount(result.current.savePayload().team)).toBe(5)
    act(() => result.current.spawn('scout')) // over the cap → no-op
    expect(scoutCount(result.current.savePayload().team)).toBe(5)
  })

  it('removeRole removes an ADDED agent but never below the AI floor', () => {
    const { result } = renderHook(() => useFormationEditor(PLAN))
    act(() => result.current.spawn('scout')) // 3 -> 4
    act(() => result.current.removeRole('scout')) // 4 -> 3 (back to floor)
    expect(scoutCount(result.current.savePayload().team)).toBe(3)
    act(() => result.current.removeRole('scout')) // at floor → no-op (additive-only)
    expect(scoutCount(result.current.savePayload().team)).toBe(3)
  })

  it('savePayload carries the note for an added agent, keyed by its wolf id', () => {
    const { result } = renderHook(() => useFormationEditor(PLAN))
    act(() => result.current.spawn('scout')) // adds scout-4
    act(() => result.current.setNote('scout-4', 'focus on primary sources'))
    const payload = result.current.savePayload()
    expect(payload.notes['scout-4']).toBe('focus on primary sources')
  })

  it('savePayload now carries a note for a CORE wolf too (was dropped when added-only)', () => {
    const { result } = renderHook(() => useFormationEditor(PLAN))
    act(() => result.current.setNote('tracker', 'cite official filings'))
    expect(result.current.savePayload().notes['tracker']).toBe('cite official filings')
  })

  it('drops an orphaned note whose role was reduced back below its count', () => {
    const { result } = renderHook(() => useFormationEditor(PLAN))
    act(() => result.current.spawn('scout')) // scout-4 now exists
    act(() => result.current.setNote('scout-4', 'temp'))
    act(() => result.current.removeRole('scout')) // scout-4 gone
    expect(result.current.savePayload().notes['scout-4']).toBeUndefined()
  })

  it('surfaces a scout its assigned angle from the plan queries (positional)', () => {
    const planWithQueries = { ...PLAN, queries: ['angle A', 'angle B', 'angle C'] } as unknown as PlanState
    const { result } = renderHook(() => useFormationEditor(planWithQueries))
    act(() => result.current.selectWolf('scout-2'))
    expect(result.current.selectedInfo?.query).toBe('angle B')
    act(() => result.current.selectWolf('tracker'))
    expect(result.current.selectedInfo?.query).toBeNull() // non-scouts have no per-instance angle
  })

  it('derives one canvas node per wolf and grows when you add', () => {
    const { result } = renderHook(() => useFormationEditor(PLAN))
    const before = result.current.nodes.length
    act(() => result.current.spawn('tracker'))
    expect(result.current.nodes.length).toBe(before + 1)
  })
})
