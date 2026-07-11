import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from './client'

/** A saved plan preset (GET /instincts). Server contract: {instinct_id, label, spec}. */
export const InstinctSchema = z.object({
  instinct_id: z.string(),
  label: z.string().default(''),
  spec: z.record(z.string(), z.unknown()).default({}),
})
export type Instinct = z.infer<typeof InstinctSchema>

export function useInstincts() {
  return useQuery({
    queryKey: ['instincts'],
    queryFn: async () => {
      const res = await api.get<{ instincts: unknown }>('/instincts')
      return InstinctSchema.array().parse(res.data.instincts)
    },
  })
}

export function useCreateInstinct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { label: string; spec: Record<string, unknown> }) => {
      const res = await api.post<{ instinct_id: string; accepted: boolean }>('/instincts', body)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['instincts'] })
    },
  })
}

export function useDeleteInstinct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (instinctId: string) => {
      await api.delete(`/instincts/${instinctId}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['instincts'] })
    },
  })
}
