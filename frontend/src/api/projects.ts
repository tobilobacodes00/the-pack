import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from './client'

export const ProjectSchema = z.object({
  project_id: z.string(),
  label: z.string().default(''),
  instructions: z.string().nullable().default(null),
  created_at: z.string().default(''),
})
export type Project = z.infer<typeof ProjectSchema>

export function useProjects(enabled = true) {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await api.get<{ projects: unknown }>('/projects')
      return ProjectSchema.array().parse(res.data.projects)
    },
    enabled,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string; description?: string }) => {
      const res = await api.post<Project>('/projects', body)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (projectId: string) => {
      await api.delete(`/projects/${projectId}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}