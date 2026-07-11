import { useEffect, useRef, type MutableRefObject } from 'react'

/**
 * AlphaWolf — the Pack logo as a living 3D mascot.
 *
 * The front of the head is built VERBATIM from public/pack-logo.svg: every vertex and every
 * stroked facet edge in the mark is reproduced 1:1 (the silhouette ring sits on z=0 and the
 * projection is near-orthographic, so head-on the render IS the logo — same outline, same
 * linework). Interior vertices carry a sculpted relief (nose forward, brow ridge, eye shards)
 * and the silhouette is swept back into a faceted cranium, so the head is a complete volume
 * from every angle — profile, three-quarter, back.
 *
 * It stays alive: it turns toward the cursor, blinks, twitches its ears, and a `stageRef`
 * (0..1 scroll) drives a mood state machine (emblem → watchful → alert → ferocious → proud →
 * settle). The lower jaw is hinged into the mesh (chin facets stretch open onto a maw + fangs
 * that only exist while the jaw is open). `overrideRef` gives callers direct pose/jaw/glow
 * control for bespoke section choreography. Transparent canvas — it floats over the page.
 */

type Vec3 = number[]

interface MeshFace {
  v: Vec3[]
  tone: number
  mat: number // 0 fur facet · 1 eye shard · 2 fang · 3 maw
  grp: number // 0 skull · 1/2 ears · 3/4 eyes · 5 lower jaw · 6 jaw-reveal (maw/fangs)
  grps?: number[] // per-vertex group — soft hinges (e.g. chin verts swing, nose verts stay)
  piv: number[]
  hidden?: Array<[number, number]> // vertex-index pairs whose edge must NOT render (fan seams)
  noMirror?: boolean // spans the centre line — built whole, skipped by the mirror pass
}

interface WolfState {
  poseYaw: number
  posePitch: number
  poseRoll: number
  headFollow: number
  jaw: number
  growl: number
  glow: number
}
type Stage = WolfState & { at: number }

const STAGES: Stage[] = [
  { at: 0.0, poseYaw: 0.0, posePitch: 0.0, poseRoll: 0.0, headFollow: 0.14, jaw: 0.0, growl: 0.0, glow: 0.4 }, // hero: EMBLEM (dead-on, the logo)
  { at: 0.16, poseYaw: 0.0, posePitch: 0.06, poseRoll: 0.0, headFollow: 1.0, jaw: 0.05, growl: 0.12, glow: 0.7 }, // watch
  { at: 0.34, poseYaw: 0.1, posePitch: 0.02, poseRoll: 0.03, headFollow: 1.0, jaw: 0.09, growl: 0.28, glow: 0.85 }, // alert
  { at: 0.5, poseYaw: -0.06, posePitch: 0.0, poseRoll: 0.0, headFollow: 0.7, jaw: 0.05, growl: 0.16, glow: 0.65 }, // focused
  { at: 0.66, poseYaw: 0.0, posePitch: -0.14, poseRoll: 0.0, headFollow: 0.45, jaw: 0.32, growl: 1.0, glow: 1.0 }, // black box: FEROCIOUS
  { at: 0.82, poseYaw: 0.0, posePitch: 0.12, poseRoll: 0.0, headFollow: 0.6, jaw: 0.04, growl: 0.08, glow: 0.8 }, // proof: PROUD
  { at: 0.97, poseYaw: 0.0, posePitch: 0.0, poseRoll: 0.0, headFollow: 0.2, jaw: 0.0, growl: 0.0, glow: 0.55 }, // CTA: SETTLES (back to emblem)
]

