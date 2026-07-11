import { create } from 'zustand'

export type ToastVariant = 'default' | 'warn' | 'danger' | 'success'

export interface ToastItem {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
  /** Auto-dismiss after ms; `Infinity` keeps it up until explicitly dismissed. Defaults to 4000. */
  duration?: number
}

interface ToastStore {
  toasts: ToastItem[]
  push: (t: Omit<ToastItem, 'id'>) => string
  dismiss: (id: string) => void
}

let _seq = 0

/**
 * A tiny imperative toast queue. `ui/toast.tsx` is declarative-only (Radix wrappers), so this store
 * bridges the gap: push from anywhere (mutation callbacks, event handlers), render via `<Toaster />`.
 */
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `toast-${++_seq}`
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

/** Imperative helper usable outside React render (mutation callbacks, plain functions). */
export const toast = (t: Omit<ToastItem, 'id'>) => useToastStore.getState().push(t)
