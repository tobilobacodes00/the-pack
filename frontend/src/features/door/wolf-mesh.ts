// Shared geometry + shaders for the faceted wolf, used by both the hero mascot (alpha-wolf) and
// the pack scene (pack-canvas) — one source so every wolf on the site is the same logo-exact head.
//
// Front of the head is built verbatim from public/pack-logo.svg (every vertex + facet edge, 1:1;
// silhouette on z=0 so head-on it IS the logo). Silhouette swept back into a faceted cranium.

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

export interface WolfState {
  poseYaw: number
  posePitch: number
  poseRoll: number
  headFollow: number
  jaw: number
  growl: number
  glow: number
}
type Stage = WolfState & { at: number }

export const STAGES: Stage[] = [
  { at: 0.0, poseYaw: 0.0, posePitch: 0.0, poseRoll: 0.0, headFollow: 0.14, jaw: 0.0, growl: 0.0, glow: 0.4 },
  { at: 0.16, poseYaw: 0.0, posePitch: 0.06, poseRoll: 0.0, headFollow: 1.0, jaw: 0.05, growl: 0.12, glow: 0.7 },
  { at: 0.34, poseYaw: 0.1, posePitch: 0.02, poseRoll: 0.03, headFollow: 1.0, jaw: 0.09, growl: 0.28, glow: 0.85 },
  { at: 0.5, poseYaw: -0.06, posePitch: 0.0, poseRoll: 0.0, headFollow: 0.7, jaw: 0.05, growl: 0.16, glow: 0.65 },
  { at: 0.66, poseYaw: 0.0, posePitch: -0.14, poseRoll: 0.0, headFollow: 0.45, jaw: 0.32, growl: 1.0, glow: 1.0 },
  { at: 0.82, poseYaw: 0.0, posePitch: 0.12, poseRoll: 0.0, headFollow: 0.6, jaw: 0.04, growl: 0.08, glow: 0.8 },
  { at: 0.97, poseYaw: 0.0, posePitch: 0.0, poseRoll: 0.0, headFollow: 0.2, jaw: 0.0, growl: 0.0, glow: 0.55 },
]

export function sampleStage(t: number): WolfState {
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

export function hexToVec3(hex: string): number[] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ]
}

/** Interleaved VBO: pos(3) nor(3) tone(1) mat(1) grp(1) piv(2) bary(3) = 14 floats/vertex. */
export const FLOATS_PER_VERT = 14

