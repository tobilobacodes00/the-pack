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
