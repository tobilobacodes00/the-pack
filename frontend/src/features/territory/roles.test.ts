import { describe, it, expect } from 'vitest'
import { numberWord, ROLE_COLOR, ROLE_DESC, DEFAULT_IDLE_TEAM } from './roles'

describe('numberWord', () => {
  it('maps 0-10 to words', () => {
    expect(numberWord(0)).toBe('zero')
    expect(numberWord(3)).toBe('three')
    expect(numberWord(10)).toBe('ten')
  })
  it('falls back to the digit past ten', () => {
    expect(numberWord(11)).toBe('11')
    expect(numberWord(42)).toBe('42')
  })
})

describe('role tables', () => {
  it('has a colour + description for every core role', () => {
    for (const role of ['alpha', 'beta', 'scout', 'tracker', 'howler', 'sentinel']) {
      expect(ROLE_COLOR[role]).toMatch(/^#[0-9A-F]{6}$/i)
      expect(ROLE_DESC[role]).toBeTruthy()
    }
  })
  it('the idle team leads with alpha+beta and holds three scouts', () => {
    expect(DEFAULT_IDLE_TEAM.slice(0, 2)).toEqual(['alpha', 'beta'])
    expect(DEFAULT_IDLE_TEAM.filter((r) => r === 'scout')).toHaveLength(3)
  })
})
