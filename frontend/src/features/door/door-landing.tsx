import { memo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight, ArrowUpRight, Github, Server, Workflow, PlayCircle, Figma,
  Dribbble, Palette,
} from 'lucide-react'
import { PackReveal } from './pack-reveal'

/**
 * The Door's landing. Scrolls in under the hero chat. The pinned reveal tells the story, the CTA
 * closes, the footer credits. Dark hero warms into the cream brutalist palette as the pack fans out.
 */

const toChat = () => window.scrollTo({ top: 0, behavior: 'smooth' })

const ASKS = [
  'Map the BNPL market in Nigeria: players, sizing, and risks.',
  'Run due diligence on a company before we partner with them.',
  'Compare Postgres vs MongoDB for a high-write event log.',
  'Summarise the PDF I dropped and cross-check its claims against the web.',
]

// Hackathon submission links. The footer renders one slot per deliverable.
const REPO = 'https://github.com/tobilobacodes00/the-pack'
const HACKATHON = 'https://qwencloud-hackathon.devpost.com'

// Edit here. Empty strings render an "add link" placeholder in the footer.
const SUBMISSION = {
  repo: REPO,
  figma: 'https://www.figma.com/design/agn6RMQxQX6xn1OfYQNkTr/Qwen-Hackathon?node-id=0-1&p=f&t=dqn6oIL32hRo6FpG-0',
  architecture: `${REPO}/blob/main/docs/ARCHITECTURE.md`,
  demoVideo: '',
}

// The submission deliverables, in order.
const DELIVERABLES: Array<{ Icon: typeof Github; label: string; href: string; note?: string }> = [
  { Icon: Github, label: 'Source code', href: SUBMISSION.repo },
  { Icon: Figma, label: 'Figma file', href: SUBMISSION.figma },
  { Icon: Workflow, label: 'Architecture diagram', href: SUBMISSION.architecture },
  { Icon: PlayCircle, label: 'Demo video', href: SUBMISSION.demoVideo },
]

// Context links beside the brand block.
const CONTEXT: Array<{ h: string; links: Array<{ t: string; href: string }> }> = [
  {
    h: 'Built on',
    links: [
      { t: 'Qwen Cloud', href: 'https://www.qwencloud.com' },
      { t: 'Qwen models', href: 'https://qwen.ai' },
      { t: 'Alibaba Cloud', href: 'https://www.alibabacloud.com' },
    ],
  },
  {
    h: 'Hackathon',
    links: [
      { t: 'Overview', href: HACKATHON },
      { t: 'Rules', href: `${HACKATHON}/rules` },
      { t: 'Resources', href: `${HACKATHON}/resources` },
    ],
  },
]

// The people who built A Pack. Add a builder by pushing to this list.
type BuilderStat = { Icon: typeof Github; value: string; label: string; href: string }
type Builder = {
  name: string
  role: string
  bio: string
  photo?: string
  /** Render the photo in black & white. */
  grayscale?: boolean
  site: string
  ctaLabel: string
  stats: BuilderStat[]
  links: Array<{ Icon: typeof Github; label: string; href: string }>
}

const BUILDERS: Builder[] = [
  {
    name: 'Tobiloba Sulaimon',
    role: 'Fullstack Engineer · Founder of AuTrans',
    bio: 'Fullstack engineer building technology that understands how Africans talk. I built A Pack end to end, the wolves, the live canvas, and the engine underneath, to make AI research something you can actually watch and trust.',
    photo: 'https://i.postimg.cc/CxHXd1vK/myself_(1).png',
    site: 'https://tobilobasulaimon.com',
    ctaLabel: 'Visit site',
    stats: [
      { Icon: Github, value: 'GitHub', label: 'code', href: 'https://github.com/tobilobacodes00' },
      { Icon: Server, value: 'AuTrans', label: 'founder', href: 'https://autrans.online' },
    ],
    // Chips removed under the card — the "Visit site" CTA covers reaching out.
    links: [],
  },
  {
    name: 'AbdulQudus',
    role: 'UI/UX & Product Designer',
    bio: 'UI/UX & product designer with 3+ years crafting clean, conversion-driven work across apps and dashboards. He designed A Pack end to end in Figma, every screen and interaction, turning a complex multi-agent system into something intuitive.',
    photo: '/abdul.jpeg',
    grayscale: true,
    site: 'https://dribbble.com/abdul_uxui',
    ctaLabel: 'Portfolio',
    stats: [
      { Icon: Dribbble, value: 'Dribbble', label: 'shots', href: 'https://dribbble.com/abdul_uxui' },
      { Icon: Palette, value: 'Behance', label: 'work', href: 'https://www.behance.net/abduluxui' },
    ],
    links: [],
  },
  {
    name: 'Joanna',
    role: 'Frontend Developer',
    bio: "Frontend developer who turns designs into clean, accessible code with React, Next.js, TypeScript, and Tailwind. She polished A Pack's front end, refining the interface and interactions until every screen felt right.",
    photo: '/devbyte.jpeg',
    site: 'https://staging.open-profile.hng14.com',
    ctaLabel: 'Profile',
    stats: [],
    links: [],
  },
]

