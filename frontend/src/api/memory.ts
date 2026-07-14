import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from './client'

/** One lesson the Elder distilled across hunts (GET /memory). Matches backend MemoryItem. `kind` is
 *  the lesson type — what-worked / what-failed / preference / topic-insight, or "takeaway" for legacy
 *  rows — so the view can group and label what the pack learned. */
export const MemoryEntrySchema = z.object({
  text: z.string().default(''),
  kind: z.string().default('takeaway'),
  hunt_id: z.string().nullable().default(null),
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
