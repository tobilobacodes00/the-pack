import { useEffect, useRef } from 'react';

/**
 * AlphaWolf — the geometric wolf emblem, alive.
 *
 * The look in the reference is crisp faceted planes, so this component moves
 * from noise-displaced distance fields to a hand-authored low-poly 3D mesh:
 * the head is defined as named vertices (right half, auto-mirrored), every
 * triangle carries its own tone from the emblem's value structure, and real
 * face normals drive flat shading from a key + fill light. Because the mesh
 * is genuinely 3D, the head *turns* toward your cursor — facets catch and
 * lose the light as it rotates.
 *
 * Ferocity, on a schedule:
 *   - fangs are always slightly bared (resting snarl)
 *   - periodic growl: the jaw drops to expose the maw and lower fangs, the
 *     eyes flare, the head lowers and trembles, and it lunges forward a hair
 *   - glowing eyes with a slow pulse; blinking narrows them to embers
 *   - independent ear flicks, constant slow breathing
 *   - head follows the cursor; prowls on its own when you go idle
 *
 * Props:
 *   furColor        mid coat tone; light/dark facets derived  ('#33363E')
 *   eyeColor        ember glow                                ('#FFAE34')
 *   backgroundColor scene                                     ('#0B0C10')
 *   scale           overall size                              (1)
 *   headFollow      0..1 cursor tracking                      (1)
 *   fidget          0..2 how restless / aggressive            (1)
 */

function hexToVec3(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  ];
}

/* ------------------------------------------------------------------ */
/* Mesh: right half of the head, mirrored at build time.               */
/* Coordinates: x right, y up, z toward the viewer.                    */
/* ------------------------------------------------------------------ */

/* crown / forehead */
const T0 = [0.0, 0.60, 0.16];    /* crown dip, centre  */
const T1 = [0.15, 0.70, 0.10];   /* crown peak         */
const F0 = [0.0, 0.34, 0.24];    /* forehead centre    */

/* ear */
const E0 = [0.25, 0.55, 0.10];   /* inner base         */
const E1 = [0.60, 0.34, 0.00];   /* outer base         */
const E2 = [0.53, 1.04, -0.05];  /* tip                */
const E3 = [0.40, 0.52, 0.07];   /* front ridge base   */
const E4 = [0.48, 0.88, 0.03];   /* inner-ear top      */
const E5 = [0.51, 0.44, 0.05];   /* inner-ear outer    */
const E6 = [0.36, 0.50, 0.08];   /* inner-ear inner    */
const EAR_PIV = [0.44, 0.48];

/* brow (heavy, angled in — the anger) */
const B0 = [0.20, 0.40, 0.20];
const B1 = [0.38, 0.26, 0.13];
const B2 = [0.07, 0.185, 0.24];

/* eye slit: inner corner LOW, outer HIGH */
const Y0 = [0.095, 0.14, 0.215];
const Y1 = [0.335, 0.225, 0.15];
const Y2 = [0.21, 0.23, 0.185];
const Y3 = [0.19, 0.13, 0.19];
const EYE_PIV = [0.20, 0.18];

/* cheek mass + three silhouette fur spikes */
const C0 = [0.64, 0.10, -0.02];
const C1 = [0.75, -0.10, -0.06];
const C2 = [0.55, -0.16, 0.00];
const C3 = [0.62, -0.38, -0.05];
const C4 = [0.40, -0.33, 0.06];
const C5 = [0.42, -0.58, -0.01];
const C6 = [0.22, -0.45, 0.10];
const U0 = [0.30, 0.02, 0.16];

/* muzzle */
const M0 = [0.0, 0.155, 0.28];
const M1 = [0.0, -0.02, 0.30];
const M2 = [0.145, -0.02, 0.235];
const M3 = [0.185, -0.20, 0.185];
const M4 = [0.0, -0.155, 0.305];

/* nose */
const N0 = [0.085, -0.185, 0.285];
const N1 = [0.06, -0.30, 0.28];
const N2 = [0.0, -0.345, 0.285];

/* lip line + upper fang */
const L0 = [0.155, -0.30, 0.20];
const FA0 = [0.115, -0.315, 0.25];
const FA1 = [0.165, -0.30, 0.245];
const FA2 = [0.142, -0.47, 0.26];

