import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  FirstInstinctPrompt,
  hasSeenFirstInstinctPrompt,
  markFirstInstinctPromptSeen,
} from './first-instinct-prompt'

describe('first-instinct-prompt gating', () => {
  beforeEach(() => localStorage.clear())

  it('is unseen by default, seen after marking', () => {
    expect(hasSeenFirstInstinctPrompt()).toBe(false)
    markFirstInstinctPromptSeen()
    expect(hasSeenFirstInstinctPrompt()).toBe(true)
  })
})

describe('FirstInstinctPrompt', () => {
  it('saves with the edited name', () => {
    const onSave = vi.fn()
    render(
      <FirstInstinctPrompt defaultName="EU battery brief" saving={false} onSave={onSave} onDismiss={() => {}} />,
    )
    const input = screen.getByPlaceholderText(/name this instinct/i) as HTMLInputElement
    expect(input.value).toBe('EU battery brief') // pre-filled with the brief title
    fireEvent.change(input, { target: { value: 'Market scan' } })
    fireEvent.click(screen.getByRole('button', { name: /save instinct/i }))
    expect(onSave).toHaveBeenCalledWith('Market scan')
  })

  it('falls back to the default name when cleared', () => {
    const onSave = vi.fn()
    render(
      <FirstInstinctPrompt defaultName="Default title" saving={false} onSave={onSave} onDismiss={() => {}} />,
    )
    fireEvent.change(screen.getByPlaceholderText(/name this instinct/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /save instinct/i }))
    expect(onSave).toHaveBeenCalledWith('Default title')
  })

  it('dismisses', () => {
    const onDismiss = vi.fn()
    render(
      <FirstInstinctPrompt defaultName="x" saving={false} onSave={() => {}} onDismiss={onDismiss} />,
    )
    fireEvent.click(screen.getByLabelText(/dismiss/i))
    expect(onDismiss).toHaveBeenCalled()
  })
})
