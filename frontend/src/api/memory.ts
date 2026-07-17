import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from './client'

/** One lesson the Elder distilled across hunts (GET /memory). Matches backend MemoryItem. `kind` is
 *  the lesson type — what-worked / what-failed / preference / topic-insight, or "takeaway" for legacy
 *  rows — so the view can group and label what the pack learned. v6: `id` makes the lesson
 *  addressable (editable, vetoable, citable as memory://id); `status` is its lifecycle — `active`
 *  lessons steer future hunts, `archived` ones are vetoed and never recalled again. */
export const MemoryEntrySchema = z.object({
  id: z.number().default(0),
  text: z.string().default(''),
  kind: z.string().default('takeaway'),
  hunt_id: z.string().nullable().default(null),
  status: z.enum(['active', 'archived']).catch('active').default('active'),
})
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>

export function useMemory() {
  return useQuery({
    queryKey: ['memory'],
    queryFn: async () => {
      const res = await api.get<{ memory: unknown }>('/memory')
      return MemoryEntrySchema.array().parse(res.data.memory)
    },
  })
}

/** Edit one lesson: rewrite its text and/or flip active ↔ archived (the veto). */
export function usePatchMemory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: number; text?: string; status?: 'active' | 'archived' }) => {
      const { id, ...body } = input
      await api.patch(`/memory/${id}`, body)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memory'] })
    },
  })
}

/** Forget ONE lesson for good. */
export function useDeleteMemoryEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/memory/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memory'] })
    },
  })
}

export function useClearMemory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.delete('/memory')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['memory'] })
    },
  })
}
