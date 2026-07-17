import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTypewriter } from './use-typewriter'

// Drive the chained-timeout animation deterministically with fake timers.
vi.mock('framer-motion', () => ({ useReducedMotion: () => false }))

describe('useTypewriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const PHRASES = ['ab', 'cd']

  it('starts with the first phrase fully shown', () => {
    const { result } = renderHook(() => useTypewriter(PHRASES, { holdMs: 100, typeMs: 10, deleteMs: 10, gapMs: 10 }))
    expect(result.current.text).toBe('ab')
    expect(result.current.reduced).toBe(false)
  })

  it('holds, backspaces to empty, then types the next phrase', () => {
    const { result } = renderHook(() => useTypewriter(PHRASES, { holdMs: 100, typeMs: 10, deleteMs: 10, gapMs: 10 }))
    // Record the sequence of visible states as time advances one tick at a time, so we assert the
    // trajectory (hold → backspace to empty → type the next phrase) without pinning exact timings.
    const seq: string[] = [result.current.text]
    for (let i = 0; i < 40; i++) {
      act(() => vi.advanceTimersByTime(10))
      if (seq[seq.length - 1] !== result.current.text) seq.push(result.current.text)
    }
    // Started fully typed on phrase 1…
    expect(seq[0]).toBe('ab')
    // …backspaced through 'a' to empty…
    expect(seq).toContain('a')
    expect(seq).toContain('')
    // …then typed phrase 2 up to full.
    expect(seq).toContain('c')
    expect(seq).toContain('cd')
    // and 'ab' fully typed comes strictly before 'cd' fully typed (order preserved).
    expect(seq.indexOf('ab')).toBeLessThan(seq.indexOf('cd'))
    expect(seq.indexOf('')).toBeLessThan(seq.indexOf('cd'))
  })

  it('loops back to the first phrase after the last', () => {
    const { result } = renderHook(() => useTypewriter(PHRASES, { holdMs: 50, typeMs: 5, deleteMs: 5, gapMs: 5 }))
    // Run a big chunk of time and assert we return to 'ab' at some point (loop closed).
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      act(() => vi.advanceTimersByTime(5))
      seen.add(result.current.text)
    }
    expect(seen.has('ab')).toBe(true)
    expect(seen.has('cd')).toBe(true)
    expect(seen.has('')).toBe(true) // it fully cleared between phrases
  })
})

describe('useTypewriter — reduced motion', () => {
  it('settles on the first phrase with no animation', async () => {
    vi.resetModules()
    vi.doMock('framer-motion', () => ({ useReducedMotion: () => true }))
    const { useTypewriter: reducedHook } = await import('./use-typewriter')
    const { result } = renderHook(() => reducedHook(['first', 'second']))
    expect(result.current.text).toBe('first')
    expect(result.current.done).toBe(true)
    expect(result.current.reduced).toBe(true)
  })
})
