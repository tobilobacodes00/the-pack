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

/** One document WITH its extracted text (GET /documents/:id). Matches backend DocumentDetailResponse. */
export const DocumentDetailSchema = DocumentSchema.extend({
  text: z.string().default(''),
})
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>

export function useDocuments() {
  return useQuery({
    queryKey: ['documents'],
    queryFn: async () => {
      const res = await api.get<{ documents: unknown }>('/documents')
      return DocumentSchema.array().parse(res.data.documents)
    },
  })
}

/** Fetch one document's full extracted text — the "see what the pack actually read from my upload"
 *  view. Enabled only when a doc id is selected. */
export function useDocument(docId: number | null) {
  return useQuery({
    queryKey: ['documents', docId],
    queryFn: async () => {
      const res = await api.get(`/documents/${docId}`)
      return DocumentDetailSchema.parse(res.data)
    },
    enabled: docId != null,
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