/* maw interior (static — revealed when the jaw drops) */
const W0 = [0.0, -0.33, 0.10];
const W1 = [0.14, -0.30, 0.08];
const W2 = [0.0, -0.56, 0.06];

/* lower jaw (animated group) + lower fang */
const J0 = [0.0, -0.36, 0.19];
const J1 = [0.135, -0.33, 0.155];
const J2 = [0.155, -0.47, 0.12];
const J3 = [0.0, -0.65, 0.14];
const G0 = [0.07, -0.375, 0.215];
const G1 = [0.115, -0.38, 0.21];
const G2 = [0.093, -0.295, 0.215];

/* materials: 0 fur, 1 eye, 2 fang, 3 maw, 4 backdrop */
/* groups:    0 static, 1 earR, 2 earL, 3 eyeR, 4 eyeL, 5 jaw */

function buildMesh() {
  const half = [];
  const F = (a, b, c, tone, mat = 0, grp = 0, piv = [0, 0]) =>
    half.push({ v: [a, b, c], tone, mat, grp, piv });

  /* ear */
  F(E2, E1, E3, 0.40, 0, 1, EAR_PIV);
  F(E2, E3, E0, 0.66, 0, 1, EAR_PIV);
  F(E4, E5, E6, 0.08, 0, 1, EAR_PIV);
  /* crown */
  F(T0, T1, F0, 0.72);
  F(T1, B0, F0, 0.62);
  F(T1, E0, B0, 0.52);
  F(E0, E1, B1, 0.38);
  F(E0, B1, B0, 0.48);
  /* brow strip */
  F(B2, B0, Y2, 0.85);
  F(B2, Y2, Y0, 0.78);
  F(B0, B1, Y2, 0.80);
  F(B1, Y1, Y2, 0.70);
  /* eye slit */
  F(Y0, Y2, Y1, 0.90, 1, 3, EYE_PIV);
  F(Y0, Y1, Y3, 0.50, 1, 3, EYE_PIV);
  /* centre face */
  F(F0, B0, B2, 0.68);
  F(F0, B2, M0, 0.74);
  F(M0, B2, Y0, 0.80);
  /* bridge */
  F(M0, M2, M1, 0.88);
  F(M0, Y0, M2, 0.76);
  F(Y0, Y3, M2, 0.58);
  F(Y3, Y1, U0, 0.50);
  F(Y3, U0, M2, 0.55);
  F(Y1, C0, U0, 0.42);
  /* muzzle lower */
  F(M1, M2, M4, 0.84);
  F(M2, M3, M4, 0.62);
  F(M2, U0, M3, 0.52);
  F(U0, C0, C2, 0.44);
  F(U0, C2, C4, 0.48);
  F(U0, C4, M3, 0.42);
  F(M3, C4, C6, 0.36);
  F(M3, C6, L0, 0.34);
  /* silhouette spikes */
  F(C0, C1, C2, 0.28);
  F(C2, C1, C3, 0.24);
  F(C2, C3, C4, 0.40);
  F(C4, C3, C5, 0.28);
  F(C4, C5, C6, 0.34);
  /* nose */
  F(M4, N0, N1, 0.07);
  F(M4, N1, N2, 0.05);
  /* lip band */
  F(N0, M3, L0, 0.44);
  F(N0, L0, N1, 0.38);
  F(N1, L0, N2, 0.34);
  /* upper fang */
  F(FA0, FA1, FA2, 0.9, 2, 0);
  /* maw */
  F(W0, W1, W2, 0.5, 3, 0);
  /* lower jaw + fang */
  F(J0, J1, J3, 0.46, 0, 5);
  F(J1, J2, J3, 0.34, 0, 5);
  F(G0, G1, G2, 0.9, 2, 5);

  /* mirror x -> -x; swap L/R groups */
  const swap = { 1: 2, 2: 1, 3: 4, 4: 3 };
  const faces = [...half];
  for (const f of half) {
    faces.push({
      v: f.v.map((p) => [-p[0], p[1], p[2]]),
      tone: f.tone,
      mat: f.mat,
      grp: swap[f.grp] || f.grp,
      piv: [-f.piv[0], f.piv[1]]
    });
  }

  /* backdrop glow disc (static, behind everything) */
  const discFaces = [];
  const SEG = 22;
  const R = 1.28;
  const CX = 0.0, CY = 0.14, CZ = -0.5;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2;
    const a1 = ((i + 1) / SEG) * Math.PI * 2;
    discFaces.push({
      v: [
        [CX, CY, CZ],
        [CX + Math.cos(a0) * R, CY + Math.sin(a0) * R, CZ],
        [CX + Math.cos(a1) * R, CY + Math.sin(a1) * R, CZ]
      ],
      tones: [1, 0, 0],
      mat: 4, grp: 0, piv: [0, 0]
    });
  }

  /* interleave: pos(3) normal(3) tone(1) mat(1) grp(1) pivot(2) = 11 floats */
  const out = [];
  const pushFace = (f) => {
    let [a, b, c] = f.v;
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (nz < 0) {                      /* keep every facet front-winding */
      const t = b; b = c; c = t;
      nx = -nx; ny = -ny; nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const verts = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const p = verts[i];
      const tone = f.tones ? f.tones[i] : f.tone;
      out.push(p[0], p[1], p[2], nx, ny, nz, tone, f.mat, f.grp, f.piv[0], f.piv[1]);
    }
  };
  for (const f of discFaces) pushFace(f);   /* backdrop first */
  for (const f of faces) pushFace(f);
  return new Float32Array(out);
}

