import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, renderHook } from '@testing-library/react'
import { huntReducer, initialHuntState } from '@/events/reducer'
import { HuntEventSchema } from '@/events/schema'
import type { HuntState } from '@/events/schema'
import { useReplay } from './use-replay'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../../../../backend/fixtures')

function loadRaw(filename: string): unknown[] {
  return readFileSync(resolve(FIXTURES, filename), 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown)
}

function fullReduce(raw: unknown[]): HuntState {
  return raw.reduce<HuntState>((state, r) => {
    const p = HuntEventSchema.safeParse(r)
    return p.success ? huntReducer(state, p.data) : state
  }, initialHuntState)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useReplay — the Flight Recorder engine', () => {
  it('parses a real committed log and starts at the beginning', () => {
    const raw = loadRaw('flow_a_researcher.jsonl')
    const { result } = renderHook(() => useReplay(raw))
    expect(result.current.events.length).toBeGreaterThan(0)
    expect(result.current.index).toBe(0)
    expect(result.current.state).toEqual(initialHuntState)
    expect(result.current.currentSeq).toBe(-1)
  })

  it('seeking to the end reproduces EXACTLY the live reducer’s final state', () => {
    const raw = loadRaw('flow_a_researcher.jsonl')
    const { result } = renderHook(() => useReplay(raw))
    act(() => result.current.seek(result.current.events.length))
    expect(result.current.state).toEqual(fullReduce(raw))
    expect(result.current.state.status).toBe('completed')
  })

  it('scrubbing is replay-safe — any position is a valid intermediate state', () => {
    const raw = loadRaw('flow_a_researcher.jsonl')
    const { result } = renderHook(() => useReplay(raw))
    const mid = Math.floor(result.current.events.length / 2)
    act(() => result.current.seek(mid))
    expect(result.current.currentSeq).toBe(result.current.events[mid - 1].seq)
    // scrub backwards — states are precomputed, so rewinding is exact, not re-derived drift
    act(() => result.current.seek(1))
    expect(result.current.state.status).not.toBe('completed')
  })

  it('skips malformed/unknown events instead of crashing (live-stream policy)', () => {
    const raw = [
      ...loadRaw('flow_a_researcher.jsonl'),
      { type: 'not_a_real_event', seq: 9999 },
      'garbage',
      null,
    ]
    const { result } = renderHook(() => useReplay(raw))
    act(() => result.current.seek(result.current.events.length))
    expect(result.current.state.status).toBe('completed')
  })

  it('play advances one event per tick and stops cleanly at the end', () => {
    vi.useFakeTimers()
    const raw = loadRaw('flow_a_researcher.jsonl').slice(0, 5)
    const { result } = renderHook(() => useReplay(raw, 100))
    act(() => result.current.toggle())
    expect(result.current.playing).toBe(true)
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.index).toBe(1)
    // each tick schedules the NEXT one in an effect — flush per tick, like the browser does
    for (let i = 0; i < 10; i++) act(() => vi.advanceTimersByTime(100))
    expect(result.current.index).toBe(result.current.events.length)
    expect(result.current.playing).toBe(false)
  })

  it('pressing play at the end restarts from the top', () => {
    vi.useFakeTimers()
    const raw = loadRaw('flow_a_researcher.jsonl').slice(0, 3)
    const { result } = renderHook(() => useReplay(raw, 100))
    act(() => result.current.seek(result.current.events.length))
    act(() => result.current.toggle())
    expect(result.current.index).toBe(0)
    expect(result.current.playing).toBe(true)
  })

  it('manual seek pauses playback', () => {
    vi.useFakeTimers()
    const raw = loadRaw('flow_a_researcher.jsonl').slice(0, 5)
    const { result } = renderHook(() => useReplay(raw, 100))
    act(() => result.current.toggle())
    act(() => result.current.seek(2))
    expect(result.current.playing).toBe(false)
    expect(result.current.index).toBe(2)
  })
})