function sampleStage(t: number): WolfState {
  const k = STAGES
  if (t <= k[0].at) return k[0]
  if (t >= k[k.length - 1].at) return k[k.length - 1]
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i]
    const b = k[i + 1]
    if (t >= a.at && t <= b.at) {
      const f = (t - a.at) / (b.at - a.at || 1)
      const e = f * f * (3 - 2 * f)
      const mix = (x: number, y: number) => x + (y - x) * e
      return {
        poseYaw: mix(a.poseYaw, b.poseYaw),
        posePitch: mix(a.posePitch, b.posePitch),
        poseRoll: mix(a.poseRoll, b.poseRoll),
        headFollow: mix(a.headFollow, b.headFollow),
        jaw: mix(a.jaw, b.jaw),
        growl: mix(a.growl, b.growl),
        glow: mix(a.glow, b.glow),
      }
    }
  }
  return k[k.length - 1]
}

function hexToVec3(hex: string): number[] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ]
}

function buildMesh(): Float32Array {
  /* ---- The logo graph, verbatim from public/pack-logo.svg (viewBox 34×40) ----
   * sv(x, y, relief): SVG coords → model space (centred, y-up, ≈±0.97 tall). The relief z
   * sculpts the face forward; every SILHOUETTE vertex stays at z=0 so the head-on outline
   * is exactly the logo's. */
  const sv = (x: number, y: number, z = 0): Vec3 => [(x - 16.8387) / 20, (19.6887 - y) / 20, z]

  // Silhouette ring — the exact logo outline, clockwise from the left ear tip.
  const F = sv(3.32515, 0.319336) // ear tip L
  const G = sv(13.2351, 9.17819) // brow L
  const H = sv(16.8387, 9.17819) // brow centre
  const I = sv(20.4423, 9.17819) // brow R
  const J = sv(30.3522, 0.319336) // ear tip R
  const K = sv(30.9515, 10.6797)
  const L = sv(31.4032, 18.4875)
  const M = sv(33.5053, 26.1452) // ruff tip R
  const N = sv(28.2501, 30.0491)
  const O = sv(23.145, 33.953)
  const P = sv(21.9438, 37.5566)
  const Q = sv(16.8387, 39.0581) // chin
  const R = sv(11.7336, 37.5566)
  const A = sv(10.5324, 33.953)
  const B = sv(5.42725, 30.0491)
  const C = sv(0.171997, 26.1452) // ruff tip L
  const D = sv(2.2741, 18.4875)
  const E = sv(2.72579, 10.6797)

  // Interior facet vertices (left half — the right half is generated by the mirror pass).
  const AC = sv(9.63146, 9.17819, 0.08) // brow ridge L
  const AD = sv(5.14222, 2.87189, 0.03) // inner ear L
  const AE = sv(5.33724, 10.6797, 0.05) // ear base L
  const AB = sv(5.42725, 14.2833, 0.07) // temple L
  const S = sv(11.7336, 17.7368, 0.15) // eye inner L
  const T = sv(12.6988, 21.7908, 0.13) // eye lower L
  const AA = sv(8.28011, 21.1902, 0.05) // eye outer L
  const Z = sv(10.5324, 24.0431, 0.04) // cheek L
  const U = sv(13.2351, 24.0431, 0.15) // muzzle side L
  const V = sv(16.8387, 15.3344, 0.26) // brow stop (centre)
  const NC = sv(16.8387, 33.3524, 0.32) // nose top centre
  const NL2 = sv(14.136, 33.3524, 0.34)
  const NR2 = sv(19.5414, 33.3524, 0.34)
  const NL1 = sv(14.136, 35.3043, 0.34)
  const NR1 = sv(19.5414, 35.3043, 0.34)
  const NB = sv(16.8387, 36.3554, 0.3) // nose bottom

  const EAR_PIV = [-0.47, 0.49]
  const EYE_PIV = [-0.28, -0.15]
  const JAW_PIV = [0, -0.71]

  const faces: MeshFace[] = []
  interface FaceOpts {
    tone?: number
    mat?: number
    grp?: number
    grps?: number[]
    piv?: number[]
    noMirror?: boolean
  }
  const tri = (a: Vec3, b: Vec3, c: Vec3, hidden: Array<[number, number]> = [], o: FaceOpts = {}) =>
    faces.push({
      v: [a, b, c],
      hidden,
      tone: o.tone ?? 0.5,
      mat: o.mat ?? 0,
      grp: o.grp ?? 0,
      grps: o.grps,
      piv: o.piv ?? [0, 0],
      noMirror: o.noMirror,
    })
  // Fan-triangulates one logo facet: the polygon OUTLINE renders as the logo's linework,
  // the fan diagonals are hidden (barycentric trick). Must be fan-visible from pts[0].
  const poly = (pts: Vec3[], o: FaceOpts = {}) => {
    for (let i = 1; i < pts.length - 1; i++) {
      const hidden: Array<[number, number]> = []
      if (i > 1) hidden.push([0, 1])
      if (i + 1 < pts.length - 1) hidden.push([0, 2])
      faces.push({
        v: [pts[0], pts[i], pts[i + 1]],
        hidden,
        tone: o.tone ?? 0.5,
        mat: o.mat ?? 0,
        grp: o.grp ?? 0,
        grps: o.grps ? [o.grps[0], o.grps[i], o.grps[i + 1]] : undefined,
        piv: o.piv ?? [0, 0],
        noMirror: o.noMirror,
      })
    }
  }

  /* ---- Front face: the logo's facet tiling, one polygon per facet ---- */
  poly([F, G, AC, AD], { grp: 1, piv: EAR_PIV }) // ear front
  poly([F, AD, AE, E], { grp: 1, piv: EAR_PIV }) // ear outer
  poly([AC, AB, AE, AD]) // temple
  poly([E, AE, AB, D]) // side of head
  poly([V, S, AB, AC, G, H]) // forehead
  poly([AA, D, AB, S, T]) // brow shard (above the eye)
  tri(D, C, AA) // ruff shard
  poly([C, B, Z, AA]) // ruff
  // Eye — the SMALL slanted quad under the brow shard (the logo gives it its own fill
  // path); white-lit, with a dark socket just behind so blinks read.
  const soc = (p: Vec3): Vec3 => [p[0], p[1], p[2] - 0.1]
  poly([soc(AA), soc(Z), soc(U), soc(T)], { tone: 0.2 })
  poly([AA, Z, U, T], { mat: 1, grp: 3, piv: EYE_PIV, tone: 0.7 })
  poly([B, A, U, Z]) // jawline
  // Snout — one smooth region in the logo (no interior strokes), so all seams are hidden.
  tri(V, S, NC, [[1, 2], [2, 0]])
  tri(S, T, NC, [[1, 2], [2, 0]])
  tri(T, U, NC, [[1, 2], [2, 0]])
  tri(U, NL2, NC, [[0, 1], [2, 0]])
  tri(U, A, NL2, [[1, 2], [2, 0]])
  tri(A, NL1, NL2, [[0, 1], [2, 0]])
  tri(A, R, NL1, [[1, 2], [2, 0]])
  tri(R, NB, NL1, [[2, 0]])
  // Nose — crosses the centre line, built whole.
  poly([NB, NL1, NL2, NR2, NR1], { noMirror: true, tone: 0.3 })
  // Chin — hinged: NB stays with the skull, R/Q swing down with the jaw.
  tri(NB, R, Q, [[0, 2]], { grps: [0, 5, 5], piv: JAW_PIV })
  // Maw + fangs — zero-height until the jaw opens (grp 6 scales them out).
  poly(
    [
      [-0.2, -0.71, -0.03],
      [0.2, -0.71, -0.03],
      [0.14, -0.97, -0.09],
      [-0.14, -0.97, -0.09],
    ],
    { mat: 3, grp: 6, piv: [0, -0.71], noMirror: true, tone: 0.1 },
  )
  tri([-0.115, -0.79, 0.07], [-0.05, -0.795, 0.07], [-0.0825, -0.94, 0.03], [], {
    mat: 2,
    grp: 6,
    piv: [-0.0825, -0.79],
    tone: 0.9,
  })

  /* ---- The cranium: the silhouette ring swept back to a skull apex, faceted like the
   * front, so profile / three-quarter / back views hold up as a complete head. ---- */
  const SIL = [F, G, H, I, J, K, L, M, N, O, P, Q, R, A, B, C, D, E]
  const ring = (p: Vec3, cx: number, cy: number, k: number, z: number): Vec3 => [
    p[0] + (cx - p[0]) * k,
    p[1] + (cy - p[1]) * k,
    z,
  ]
  const R1 = SIL.map((p) => ring(p, 0, 0.12, 0.2, -0.34))
  const R2 = SIL.map((p) => ring(p, 0, 0.2, 0.55, -0.62))
  const APEX: Vec3 = [0, 0.22, -0.76]
  for (let i = 0; i < SIL.length; i++) {
    const j = (i + 1) % SIL.length
    // Chin segments (P–Q, Q–R) hinge with the jaw so the mouth opens INTO the skull.
    const jawSeg = i === 10 || i === 11
    poly([SIL[i], SIL[j], R1[j], R1[i]], {
      tone: 0.3 + 0.14 * ((i * 5) % 3),
      noMirror: true,
      piv: JAW_PIV,
      grps: jawSeg ? [5, 5, 0, 0] : undefined,
    })
    poly([R1[i], R1[j], R2[j], R2[i]], { tone: 0.25 + 0.025 * ((i * 7) % 4), noMirror: true })
    tri(R2[i], R2[j], APEX, [], { tone: 0.2 + 0.08 * (i % 3), noMirror: true })
  }

  /* ---- Mirror the left half; interleave with flat normals + edge-aware barycentrics ---- */
  const all: MeshFace[] = []
  const swap: Record<number, number> = { 1: 2, 2: 1, 3: 4, 4: 3 }
  for (const f of faces) {
    all.push(f)
    if (f.noMirror) continue
    all.push({
      ...f,
      v: f.v.map((p) => [-p[0], p[1], p[2]]),
      grp: swap[f.grp] ?? f.grp,
      grps: f.grps?.map((g) => swap[g] ?? g),
      piv: [-f.piv[0], f.piv[1]],
    })
  }

  // interleave: pos(3) nor(3) tone(1) mat(1) grp(1) piv(2) bary(3) = 14 floats
  const CEN = [0, 0.05, -0.25] // approximate head centre — normals face away from it
  const data: number[] = []
  for (const f of all) {
    const [a, b, c] = f.v
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    const gx = (a[0] + b[0] + c[0]) / 3 - CEN[0]
    const gy = (a[1] + b[1] + c[1]) / 3 - CEN[1]
    const gz = (a[2] + b[2] + c[2]) / 3 - CEN[2]
    let idx = [0, 1, 2]
    if (nx * gx + ny * gy + nz * gz < 0) {
      idx = [0, 2, 1]
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const bary = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    for (const [p, q] of f.hidden ?? []) {
      const fp = idx.indexOf(p)
      const fq = idx.indexOf(q)
      const k = 3 - fp - fq
      bary[fp][k] = 1
      bary[fq][k] = 1
    }
    for (let s = 0; s < 3; s++) {
      const vi = idx[s]
      const pos = f.v[vi]
      const grp = f.grps ? f.grps[vi] : f.grp
      data.push(
        pos[0], pos[1], pos[2],
        nx, ny, nz,
        f.tone, f.mat, grp,
        f.piv[0], f.piv[1],
        bary[s][0], bary[s][1], bary[s][2],
      )
    }
  }
  return new Float32Array(data)
}

const vertexShader = `
precision highp float;
attribute vec3 aPos; attribute vec3 aNor; attribute float aTone; attribute float aMat; attribute float aGrp; attribute vec2 aPiv; attribute vec3 aBary;
uniform vec3 uRes; uniform float uScale; uniform float uYaw; uniform float uPitch; uniform float uRoll;
uniform float uPulse; uniform float uBlink; uniform float uEarL; uniform float uEarR; uniform float uJaw;
varying vec3 vNormal; varying float vTone; varying float vMat; varying vec3 vBary;
void main() {
  vec3 pos = aPos; vec3 nor = aNor;
  if (aGrp > 0.5 && aGrp < 2.5) { // ears: twitch
    float tw = (aGrp < 1.5) ? uEarR : uEarL;
    float a = tw * 0.20 * sign(aPiv.x);
    vec2 d = pos.xy - aPiv; float c = cos(a); float s = sin(a);
    pos.xy = aPiv + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  }
  if (aGrp > 2.5 && aGrp < 4.5) { // eyes: blink, and squint when the jaw bares
    float sq = max(1.0 - uBlink, 0.07) * (1.0 - 0.30 * uJaw);
    pos.y = aPiv.y + (pos.y - aPiv.y) * sq;
  }
  if (aGrp > 4.5 && aGrp < 5.5) { // lower jaw: drops — hinged verts stretch the chin facets open
    pos.y -= uJaw * 0.24; pos.z -= uJaw * 0.05;
  }
  if (aGrp > 5.5) { // maw + fangs: only exist while the jaw is open
    pos.y = aPiv.y + (pos.y - aPiv.y) * min(uJaw * 1.6, 1.0);
  }
  pos *= uPulse;
  float cy = cos(uYaw); float sy = sin(uYaw); float cx = cos(uPitch); float sx = sin(uPitch); float cz = cos(uRoll); float sz = sin(uRoll);
  mat3 Rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  mat3 Rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 Ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 Rm = Ry * Rx * Rz; pos = Rm * pos; nor = Rm * nor;
  vNormal = nor; vTone = aTone; vMat = aMat; vBary = aBary;
  float persp = 1.0 / (1.0 - pos.z * 0.1); // near-ortho: head-on stays the exact logo
  vec2 xy = pos.xy * persp * uScale * 0.78;
  gl_Position = vec4(xy.x / uRes.z, xy.y, -pos.z * 0.4, 1.0);
}
`

// Emblem look: dark faceted fill + crisp light facet-edges (the logo's linework), white
// glowing eye shards, bright fangs, near-black maw.
const fragmentShader = `#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec3 uFill; uniform vec3 uEdge; uniform vec3 uEye; uniform float uGlow;
varying vec3 vNormal; varying float vTone; varying float vMat; varying vec3 vBary;
void main() {
  // wireframe: light where a fragment is near a DRAWN triangle edge (min barycentric ~ 0)
  float m = min(min(vBary.x, vBary.y), vBary.z);
  float w = fwidth(m);
  float edge = 1.0 - smoothstep(0.0, w * 2.2, m);

  vec3 n = normalize(vNormal);
  float li = 0.78 + 0.2 * max(dot(n, normalize(vec3(-0.35, 0.5, 0.78))), 0.0); // near-flat facets
  vec3 col;
  if (vMat > 2.5) {
    // maw interior: near-black, dim edge
    col = mix(uFill * 0.35, uEdge * 0.5, edge);
  } else if (vMat > 1.5) {
    // fang: bright
    col = mix(uEdge * 0.82, uEdge, edge);
  } else if (vMat > 0.5) {
    // eye shard: white fill that breathes with the stage glow
    vec3 eyeFill = uEye * (0.55 + 0.35 * uGlow);
    col = mix(eyeFill, uEye, edge);
    col += uEye * uGlow * 0.2 * vTone;
  } else {
    // fur facet: dark fill + light edge = the logo
    col = mix(uFill * li, uEdge, edge);
  }
  col = pow(max(col, vec3(0.0)), vec3(0.95));
  gl_FragColor = vec4(col, 1.0);
}
`

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
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program))
      return undefined
    }
    gl.useProgram(program)
    gl.enable(gl.DEPTH_TEST)

    const data = buildMesh()
    const vertCount = data.length / 14
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)

    const STRIDE = 14 * 4
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

    // Park the render loop whenever the stage is hidden (HeroWolf flips to display:none
    // once the emblem has fully faded near the CTA) — zero GPU while parked.
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
