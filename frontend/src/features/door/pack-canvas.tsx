import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { buildMesh, hexToVec3, FLOATS_PER_VERT, VERTEX_SHADER, FRAGMENT_SHADER } from './wolf-mesh'
import { PACK_SLOTS, BASE_SCALE, HERO_SCALE, lerp } from './pack-formation'

/** What the scroll journey feeds the canvas each frame. */
export interface PackDrive {
  /** 0 = one lone wolf, 1 = full triangle. */
  spread: number
  /** Overall visibility (faint on the hero, full during the pack, fading as it rests). */
  presence: number
  /** Lone-wolf clip-space offset — slides left for the value phase, down for the resting logo. */
  alphaX: number
  alphaY: number
  /** Lone-wolf size multiplier — 1 = hero size, small as it settles into the resting logo. */
  alphaScaleMul: number
  /** 0 = glow on black (hero), 1 = forest-ink wireframe on cream (the warmed-up pack). */
  warm: number
}

/**
 * PackCanvas — the whole pack, alive, in one WebGL context.
 *
 * Every member is the same wolf head (shared mesh/shaders from wolf-mesh), drawn as a separate
 * instance: one GL context, one render loop, N draw calls with per-instance uniforms — avoids the
 * N-contexts/N-loops perf trap. Scroll (progressRef, 0..1) fans them from one head into the
 * triangle, back to one, then slides that one aside. Loop parks itself when scrolled out of view.
 */
