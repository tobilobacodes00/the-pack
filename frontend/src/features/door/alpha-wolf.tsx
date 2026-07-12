import { useEffect, useRef, type MutableRefObject } from 'react'
import {
  buildMesh,
  hexToVec3,
  sampleStage,
  STAGES,
  FLOATS_PER_VERT,
  VERTEX_SHADER,
  FRAGMENT_SHADER,
  type WolfState,
} from './wolf-mesh'

/**
 * AlphaWolf — the single hero mascot: the Pack logo as one living 3D head (geometry + shaders
 * shared from wolf-mesh). It turns toward the cursor, blinks, twitches its ears; `stageRef`
 * (0..1) eases a mood machine and `overrideRef` gives callers direct pose/jaw/glow control.
 * The pack scene (many wolves in one canvas) is pack-canvas; both draw the same mesh.
 */

/** Direct pose control for bespoke choreography (yaw/pitch/roll are ADDED to the stage pose;
 *  jaw/glow REPLACE it while set). Drive it from anywhere via a mutable ref — no re-renders. */
export interface WolfOverride {
  yaw?: number
  pitch?: number
  roll?: number
  jaw?: number
  glow?: number
}

export interface AlphaWolfProps {
  /** Facet fill (the logo's dark body). */
  furColor?: string
  /** Facet-edge / fang colour (the logo's light strokes). */
  edgeColor?: string
  /** Eye-shard colour. */
  eyeColor?: string
  scale?: number
  headFollow?: number
  fidget?: number
  /** 0..1 scroll position — drives the stage machine (which mood the emblem eases to). */
  stageRef?: MutableRefObject<number>
  /** Optional live pose override — see WolfOverride. */
  overrideRef?: MutableRefObject<WolfOverride | null>
}

