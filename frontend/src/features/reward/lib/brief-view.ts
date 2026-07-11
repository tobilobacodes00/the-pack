import type { Brief, BriefBlock } from '@/api/hunts'

export interface BriefView {
  title: string
  bodyBlocks: BriefBlock[]
  noSources: boolean
  refined: boolean
}

/** Split a brief into its title (the leading "# …" block) and body paragraphs. */
export function parseBrief(brief: Brief, fallbackTitle: string): BriefView {
  const blocks = brief.content.blocks ?? []
  let title = ''
  const body: BriefBlock[] = []
  for (const b of blocks) {
    const t = (b.text ?? '').trim()
    if (!title && t.startsWith('# ')) {
      title = t.slice(2).trim()
      continue
    }
    if (t) body.push(b)
  }
  if (body.length === 0 && brief.content.text?.trim()) {
    body.push({ text: brief.content.text.trim(), source_ids: [] })
  }
  return {
    title: title || fallbackTitle || 'Untitled brief',
    bodyBlocks: body,
    noSources: brief.content.no_sources || (brief.content.sources?.length ?? 0) === 0,
    refined: !!brief.content.refined,
  }
}

/** "Researched and drafted by Pack · {project} · June 17, 2026" (segments omitted when unavailable). */
export function formatByline(dateISO?: string | null, project?: string | null): string {
  const parts = ['Researched and drafted by Pack']
  if (project) parts.push(project)
  if (dateISO) {
    const d = new Date(dateISO)
    if (!Number.isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))
    }
  }
  return parts.join(' · ')
}
