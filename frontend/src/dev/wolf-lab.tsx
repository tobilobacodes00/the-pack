import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlphaWolf, type WolfOverride } from '@/features/door/alpha-wolf'
import '@/index.css'

/**
 * Wolf Lab — dev-only harness for the mascot (http://localhost:5173/wolf-lab.html).
 * Pose the head from any angle (yaw all the way around), open the jaw, drive the glow —
 * for tuning section choreography without scrolling the landing. Also exposes
 * `window.__wolf({yaw, pitch, jaw, ...})` so headless screenshots can pose it.
 * Not part of the app build (vite only builds index.html).
 */

function Lab() {
  const ov = useRef<WolfOverride | null>(null)
  const stage = useRef(0)
  const [pose, setPose] = useState<WolfOverride>({ yaw: 0, pitch: 0, roll: 0, jaw: 0, glow: 0.5 })
  const [spin, setSpin] = useState(false)

  useEffect(() => {
    ov.current = pose
  }, [pose])

  // Puppeteer hook: window.__wolf({yaw: Math.PI}) poses the head for a screenshot.
  useEffect(() => {
    ;(window as unknown as { __wolf?: (o: WolfOverride | null) => void }).__wolf = (o) => {
      ov.current = o
      if (o) setPose((p) => ({ ...p, ...o }))
    }
  }, [])

  useEffect(() => {
    if (!spin) return undefined
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = (now - last) / 1000
      last = now
      setPose((p) => ({ ...p, yaw: ((p.yaw ?? 0) + dt * 0.8 + Math.PI) % (Math.PI * 2) - Math.PI }))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [spin])

  const slider = (key: keyof WolfOverride, min: number, max: number, label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#A3A3A3' }}>
      <span style={{ width: 40 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={pose[key] ?? 0}
        onChange={(e) => setPose((p) => ({ ...p, [key]: Number(e.target.value) }))}
        style={{ width: 160 }}
      />
      <span style={{ width: 44, textAlign: 'right', color: '#FAFAFA' }}>{(pose[key] ?? 0).toFixed(2)}</span>
    </label>
  )

  return (
    <div style={{ height: '100vh', width: '100vw', background: '#0F0F0F', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <AlphaWolf headFollow={0} fidget={0.6} stageRef={stage} overrideRef={ov} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '14px 16px',
          background: '#1A1A1A',
          border: '1px solid #404040',
          borderRadius: 12,
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: '#FAFAFA', marginBottom: 2 }}>Wolf Lab</div>
        {slider('yaw', -Math.PI, Math.PI, 'yaw')}
        {slider('pitch', -0.9, 0.9, 'pitch')}
        {slider('roll', -0.6, 0.6, 'roll')}
        {slider('jaw', 0, 1, 'jaw')}
        {slider('glow', 0, 1, 'glow')}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#A3A3A3' }}>
          <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} />
          <span>spin (full turn — check the back of the head)</span>
        </label>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
