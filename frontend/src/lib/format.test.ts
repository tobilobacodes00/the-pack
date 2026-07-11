import { describe, it, expect, afterEach, vi } from 'vitest'
import { formatUsd, formatDuration, formatRelative, formatPct } from './format'

describe('formatUsd', () => {
  it('renders sub-cent amounts in cents', () => {
    expect(formatUsd(0.004)).toBe('$0.40¢')
  })
  it('renders cent-and-up amounts in dollars to 3dp', () => {
    expect(formatUsd(0.5)).toBe('$0.500')
    expect(formatUsd(1.2345)).toBe('$1.234')
  })
})

describe('formatDuration', () => {
  it('renders under a minute in seconds', () => {
    expect(formatDuration(42.4)).toBe('42s')
  })
  it('renders a minute or more as m s', () => {
    expect(formatDuration(90)).toBe('1m 30s')
    expect(formatDuration(3661)).toBe('61m 1s')
  })
})

describe('formatPct', () => {
  it('rounds a fraction to a whole percent', () => {
    expect(formatPct(0.8)).toBe('80%')
    expect(formatPct(0.874)).toBe('87%')
  })
})

describe('formatRelative', () => {
  afterEach(() => vi.useRealTimers())
  function at(now: string) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
  }
  it('says "just now" under a minute', () => {
    at('2026-01-01T00:00:30Z')
    expect(formatRelative('2026-01-01T00:00:00Z')).toBe('just now')
  })
  it('renders minutes and hours ago', () => {
    at('2026-01-01T01:30:00Z')
    expect(formatRelative('2026-01-01T01:00:00Z')).toBe('30m ago')
    expect(formatRelative('2026-01-01T00:00:00Z')).toBe('1h ago')
  })
  it('falls back to a date past a day', () => {
    at('2026-01-03T00:00:00Z')
    expect(formatRelative('2026-01-01T00:00:00Z')).toContain('2026')
  })
})
