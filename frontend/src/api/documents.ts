import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from './client'

/** Knowledge-base document (GET /documents). Matches backend DocMeta. */
export const DocumentSchema = z.object({
  id: z.number(),
  name: z.string().default(''),
  kind: z.string().default(''),
  chars: z.number().default(0),
})
export type Document = z.infer<typeof DocumentSchema>

export function useDocuments() {
  return useQuery({
    queryKey: ['documents'],
    queryFn: async () => {
      const res = await api.get<{ documents: unknown }>('/documents')
      return DocumentSchema.array().parse(res.data.documents)
    },
  })
}

export function useUploadDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post<Document>('/documents', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (docId: number) => {
      await api.delete(`/documents/${docId}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}