// Hover motion. Spring on the card lift, a shared ease for the rest. The card animates in place so
// the page never reflows.
const CARD_SPRING = { type: 'spring' as const, stiffness: 240, damping: 24, mass: 0.9 }
const GLIDE = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const }
const CARD_H = 440
const PHOTO_REST = 224 // square window at rest, grows to fill the card on hover; leaves room below
                       // for a 4-line bio + CTA row regardless of bio length.

/** A builder profile card. At rest: photo square up top, dark text on the white panel below. On hover
 *  the card lifts, the photo grows to fill it, the white panel slides away, and the text turns white. */
function BuilderCard({ builder, delay }: { builder: Builder; delay: number }) {
  const [hover, setHover] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const initials = builder.name.split(' ').map((w) => w[0]).slice(0, 2).join('')
  const hasPhoto = !!builder.photo && !imgFailed

  // A card links out only if the builder has a site; otherwise it's a plain, still-hoverable block.
  const linkProps = builder.site
    ? { href: builder.site, target: '_blank', rel: 'noreferrer noopener' as const }
    : {}

  return (
    <Reveal delay={delay} className="w-full [perspective:1200px]">
      <motion.a
        {...linkProps}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        initial={false}
        animate={{
          scale: hover ? 1.05 : 1,
          y: hover ? -10 : 0,
          boxShadow: hover
            ? '0 44px 84px -24px rgba(26,26,26,0.34), 0 14px 30px -12px rgba(26,26,26,0.22)'
            : '0 18px 40px -18px rgba(26,26,26,0.18), 0 6px 14px -8px rgba(26,26,26,0.12)',
        }}
        transition={CARD_SPRING}
        style={{ height: CARD_H, transformOrigin: 'center bottom', willChange: 'transform' }}
        className={`group relative mx-auto block w-full max-w-[380px] overflow-hidden rounded-[28px] bg-white outline-none ${builder.site ? '' : 'cursor-default'}`}
      >
        {/* Photo: a square window up top at rest; grows to fill the whole card on hover. Only this
            card animates its own height — the page never reflows. */}
        <motion.div
          className="absolute inset-x-0 top-0 overflow-hidden rounded-[28px]"
          style={{ background: '#dfe4e6', willChange: 'height' }}
          initial={false}
          animate={{ height: hover ? CARD_H : PHOTO_REST }}
          transition={GLIDE}
        >
          {hasPhoto ? (
            <img
              src={builder.photo}
              alt={builder.name}
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
              className={`h-full w-full object-cover object-center ${builder.grayscale ? 'grayscale' : ''}`}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-brand-100 font-display text-7xl font-extrabold text-ink-400">
              {initials}
            </div>
          )}
        </motion.div>

        {/* White panel: holds dark text at rest; slides down out of view on hover as the photo takes over. */}
        <motion.div
          aria-hidden
          className="absolute inset-x-0 bottom-0 rounded-t-2xl rounded-b-[28px] bg-white"
          style={{ top: PHOTO_REST - 20 }}
          initial={false}
          animate={{ y: hover ? CARD_H : 0, opacity: hover ? 0 : 1 }}
          transition={GLIDE}
        />

        {/* Hover-only scrim so the white text reads once it's over the photo. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 -top-28"
          initial={false}
          animate={{ opacity: hover ? 1 : 0 }}
          transition={GLIDE}
          style={{ background: 'linear-gradient(to top, rgba(18,20,22,0.8), rgba(18,20,22,0.4) 46%, rgba(18,20,22,0))' }}
        />

        {/* Text sits at the bottom in both states — dark at rest, white over the photo on hover. */}
        <div className="absolute inset-x-0 bottom-0 px-6 pb-6 pt-4">
          <motion.h3
            className="font-display text-[16px] font-extrabold leading-[1.25] tracking-tight pb-0.5"
            initial={false}
            animate={{ color: hover ? '#ffffff' : '#1a1a1a' }}
            transition={GLIDE}
          >
            {builder.name}
          </motion.h3>
          <motion.p
            className="mt-1 text-[11.5px] leading-snug"
            initial={false}
            animate={{ color: hover ? 'rgba(255,255,255,0.9)' : '#6b6b6b' }}
            transition={GLIDE}
          >
            {builder.bio}
          </motion.p>

          {/* Stats + real CTA — honest (links out, no fake counts). Hidden when a builder has none. */}
          {(builder.stats.length > 0 || builder.site) && (
            <div className="mt-3.5 flex items-center gap-3.5">
              {builder.stats.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => e.stopPropagation()}
                  className={`flex items-center gap-1.5 transition-colors ${hover ? 'text-white/90 hover:text-white' : 'text-ink-700 hover:text-ink-900'}`}
                  title={`${s.value} · ${s.label}`}
                >
                  <s.Icon size={14} className={hover ? 'text-white/70' : 'text-ink-500'} />
                  <span className="text-[11.5px] font-semibold">{s.value}</span>
                </a>
              ))}
              {builder.site && builder.ctaLabel && (
                <span
                  className={`ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all group-hover:scale-[1.03] ${
                    hover ? 'bg-white text-ink-900' : 'bg-ink-900 text-white'
                  }`}
                >
                  {builder.ctaLabel}
                  <ArrowUpRight size={12} />
                </span>
              )}
            </div>
          )}
        </div>
      </motion.a>
    </Reveal>
  )
}

