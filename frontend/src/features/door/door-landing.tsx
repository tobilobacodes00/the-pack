import { memo, useState, type FormEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight, ArrowUpRight, Github, Server, Workflow, PlayCircle, FileText, PenLine,
  Linkedin, Twitter, Instagram, Mail, MessageCircle,
} from 'lucide-react'
import { toast } from '@/store/toast-store'
import { PackReveal } from './pack-reveal'

/**
 * The Door's landing — scrolls in below the hero chat on the intake screen (see door-page).
 * Deliberately lean: the pinned "meet the pack" reveal carries the story (who's on it + what it
 * gets you), then a big CTA and the footer close it out. The scroll runs a dark→light journey —
 * the dark hero warms into A Pack's cream, warm-brutalist palette (sage brand, forest-ink text +
 * outlines, chunky offset shadows, soft pastel per-role accents) as the pack fans out.
 */

const toChat = () => window.scrollTo({ top: 0, behavior: 'smooth' })

const ASKS = [
  'Map the BNPL market in Nigeria: players, sizing, and risks.',
  'Run due diligence on a company before we partner with them.',
  'Compare Postgres vs MongoDB for a high-write event log.',
  'Summarise the PDF I dropped and cross-check its claims against the web.',
]

// A Pack is a submission to the Global AI Hackathon Series with Qwen Cloud. The footer carries
// a slot for each of the six submission deliverables + the "Built with Qwen Cloud" attribution.
const REPO = 'https://github.com/tobilobacodes00/the-pack'
const HACKATHON = 'https://qwencloud-hackathon.devpost.com'

// ⬇️ THE ONE PLACE TO EDIT: paste your real URLs here as you get them. Leave '' and the footer
//    shows an "add link" placeholder for that deliverable. Pre-filled where we already have it.
const SUBMISSION = {
  repo: REPO, // public, open-source, with a LICENSE file visible at the top
  backend: `${REPO}/blob/main/backend/app/qwen/client.py`, // proof: code calling Qwen Cloud / Alibaba Cloud
  architecture: `${REPO}/blob/main/docs/ARCHITECTURE.md`,
  demoVideo: '', // ~3-min public video — YouTube / Vimeo / Facebook
  devpost: HACKATHON, // your Devpost submission page (add your specific entry URL)
  blog: '', // optional — blog / social post for the Blog Post Prize
}

// The six deliverables, in submission order.
const DELIVERABLES: Array<{ Icon: typeof Github; label: string; href: string; note?: string }> = [
  { Icon: Github, label: 'Source code', href: SUBMISSION.repo },
  { Icon: Server, label: 'Alibaba Cloud backend', href: SUBMISSION.backend },
  { Icon: Workflow, label: 'Architecture diagram', href: SUBMISSION.architecture },
  { Icon: PlayCircle, label: 'Demo video', href: SUBMISSION.demoVideo },
  { Icon: FileText, label: 'Devpost submission', href: SUBMISSION.devpost },
  { Icon: PenLine, label: 'Blog post', href: SUBMISSION.blog, note: 'optional' },
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

// The people who built A Pack. Edit this list to add a builder.
type BuilderStat = { Icon: typeof Github; value: string; label: string; href: string }
type Builder = {
  name: string
  role: string
  bio: string
  photo?: string
  site: string
  ctaLabel: string
  stats: BuilderStat[]
  links: Array<{ Icon: typeof Github; label: string; href: string }>
}

const BUILDERS: Builder[] = [
  {
    name: 'Tobiloba Sulaimon',
    role: 'Fullstack Engineer · Founder of AuTrans',
    bio: 'Fullstack engineer building technology that understands how Africans talk. I built A Pack end to end — the wolves, the live canvas, and the engine underneath — to make AI research something you can actually watch and trust.',
    photo: 'https://i.postimg.cc/CxHXd1vK/myself_(1).png',
    site: 'https://tobilobasulaimon.com',
    ctaLabel: 'Visit site',
    // Real, honest chrome — a link out to the platforms, not invented follower counts.
    stats: [
      { Icon: Github, value: 'GitHub', label: 'code', href: 'https://github.com/tobilobacodes00' },
      { Icon: Server, value: 'AuTrans', label: 'founder', href: 'https://autrans.online' },
    ],
    links: [
      { Icon: Github, label: 'GitHub', href: 'https://github.com/tobilobacodes00' },
      { Icon: Linkedin, label: 'LinkedIn', href: 'https://www.linkedin.com/in/tobilobacodes' },
      { Icon: Twitter, label: 'X', href: 'https://x.com/tobilobacodes00' },
      { Icon: Instagram, label: 'Instagram', href: 'https://www.instagram.com/tobilobacodes' },
      { Icon: Mail, label: 'Email', href: 'mailto:hello@tobilobasulaimon.com' },
      {
        Icon: MessageCircle,
        label: 'WhatsApp',
        href: 'https://wa.me/2349021063830?text=Hello%20Tobiloba%2C%20I%27m%20reaching%20out%20from%20A%20Pack.',
      },
    ],
  },
]

// Smooth, GPU-friendly hover. The whole card lifts + scales; the photo (which fills the card behind
// everything) scales up a touch; and the text panel slides UP to overlap the photo bottom, its
// frosted-glass backdrop fading in — so the flat "state 1" morphs into the lifted "state 2".
// EVERYTHING animates on transform/opacity only (translate/scale/opacity) — no margin/aspect-ratio,
// so it's 60fps with no layout thrash. Spring on the lift so it glides rather than snaps.
const CARD_SPRING = { type: 'spring' as const, stiffness: 240, damping: 24, mass: 0.9 }
const GLIDE = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const }
const CARD_H = 460 // fixed card height — nothing reflows the PAGE on hover (the card animates in place)
const PHOTO_REST = 300 // resting photo height (a near-square window up top, face centered)

