import { useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowUpRight, Twitter, Instagram, Github, Linkedin } from 'lucide-react'
import { toast } from '@/store/toast-store'

/**
 * The Door's marketing landing — the brief made scrollable. Sits directly below the hero chat on the
 * intake screen (see door-page). Layout is borrowed from a full-bleed agency landing (full-width hero,
 * three-column info rows, numbered feature blocks, a full-width statement band, thin vertical guide
 * lines) but rendered entirely in The Pack's own dark neutral palette, accent used sparingly.
 */

interface Door {
  setInput: (v: string) => void
}

const toChat = () => window.scrollTo({ top: 0, behavior: 'smooth' })

const PILLARS = [
  {
    n: '01',
    title: 'Watch it',
    body: 'The whole research runs on a live canvas. The plan forms, scouts search, findings merge, the brief gets written, all in real time. No spinner, no black box.',
  },
  {
    n: '02',
    title: 'Steer it',
    body: 'A human gate at every decision. Approve the plan, edit the team, answer the questions the pack pauses to ask, add input, or redirect at any point.',
  },
  {
    n: '03',
    title: 'Verify it',
    body: 'Every claim cites a source you can click. A critic agent challenges the weakest claim in a Standoff before it ships, and says "I couldn’t verify this" instead of padding.',
  },
  {
    n: '04',
    title: 'Cap the cost',
    body: 'Set a dollar Boundary. The engine checks projected spend before every call and halts at 100%. You can even rehearse a run’s cost before committing.',
  },
]

const BEATS = [
  { k: 'Say it', v: 'Type, speak, or drop a file. Alpha clarifies until there is a real job.' },
  { k: 'Approve it', v: 'See the plan and the team, set your budget, and hit go, or edit the formation first.' },
  { k: 'Watch it', v: 'Scouts research in parallel, findings merge, weak claims get challenged, live.' },
  { k: 'Keep it', v: 'A cited brief you can refine, download in six formats, or share by link.' },
]

const PROOF = [
  { k: 'Cited', v: 'Every claim links to a source. Unverifiable ones are flagged, not faked.' },
  { k: 'Capped', v: 'Halts before overspend. Warns at 70%, downgrades at 85%, stops at 100%.' },
  { k: '6 formats', v: 'Export to PDF, DOCX, PPTX, XLSX, HTML, MD, or a read-only share link.' },
  { k: 'Offline-ready', v: 'Runs fully with no keys, then swaps to real models with zero code change.' },
]

const ASKS = [
  'Map the BNPL market in Nigeria: players, sizing, and risks.',
  'Run due diligence on a company before we partner with them.',
  'Compare Postgres vs MongoDB for a high-write event log.',
  'Summarise the PDF I dropped and cross-check its claims against the web.',
]

const SOCIALS: Array<{ Icon: typeof Twitter; label: string }> = [
  { Icon: Twitter, label: 'Twitter' },
  { Icon: Instagram, label: 'Instagram' },
  { Icon: Github, label: 'GitHub' },
  { Icon: Linkedin, label: 'LinkedIn' },
]

const FOOTER_COLS = [
  { h: 'Product', links: ['Territory', 'Instincts', 'Knowledge base', 'Pricing'] },
  { h: 'Resources', links: ['How it works', 'Docs', 'API reference', 'Postman'] },
  { h: 'Company', links: ['About', 'Careers', 'Press kit', 'Contact'] },
  { h: 'Legal', links: ['Privacy', 'Terms of use', 'Cookie policy', 'Accessibility'] },
]

/** Fade-and-rise as a block scrolls into view (once). */
function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-text-faint">{children}</p>
}