/** Fade-and-rise UP from below as a block scrolls into view (once). */
function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-500">{children}</p>
}

/** Memoized + narrowed to one stable setter — the composer's `input` re-renders DoorPage on every
 *  keystroke, and without this that would reconcile the whole landing tree on top of the two
 *  already-running WebGL rAF loops (pack canvas + fluid cursor). */
export const DoorLanding = memo(function DoorLanding({ setInput }: { setInput: (v: string) => void }) {
  const seed = (prompt: string) => {
    setInput(prompt)
    toChat()
  }

  return (
    <div className="relative w-full">
      {/* Thin vertical guide lines — the agency-grid motif, very faint. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <div className="mx-auto h-full max-w-6xl px-6">
          <div className="relative h-full">
            <span className="absolute inset-y-0 left-1/4 w-px bg-ink-900/[0.06]" />
            <span className="absolute inset-y-0 left-1/2 w-px bg-ink-900/[0.06]" />
            <span className="absolute inset-y-0 left-3/4 w-px bg-ink-900/[0.06]" />
          </div>
        </div>
      </div>

      <div className="relative z-10">
        {/* ── Meet the pack (pinned reveal: expand → collide → value) ───────────── */}
        <PackReveal />

        {/* ── Big CTA (statement + button + brand mark) ────────────────────────── */}
        <section className="cv-auto relative overflow-hidden border-t border-ink-900/10">
          <div className="relative mx-auto max-w-6xl px-5 pt-16 pb-12 text-center sm:px-6 sm:pt-24 md:pt-28 md:pb-14">
            <Reveal>
              <Kicker>Get started</Kicker>
              {/* Fluid headline: scales continuously with the viewport so tablets get a sensible size,
                  not the desktop 72px jammed onto an 800px screen. */}
              <h2
                className="mx-auto mt-6 max-w-4xl font-display font-extrabold leading-[1.02] tracking-tight text-ink-900"
                style={{ fontSize: 'clamp(2rem, 6vw, 4.5rem)' }}
              >
                Send the pack after<br />your next question.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[14px] leading-relaxed text-ink-500 sm:mt-6 sm:text-[15px]">
                Type it, speak it, or drop a file. See the price before it spends a cent, watch the
                work happen live, and get a brief where every claim carries a receipt.
              </p>
              <button
                onClick={toChat}
                className="group mx-auto mt-9 inline-flex items-center gap-2 rounded-full bg-brand-500 px-8 py-3.5 text-sm font-semibold text-white shadow-chunk-sm transition-all hover:-translate-y-0.5 hover:shadow-chunk active:translate-y-0"
              >
                Start a hunt
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2.5">
                {ASKS.map((a) => (
                  <button
                    key={a}
                    onClick={() => seed(a)}
                    className="rounded-full border-[2px] border-ink-900 bg-cream-50 px-4 py-2 text-left text-[13px] font-medium text-ink-700 shadow-chunk-sm transition-all hover:-translate-y-0.5 hover:bg-white"
                  >
                    {a}
                  </button>
                ))}
              </div>
            </Reveal>
          </div>

          {/* The resting logo — the journey wolf shrinks + descends into this spot and fades out
              as this static mark fades in, so it "comes to rest as the logo at the bottom." */}
          <Reveal delay={0.12}>
            <div className="relative flex items-end justify-center pb-2">
              <div
                aria-hidden
                className="pointer-events-none absolute bottom-0 left-1/2 h-[300px] w-[300px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
                style={{ background: 'radial-gradient(closest-side, rgba(26,26,26,0.14), transparent)' }}
              />
              <img
                src="/pack-logo.svg"
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="relative h-28 w-auto opacity-95 sm:h-32 md:h-40"
                style={{ filter: 'drop-shadow(0 18px 40px rgba(23,58,32,0.22))' }}
              />
            </div>
          </Reveal>
        </section>

        {/* ── Builders — the people behind A Pack (sits just above the footer) ──── */}
        <section className="cv-auto relative overflow-hidden border-t border-ink-900/10">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-16 md:py-20">
            <Reveal>
              <Kicker>The team</Kicker>
              <h2 className="mt-4 max-w-2xl font-display text-2xl font-extrabold leading-tight tracking-tight text-ink-900 sm:mt-5 sm:text-3xl md:text-4xl">
                The pack behind the pack.
              </h2>
            </Reveal>

            <div className="mt-10 grid grid-cols-1 justify-items-center gap-10 sm:mt-12 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3 lg:gap-6">
              {BUILDERS.map((b, i) => (
                <div key={b.name} className="flex w-full max-w-[380px] flex-col items-center">
                  <BuilderCard builder={b} delay={0.05 * i} />
                  {/* Role + the direct social chips beneath the card. */}
                  <Reveal delay={0.08 * i + 0.1} className="w-full">
                    <p className="mt-6 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                      {b.role}
                    </p>
                    {b.links.length > 0 && (
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {b.links.map(({ Icon, label, href }) => (
                          <a
                            key={label}
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={label}
                            title={label}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border-[2px] border-ink-900 bg-white text-ink-700 transition-all hover:-translate-y-0.5 hover:bg-cream-100 hover:text-ink-900"
                          >
                            <Icon size={15} />
                          </a>
                        ))}
                      </div>
                    )}
                  </Reveal>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Footer — a slot for each submission deliverable + Qwen Cloud attribution ── */}
        <footer className="cv-auto border-t border-ink-900/10">
          {/* The submission deliverables. Filled slots link out; empty ones show "add link". */}
          <Reveal>
            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-px bg-ink-900/10 sm:grid-cols-2 md:grid-cols-4">
              {DELIVERABLES.map(({ Icon, label, href, note }) =>
                href ? (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group flex items-center justify-between bg-cream-50 px-5 py-5 transition-colors hover:bg-cream-100 sm:px-6 sm:py-6"
                  >
                    <span className="flex items-center gap-3 text-[14px] font-semibold text-ink-900">
                      <Icon size={18} className="text-brand-500" />
                      {label}
                      {note && <span className="text-[11px] font-normal text-ink-400">· {note}</span>}
                    </span>
                    <ArrowUpRight size={18} className="text-ink-400 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </a>
                ) : (
                  <div key={label} className="flex items-center justify-between bg-cream-50 px-5 py-5 sm:px-6 sm:py-6">
                    <span className="flex items-center gap-3 text-[14px] font-semibold text-ink-400">
                      <Icon size={18} className="text-ink-400" />
                      {label}
                      {note && <span className="text-[11px] font-normal">· {note}</span>}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-600">Add link</span>
                  </div>
                ),
              )}
            </div>
          </Reveal>

          {/* Brand + attribution · context columns. Single column on phones, two on small tablets,
              four across on desktop — the brand block spans the full row until it's four-up. */}
          <div className="border-t border-ink-900/10">
            <Reveal>
              <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-5 py-12 sm:grid-cols-2 sm:gap-10 sm:px-6 sm:py-14 md:grid-cols-4 md:py-16">
                <div className="sm:col-span-2">
                  <div className="flex items-center gap-2.5">
                    <img src="/pack-logo.svg" className="h-7 w-auto" alt="" loading="lazy" decoding="async" />
                    <span className="font-display text-lg font-extrabold tracking-wide text-ink-900">A Pack</span>
                  </div>
                  <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-ink-500">
                    A research team you can watch, and audit. Built with Qwen models on Qwen Cloud,
                    with the backend running on Alibaba Cloud.
                  </p>
                </div>
                {CONTEXT.map((c) => (
                  <div key={c.h}>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500">{c.h}</p>
                    <ul className="mt-4 flex flex-col gap-2.5">
                      {c.links.map((l) => (
                        <li key={l.t}>
                          <a
                            href={l.href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-[14px] text-ink-700 transition-colors hover:text-ink-900"
                          >
                            {l.t}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          <div className="border-t border-ink-900/10">
            <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-6 text-[12px] text-ink-500 md:flex-row md:items-center md:justify-between">
              <span>© 2026 A Pack</span>
              <span>Built with Qwen Cloud · Global AI Hackathon Series</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
})
