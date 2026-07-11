import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from './client'

export const MemoryEntrySchema = z.object({
  memory_id: z.string(),
  content: z.string().default(''),
  hunt_id: z.string().default(''),
  created_at: z.string().default(''),
})
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>

export function useMemory(limit = 50) {
  return useQuery({
    queryKey: ['memory', limit],
    queryFn: async () => {
      const res = await api.get<{ entries: unknown }>('/memory', { params: { limit } })
      return MemoryEntrySchema.array().parse(res.data.entries)
    },
  })
}
