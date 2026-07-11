import { describe, it, expect, afterEach } from 'vitest'
import { useToastStore, toast } from './toast-store'

afterEach(() => useToastStore.setState({ toasts: [] }))

describe('toast-store', () => {
  it('push appends a toast and returns its id', () => {
    const id = useToastStore.getState().push({ title: 'Hi' })
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].id).toBe(id)
    expect(toasts[0].title).toBe('Hi')
  })

  it('ids are unique across pushes', () => {
    const a = useToastStore.getState().push({ title: 'A' })
    const b = useToastStore.getState().push({ title: 'B' })
    expect(a).not.toBe(b)
    expect(useToastStore.getState().toasts).toHaveLength(2)
  })

  it('dismiss removes only the matching toast', () => {
    const a = useToastStore.getState().push({ title: 'A' })
    useToastStore.getState().push({ title: 'B' })
    useToastStore.getState().dismiss(a)
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].title).toBe('B')
  })

  it('the imperative toast() helper routes through the store', () => {
    toast({ title: 'Imperative', variant: 'success' })
    expect(useToastStore.getState().toasts[0].variant).toBe('success')
  })
})
