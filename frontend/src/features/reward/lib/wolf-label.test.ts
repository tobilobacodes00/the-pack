import { describe, it, expect } from 'vitest'
import { wolfLabel } from './wolf-label'

describe('wolfLabel', () => {
  it('parses a numbered scout into labels + colour', () => {
    const w = wolfLabel('scout-2')
    expect(w.role).toBe('scout')
    expect(w.n).toBe(2)
    expect(w.label).toBe('Scout 2')
    expect(w.short).toBe('Scout-2')
    expect(w.color).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('handles a bare role (no number)', () => {
    const w = wolfLabel('alpha')
    expect(w.n).toBeNull()
    expect(w.label).toBe('Alpha')
    expect(w.short).toBe('Alpha')
  })

  it('falls back to Pack + grey for empty input', () => {
    const w = wolfLabel('')
    expect(w.label).toBe('Pack')
    expect(w.color).toBe('#A3A3A3')
  })

  it('uses the grey fallback colour for an unknown role', () => {
    expect(wolfLabel('gremlin-1').color).toBe('#A3A3A3')
    expect(wolfLabel('???').color).toBe('#A3A3A3')
  })
})
