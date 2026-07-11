import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RewardEmpty } from './reward-empty'

describe('RewardEmpty', () => {
  it('shows the default copy for each state', () => {
    const { rerender } = render(<RewardEmpty kind="loading" />)
    expect(screen.getByText(/Fetching the Reward/i)).toBeTruthy()
    rerender(<RewardEmpty kind="missing" />)
    expect(screen.getByText(/No brief yet/i)).toBeTruthy()
  })

  it('prefers an explicit message', () => {
    render(<RewardEmpty kind="error" message="boom" />)
    expect(screen.getByText('boom')).toBeTruthy()
  })
})
