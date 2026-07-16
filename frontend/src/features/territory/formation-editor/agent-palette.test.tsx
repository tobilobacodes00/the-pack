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
      selectedInfo: {
        wolfId: 'scout-4', role: 'scout', added: true, note: '',
        desc: 'Ranging ahead to find ground truth', query: 'competitor pricing 2025',
      },
    })
    render(<AgentPalette ed={ed} />)
    fireEvent.change(screen.getByPlaceholderText(/focus on/i), { target: { value: 'primary sources only' } })
    expect(ed.setNote).toHaveBeenCalledWith('scout-4', 'primary sources only')
  })

  it('shows a scout its assigned search angle', () => {
    const ed = mockEd({
      selectedInfo: {
        wolfId: 'scout-1', role: 'scout', added: false, note: '',
        desc: 'Ranging ahead to find ground truth', query: 'EV battery supply chain 2025',
      },
    })
    render(<AgentPalette ed={ed} />)
    expect(screen.getByText(/assigned angle/i)).toBeTruthy()
    expect(screen.getByText(/EV battery supply chain 2025/)).toBeTruthy()
  })

  it('a CORE agent now shows its role + an editable note (not a dead disclaimer)', () => {
    const ed = mockEd({
      selectedInfo: {
        wolfId: 'tracker', role: 'tracker', added: false, note: '',
        // A distinctive description (not the real ROLE_DESC, which the add-row list also renders — we
        // want to assert on the INSPECTOR specifically, so use a string that appears only there).
        desc: 'INSPECTOR-ONLY tracker contribution', query: null,
      },
    })
    render(<AgentPalette ed={ed} />)
    // Its contribution is shown in the inspector…
    expect(screen.getByText(/inspector-only tracker contribution/i)).toBeTruthy()
    // …the "core · always runs" marker is present…
    expect(screen.getByText(/always runs/i)).toBeTruthy()
    // …and its note is editable (the old build showed only "core agent — it always runs", no field).
    fireEvent.change(screen.getByPlaceholderText(/keep it concise/i), { target: { value: 'cite filings' } })
    expect(ed.setNote).toHaveBeenCalledWith('tracker', 'cite filings')
    // Core agents can't be removed.
    expect(screen.queryByText(/remove this agent/i)).toBeNull()
  })
})