export function buildMesh(): Float32Array {
  /* ---- The logo graph, verbatim from public/pack-logo.svg (viewBox 34×40) ----
   * sv(x, y, relief): SVG coords → model space (centred, y-up, ≈±0.97 tall). */
  const sv = (x: number, y: number, z = 0): Vec3 => [(x - 16.8387) / 20, (19.6887 - y) / 20, z]

  const F = sv(3.32515, 0.319336)
  const G = sv(13.2351, 9.17819)
  const H = sv(16.8387, 9.17819)
  const I = sv(20.4423, 9.17819)
  const J = sv(30.3522, 0.319336)
  const K = sv(30.9515, 10.6797)
  const L = sv(31.4032, 18.4875)
  const M = sv(33.5053, 26.1452)
  const N = sv(28.2501, 30.0491)
  const O = sv(23.145, 33.953)
  const P = sv(21.9438, 37.5566)
  const Q = sv(16.8387, 39.0581)
  const R = sv(11.7336, 37.5566)
  const A = sv(10.5324, 33.953)
  const B = sv(5.42725, 30.0491)
  const C = sv(0.171997, 26.1452)
  const D = sv(2.2741, 18.4875)
  const E = sv(2.72579, 10.6797)

  const AC = sv(9.63146, 9.17819, 0.08)
  const AD = sv(5.14222, 2.87189, 0.03)
  const AE = sv(5.33724, 10.6797, 0.05)
  const AB = sv(5.42725, 14.2833, 0.07)
  const S = sv(11.7336, 17.7368, 0.15)
  const T = sv(12.6988, 21.7908, 0.13)
  const AA = sv(8.28011, 21.1902, 0.05)
  const Z = sv(10.5324, 24.0431, 0.04)
  const U = sv(13.2351, 24.0431, 0.15)
  const V = sv(16.8387, 15.3344, 0.26)
  const NC = sv(16.8387, 33.3524, 0.32)
  const NL2 = sv(14.136, 33.3524, 0.34)
  const NR2 = sv(19.5414, 33.3524, 0.34)
  const NL1 = sv(14.136, 35.3043, 0.34)
  const NR1 = sv(19.5414, 35.3043, 0.34)
  const NB = sv(16.8387, 36.3554, 0.3)

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
  poly([F, G, AC, AD], { grp: 1, piv: EAR_PIV })
  poly([F, AD, AE, E], { grp: 1, piv: EAR_PIV })
  poly([AC, AB, AE, AD])
  poly([E, AE, AB, D])
  poly([V, S, AB, AC, G, H])
  poly([AA, D, AB, S, T])
  tri(D, C, AA)
  poly([C, B, Z, AA])
  const soc = (p: Vec3): Vec3 => [p[0], p[1], p[2] - 0.1]
  poly([soc(AA), soc(Z), soc(U), soc(T)], { tone: 0.2 })
  poly([AA, Z, U, T], { mat: 1, grp: 3, piv: EYE_PIV, tone: 0.7 })
  poly([B, A, U, Z])
  tri(V, S, NC, [[1, 2], [2, 0]])
  tri(S, T, NC, [[1, 2], [2, 0]])
  tri(T, U, NC, [[1, 2], [2, 0]])
  tri(U, NL2, NC, [[0, 1], [2, 0]])
  tri(U, A, NL2, [[1, 2], [2, 0]])
  tri(A, NL1, NL2, [[0, 1], [2, 0]])
  tri(A, R, NL1, [[1, 2], [2, 0]])
  tri(R, NB, NL1, [[2, 0]])
  poly([NB, NL1, NL2, NR2, NR1], { noMirror: true, tone: 0.3 })
  tri(NB, R, Q, [[0, 2]], { grps: [0, 5, 5], piv: JAW_PIV })
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

  /* ---- Cranium: silhouette ring swept back to a skull apex ---- */
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

  const CEN = [0, 0.05, -0.25]
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
    for (const [pp, qq] of f.hidden ?? []) {
      const fp = idx.indexOf(pp)
      const fq = idx.indexOf(qq)
      const kk = 3 - fp - fq
      bary[fp][kk] = 1
      bary[fq][kk] = 1
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

// uOffset (clip-space x,y) lets one canvas place the same mesh at many screen positions —
// zero for the single hero mascot, per-instance for the pack scene.
export const VERTEX_SHADER = `
precision highp float;
attribute vec3 aPos; attribute vec3 aNor; attribute float aTone; attribute float aMat; attribute float aGrp; attribute vec2 aPiv; attribute vec3 aBary;
uniform vec3 uRes; uniform float uScale; uniform vec2 uOffset; uniform float uYaw; uniform float uPitch; uniform float uRoll;
uniform float uPulse; uniform float uBlink; uniform float uEarL; uniform float uEarR; uniform float uJaw;
varying vec3 vNormal; varying float vTone; varying float vMat; varying vec3 vBary;
void main() {
  vec3 pos = aPos; vec3 nor = aNor;
  if (aGrp > 0.5 && aGrp < 2.5) {
    float tw = (aGrp < 1.5) ? uEarR : uEarL;
    float a = tw * 0.20 * sign(aPiv.x);
    vec2 d = pos.xy - aPiv; float c = cos(a); float s = sin(a);
    pos.xy = aPiv + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  }
  if (aGrp > 2.5 && aGrp < 4.5) {
    float sq = max(1.0 - uBlink, 0.07) * (1.0 - 0.30 * uJaw);
    pos.y = aPiv.y + (pos.y - aPiv.y) * sq;
  }
  if (aGrp > 4.5 && aGrp < 5.5) {
    pos.y -= uJaw * 0.24; pos.z -= uJaw * 0.05;
  }
  if (aGrp > 5.5) {
    pos.y = aPiv.y + (pos.y - aPiv.y) * min(uJaw * 1.6, 1.0);
  }
  pos *= uPulse;
  float cy = cos(uYaw); float sy = sin(uYaw); float cx = cos(uPitch); float sx = sin(uPitch); float cz = cos(uRoll); float sz = sin(uRoll);
  mat3 Rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  mat3 Rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 Ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 Rm = Ry * Rx * Rz; pos = Rm * pos; nor = Rm * nor;
  vNormal = nor; vTone = aTone; vMat = aMat; vBary = aBary;
  float persp = 1.0 / (1.0 - pos.z * 0.1);
  vec2 xy = pos.xy * persp * uScale * 0.78;
  gl_Position = vec4(xy.x / uRes.z + uOffset.x, xy.y + uOffset.y, -pos.z * 0.4, 1.0);
}
`

// Emblem look: dark faceted fill + crisp light facet-edges, white eye shards, bright fangs.
export const FRAGMENT_SHADER = `#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec3 uFill; uniform vec3 uEdge; uniform vec3 uEye; uniform float uGlow; uniform float uAlpha;
varying vec3 vNormal; varying float vTone; varying float vMat; varying vec3 vBary;
void main() {
  float m = min(min(vBary.x, vBary.y), vBary.z);
  float w = fwidth(m);
  float edge = 1.0 - smoothstep(0.0, w * 2.2, m);

  vec3 n = normalize(vNormal);
  float li = 0.78 + 0.2 * max(dot(n, normalize(vec3(-0.35, 0.5, 0.78))), 0.0);
  vec3 col;
  if (vMat > 2.5) {
    col = mix(uFill * 0.35, uEdge * 0.5, edge);
  } else if (vMat > 1.5) {
    col = mix(uEdge * 0.82, uEdge, edge);
  } else if (vMat > 0.5) {
    vec3 eyeFill = uEye * (0.55 + 0.35 * uGlow);
    col = mix(eyeFill, uEye, edge);
    col += uEye * uGlow * 0.2 * vTone;
  } else {
    col = mix(uFill * li, uEdge, edge);
  }
  col = pow(max(col, vec3(0.0)), vec3(0.95));
  gl_FragColor = vec4(col * uAlpha, uAlpha); // premultiplied — safe over transparent page + between instances
}
`