export function AlphaWolf({
  furColor = '#1A1A1A',
  edgeColor = '#FAFAFA',
  eyeColor = '#FFFFFF',
  scale = 1.0,
  headFollow = 1.0,
  fidget = 1.0,
  stageRef,
  overrideRef,
}: AlphaWolfProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false })
    if (!gl) return undefined
    gl.getExtension('OES_standard_derivatives') // fwidth() for crisp facet edges

    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s))
      return s
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
      res: u('uRes'), yaw: u('uYaw'), pitch: u('uPitch'), roll: u('uRoll'),
      pulse: u('uPulse'), blink: u('uBlink'), earL: u('uEarL'), earR: u('uEarR'),
      jaw: u('uJaw'), glow: u('uGlow'),
    }

    const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
    gl.uniform1f(u('uScale'), scale)
    gl.uniform2f(u('uOffset'), 0, 0) // single mascot — centred
    gl.uniform1f(u('uAlpha'), 1) // fully opaque (pack-canvas fades per-instance instead)
    gl.uniform3fv(u('uFill'), hexToVec3(furColor))
    gl.uniform3fv(u('uEdge'), hexToVec3(edgeColor))
    gl.uniform3fv(u('uEye'), hexToVec3(eyeColor))
    gl.clearColor(0, 0, 0, 0) // transparent — the emblem floats over the page

    const fg = Math.max(fidget, 0.001)
    const rand = (a: number, b: number) => a + Math.random() * (b - a)
    const pulse = (x: number) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x))
    const sm = (x: number) => x * x * (3 - 2 * x)
    const ease = (a: number, b: number, x: number) => clamp01((x - a) / (b - a))

    const mouse = { x: 0, y: 0, sx: 0, sy: 0, lastMove: -1e9 }
    const B = {
      nextBlink: rand(1, 3), blinkStart: -10, dbl: false,
      growlStart: -100, growlDur: 0, nextGrowl: rand(3, 7),
      earLStart: -10, nextEarL: rand(2, 6) / fg,
      earRStart: -10, nextEarR: rand(3, 8) / fg,
    }
    const cur: WolfState = { ...STAGES[0] }

    const onMouseMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      mouse.x = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1))
      mouse.y = Math.max(-1, Math.min(1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)))
      mouse.lastMove = performance.now() * 0.001
    }
    window.addEventListener('pointermove', onMouseMove, { passive: true })

    const resize = () => {
      const w = Math.max(container.offsetWidth, 1)
      const h = Math.max(container.offsetHeight, 1)
      // 1.5x DPR keeps the facet edges crisp (antialiased lines) at ~half the fill cost of 2x.
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

    let animationFrameId = 0
    let last = performance.now()

    // Park the render loop whenever the container leaves the viewport — zero GPU while parked.
    let visible = true
    let looping = false
    const startLoop = () => {
      if (looping) return
      looping = true
      last = performance.now()
      animationFrameId = requestAnimationFrame(update)
    }
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            visible = entries[0]?.isIntersecting ?? true
            if (visible) startLoop()
          })
        : null
    io?.observe(container)

    const update = (now: number) => {
      if (!visible) {
        looping = false
        return
      }
      animationFrameId = requestAnimationFrame(update)
      const s = now * 0.001
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      const tgt = sampleStage(clamp01(stageRef?.current ?? 0))
      const ek = 1 - Math.exp(-dt * 3.5)
      cur.poseYaw += (tgt.poseYaw - cur.poseYaw) * ek
      cur.posePitch += (tgt.posePitch - cur.posePitch) * ek
      cur.poseRoll += (tgt.poseRoll - cur.poseRoll) * ek
      cur.headFollow += (tgt.headFollow - cur.headFollow) * ek
      cur.jaw += (tgt.jaw - cur.jaw) * ek
      cur.growl += (tgt.growl - cur.growl) * ek
      cur.glow += (tgt.glow - cur.glow) * ek

      if (s > B.nextBlink) { B.blinkStart = s; B.dbl = Math.random() < 0.2; B.nextBlink = s + rand(2.0, 6.5) }
      let blink = pulse((s - B.blinkStart) / 0.24)
      if (B.dbl) blink = Math.min(1, blink + pulse((s - B.blinkStart - 0.3) / 0.24))

      const gAmp = cur.growl
      if (s > B.nextGrowl && s > B.growlStart + B.growlDur + 1.2) {
        B.growlStart = s
        B.growlDur = rand(1.2, 2.2)
        B.nextGrowl = s + rand(3, 9) / (fg * (0.25 + gAmp * 2.5))
      }
      const gu = s - B.growlStart
      let growlP = 0
      if (gu >= 0 && gu <= B.growlDur) growlP = sm(ease(0, 0.35, gu)) * sm(1 - ease(B.growlDur - 0.45, B.growlDur, gu))
      const growl = growlP * (0.35 + gAmp)
      const tremY = Math.sin(s * 47.0) * 0.012 * growl
      const tremR = Math.sin(s * 55.0) * 0.02 * growl
      const lunge = 1 + 0.05 * growl

      if (s > B.nextEarL) { B.earLStart = s; B.nextEarL = s + rand(2.5, 7.0) / fg }
      if (s > B.nextEarR) { B.earRStart = s; B.nextEarR = s + rand(3.0, 8.5) / fg }
      const earL = pulse((s - B.earLStart) / 0.32)
      const earR = pulse((s - B.earRStart) / 0.32)

      const idle = s - mouse.lastMove > 3.0
      const tx = idle ? Math.sin(s * 0.4) * 0.5 + Math.sin(s * 0.17 + 2.0) * 0.2 : mouse.x
      const ty = idle ? Math.sin(s * 0.26 + 1.3) * 0.28 : mouse.y
      const k = 1 - Math.exp(-dt * 6.0)
      mouse.sx += (tx - mouse.sx) * k
      mouse.sy += (ty - mouse.sy) * k

      const ov = overrideRef?.current
      const hf = cur.headFollow * headFollow
      const yaw = cur.poseYaw + mouse.sx * 0.42 * hf + tremY + (ov?.yaw ?? 0)
      const pitch = cur.posePitch - mouse.sy * 0.3 * hf + 0.1 * growl + (ov?.pitch ?? 0)
      const roll = cur.poseRoll + mouse.sx * 0.05 * hf + tremR + (ov?.roll ?? 0)
      const breath = 1 + 0.007 * Math.sin(s * 2.1)
      const jaw = clamp01((ov?.jaw ?? cur.jaw) + 0.9 * growlP)
      const glowBase = ov?.glow ?? cur.glow
      const glow = clamp01((glowBase + 0.12 * Math.sin(s * 2.4)) * (1 - 0.85 * blink)) * (1 + 0.7 * growl)

      gl.uniform1f(U.yaw, yaw); gl.uniform1f(U.pitch, pitch); gl.uniform1f(U.roll, roll)
      gl.uniform1f(U.pulse, breath * lunge)
      gl.uniform1f(U.blink, blink); gl.uniform1f(U.earL, earL); gl.uniform1f(U.earR, earR)
      gl.uniform1f(U.jaw, jaw); gl.uniform1f(U.glow, glow)

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, vertCount)
    }
    startLoop()

    return () => {
      looping = false
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMouseMove)
      if (ro) ro.disconnect()
      io?.disconnect()
      if (canvas.parentNode === container) container.removeChild(canvas)
      const lose = gl.getExtension('WEBGL_lose_context')
      if (lose) lose.loseContext()
    }
  }, [furColor, edgeColor, eyeColor, scale, headFollow, fidget, stageRef, overrideRef])

  return <div ref={containerRef} className="h-full w-full" />
}
