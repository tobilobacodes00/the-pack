import { z } from 'zod'

/**
 * Zod schemas for REST responses — the single source of truth for API shapes. Types are derived via
 * `z.infer`, and the query hooks `.parse()` responses at the boundary, so backend drift throws loudly
 * here instead of surfacing as a silent runtime bug three components deep. Fields the UI can tolerate
 * missing get `.default(...)` so a thin/legacy payload degrades rather than rejects.
 */

export const HuntSummarySchema = z.object({
  hunt_id: z.string(),
  state: z.string(),
  source: z.string().default(''),
  title: z.string().default(''),
  // Backend sends null until a plan is approved; `.default` only fills undefined, so it must be
  // nullable or the whole list parse throws and the Past Hunts sidebar silently shows empty.
  boundary_usd: z.number().nullable().default(null),
  project_id: z.string().nullable().default(null),
  created_at: z.string().default(''),
  cost_usd: z.number().default(0),
})
export type HuntSummary = z.infer<typeof HuntSummarySchema>

export const HuntListResponseSchema = z.object({
  hunts: z.array(HuntSummarySchema),
  next_cursor: z.string().nullable(),
})
export type HuntListResponse = z.infer<typeof HuntListResponseSchema>

export const HuntSnapshotSchema = z.object({
  hunt_id: z.string(),
  state: z.string(),
  last_seq: z.number(),
  task: z.string().default(''),
  strategy: z.string().default('orchestrate'),
  project_id: z.string().nullable().default(null),
  created_at: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
})
export type HuntSnapshot = z.infer<typeof HuntSnapshotSchema>

export const ArtifactKindSchema = z.enum(['md', 'html', 'pdf', 'docx', 'xlsx', 'pptx', 'png'])
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>

export const ArtifactMetaSchema = z.object({ artifact_id: z.string(), kind: ArtifactKindSchema })
export type ArtifactMeta = z.infer<typeof ArtifactMetaSchema>

export const BriefSourceSchema = z.object({
  title: z.string().default(''),
  url: z.string().default(''),
  by: z.string().default(''),
  verified: z.boolean().default(false),
  timestamp: z.string().optional(),
})
export type BriefSource = z.infer<typeof BriefSourceSchema>

export const BriefBlockSchema = z.object({
  text: z.string().default(''),
  source_ids: z.array(z.number()).default([]),
})
export type BriefBlock = z.infer<typeof BriefBlockSchema>

export const BriefContentSchema = z.object({
  text: z.string().default(''),
  blocks: z.array(BriefBlockSchema).default([]),
  claims: z.array(z.string()).default([]),
  sources: z.array(BriefSourceSchema).default([]),
  span_map_ref: z.string().nullable().default(null),
  no_sources: z.boolean().default(false),
  refined: z.boolean().optional(),
})
export type BriefContent = z.infer<typeof BriefContentSchema>

export const BriefSchema = z.object({
  artifact_id: z.string(),
  hunt_id: z.string(),
  kind: z.string(),
  produced_by: z.string().nullable().default(null),
  content: BriefContentSchema,
})
export type Brief = z.infer<typeof BriefSchema>

export const SharedSchema = z.object({
  title: z.string().default(''),
  content: BriefContentSchema.nullable(),
})
export type Shared = z.infer<typeof SharedSchema>

export const ScorecardSideSchema = z.object({
  quality: z.number().default(0),
  citations: z.number().default(0),
  cost_usd: z.number().default(0),
  time_s: z.number().default(0),
  sources: z.number().default(0),
})
export type ScorecardSide = z.infer<typeof ScorecardSideSchema>

export const ScorecardSchema = z.object({
  lone_wolf: ScorecardSideSchema,
  pack: ScorecardSideSchema,
})
export type Scorecard = z.infer<typeof ScorecardSchema>

/** GET /hunts/:id/receipts — per-claim provenance for the delivered brief. */
export const ReceiptSourceSchema = z.object({
  n: z.number(),
  title: z.string().default(''),
  url: z.string().default(''),
  by: z.string().default(''),
  verified: z.boolean().default(false),
  library: z.boolean().default(false),
})
export const ReceiptClaimSchema = z.object({
  text: z.string(),
  // an unknown future status degrades to the neutral middle instead of rejecting the payload
  status: z.enum(['verified', 'cited', 'unsourced', 'challenged_kept']).catch('cited'),
  sources: z.array(ReceiptSourceSchema).default([]),
  challenge: z.object({ problem: z.string().default('') }).nullable().default(null),
})
export const ReceiptsSchema = z.object({
  hunt_id: z.string().default(''),
  critique_ran: z.boolean().default(false),
  review_note: z.string().default(''),
  claims: z.array(ReceiptClaimSchema).default([]),
  dropped: z.array(z.object({ text: z.string(), problem: z.string().default('') })).default([]),
  standoff: z
    .object({
      challenger: z.string().default('sentinel'),
      defendant: z.string().default('tracker'),
      outcome: z.string().default('unresolved'),
      rationale: z.string().default(''),
    })
    .nullable()
    .default(null),
  wolves: z
    .record(z.string(), z.object({ sources: z.number().default(0), verified: z.number().default(0) }))
    .default({}),
  documents: z
    .array(z.object({ doc_id: z.string(), title: z.string().default(''), cited_by_claims: z.number().default(0) }))
    .default([]),
  totals: z.record(z.string(), z.number()).default({}),
})
export type ReceiptClaim = z.infer<typeof ReceiptClaimSchema>
export type Receipts = z.infer<typeof ReceiptsSchema>

/** GET /share/:token/tracks — the public Flight Recorder: a shared hunt's full redacted event
 *  log. Events stay loosely typed here; the replay engine re-parses each one against
 *  HuntEventSchema and skips anything it doesn't recognize (same policy as the live stream). */
export const SharedTracksSchema = z.object({
  title: z.string().default('A Pack hunt'),
  events: z.array(z.record(z.string(), z.unknown())).default([]),
  redacted: z.boolean().default(true),
})
export type SharedTracks = z.infer<typeof SharedTracksSchema>

/** POST /hunts/:id/rehearse — the Shadow Hunt cost/time estimate for a team + strategy + depth.
 *  Pure and instant server-side (no model calls) — safe to re-query as the user reshapes the pack. */
export const RehearseSchema = z.object({
  est_cost_usd: z.number(),
  est_time_s: z.number(),
  calls: z.number(),
  scouts: z.number(),
  warnings: z.array(z.string()).default([]),
})
export type Rehearse = z.infer<typeof RehearseSchema>

export const SpendHuntSchema = z.object({
  hunt_id: z.string(),
  title: z.string().default(''),
  cost_usd: z.number().default(0),
})
export const SpendSummarySchema = z.object({
  total_usd: z.number().default(0),
  hunts: z.array(SpendHuntSchema).default([]),
})
export type SpendHunt = z.infer<typeof SpendHuntSchema>
export type SpendSummary = z.infer<typeof SpendSummarySchema>