/* ------------------------------------------------------------------ */

const vertexShader = `
precision highp float;

attribute vec3 aPos;
attribute vec3 aNor;
attribute float aTone;
attribute float aMat;
attribute float aGrp;
attribute vec2 aPiv;

uniform vec3  uRes;      /* w, h, aspect */
uniform float uScale;
uniform float uYaw;
uniform float uPitch;
uniform float uRoll;
uniform float uPulse;    /* breath + lunge scale */
uniform float uBlink;
uniform float uEarL;
uniform float uEarR;
uniform float uJaw;

varying vec3  vNormal;
varying float vTone;
varying float vMat;

void main() {
  vec3 pos = aPos;
  vec3 nor = aNor;

  if (aMat < 3.5) {
    /* ---- articulation ---- */
    if (aGrp > 0.5 && aGrp < 2.5) {              /* ear flick */
      float tw = (aGrp < 1.5) ? uEarR : uEarL;
      float a = tw * 0.20 * sign(aPiv.x);
      vec2 d = pos.xy - aPiv;
      float c = cos(a);
      float s = sin(a);
      pos.xy = aPiv + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    }
    if (aGrp > 2.5 && aGrp < 4.5) {              /* blink squash + growl narrow */
      float sq = max(1.0 - uBlink, 0.07) * (1.0 - 0.30 * uJaw);
      pos.y = aPiv.y + (pos.y - aPiv.y) * sq;
    }
    if (aGrp > 4.5) {                            /* jaw drop */
      pos.y -= uJaw * 0.15;
      pos.z -= uJaw * 0.05;
      pos.y -= uJaw * 0.35 * max(-0.36 - aPos.y, 0.0);  /* chin swings wider */
    }

    pos *= uPulse;

    /* ---- head rotation ---- */
    float cy = cos(uYaw);
    float sy = sin(uYaw);
    float cx = cos(uPitch);
    float sx = sin(uPitch);
    float cz = cos(uRoll);
    float sz = sin(uRoll);
    mat3 Rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
    mat3 Rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
    mat3 Ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
    mat3 R = Ry * Rx * Rz;
    pos = R * pos;
    nor = R * nor;
  }

  vNormal = nor;
  vTone = aTone;
  vMat = aMat;

  float persp = 1.0 / (1.0 - pos.z * 0.22);
  vec2 xy = pos.xy * persp * uScale * 0.82;
  xy.y -= 0.14 * uScale;
  gl_Position = vec4(xy.x / uRes.z, xy.y, -pos.z * 0.4, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform vec3  uFurLight;
uniform vec3  uFurDark;
uniform vec3  uEye;
uniform vec3  uBg;
uniform vec3  uBgGlow;
uniform float uGlow;

varying vec3  vNormal;
varying float vTone;
varying float vMat;

void main() {
  vec3 col;

  if (vMat > 3.5) {
    /* backdrop: quiet radial glow */
    col = mix(uBg * 0.85, uBgGlow, pow(vTone, 1.8));
  } else if (vMat > 2.5) {
    /* maw */
    vec3 n = normalize(vNormal);
    float d = max(dot(n, normalize(vec3(-0.42, 0.62, 0.66))), 0.0);
    col = vec3(0.30, 0.06, 0.07) * (0.35 + 0.55 * d);
  } else if (vMat > 1.5) {
    /* fang */
    vec3 n = normalize(vNormal);
    float d = max(dot(n, normalize(vec3(-0.42, 0.62, 0.66))), 0.0);
    col = vec3(0.92, 0.90, 0.85) * (0.40 + 0.70 * d);
  } else if (vMat > 0.5) {
    /* eye: emissive ember, brighter along the upper facet */
    col = uEye * (0.40 + 1.05 * uGlow) * (0.70 + 0.55 * vTone);
    col += uEye * uGlow * uGlow * 0.35;
  } else {
    /* fur facet: per-face tone x key light + fill + cool silhouette rim */
    vec3 n = normalize(vNormal);
    float d1 = max(dot(n, normalize(vec3(-0.42, 0.62, 0.66))), 0.0);
    float d2 = max(dot(n, normalize(vec3(0.65, -0.15, 0.45))), 0.0);
    float li = 0.26 + 0.92 * d1 + 0.16 * d2;
    col = mix(uFurDark, uFurLight, vTone) * li;
    col += vec3(0.10, 0.12, 0.16) * pow(1.0 - abs(n.z), 3.0) * 0.55;
  }

  col = pow(max(col, vec3(0.0)), vec3(0.95));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function AlphaWolf({
  furColor = '#33363E',
  eyeColor = '#FFAE34',
  backgroundColor = '#0B0C10',
  scale = 1.0,
  headFollow = 1.0,
  fidget = 1.0
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const container = containerRef.current;

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return undefined;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
      }
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return undefined;
    }
    gl.useProgram(program);
    gl.enable(gl.DEPTH_TEST);

    const data = buildMesh();
    const vertCount = data.length / 11;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    const STRIDE = 11 * 4;
    const attr = (name, size, offset) => {
      const loc = gl.getAttribLocation(program, name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset * 4);
      }
    };
    attr('aPos', 3, 0);
    attr('aNor', 3, 3);
    attr('aTone', 1, 6);
    attr('aMat', 1, 7);
    attr('aGrp', 1, 8);
    attr('aPiv', 2, 9);

    const u = (name) => gl.getUniformLocation(program, name);
    const U = {
      res: u('uRes'), yaw: u('uYaw'), pitch: u('uPitch'), roll: u('uRoll'),
      pulse: u('uPulse'), blink: u('uBlink'), earL: u('uEarL'), earR: u('uEarR'),
      jaw: u('uJaw'), glow: u('uGlow')
    };

    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const fur = hexToVec3(furColor);
    const eye = hexToVec3(eyeColor);
    const bg = hexToVec3(backgroundColor);

    gl.uniform1f(u('uScale'), scale);
    gl.uniform3fv(u('uFurLight'), fur.map((v) => clamp01(v * 2.0 + 0.05)));
    gl.uniform3fv(u('uFurDark'), fur.map((v) => v * 0.28));
    gl.uniform3fv(u('uEye'), eye);
    gl.uniform3fv(u('uBg'), bg);
    gl.uniform3fv(u('uBgGlow'), bg.map((v, i) => clamp01(v * 0.55 + eye[i] * 0.10 + 0.015)));
    gl.clearColor(bg[0] * 0.85, bg[1] * 0.85, bg[2] * 0.85, 1);

    /* ---------------- behavior engine ---------------- */
    const fg = Math.max(fidget, 0.001);
    const rand = (a, b) => a + Math.random() * (b - a);
    const pulse = (x) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x));
    const sm = (x) => x * x * (3 - 2 * x);
    const ease = (a, b, x) => clamp01((x - a) / (b - a));

    const mouse = { x: 0, y: 0, sx: 0, sy: 0, lastMove: -1e9 };
    const B = {
      nextBlink: rand(1, 3), blinkStart: -10, dbl: false,
      growlStart: -100, growlDur: 0, nextGrowl: rand(4, 9) / fg,
      earLStart: -10, nextEarL: rand(2, 6) / fg,
      earRStart: -10, nextEarR: rand(3, 8) / fg
    };

    function onMouseMove(e) {
      const rect = container.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      mouse.x = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
      mouse.y = Math.max(-1, Math.min(1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)));
      mouse.lastMove = performance.now() * 0.001;
    }
    window.addEventListener('pointermove', onMouseMove, { passive: true });

    function resize() {
      const w = Math.max(container.offsetWidth, 1);
      const h = Math.max(container.offsetHeight, 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform3f(U.res, canvas.width, canvas.height, canvas.width / canvas.height);
    }
    window.addEventListener('resize', resize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container);
    resize();

    container.appendChild(canvas);

    let animationFrameId;
    let last = performance.now();

    function update(now) {
      animationFrameId = requestAnimationFrame(update);
      const s = now * 0.001;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      /* blink */
      if (s > B.nextBlink) {
        B.blinkStart = s;
        B.dbl = Math.random() < 0.2;
        B.nextBlink = s + rand(2.0, 6.5);
      }
      let blink = pulse((s - B.blinkStart) / 0.24);
      if (B.dbl) blink = Math.min(1, blink + pulse((s - B.blinkStart - 0.30) / 0.24));

      /* growl */
      if (s > B.nextGrowl && s > B.growlStart + B.growlDur + 1.5) {
        B.growlStart = s;
        B.growlDur = rand(1.5, 2.4);
        B.nextGrowl = s + rand(6, 13) / fg;
      }
      const gu = s - B.growlStart;
      let growl = 0;
      if (gu >= 0 && gu <= B.growlDur) {
        growl = sm(ease(0, 0.35, gu)) * sm(1 - ease(B.growlDur - 0.45, B.growlDur, gu));
      }
      const jaw = 0.06 + 0.94 * growl;                 /* resting snarl */
      const tremY = Math.sin(s * 47.0) * 0.012 * growl;
      const tremR = Math.sin(s * 55.0) * 0.02 * growl;
      const lunge = 1 + 0.04 * growl;
      const flare = 1 + 1.1 * growl;

      /* ear flicks */
      if (s > B.nextEarL) { B.earLStart = s; B.nextEarL = s + rand(2.5, 7.0) / fg; }
      if (s > B.nextEarR) { B.earRStart = s; B.nextEarR = s + rand(3.0, 8.5) / fg; }
      const earL = pulse((s - B.earLStart) / 0.32);
      const earR = pulse((s - B.earRStart) / 0.32);

      /* head: track cursor; prowl when idle */
      const idle = s - mouse.lastMove > 3.0;
      const tx = idle ? Math.sin(s * 0.40) * 0.55 + Math.sin(s * 0.17 + 2.0) * 0.2 : mouse.x;
      const ty = idle ? Math.sin(s * 0.26 + 1.3) * 0.30 : mouse.y;
      const k = 1 - Math.exp(-dt * 6.0);
      mouse.sx += (tx - mouse.sx) * k;
      mouse.sy += (ty - mouse.sy) * k;

      const yaw = mouse.sx * 0.42 * headFollow + tremY;
      const pitch = -mouse.sy * 0.30 * headFollow + 0.10 * growl;
      const roll = mouse.sx * 0.05 * headFollow + tremR;
      const breath = 1 + 0.007 * Math.sin(s * 2.1);
      const glow = clamp01((0.82 + 0.18 * Math.sin(s * 2.4)) * (1 - 0.88 * blink)) * flare;

      gl.uniform1f(U.yaw, yaw);
      gl.uniform1f(U.pitch, pitch);
      gl.uniform1f(U.roll, roll);
      gl.uniform1f(U.pulse, breath * lunge);
      gl.uniform1f(U.blink, blink);
      gl.uniform1f(U.earL, earL);
      gl.uniform1f(U.earR, earR);
      gl.uniform1f(U.jaw, jaw);
      gl.uniform1f(U.glow, glow);

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, vertCount);
    }
    animationFrameId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMouseMove);
      if (ro) ro.disconnect();
      if (canvas.parentNode === container) container.removeChild(canvas);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    };
  }, [furColor, eyeColor, backgroundColor, scale, headFollow, fidget]);

  return <div ref={containerRef} className="w-full h-full" />;
}

/* Demo wrapper — sized container for the preview. */
export default function AlphaWolfDemo() {
  return (
    <div style={{ width: '100%', height: '100vh', background: '#0B0C10' }}>
      <AlphaWolf
        furColor="#33363E"
        eyeColor="#FFAE34"
        backgroundColor="#0B0C10"
        scale={1}
        headFollow={1}
        fidget={1}
      />
    </div>
  );
}
