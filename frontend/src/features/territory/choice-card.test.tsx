import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChoiceCard } from './choice-card'

const opts = [{ label: 'Option A' }, { label: 'Option B' }]

describe('ChoiceCard', () => {
  it('disables Submit until an option is selected', () => {
    render(
      <ChoiceCard title="Pick" options={opts} selected={null} onSelect={vi.fn()} onSubmit={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('enables Submit and fires callbacks once selected', () => {
    const onSelect = vi.fn()
    const onSubmit = vi.fn()
    render(
      <ChoiceCard title="Pick" options={opts} selected={1} onSelect={onSelect} onSubmit={onSubmit} />,
    )
    fireEvent.click(screen.getByText('Option A'))
    expect(onSelect).toHaveBeenCalledWith(0)
    const submit = screen.getByRole('button', { name: 'Submit' })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalled()
  })

  it('renders the Skip action and fires it', () => {
    const onSkip = vi.fn()
    render(
      <ChoiceCard
        title="Pick"
        options={opts}
        selected={null}
        onSelect={vi.fn()}
        onSubmit={vi.fn()}
        onSkip={onSkip}
      />,
    )
    fireEvent.click(screen.getByText('Skip'))
    expect(onSkip).toHaveBeenCalled()
  })

  it('shows a submitting state and disables Submit', () => {
    render(
      <ChoiceCard
        title="Pick"
        options={opts}
        selected={0}
        onSelect={vi.fn()}
        onSubmit={vi.fn()}
        submitting
      />,
    )
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled()
  })
})
