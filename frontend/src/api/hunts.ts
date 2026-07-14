import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import {
  HuntListResponseSchema,
  HuntSnapshotSchema,
  BriefSchema,
  ArtifactMetaSchema,
  ScorecardSchema,
  SharedSchema,
  SpendSummarySchema,
} from './schemas'
import type { ArtifactMeta } from './schemas'

// Types are derived from the zod schemas (single source of truth) and re-exported here so every
// existing `@/api/hunts` import keeps working.
export type {
  HuntSummary,
  HuntListResponse,
  HuntSnapshot,
  ArtifactKind,
  ArtifactMeta,
  BriefSource,
  BriefBlock,
  BriefContent,
  Brief,
  Shared,
  ScorecardSide,
  Scorecard,
  SpendHunt,
  SpendSummary,
} from './schemas'

export type IntakeMessage = { role: 'user' | 'assistant'; content: string }

export interface IntakePayload {
  messages: IntakeMessage[]
  artifact_ids?: string[]
}

export interface IntakeResponse {
  reply: string
  ready: boolean
  brief: string
}

/** Shape returned by GET /hunts/:id/messages (durable side-chat with Alpha). */
export interface MessageItem {
  role: 'user' | 'alpha'
  text: string
}

export function useHunts(projectId?: string, limit = 20) {
  return useQuery({
    queryKey: ['hunts', projectId, limit],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit }
      if (projectId) params.project_id = projectId
      const res = await api.get('/hunts', { params })
      return HuntListResponseSchema.parse(res.data)
    },
  })
}

/** GET /hunts/:id — the original prompt + created/updated dates for the Reward header/byline. */
export function useHuntSnapshot(huntId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['hunts', huntId, 'snapshot'],
    queryFn: async () => {
      const res = await api.get(`/hunts/${huntId}`)
      return HuntSnapshotSchema.parse(res.data)
    },
    enabled: enabled && !!huntId,
  })
}

export function useIntake() {
  return useMutation({
    mutationFn: async (body: IntakePayload) => {
      const res = await api.post<IntakeResponse>('/hunts/intake', body)
      return res.data
    },
  })
}

export function useCreateHunt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { input?: string; instinct_id?: string; strategy?: string; project_id?: string; boundary_usd?: number }) => {
      const res = await api.post<{ hunt_id: string }>('/hunts', body)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hunts'] })
    },
  })
}

export function useApprovePlan(huntId: string) {
  return useMutation({
    mutationFn: async (body: {
      mode: 'wild' | 'on_signal' | 'on_command'
      boundary_usd: number
      // v3: the user's depth choice from the plan card (brief|standard|deep). Omitted → keep Beta's.
      depth?: 'brief' | 'standard' | 'deep'
      // Formation edits from the Edit panel — the backend `_apply_edits` seam. `team` respawns the
      // pack; `notes` is a per-wolf handler note keyed by wolf_id (scout-4, tracker-2, …).
      edits?: {
        team?: Array<{ role: string; count: number }>
        notes?: Record<string, string>
        queries?: string[]
        assumptions?: string[]
      }
    }) => {
      await api.post(`/hunts/${huntId}/plan/approve`, body)
    },
  })
}

/** Resume a Boundary-halted hunt by raising the Boundary (POST /hunts/:id/resume). */
export function useResumeHunt(huntId: string) {
  return useMutation({
    mutationFn: async (body: { boundary_usd: number }) => {
      await api.post(`/hunts/${huntId}/resume`, body)
    },
  })
}

export function useStopHunt(huntId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.post(`/hunts/${huntId}/stop`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hunts', huntId] })
    },
  })
}

export function useResolveHold(huntId: string) {
  return useMutation({
    mutationFn: async ({ holdId, resolution }: { holdId: string; resolution: string }) => {
      await api.post(`/hunts/${huntId}/holds/${holdId}/resolve`, { resolution })
    },
  })
}

export function useDeleteHunt(huntId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.delete(`/hunts/${huntId}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hunts'] })
    },
  })
}

/** Delete any hunt by id passed at call time (for list rows). */
export function useDeleteHuntById() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (huntId: string) => {
      await api.delete(`/hunts/${huntId}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hunts'] })
    },
  })
}

export function useHuntMessages(huntId: string) {
  return useQuery({
    queryKey: ['hunts', huntId, 'messages'],
    queryFn: async () => {
      const res = await api.get<{ messages: MessageItem[] }>(`/hunts/${huntId}/messages`)
      return res.data.messages
    },
    enabled: !!huntId,
  })
}

