// The role avatar (ringed disc + glyph) and its tone colour — extracted from agent-node so it
// carries NO @xyflow/react dependency. This lets the marketing landing (PackReveal) reuse the
// exact pack avatars without pulling React Flow onto its critical path. agent-node re-exports
// these for the territory canvas.
import { ROLE_COLOR } from './roles'

/** Live state of an agent on the canvas — drives colour + glow. */
export type AgentTone = 'idle' | 'active' | 'done' | 'strayed' | 'healing'

export const GLYPH_SIZE = 80

// Glyph colour for a tone: idle grey, strayed/sick grey (a faulted agent reads as dimmed/down until a
// Warden reaches it), healing cyan, else the role colour.
export function toneColor(role: string, tone: AgentTone): string {
  if (tone === 'idle') return 'currentColor' // dormant — charcoal ink
  if (tone === 'strayed') return '#9A9A9A' // down/faulted — dim grey
  if (tone === 'healing') return '#22B8CF' // cyan — a Warden is reaching it
  return ROLE_COLOR[role] ?? '#6B6B6B' // active / done — the role's colour
}

// Idle icons verbatim from the design; each viewBox centres on the glyph's ref point, so paths need no transform.
type IconDef = { cx: number; cy: number; icon: React.ReactNode }

const ICONS: Record<string, IconDef> = {
  alpha: {
    cx: 592, cy: 61,
    icon: (
      <path
        d="M591.388 50.453C591.924 49.2907 593.576 49.2907 594.112 50.453L596.609 55.8669C596.828 56.3406 597.277 56.6668 597.795 56.7282L603.715 57.4302C604.986 57.5809 605.497 59.152 604.557 60.021L600.18 64.069C599.797 64.4232 599.625 64.9509 599.727 65.4626L600.889 71.3104C601.139 72.5658 599.802 73.5368 598.685 72.9116L593.483 69.9995C593.027 69.7446 592.473 69.7446 592.017 69.9995L586.815 72.9116C585.698 73.5368 584.362 72.5658 584.611 71.3104L585.773 65.4626C585.875 64.9509 585.703 64.4232 585.32 64.069L580.943 60.021C580.003 59.152 580.514 57.5809 581.785 57.4302L587.705 56.7282C588.223 56.6668 588.672 56.3406 588.891 55.8669L591.388 50.453Z"
        fill="currentColor"
      />
    ),
  },
  beta: {
    cx: 592, cy: 194,
    icon: (
      <>
        <path d="M580 183.5C580 182.672 580.672 182 581.5 182H584.5C585.328 182 586 182.672 586 183.5V206H580V183.5Z" fill="currentColor" />
        <path d="M589 189.5C589 188.672 589.672 188 590.5 188H593.5C594.328 188 595 188.672 595 189.5V206H589V189.5Z" fill="currentColor" />
        <path d="M598 183.5C598 182.672 598.672 182 599.5 182H602.5C603.328 182 604 182.672 604 183.5V206H598V183.5Z" fill="currentColor" />
      </>
    ),
  },
  scout: {
    cx: 593, cy: 345,
    icon: (
      <>
        <path d="M582.5 355.5C581.75 349.5 582.8 339 593 345C603.2 351 604.25 340.5 603.5 334.5" stroke="currentColor" strokeWidth="3" />
        <circle cx="3" cy="3" r="3" transform="matrix(-1 0 0 1 606.5 331.5)" fill="#A3A3A3" />
        <circle cx="3" cy="3" r="3" transform="matrix(-1 0 0 1 585.5 352.5)" fill="#A3A3A3" />
      </>
    ),
  },
  tracker: {
    cx: 593, cy: 499,
    icon: (
      <>
        <path d="M593 485.5V512.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M606.5 499H579.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle cx="593" cy="499" r="7.5" fill="#A3A3A3" stroke="currentColor" strokeWidth="3" />
        <circle cx="593" cy="499" r="3" fill="currentColor" />
      </>
    ),
  },
  howler: {
    cx: 593, cy: 648,
    icon: (
      <>
        <path d="M602.059 643.876L587.954 657.981C587.836 658.098 587.681 658.174 587.516 658.195L582.668 658.8C582.182 658.861 581.77 658.449 581.831 657.963L582.436 653.115C582.457 652.95 582.532 652.795 582.65 652.677L596.755 638.572L602.059 643.876Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M603.166 637.462C604.63 638.927 604.63 641.301 603.166 642.766L602.105 643.826L596.802 638.523L597.863 637.462C599.327 635.998 601.701 635.998 603.166 637.462Z" fill="#A3A3A3" stroke="currentColor" strokeWidth="1.5" />
      </>
    ),
  },
  sentinel: {
    cx: 593, cy: 804,
    icon: (
      <>
        <path d="M580.585 813.329L591.658 791.183C592.211 790.078 593.789 790.078 594.342 791.183L605.415 813.329C605.913 814.327 605.188 815.5 604.073 815.5H581.927C580.812 815.5 580.087 814.327 580.585 813.329Z" fill="currentColor" />
        <circle cx="1.5" cy="1.5" r="0.75" transform="matrix(-1 0 0 1 594.5 809.5)" fill="#A3A3A3" stroke="#A3A3A3" strokeWidth="1.5" />
        <path d="M593 796V808" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  elder: {
    cx: 594, cy: 962,
    icon: (
      <>
        <path d="M593.25 948.933C593.714 948.665 594.286 948.665 594.75 948.933L604.941 954.817C605.405 955.085 605.691 955.58 605.691 956.116V967.884C605.691 968.42 605.405 968.915 604.941 969.183L594.75 975.067C594.286 975.335 593.714 975.335 593.25 975.067L583.059 969.183C582.595 968.915 582.309 968.42 582.309 967.884V956.116C582.309 955.58 582.595 955.085 583.059 954.817L593.25 948.933Z" fill="currentColor" />
        <circle cx="3" cy="3" r="3" transform="matrix(-1 0 0 1 597 959)" fill="#A3A3A3" />
      </>
    ),
  },
}

function iconFor(role: string): IconDef {
  if (ICONS[role]) return ICONS[role]
  if (role === 'hunter') return ICONS.tracker
  // The healers share the shield/medic mark (elder glyph) — the Warden supersedes the Doctor.
  if (role === 'doctor' || role === 'warden') return ICONS.elder
  return ICONS.alpha
}

/**
 * The grey idle avatar for a role — three concentric rings + the role's glyph,
 * taken verbatim from the "idle state" design. Shared by the canvas node, the
 * roster, and the marketing landing so an inactive pack reads identically everywhere.
 * `size` only scales the render; the 80-unit viewBox (centred on the glyph) is preserved.
 */
export function IdleGlyph({
  role,
  size = GLYPH_SIZE,
  tone = 'idle',
  accent,
  outline = false,
  showDone = false,
}: {
  role: string
  size?: number
  tone?: AgentTone
  /** Override the active colour (e.g. the landing's pastel per-role accent, tuned for cream). */
  accent?: string
  /** Draw a chunky forest-ink rim so the disc reads as a coin on the cream landing. */
  outline?: boolean
  /** When true, a finished (`done`) wolf gets a small check badge so it reads as DONE at a glance —
   *  not just "same colour as active, minus the ring". The canvas node opts in; tiny avatars don't. */
  showDone?: boolean
}) {
  const { cx, cy, icon } = iconFor(role)
  const viewBox = `${cx - GLYPH_SIZE / 2} ${cy - GLYPH_SIZE / 2} ${GLYPH_SIZE} ${GLYPH_SIZE}`
  const idle = tone === 'idle'
  const done = tone === 'done'
  // Charcoal coin (the logo grey) always; an idle agent's glyph is a dim grey, an ACTIVE one lights up
  // in its role/state colour — so the pack carries colour while the chrome stays monochrome.
  const tc = accent ?? toneColor(role, tone)
  const color = idle ? '#8a8a8a' : tc
  const ring = idle ? '#9a9a9a' : tc
  const halo = idle ? '#ebeae6' : tc
  const discFill = '#1a1a1a' // charcoal ink coin
  // Ease every colour/opacity change so a tone flip (idle→active→done→strayed) glides instead of
  // snapping — the "refined, clearly-alive" feel. GPU-cheap (paint-only props).
  const ease = 'stroke 400ms ease, fill 400ms ease, opacity 400ms ease, color 400ms ease'

  return (
    // `color` drives the glyph via currentColor; rings + faint halo pick up the role colour once active.
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      style={{ display: 'block', color, transition: ease, overflow: 'visible' }}
    >
      <circle opacity={idle ? 0.1 : 0.18} cx={cx} cy={cy} r="39.75" fill={halo} stroke={ring} strokeWidth="0.5" style={{ transition: ease }} />
      <circle opacity={idle ? 0.3 : 0.28} cx={cx} cy={cy} r="34.75" fill={halo} stroke={ring} strokeWidth="0.5" style={{ transition: ease }} />
      <circle
        cx={cx}
        cy={cy}
        r="29.75"
        fill={discFill}
        stroke={outline ? '#1A1A1A' : ring}
        strokeWidth={outline ? 2.5 : idle ? 0.5 : 1.5}
        style={{ transition: ease }}
      />
      {icon}
      {/* Done badge — a small check disc at the coin's lower-right. Only when the caller opts in AND
          the wolf has actually finished, so "done" is instantly distinct from "active". */}
      {showDone && done && (
        <g style={{ transformOrigin: `${cx + 20}px ${cy + 20}px` }} className="glyph-done-pop">
          <circle cx={cx + 20} cy={cy + 20} r="9" fill={ring} stroke="#1a1a1a" strokeWidth="1.5" />
          <path
            d={`M ${cx + 15.5} ${cy + 20} L ${cx + 18.7} ${cy + 23} L ${cx + 24.5} ${cy + 16.5}`}
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  )
}
