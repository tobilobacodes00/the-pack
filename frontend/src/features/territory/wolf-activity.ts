import type { WolfState } from '@/events/schema'
import { wolfLabel } from '@/features/reward/lib/wolf-label'

// Present-tense verb phrase per phase — covers the WolfPhase enum AND the tool-name phases that
// `tool_called` writes ('web_search'/'web_fetch'). Shared by the canvas hover tooltip and any live
// activity readout so the two never drift.
const PHASE_VERB: Record<string, string> = {
  thinking: 'is thinking it through',
  searching: 'is searching the web',
  reading: 'is reading sources',
  merging: 'is cross-referencing findings',
  writing: 'is drafting the briefing',
  critiquing: 'is challenging the claims',
  forge: 'is making your files',
  web_search: 'is searching the web',
  web_fetch: 'is reading a page',
}

/** What a wolf is doing right now (status overrides phase). */
export function wolfActivity(w: WolfState): string {
  if (w.status === 'done') return 'has finished'
  if (w.status === 'strayed' || w.status === 'error') return 'went off-track — recovering'
  if (w.status === 'healing') return 'is being patched up'
  if (w.phase && PHASE_VERB[w.phase]) return PHASE_VERB[w.phase]
  return 'is on the move'
}

/** "Scout 2 is searching the web" — subject + activity, for the hover tooltip. */
export function wolfActivityLine(w: WolfState): string {
  return `${wolfLabel(w.wolf_id).label} ${wolfActivity(w)}`
}