export function PackCanvas({
  driveRef,
  observeRef,
}: {
  driveRef: MutableRefObject<PackDrive>
  /** Element whose visibility parks the render loop. The canvas itself is fixed (always on
   *  screen), so we watch the scroll region (the flow spacer) instead of the canvas. */
  observeRef?: RefObject<Element | null>
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true })
    if (!gl) return undefined
    gl.getExtension('OES_standard_derivatives')

    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh))
      return sh
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program))
      return undefined
    }
    gl.useProgram(program)
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied — shader outputs col*uAlpha
    gl.clearColor(0, 0, 0, 0)

    const data = buildMesh()
    const vertCount = data.length / FLOATS_PER_VERT
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    const STRIDE = FLOATS_PER_VERT * 4
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(program, name)
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset * 4)
      }
    }
    attr('aPos', 3, 0); attr('aNor', 3, 3); attr('aTone', 1, 6); attr('aMat', 1, 7); attr('aGrp', 1, 8); attr('aPiv', 2, 9); attr('aBary', 3, 11)

    const u = (name: string) => gl.getUniformLocation(program, name)
    const U = {
      res: u('uRes'), scale: u('uScale'), offset: u('uOffset'),
      yaw: u('uYaw'), pitch: u('uPitch'), roll: u('uRoll'),
      pulse: u('uPulse'), blink: u('uBlink'), earL: u('uEarL'), earR: u('uEarR'),
      jaw: u('uJaw'), glow: u('uGlow'), alpha: u('uAlpha'),
    }
    // Palette is scroll-driven: glow-on-black hero → forest-ink-on-cream, lerped per-frame by drive.warm.
    const uFill = u('uFill')
    const uEdge = u('uEdge')
    const uEye = u('uEye')
    const DARK = { fill: hexToVec3('#1A1A1A'), edge: hexToVec3('#FAFAFA'), eye: hexToVec3('#FFFFFF') }
    const WARM = { fill: hexToVec3('#F5F5F5'), edge: hexToVec3('#1A1A1A'), eye: hexToVec3('#4A4A4A') }
    const mix3 = (a: number[], b: number[], t: number): [number, number, number] => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]

    const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
    const pulse = (x: number) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x))
    const rand = (a: number, b: number) => a + Math.random() * (b - a)

    // Clicking a wolf plays a short choreography over the shader's pose uniforms; `dur` is length in
    // seconds. Picked at random per click, avoiding an immediate repeat.
    const TRICKS = ['wag', 'nod', 'howl', 'wink', 'perk', 'spark'] as const
    type Trick = (typeof TRICKS)[number]
    const TRICK_DUR: Record<Trick, number> = {
      wag: 0.6, nod: 0.55, howl: 1.1, wink: 0.4, perk: 0.55, spark: 0.9,
    }
    const pickTrick = (avoid?: Trick): Trick => {
      const pool = TRICKS.filter((t) => t !== avoid)
      return pool[Math.floor(Math.random() * pool.length)]
    }

    // Draw back-to-front (Alpha, highest z, drawn last so it paints over the pack when collided).
    const order = [...PACK_SLOTS].sort((a, b) => a.z - b.z)
    // Per-instance idle timing so the pack doesn't blink/twitch in unison.
    const anim = order.map((slot, i) => ({
      slot,
      isAlpha: slot.role === 'alpha',
      phase: i * 1.7,
      nextBlink: rand(1, 4),
      blinkStart: -10,
      nextEarL: rand(2, 6),
      earLStart: -10,
      nextEarR: rand(3, 8),
      earRStart: -10,
      // Live clip-space position + radius, refreshed each frame for the click hit-test.
      hitX: 0, hitY: 0, hitR: 0, drawn: false,
      trick: 'wag' as Trick, trickStart: -10, lastTrick: undefined as Trick | undefined,
    }))

    const mouse = { cx: 0, cy: 0, sx: 0, sy: 0 }
    const onMove = (e: PointerEvent) => {
      mouse.cx = (e.clientX / window.innerWidth) * 2 - 1
      mouse.cy = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })

    // Hit-test in clip space against each wolf's live position (aspect-corrected on x since clip
    // space is square but the canvas isn't), nearest-first; empty-canvas clicks do nothing.
    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        return
      }
      const cx = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const cy = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
      const aspect = rect.width / Math.max(rect.height, 1)
      let hit: (typeof anim)[number] | null = null
      let bestD = Infinity
      for (const a of anim) {
        if (!a.drawn || a.hitR <= 0) continue
        const dx = (cx - a.hitX) * aspect // widen x so the circle isn't squashed on a wide canvas
        const dy = cy - a.hitY
        const d = dx * dx + dy * dy
        if (d < a.hitR * a.hitR && d < bestD) {
          bestD = d
          hit = a
        }
      }
      if (hit) {
        const now = performance.now() / 1000
        hit.trick = pickTrick(hit.lastTrick)
        hit.lastTrick = hit.trick
        hit.trickStart = now
      }
    }
    // pointerdown (not click) so it fires before any scroll gesture; passive so it never blocks scroll.
    window.addEventListener('pointerdown', onPointerDown, { passive: true })

    const resize = () => {
      const w = Math.max(container.offsetWidth, 1)
      const h = Math.max(container.offsetHeight, 1)
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform3f(U.res, canvas.width, canvas.height, canvas.width / canvas.height)
    }
    window.addEventListener('resize', resize)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (ro) ro.observe(container)
    resize()
    container.appendChild(canvas)

    let raf = 0
    let last = performance.now()
    let visible = true
    let looping = false
    const start = () => {
      if (looping) return
      looping = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    // Wide margin so it only parks well past the section (deep in the footer / after hunt starts).
    const observed = observeRef?.current ?? container
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (es) => {
              visible = es[0]?.isIntersecting ?? true
              if (visible) start()
            },
            { rootMargin: '140% 0px 140% 0px' },
          )
        : null
    io?.observe(observed)

    const frame = (now: number) => {
      if (!visible) {
        // Clear before parking so no stale wolf frame lingers on the canvas (e.g. behind the footer).
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        looping = false
        return
      }
      raf = requestAnimationFrame(frame)
      const s = now * 0.001
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      const drive = driveRef.current
      const spread = clamp01(drive.spread)
      const presence = clamp01(drive.presence)
      const { alphaX, alphaY, alphaScaleMul } = drive
      if (presence < 0.015) {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        return
      }

      const k = 1 - Math.exp(-dt * 6)
      mouse.sx += (mouse.cx - mouse.sx) * k
      mouse.sy += (mouse.cy - mouse.sy) * k

      const warm = clamp01(drive.warm)
      const fc = mix3(DARK.fill, WARM.fill, warm)
      const ec = mix3(DARK.edge, WARM.edge, warm)
      const yc = mix3(DARK.eye, WARM.eye, warm)
      gl.uniform3f(uFill, fc[0], fc[1], fc[2])
      gl.uniform3f(uEdge, ec[0], ec[1], ec[2])
      gl.uniform3f(uEye, yc[0], yc[1], yc[2])

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      for (const a of anim) {
        a.drawn = false // stale until proven drawn this frame (so a culled wolf isn't clickable)
        // Alpha is the lone wolf (full presence); the rest emerge from centre as the pack fans out.
        const alpha = a.isAlpha ? presence : presence * spread
        if (alpha < 0.02) continue
        const slot = a.slot
        const ox = (a.isAlpha ? alphaX : 0) + slot.sx * spread
        const oy = (a.isAlpha ? alphaY : 0) + slot.sy * spread
        // Alpha starts hero-sized and shrinks to apex size; the rest grow in from nothing.
        const sc = a.isAlpha
          ? lerp(HERO_SCALE * alphaScaleMul, slot.scale * BASE_SCALE, spread)
          : slot.scale * BASE_SCALE * spread

        if (s > a.nextBlink) { a.blinkStart = s; a.nextBlink = s + rand(2.2, 6.5) }
        const blink = pulse((s - a.blinkStart) / 0.24)
        if (s > a.nextEarL) { a.earLStart = s; a.nextEarL = s + rand(2.5, 7) }
        if (s > a.nextEarR) { a.earRStart = s; a.nextEarR = s + rand(3, 8) }
        const earL = pulse((s - a.earLStart) / 0.32)
        const earR = pulse((s - a.earRStart) / 0.32)

        // Each wolf turns toward the cursor + a slow idle sway. Alpha follows even as the lone
        // hero wolf (spread 0); the rest only once fanned out.
        const follow = a.isAlpha ? 1 : spread
        let yaw = (mouse.sx - ox) * 0.34 * follow + Math.sin(s * 0.5 + a.phase) * 0.06
        let pitch = -mouse.sy * 0.16 * follow + Math.sin(s * 0.4 + a.phase) * 0.04
        const roll = 0
        let breath = 1 + 0.008 * Math.sin(s * 2.1 + a.phase)
        let jaw = 0
        let glow = (0.5 + 0.14 * Math.sin(s * 2.3 + a.phase)) * (1 - 0.85 * blink)
        let tblink = blink
        let tEarL = earL
        let tEarR = earR
        let hop = 0

        // `t` is 0→1 across the trick's duration; `e` is a soft ease envelope.
        const dur = TRICK_DUR[a.trick]
        const t = (s - a.trickStart) / dur
        if (t >= 0 && t < 1) {
          const e = Math.sin(Math.PI * t) // rise-and-fall envelope (0 at ends, 1 mid)
          switch (a.trick) {
            case 'wag': // playful tail-wag read as a quick head waggle
              yaw += Math.sin(t * Math.PI * 6) * 0.5 * e
              break
            case 'nod': // eager yes-nod
              pitch += Math.sin(t * Math.PI * 4) * 0.4 * e
              break
            case 'howl': // head tips back, jaw opens, eyes blaze
              pitch -= 0.35 * e
              jaw = Math.sin(Math.min(t * 1.6, 1) * Math.PI) * 0.34
              glow = Math.min(glow + e * 0.9, 1.3)
              breath += e * 0.05
              break
            case 'wink': { // one cheeky blink
              const w = Math.sin(Math.min(t * 2, 1) * Math.PI)
              tblink = Math.max(tblink, w)
              break
            }
            case 'perk': // both ears shoot up + a little bounce
              tEarL = Math.max(tEarL, e)
              tEarR = Math.max(tEarR, e)
              hop += Math.sin(t * Math.PI) * 0.03
              break
            case 'spark': // eyes flash bright — an excited shimmer + tiny shimmy
              glow = Math.min(glow + e * 1.1, 1.4)
              yaw += Math.sin(t * Math.PI * 8) * 0.12 * e
              break
          }
        }

        // Stamp live position + click radius for the hit-test.
        a.hitX = ox
        a.hitY = oy + hop
        a.hitR = sc * 1.15
        a.drawn = true

        gl.uniform2f(U.offset, ox, oy + hop)
        gl.uniform1f(U.scale, sc)
        gl.uniform1f(U.yaw, yaw)
        gl.uniform1f(U.pitch, pitch)
        gl.uniform1f(U.roll, roll)
        gl.uniform1f(U.pulse, breath)
        gl.uniform1f(U.blink, tblink)
        gl.uniform1f(U.earL, tEarL)
        gl.uniform1f(U.earR, tEarR)
        gl.uniform1f(U.jaw, jaw)
        gl.uniform1f(U.glow, glow)
        gl.uniform1f(U.alpha, alpha)

        gl.clear(gl.DEPTH_BUFFER_BIT) // each wolf self-occludes; not against the others
        gl.drawArrays(gl.TRIANGLES, 0, vertCount)
      }
    }
    start()

    return () => {
      looping = false
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', resize)
      if (ro) ro.disconnect()
      io?.disconnect()
      if (canvas.parentNode === container) container.removeChild(canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [driveRef, observeRef])

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />
}
