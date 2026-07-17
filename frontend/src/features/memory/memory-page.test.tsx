import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MemoryPage from './memory-page'
import { api } from '@/api/client'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
// The sidebar drags in the whole hunts query surface — out of scope for this page's behavior.
vi.mock('@/features/door/hunt-sidebar', () => ({ HuntSidebar: () => <div /> }))

const apiGet = vi.mocked(api.get)
const apiPatch = vi.mocked(api.patch)
const apiDelete = vi.mocked(api.delete)

const LESSONS = [
  { id: 1, text: 'Primary sources beat aggregators', kind: 'preference', hunt_id: 'h1', status: 'active' },
  { id: 2, text: 'Vendor blogs padded the brief', kind: 'what-failed', hunt_id: 'h2', status: 'archived' },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MemoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiGet.mockReset()
  apiPatch.mockReset()
  apiDelete.mockReset()
  apiGet.mockResolvedValue({ data: { memory: LESSONS } })
  apiPatch.mockResolvedValue({ data: { ok: true } })
  apiDelete.mockResolvedValue({ data: { deleted: true } })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('MemoryPage — the visible, vetoable memory', () => {
  it('groups lessons into active and vetoed with kind badges', async () => {
    renderPage()
    expect(await screen.findByText('Primary sources beat aggregators')).toBeInTheDocument()
    expect(screen.getByText(/Active — steering future hunts \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Vetoed — kept for the record \(1\)/)).toBeInTheDocument()
    expect(screen.getByText('Preference')).toBeInTheDocument()
    expect(screen.getByText('What failed')).toBeInTheDocument()
  })

  it('vetoing an active lesson PATCHes status=archived', async () => {
    renderPage()
    await screen.findByText('Primary sources beat aggregators')
    fireEvent.click(screen.getByRole('button', { name: 'Veto lesson 1' }))
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/memory/1', { status: 'archived' }),
    )
  })

  it('restoring a vetoed lesson PATCHes status=active', async () => {
    renderPage()
    await screen.findByText('Vendor blogs padded the brief')
    fireEvent.click(screen.getByRole('button', { name: 'Restore lesson 2' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/memory/2', { status: 'active' }))
  })

  it('editing a lesson PATCHes the new text', async () => {
    renderPage()
    await screen.findByText('Primary sources beat aggregators')
    fireEvent.click(screen.getByRole('button', { name: 'Edit lesson 1' }))
    const box = screen.getByRole('textbox', { name: 'Edit lesson' })
    fireEvent.change(box, { target: { value: 'Primary sources only — always' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/memory/1', { text: 'Primary sources only — always' }),
    )
  })

  it('deleting a lesson confirms then DELETEs the row', async () => {
    renderPage()
    await screen.findByText('Primary sources beat aggregators')
    fireEvent.click(screen.getByRole('button', { name: 'Delete lesson 1' }))
    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/memory/1'))
  })

  it('shows the empty state when the pack has learned nothing', async () => {
    apiGet.mockResolvedValue({ data: { memory: [] } })
    renderPage()
    expect(await screen.findByText('Nothing learned yet')).toBeInTheDocument()
  })
})
