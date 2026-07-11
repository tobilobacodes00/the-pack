import { describe, it, expect } from 'vitest'
import { mmss, hms } from './scorecard-copy'

describe('scorecard-copy formatters', () => {
  it('mmss zero-pads minutes and seconds', () => {
    expect(mmss(90)).toBe('01:30')
    expect(mmss(612)).toBe('10:12')
    expect(mmss(5)).toBe('00:05')
  })

  it('hms renders the human "Xm Ys" form', () => {
    expect(hms(90)).toBe('1m 30s')
    expect(hms(45)).toBe('45s')
    expect(hms(120)).toBe('2m')
    expect(hms(0)).toBe('0s')
  })
})