/** Append one turn to a hunt's durable chat log (role 'user' | 'alpha').
 * Plain helper (not a hook) so the intake conversation can be flushed in a loop
 * against a hunt id that only exists after createHunt resolves. */
export async function postMessage(
  huntId: string,
  body: { role: 'user' | 'alpha'; content: string },
) {
  await api.post(`/hunts/${huntId}/messages`, body)
}

/** GET /hunts/:id/artifact — Howler's final brief (the Reward's reading view). */
export function useHuntBrief(huntId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['hunts', huntId, 'artifact'],
    queryFn: async () => {
      const res = await api.get(`/hunts/${huntId}/artifact`)
      return BriefSchema.parse(res.data)
    },
    enabled: enabled && !!huntId,
    // The brief is immutable per draft; a Refine emits a new one and we invalidate this key.
    staleTime: Infinity,
    retry: false,
  })
}

/** The forged export files for a hunt (id + kind) — the Reward's download menu. */
export function useHuntArtifacts(huntId: string, enabled = true) {
  return useQuery({
    queryKey: ['hunts', huntId, 'artifacts'],
    queryFn: async () => {
      const res = await api.get<{ artifacts: unknown }>(`/hunts/${huntId}/artifacts`)
      return ArtifactMetaSchema.array().parse(res.data.artifacts)
    },
    enabled: enabled && !!huntId,
  })
}

/** Download one forged export as a file (blob → anchor click). */
export function useDownloadArtifact(huntId: string) {
  return useMutation({
    mutationFn: async (art: ArtifactMeta) => {
      const res = await api.get(`/hunts/${huntId}/artifacts/${art.artifact_id}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pack-brief.${art.kind}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Defer the revoke — revoking in the same tick aborts the download in Firefox/Safari.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    },
  })
}

/** Re-draft the brief from its existing sources (no re-scout). Refetches the brief on success. */
export function useRefine(huntId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (instruction: string) => {
      const res = await api.post<{ artifact_id: string }>(`/hunts/${huntId}/refine`, { instruction })
      return res.data
    },
    onSuccess: () => {
      // refine_brief persists the new final artifact before returning, so an immediate refetch wins.
      void qc.invalidateQueries({ queryKey: ['hunts', huntId, 'artifact'] })
    },
  })
}

/** Public read-only brief behind a share token (GET /share/:token) — powers the ShareView page. */
export function useShared(token: string | undefined) {
  return useQuery({
    queryKey: ['share', token],
    queryFn: async () => {
      const res = await api.get(`/share/${token}`)
      return SharedSchema.parse(res.data)
    },
    enabled: !!token,
    retry: false,
  })
}

/** Mint (or reuse) a public read-only token for this hunt's brief. */
export function useShare(huntId: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ token: string }>(`/hunts/${huntId}/share`)
      return res.data.token
    },
  })
}

/** The latest benchmark Scorecard (Lone Wolf vs Pack). 404 (→ isError) until a benchmark is run. */
export function useHuntScorecard(huntId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['hunts', huntId, 'scorecard'],
    queryFn: async () => {
      const res = await api.get<{ scorecard: unknown }>(`/hunts/${huntId}/scorecard`)
      return ScorecardSchema.parse(res.data.scorecard)
    },
    enabled: enabled && !!huntId,
    retry: false,
  })
}

export interface RawTrackEvent {
  type: string
  actor: string
  seq: number
  ts: string
  payload: Record<string, unknown>
}

/** The full redacted event log — the Reward's Tracks drawer derives its narrative from this. */
export function useTracks(huntId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['hunts', huntId, 'tracks'],
    queryFn: async () => {
      const res = await api.get<{ events: RawTrackEvent[] }>(`/hunts/${huntId}/tracks/export`)
      return res.data.events
    },
    enabled: enabled && !!huntId,
  })
}

/** Total + per-hunt spend for the Settings › Spend section (GET /spend). */
export function useSpendSummary() {
  return useQuery({
    queryKey: ['spend'],
    queryFn: async () => {
      const res = await api.get('/spend')
      return SpendSummarySchema.parse(res.data)
    },
  })
}

/** Clear all hunt history (DELETE /hunts) — keeps documents/memory/instincts. */
export function useClearHunts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.delete('/hunts')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hunts'] })
      void qc.invalidateQueries({ queryKey: ['spend'] })
    },
  })
}

/** Reset all local data (POST /reset) — wipes hunts, memory, documents, instincts, projects. */
export function useResetData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.post('/reset')
    },
    onSuccess: () => {
      void qc.invalidateQueries()
    },
  })
}