export function DoorLanding({ door }: { door: Door }) {
  const seed = (prompt: string) => {
    door.setInput(prompt)
    toChat()
  }
  const [email, setEmail] = useState('')
  const subscribe = (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    toast({ title: "You're on the list. We'll keep you posted.", variant: 'success' })
    setEmail('')
  }
  const noop = (e: MouseEvent) => e.preventDefault()

  return (
    <div className="relative w-full">
      {/* Thin vertical guide lines — the agency-grid motif, very faint. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <div className="mx-auto h-full max-w-6xl px-6">
          <div className="relative h-full">
            <span className="absolute inset-y-0 left-1/4 w-px bg-white/[0.05]" />
            <span className="absolute inset-y-0 left-1/2 w-px bg-white/[0.05]" />
            <span className="absolute inset-y-0 left-3/4 w-px bg-white/[0.05]" />
          </div>
        </div>
      </div>

      <div className="relative z-10">
        {/* ── Section 1 — Who we are (three columns) ───────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 pt-28 pb-24 md:pt-36">
          <Reveal><Kicker>Who we are</Kicker></Reveal>
          <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-12">
            <Reveal className="md:col-span-5">
              <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight text-text md:text-5xl">
                A research team<br />you can watch.
              </h2>
            </Reveal>
            <Reveal delay={0.08} className="md:col-span-4">
              <p className="text-[15px] leading-relaxed text-text-dim">
                You bring a question, or your own documents. A team of AI agents plans it, researches it,
                and writes it up live in front of you, with every claim traced to a source you can click,
                and a hard cap on what it can spend.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-text-faint">
                Not an answer you are handed. A research process you steer.
              </p>
            </Reveal>
            <Reveal delay={0.16} className="md:col-span-3">
              <p className="text-lg font-medium leading-snug text-text">Be a part of<br />something great</p>
              <button
                onClick={toChat}
                className="group mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-raised"
              >
                Start a hunt
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </Reveal>
          </div>
        </section>

        {/* ── Section 2 — The wedge + numbered pillars ─────────────────────────── */}
        <section className="border-t border-border-subtle">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <Reveal>
              <Kicker>What we do differently</Kicker>
              <h2 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.06] tracking-tight text-text md:text-6xl">
                You don’t just get an answer.<br />You get the work.
              </h2>
              <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-text-dim">
                Most AI tools optimise for one fast answer. The Pack optimises for a defensible one:
                a process you can see, steer, verify, and afford.
              </p>
            </Reveal>

            <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border-subtle bg-border-subtle md:grid-cols-2">
              {PILLARS.map((p, i) => (
                <Reveal key={p.n} delay={i * 0.06}>
                  <div className="flex h-full flex-col gap-3 bg-canvas p-8">
                    <div className="flex items-baseline gap-4">
                      <span className="font-mono text-sm text-accent">{p.n}</span>
                      <h3 className="text-2xl font-semibold tracking-tight text-text">{p.title}</h3>
                    </div>
                    <p className="text-[14.5px] leading-relaxed text-text-dim">{p.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Section 3 — How it works (four beats) ────────────────────────────── */}
        <section className="border-t border-border-subtle">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <Reveal><Kicker>How it works</Kicker></Reveal>
            <div className="mt-12 grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
              {BEATS.map((b, i) => (
                <Reveal key={b.k} delay={i * 0.06}>
                  <div className="flex flex-col gap-3">
                    <span className="font-mono text-xs text-text-faint">{String(i + 1).padStart(2, '0')}</span>
                    <div className="h-px w-full bg-border" />
                    <h3 className="mt-1 text-xl font-semibold tracking-tight text-text">{b.k}</h3>
                    <p className="text-[14px] leading-relaxed text-text-dim">{b.v}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Section 4 — Statement band (full-width) ──────────────────────────── */}
        <section className="relative overflow-hidden border-t border-border-subtle">
          {/* one restrained accent glow, no photo */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
            style={{ background: 'radial-gradient(closest-side, var(--color-accent), transparent)' }}
          />
          <div className="relative mx-auto max-w-6xl px-6 py-36 text-center">
            <Reveal>
              <h2 className="mx-auto max-w-4xl text-4xl font-semibold leading-[1.08] tracking-tight text-text md:text-6xl">
                Stop trusting the black box.<br />Watch the research.
              </h2>
              <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-text-dim">
                Transparency, provenance, control, and cost, all true today. Sourced answers you can
                actually stand behind.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Section 5 — Proof points ─────────────────────────────────────────── */}
        <section className="border-t border-border-subtle">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <Reveal><Kicker>The proof</Kicker></Reveal>
            <div className="mt-12 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
              {PROOF.map((p, i) => (
                <Reveal key={p.k} delay={i * 0.06}>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-semibold tracking-tight text-text">{p.k}</h3>
                    <p className="text-[14px] leading-relaxed text-text-dim">{p.v}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Section 6 — Big CTA (statement + button + brand mark) ────────────── */}
        <section className="relative overflow-hidden border-t border-border-subtle">
          <div className="relative mx-auto max-w-6xl px-6 pt-28 pb-14 text-center">
            <Reveal>
              <Kicker>Get started</Kicker>
              <h2 className="mx-auto mt-6 max-w-4xl text-5xl font-semibold leading-[1.0] tracking-tight text-text md:text-7xl">
                Send the pack after<br />your next question.
              </h2>
              <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-text-dim">
                Type it, speak it, or drop a file. Set a budget. Then watch the work happen, live.
              </p>
              <button
                onClick={toChat}
                className="group mx-auto mt-9 inline-flex items-center gap-2 rounded-lg bg-text px-8 py-3.5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90"
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
                    className="rounded-full border border-border-subtle bg-surface px-4 py-2 text-left text-[13px] text-text-dim transition-colors hover:border-border hover:text-text"
                  >
                    {a}
                  </button>
                ))}
              </div>
            </Reveal>
          </div>

          {/* Abstract brand mark — glossy glow, the agency-hero motif, monochrome. */}
          <Reveal delay={0.12}>
            <div className="relative flex items-end justify-center pb-2">
              <div
                aria-hidden
                className="pointer-events-none absolute bottom-0 left-1/2 h-[340px] w-[340px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
                style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.55), transparent)' }}
              />
              <img
                src="/pack-logo.svg"
                alt=""
                aria-hidden
                className="relative h-44 w-auto opacity-95"
                style={{ filter: 'drop-shadow(0 24px 70px rgba(255,255,255,0.16))' }}
              />
            </div>
          </Reveal>
        </section>

        {/* ── Section 7 — Footer (social row · link columns · brand + subscribe) ── */}
        <footer className="border-t border-border-subtle">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-border-subtle md:grid-cols-4">
            {SOCIALS.map(({ Icon, label }) => (
              <a
                key={label}
                href="#"
                onClick={noop}
                className="group flex items-center justify-between bg-canvas px-6 py-6 transition-colors hover:bg-surface"
              >
                <span className="flex items-center gap-3 text-[14px] font-medium text-text">
                  <Icon size={18} className="text-text-dim" />
                  {label}
                </span>
                <ArrowUpRight size={18} className="text-text-faint transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-text" />
              </a>
            ))}
          </div>

          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-6 py-16 md:grid-cols-4">
            {FOOTER_COLS.map((c) => (
              <div key={c.h}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-faint">{c.h}</p>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {c.links.map((l) => (
                    <li key={l}>
                      <a href="#" onClick={noop} className="text-[14px] text-text-dim transition-colors hover:text-text">{l}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-border-subtle">
            <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 md:flex-row md:items-center md:justify-between">
              <div className="max-w-sm">
                <div className="flex items-center gap-2.5">
                  <img src="/pack-logo.svg" className="h-7 w-auto" alt="" />
                  <span className="text-lg font-semibold tracking-wide text-text">The Pack</span>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-text-faint">
                  A research team you can watch. Sourced answers you can stand behind, with a hard cap on spend.
                </p>
              </div>
              <form onSubmit={subscribe} className="flex w-full max-w-md items-center gap-2">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="name@email.com"
                  className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-[14px] text-text outline-none transition-colors placeholder:text-text-faint focus:border-text-faint"
                />
                <button type="submit" className="rounded-lg bg-text px-5 py-2.5 text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90">
                  Subscribe
                </button>
              </form>
            </div>
          </div>

          <div className="border-t border-border-subtle">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-[12px] text-text-faint">
              <span>© 2026 The Pack</span>
              <span>A research team you can watch.</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
