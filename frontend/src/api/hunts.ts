import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { rememberHunt, forgetHunt, clearOwnedHunts, filterOwned } from '@/lib/local-history'
import {
  HuntListResponseSchema,
  HuntSnapshotSchema,
  BriefSchema,
  ArtifactMetaSchema,
  ReceiptsSchema,
  RehearseSchema,
  ScorecardSchema,
  SharedSchema,
  SharedTracksSchema,
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
  ReceiptClaim,
  Receipts,
  SpendHunt,
  SpendSummary,
} from './schemas'

export type IntakeMessage = { role: 'user' | 'assistant'; content: string }

export interface IntakePayload {
  messages: IntakeMessage[]
  artifact_ids?: string[]
  /** Hunt this conversation is attached to, if any — lets the front door see it's running/delivered
   *  so it won't re-scope or relaunch. */
  hunt_id?: string | null
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
      const parsed = HuntListResponseSchema.parse(res.data)
      // /hunts returns every visitor's hunts (no auth); show only ones this browser created.
      return { ...parsed, hunts: filterOwned(parsed.hunts) }
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
    mutationFn: async (body: {
      input?: string
      instinct_id?: string
      strategy?: string
      project_id?: string
      boundary_usd?: number
      // A reused Instinct's formation, overriding Beta's sizing; `input` still drives the research.
      team?: Array<{ role: string; count: number }>
    }) => {
      const res = await api.post<{ hunt_id: string }>('/hunts', body)
      // Claim this hunt for THIS browser so it appears in local history/spend (no accounts).
      rememberHunt(res.data.hunt_id)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hunts'] })
      void qc.invalidateQueries({ queryKey: ['spend'] })
    },
  })
}

export function useApprovePlan(huntId: string) {
  return useMutation({
    mutationFn: async (body: {
      mode: 'wild' | 'on_signal' | 'on_command'
      boundary_usd: number
      // User's depth choice from the plan card. Omitted → keep Beta's.
      depth?: 'brief' | 'standard' | 'deep'
      // Formation edits from the Edit panel. `team` respawns the pack; `notes` is a per-wolf
      // handler note keyed by wolf_id.
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
      forgetHunt(huntId)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hunts'] })
      void qc.invalidateQueries({ queryKey: ['spend'] })
    },
  })
}

/** Delete any hunt by id passed at call time (for list rows). */
export function useDeleteHuntById() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (huntId: string) => {
      await api.delete(`/hunts/${huntId}`)
      forgetHunt(huntId)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hunts'] })
      void qc.invalidateQueries({ queryKey: ['spend'] })
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

/** Append one turn to a hunt's durable chat log. Plain helper (not a hook) so intake can flush
 * in a loop against a hunt id that only exists after createHunt resolves. */
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

/** Re-price the hunt for an edited formation before approval (Shadow Hunt rehearsal). Pure
 *  estimator, so POST-in-a-query is safe; keyed on team/strategy/depth for instant re-pricing. */
export function useRehearse(
  huntId: string | null,
  body: {
    team?: Array<{ role: string; count: number }>
    strategy?: string
    depth: 'brief' | 'standard' | 'deep'
  },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['hunts', huntId, 'rehearse', body.depth, body.strategy, JSON.stringify(body.team ?? null)],
    queryFn: async () => {
      const res = await api.post(`/hunts/${huntId}/rehearse`, body)
      return RehearseSchema.parse(res.data)
    },
    enabled: enabled && !!huntId,
    staleTime: Infinity, // pure function of the key — never goes stale
    retry: false,
  })
}

/** Launch "Lone Wolf vs the Pack": the same task runs once as a single solo agent, a judge scores
 *  both briefs, and the Scorecard lands as benchmark_completed on the hunt's stream (and via
 *  GET /scorecard). 202 fire-and-forget — pair with useHuntScorecard's pollWhileMissing. */
export function useRunBenchmark(huntId: string) {
  return useMutation({
    mutationFn: async () => {
      await api.post(`/hunts/${huntId}/benchmark`)
    },
  })
}

/** Poll budget: 2.5s × 48 ≈ 2 min. Without a cap, a benchmark that dies in the background would
 *  spin the poll forever with the Scorecard stuck on "running…". */
export const SCORECARD_POLL_MS = 2500
export const SCORECARD_POLL_MAX = 48

/** The latest benchmark Scorecard. 404 (→ isError) until a benchmark is run. `pollWhileMissing`
 *  re-checks until the scorecard lands or the poll budget runs out; `pollExhausted` lets the UI
 *  recover instead of spinning forever. */
export function useHuntScorecard(huntId: string, enabled: boolean, pollWhileMissing = false) {
  const q = useQuery({
    queryKey: ['hunts', huntId, 'scorecard'],
    queryFn: async () => {
      const res = await api.get<{ scorecard: unknown }>(`/hunts/${huntId}/scorecard`)
      return ScorecardSchema.parse(res.data.scorecard)
    },
    enabled: enabled && !!huntId,
    retry: false,
    refetchInterval: (query) => {
      // Fetch cycles so far (404s count as failures); stop once data lands or budget is spent.
      const attempts = query.state.dataUpdateCount + query.state.errorUpdateCount
      return pollWhileMissing && !query.state.data && attempts < SCORECARD_POLL_MAX
        ? SCORECARD_POLL_MS
        : false
    },
  })
  const pollExhausted =
    pollWhileMissing && !q.data && q.failureCount + q.errorUpdateCount >= SCORECARD_POLL_MAX
  return Object.assign(q, { pollExhausted })
}

export interface RawTrackEvent {
  type: string
  actor: string
  seq: number
  ts: string
  payload: Record<string, unknown>
}

/** The Receipts — per-claim provenance for the delivered brief. 404 (→ isError) until it exists. */
export function useReceipts(huntId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['hunts', huntId, 'receipts'],
    queryFn: async () => {
      const res = await api.get(`/hunts/${huntId}/receipts`)
      return ReceiptsSchema.parse(res.data)
    },
    enabled: enabled && !!huntId,
    retry: false,
  })
}

/** The public Flight Recorder feed: a shared hunt's full redacted event log, by share token. */
export function useSharedTracks(token: string | undefined) {
  return useQuery({
    queryKey: ['share', token, 'tracks'],
    queryFn: async () => {
      const res = await api.get(`/share/${token}/tracks`)
      return SharedTracksSchema.parse(res.data)
    },
    enabled: !!token,
    retry: false,
  })
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

/** Total + per-hunt spend for Settings › Spend. Server sum is global (no auth), so recompute
 *  from this browser's owned rows only. */
export function useSpendSummary() {
  return useQuery({
    queryKey: ['spend'],
    queryFn: async () => {
      const res = await api.get('/spend')
      const parsed = SpendSummarySchema.parse(res.data)
      const hunts = filterOwned(parsed.hunts)
      const total_usd = hunts.reduce((sum, h) => sum + (h.cost_usd ?? 0), 0)
      return { ...parsed, hunts, total_usd }
    },
  })
}

/** Clear this browser's hunt history. Forgets the local ownership index rather than DELETE /hunts
 *  (which would wipe every visitor's hunts). Documents/memory/instincts are untouched. */
export function useClearHunts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      clearOwnedHunts()
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hunts'] })
      void qc.invalidateQueries({ queryKey: ['spend'] })
    },
  })
}

/** Reset this browser's local data — history + spend go empty without touching the shared engine DB. */
export function useResetData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      clearOwnedHunts()
    },
    onSuccess: () => {
      void qc.invalidateQueries()
    },
  })
}