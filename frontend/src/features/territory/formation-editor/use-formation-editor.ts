import { useState, useMemo, useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { buildGraph } from '../graph-canvas'
import { ROLE_DESC } from '../roles'
import {
  buildTeam, expandTeamToWolves, wolfIds, addedInstances, teamToCounts, seedCounts, roleBounds,
} from './formation-model'
import type { EditableNodeData } from './editable-agent-node'
import type { PlanState } from '@/events/schema'
import type { PendingEdits } from '@/store/hunt-store'

/** A scout's assigned search angle, if the plan carries one. Scout ids are `scout-1..N` and the
 *  plan's `queries` are positional — `queries[i]` is `scout-(i+1)`'s angle, the exact mapping the
 *  engine zips at execution (orchestrate/deep_dive/critique). Non-scouts have no per-instance query. */
function scoutQuery(plan: PlanState | null, wolfId: string): string | null {
  const m = /^scout-(\d+)$/.exec(wolfId)
  if (!m || !plan?.queries) return null
  return plan.queries[Number(m[1]) - 1]?.trim() || null
}

/**
 * Owns the Edit-Formations state: per-role `counts` (floored at the plan's proposal — additive only)
 * and per-wolf `notes`. Derives the canvas nodes/edges (auto-arranged via `buildGraph`), the
 * selected-agent inspector, and the save payload the backend `_apply_edits` seam consumes.
 */
export function useFormationEditor(plan: PlanState | null) {
  const baseTeam = useMemo(() => buildTeam(seedCounts(plan)), [plan])
  const floor = useMemo(() => teamToCounts(baseTeam), [baseTeam]) // proposed counts = the minimum
  const [counts, setCounts] = useState<Record<string, number>>(() => teamToCounts(baseTeam))
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)

  const editedTeam = useMemo(() => buildTeam(counts), [counts])
  const added = useMemo(() => addedInstances(baseTeam, editedTeam), [baseTeam, editedTeam])
  const addedIds = useMemo(() => new Set(added.map((a) => a.wolfId)), [added])

  const spawn = useCallback((role: string) => {
    setCounts((c) => {
      const cur = c[role] ?? 1
      if (cur >= roleBounds(role).max) return c
      return { ...c, [role]: cur + 1 }
    })
  }, [])

  const removeRole = useCallback((role: string) => {
    setCounts((c) => {
      const cur = c[role] ?? 1
      const min = Math.max(roleBounds(role).min, floor[role] ?? 1)
      if (cur <= min) return c
      return { ...c, [role]: cur - 1 }
    })
    setSelected(null)
  }, [floor])

  const setNote = useCallback((wolfId: string, text: string) => {
    setNotes((n) => ({ ...n, [wolfId]: text }))
  }, [])

  const selectWolf = useCallback((wolfId: string | null) => setSelected(wolfId), [])

  const { nodes, edges } = useMemo(() => {
    const wolves = expandTeamToWolves(editedTeam)
    const g = buildGraph(wolves)
    const perRole: Record<string, number> = {}
    const built: Node<EditableNodeData>[] = g.nodes.map((n, i) => {
      const role = wolves[i]
      const idx = perRole[role] ?? 0
      perRole[role] = idx + 1
      const wid = wolfIds(role, counts[role] ?? floor[role] ?? 1)[idx]
      return {
        ...n,
        type: 'editableAgent',
        // Selectable so ReactFlow keeps pointer-events on the node — otherwise clicks never land, so
        // you can't select an agent to add/remove it or write its note. Dragging stays off.
        selectable: true,
        draggable: false,
        data: {
          role,
          wolfId: wid,
          selected: selected === wid,
          added: addedIds.has(wid),
          hasNote: !!(notes[wid] ?? '').trim(),
          canAdd: (counts[role] ?? 1) < roleBounds(role).max,
          onSelect: selectWolf,
          onSpawn: spawn,
          onRemove: removeRole,
        },
      }
    })
    return { nodes: built, edges: g.edges }
  }, [editedTeam, counts, floor, selected, addedIds, notes, selectWolf, spawn, removeRole])

  const selectedInfo = useMemo(() => {
    if (!selected) return null
    const a = added.find((x) => x.wolfId === selected)
    const role = a?.role ?? selected.replace(/-\d+$/, '')
    return {
      wolfId: selected,
      role,
      added: !!a,
      note: notes[selected] ?? '',
      // What this wolf will do: its role contribution, plus — for a scout — its assigned search angle
      // from the plan (so the Packmaster sees the real work before approving, not a generic blurb).
      desc: ROLE_DESC[role] ?? '',
      query: scoutQuery(plan, selected),
    }
  }, [selected, added, notes, plan])

  /** Per-role capacity for the palette. */
  const capacity = useCallback(
    (role: string) => ({
      count: counts[role] ?? floor[role] ?? 1,
      min: Math.max(roleBounds(role).min, floor[role] ?? 1),
      max: roleBounds(role).max,
    }),
    [counts, floor],
  )

  const savePayload = useCallback((): PendingEdits => {
    // Keep notes for EVERY wolf that still exists in the edited team (not just user-added extras) — the
    // backend `_apply_edits` honors a handler note on any wolf_id and injects it into that wolf's prompt.
    // Scope to live ids so a note left on a role whose count was later reduced doesn't ride along orphaned.
    const liveIds = new Set<string>()
    for (const t of editedTeam) for (const id of wolfIds(t.role, t.count)) liveIds.add(id)
    const cleanNotes: Record<string, string> = {}
    for (const [wolfId, raw] of Object.entries(notes)) {
      const t = (raw ?? '').trim()
      if (t && liveIds.has(wolfId)) cleanNotes[wolfId] = t
    }
    return { team: editedTeam, notes: cleanNotes }
  }, [editedTeam, notes])

  const addedCount = added.length

  return {
    nodes, edges, spawn, removeRole, setNote, selectWolf,
    selected, selectedInfo, capacity, savePayload, addedCount,
  }
}

export type FormationEditorApi = ReturnType<typeof useFormationEditor>
