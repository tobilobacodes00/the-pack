import { ROLE_COLOR } from '@/features/territory/roles'

export interface WolfLabel {
  role: string
  n: number | null
  /** "Scout 2" — sentence form for the provenance card. */
  label: string
  /** "Scout-2" — the compact form the Sources list uses. */
  short: string
  color: string
}

/** Turn a wolf_id like "scout-2" into display labels + its role colour. */
export function wolfLabel(by: string): WolfLabel {
  const m = /^([a-z]+)-?(\d+)?$/i.exec((by ?? '').trim())
  const role = (m?.[1] ?? by ?? '').toLowerCase()
  const n = m?.[2] ? parseInt(m[2], 10) : null
  const Role = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Pack'
  return {
    role,
    n,
    label: n ? `${Role} ${n}` : Role,
    short: n ? `${Role}-${n}` : Role,
    color: ROLE_COLOR[role] ?? '#A3A3A3',
  }
}
