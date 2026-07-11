import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentPalette } from './agent-palette'
import type { FormationEditorApi } from './use-formation-editor'

function mockEd(over: Partial<FormationEditorApi> = {}): FormationEditorApi {
  return {
    nodes: [],
    edges: [],
    spawn: vi.fn(),
    removeRole: vi.fn(),
    setNote: vi.fn(),
    selectWolf: vi.fn(),
    selected: null,
    selectedInfo: null,
    // scout at the floor (3): can add (below max 5), cannot remove (at min)
    capacity: (role: string) => (role === 'scout' ? { count: 4, min: 3, max: 5 } : { count: 1, min: 1, max: 3 }),
    savePayload: vi.fn(),
    addedCount: 0,
    ...over,
  } as unknown as FormationEditorApi
}

describe('AgentPalette', () => {
  it('the + stepper adds an agent for that role', () => {
    const ed = mockEd()
    render(<AgentPalette ed={ed} />)
    fireEvent.click(screen.getByLabelText('Add a scout'))
    expect(ed.spawn).toHaveBeenCalledWith('scout')
  })

  it('the − stepper removes an agent when above the floor', () => {
    const ed = mockEd() // scout count 4 > min 3 → removable
    render(<AgentPalette ed={ed} />)
    fireEvent.click(screen.getByLabelText('Remove a scout'))
    expect(ed.removeRole).toHaveBeenCalledWith('scout')
  })

  it('the − stepper is disabled at the AI floor (additive-only below the proposal)', () => {
    // tracker at min: count 1, min 1 → cannot remove
    const ed = mockEd()
    render(<AgentPalette ed={ed} />)
    const remove = screen.getByLabelText('Remove a tracker') as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    fireEvent.click(remove)
    expect(ed.removeRole).not.toHaveBeenCalled()
  })

  it('writes a note for a selected added agent', () => {
    const ed = mockEd({
      selectedInfo: { wolfId: 'scout-4', role: 'scout', added: true, note: '' },
    })
    render(<AgentPalette ed={ed} />)
    fireEvent.change(screen.getByPlaceholderText(/focus on/i), { target: { value: 'primary sources only' } })
    expect(ed.setNote).toHaveBeenCalledWith('scout-4', 'primary sources only')
  })
})