/** One builder profile card. Rests as the flat card (photo inset up top, text below); on hover it
 *  scales up and the text panel glides over the now-fuller photo on a frosted-glass panel. */
function BuilderCard({ builder, delay }: { builder: Builder; delay: number }) {
  const [hover, setHover] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const initials = builder.name.split(' ').map((w) => w[0]).slice(0, 2).join('')
  const hasPhoto = !!builder.photo && !imgFailed

  return (
    <Reveal delay={delay} className="w-full [perspective:1200px]">
      <motion.a
        href={builder.site}
        target="_blank"
        rel="noreferrer noopener"
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
        className="group relative mx-auto block w-full max-w-[380px] overflow-hidden rounded-[28px] bg-white outline-none"
      >
        {/* ── Photo. RESTING: a near-square window up top (face centered), text on white below —
             matching the mockup's state 1. HOVER: the window grows to fill the whole card so the
             photo bleeds full behind the glass (state 2). Only this card animates its own height —
             the page never reflows. object-center + object-cover keeps the face framed at both sizes. ── */}
        <motion.div
          className="absolute inset-x-0 top-0 overflow-hidden"
          style={{ background: '#dfe4e6', willChange: 'height, border-radius' }}
          initial={false}
          animate={{ height: hover ? CARD_H : PHOTO_REST, borderRadius: hover ? 28 : 20 }}
          transition={GLIDE}
        >
          {hasPhoto ? (
            <img
              src={builder.photo}
              alt={builder.name}
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
              className="h-full w-full object-cover object-center"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-brand-100 font-display text-7xl font-extrabold text-ink-400">
              {initials}
            </div>
          )}
        </motion.div>

        {/* ── Text panel. Sits at the bottom and STAYS PUT — same size, same place. On hover ONLY the
             card expands (photo grows behind); the text just shifts to white over a soft scrim. ── */}
        <div className="absolute inset-x-0 bottom-0 px-6 pb-6 pt-4">
          {/* Legibility scrim — a gentle dark wash under the white text on hover (no solid panel). Tall
              enough to fade the photo behind the whole text block, anchored to the panel bottom. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 -top-24"
            initial={false}
            animate={{ opacity: hover ? 1 : 0 }}
            transition={GLIDE}
            style={{ background: 'linear-gradient(to top, rgba(20,22,24,0.68), rgba(20,22,24,0.32) 50%, rgba(20,22,24,0))' }}
          />
          <div className="relative">
            <motion.h3
              className="font-display text-[19px] font-extrabold tracking-tight"
              initial={false}
              animate={{ color: hover ? '#ffffff' : '#1a1a1a' }}
              transition={GLIDE}
            >
              {builder.name}
            </motion.h3>
            <motion.p
              className="mt-1.5 text-[12.5px] leading-snug"
              initial={false}
              animate={{ color: hover ? 'rgba(255,255,255,0.9)' : '#6b6b6b' }}
              transition={GLIDE}
            >
              {builder.bio}
            </motion.p>

            {/* Stats + real CTA — the mockup's "312 · 48 · Follow", made honest (links out, no fake counts). */}
            <div className="mt-4 flex items-center gap-4">
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
                  <s.Icon size={15} className={hover ? 'text-white/70' : 'text-ink-500'} />
                  <span className="text-[12.5px] font-semibold">{s.value}</span>
                </a>
              ))}
              {/* CTA: dark pill at rest; on hover flips to a white pill (reads on the dark scrim). */}
              <span
                className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all group-hover:scale-[1.03] ${
                  hover ? 'bg-white text-ink-900' : 'bg-ink-900 text-white'
                }`}
              >
                {builder.ctaLabel}
                <ArrowUpRight size={13} />
              </span>
            </div>
          </div>
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

/**
 * Memoized + narrowed to the one stable setter it needs: the composer's `input` state lives at
 * page level (useDoorLogic), so every keystroke re-renders DoorPage. Without this, that would
 * reconcile the whole landing tree (PackReveal's 7 role captions, 5 animated use-case lines, the
 * CTA, the full footer) on every keypress, on top of the two already-running WebGL rAF loops
 * (the pack canvas + the fluid cursor) — pure wasted reconciliation, since the landing has never
 * needed anything from `door` except this setter.
 */
export const DoorLanding = memo(function DoorLanding({ setInput }: { setInput: (v: string) => void }) {
  const seed = (prompt: string) => {
    setInput(prompt)
    toChat()
  }
  const [email, setEmail] = useState('')
  const subscribe = (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    toast({ title: "You're on the list. We'll keep you posted.", variant: 'success' })
    setEmail('')
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
          <div className="relative mx-auto max-w-6xl px-6 pt-28 pb-14 text-center">
            <Reveal>
              <Kicker>Get started</Kicker>
              <h2 className="mx-auto mt-6 max-w-4xl font-display text-5xl font-extrabold leading-[1.0] tracking-tight text-ink-900 md:text-7xl">
                Send the pack after<br />your next question.
              </h2>
              <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-ink-500">
                Type it, speak it, or drop a file. Set a budget. Then watch the work happen, live.
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
                className="relative h-40 w-auto opacity-95"
                style={{ filter: 'drop-shadow(0 18px 40px rgba(23,58,32,0.22))' }}
              />
            </div>
          </Reveal>
        </section>

        {/* ── Builders — the people behind A Pack (sits just above the footer) ──── */}
        <section className="cv-auto relative overflow-hidden border-t border-ink-900/10">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <Reveal>
              <Kicker>The builders</Kicker>
              <h2 className="mt-5 max-w-2xl font-display text-3xl font-extrabold leading-tight tracking-tight text-ink-900 md:text-4xl">
                Made by the people who send the pack.
              </h2>
            </Reveal>

            <div className="mt-12 grid grid-cols-1 justify-items-center gap-14 md:grid-cols-2 md:gap-10">
              {BUILDERS.map((b, i) => (
                <div key={b.name} className="flex w-full max-w-[380px] flex-col items-center">
                  <BuilderCard builder={b} delay={0.05 * i} />
                  {/* Role + the direct social chips beneath the card. */}
                  <Reveal delay={0.08 * i + 0.1} className="w-full">
                    <p className="mt-6 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                      {b.role}
                    </p>
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
                  </Reveal>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Footer — a slot for each of the 6 hackathon deliverables + Qwen Cloud attribution ── */}
        <footer className="cv-auto border-t border-ink-900/10">
          {/* The six submission deliverables. Filled slots link out; empty ones show "add link". */}
          <Reveal>
            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-px bg-ink-900/10 sm:grid-cols-2 md:grid-cols-3">
              {DELIVERABLES.map(({ Icon, label, href, note }) =>
                href ? (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group flex items-center justify-between bg-cream-50 px-6 py-6 transition-colors hover:bg-cream-100"
                  >
                    <span className="flex items-center gap-3 text-[14px] font-semibold text-ink-900">
                      <Icon size={18} className="text-brand-500" />
                      {label}
                      {note && <span className="text-[11px] font-normal text-ink-400">· {note}</span>}
                    </span>
                    <ArrowUpRight size={18} className="text-ink-400 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </a>
                ) : (
                  <div key={label} className="flex items-center justify-between bg-cream-50 px-6 py-6">
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

          {/* Brand + attribution + subscribe · context columns. */}
          <div className="border-t border-ink-900/10">
            <Reveal>
              <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-6 py-16 md:grid-cols-4">
                <div className="col-span-2">
                  <div className="flex items-center gap-2.5">
                    <img src="/pack-logo.svg" className="h-7 w-auto" alt="" loading="lazy" decoding="async" />
                    <span className="font-display text-lg font-extrabold tracking-wide text-ink-900">A Pack</span>
                  </div>
                  <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-ink-500">
                    A research team you can watch. Built with Qwen models on Qwen Cloud, with the backend
                    running on Alibaba Cloud.
                  </p>
                  <form onSubmit={subscribe} className="mt-6 flex w-full max-w-md items-center gap-2">
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="name@email.com"
                      className="flex-1 rounded-full border-[2px] border-ink-900 bg-cream-50 px-4 py-2.5 text-[14px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500"
                    />
                    <button type="submit" className="rounded-full bg-brand-500 px-5 py-2.5 text-[13px] font-semibold text-white shadow-chunk-sm transition-all hover:-translate-y-0.5 hover:shadow-chunk active:translate-y-0">
                      Subscribe
                    </button>
                  </form>
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
