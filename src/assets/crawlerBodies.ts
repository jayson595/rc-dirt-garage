// Sculpted crawler bodies. Each hard body is ONE continuous lofted surface (cross-sections along x that
// blend hood → windscreen → roof, with the wheel arches cut into the lower edge and fender flares swelling
// out of the panel), plus flat end caps. All the small detail — glass, two-tone roof, retro stripes,
// panel seams, handles, badges, lamps — is painted onto the surface by evaluating the same shape function
// per texel, so it lines up exactly with the 3D form. Accessories are bent tubes and lathed parts.
// Body frame: x forward, y up, z right. Wheel centres sit at (±0.16, ≈-0.047) at rest, tyre r 0.058.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lathe, rimGeometry, surface, tireGeometry } from './materials';

export type V2 = [number, number];
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const sstep = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Chaikin corner-cutting on an open polyline (endpoints kept). */
export function chaikin(p: V2[], it = 3): V2[] {
  let a = p;
  for (let k = 0; k < it; k++) {
    const b: V2[] = [a[0]];
    for (let i = 0; i < a.length - 1; i++) {
      const [x0, y0] = a[i], [x1, y1] = a[i + 1];
      b.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    b.push(a[a.length - 1]); a = b;
  }
  return a;
}
/** y(x) from a rounded polyline given in (x, y) pairs (any x order). */
export function profile(pts: V2[], it = 3) {
  const p = chaikin([...pts].sort((a, b) => a[0] - b[0]), it);
  return (x: number) => {
    if (x <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) if (x <= p[i][0]) { const [x0, y0] = p[i - 1], [x1, y1] = p[i]; return y0 + (y1 - y0) * ((x - x0) / Math.max(1e-9, x1 - x0)); }
    return p[p.length - 1][1];
  };
}
/** Resample a polyline to n points evenly by arc length. */
export function resample(p: V2[], n: number): V2[] {
  const L = [0]; for (let i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const out: V2[] = []; let j = 1;
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * L[L.length - 1];
    while (j < L.length - 1 && L[j] < s) j++;
    const t = (s - L[j - 1]) / Math.max(1e-9, L[j] - L[j - 1]);
    out.push([p[j - 1][0] + (p[j][0] - p[j - 1][0]) * t, p[j - 1][1] + (p[j][1] - p[j - 1][1]) * t]);
  }
  return out;
}

/** Description of a lofted shell: a right-half cross-section (z, y) from the lower edge up to the
 *  centreline at each station x; mirrored to make the full section. */
export interface ShellSpec {
  xF: number; xR: number;
  half(x: number): V2[];   // right half, lower edge first, ending on the centreline (z = 0)
  endRound: number;        // length over which the ends roll in before the caps
}

export function sectionAt(spec: ShellSpec, x: number, n: number): V2[] {
  let h = resample(chaikin(spec.half(x), 3), Math.ceil(n / 2));
  // roll the ends in a little so the caps meet a rounded edge
  const dF = spec.xF - x, dR = x - spec.xR, e = spec.endRound;
  const d = Math.min(dF, dR);
  if (d < e) {
    const t = 1 - d / e, s = 1 - 0.12 * (1 - Math.sqrt(Math.max(0, 1 - t * t)));
    const yb = h[0][1], yt = h[h.length - 1][1], yc = (yb + yt) / 2;
    h = h.map(([z, y]) => [z * s, y > yc ? yc + (y - yc) * s : y]);
  }
  const mirror = h.map(([z, y]) => [-z, y] as V2);           // left half, edge → centre
  return [...mirror, ...h.slice().reverse().slice(1)];        // left edge → over the top → right edge
}

export interface Painter { (x: number, y: number, z: number, out: { c: [number, number, number]; r: number; m: number; e: number }): void }

/** Build the lofted shell mesh + painted maps. Returns the outer mesh, an inner (dark) mesh and the end outlines. */
export function loftShell(spec: ShellSpec, paint: Painter, opts: { U: number; V: number; TW: number; TH: number }) {
  const { U, V, TW, TH } = opts;
  const xAt = (u: number) => spec.xF - u * (spec.xF - spec.xR);
  // geometry
  const pos = new Float32Array(U * V * 3), uv = new Float32Array(U * V * 2);
  for (let i = 0; i < U; i++) {
    const u = i / (U - 1), x = xAt(u), sec = sectionAt(spec, x, V + 1);
    for (let j = 0; j < V; j++) {
      const [z, y] = sec[Math.round((j / (V - 1)) * (sec.length - 1))];
      const k = i * V + j; pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; uv[k * 2] = u; uv[k * 2 + 1] = j / (V - 1);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < U - 1; i++) for (let j = 0; j < V - 1; j++) { const a = i * V + j, b = a + 1, c = a + V, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  // painted maps: colour, roughness/metalness (G/B), emissive
  const mk = () => { const c = document.createElement('canvas'); c.width = TW; c.height = TH; return c; };
  const cC = mk(), cO = mk(), cE = mk();
  // CPU-backed canvases: written once with putImageData and uploaded as textures (no GPU read-back stall)
  const ctx = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;
  const iC = ctx(cC).createImageData(TW, TH), iO = ctx(cO).createImageData(TW, TH), iE = ctx(cE).createImageData(TW, TH);
  const px = { c: [1, 1, 1] as [number, number, number], r: 0.4, m: 0.1, e: 0 };
  for (let i = 0; i < TW; i++) {
    const u = (i + 0.5) / TW, x = xAt(u), sec = sectionAt(spec, x, TH + 1);
    for (let j = 0; j < TH; j++) {
      const [z, y] = sec[Math.round(((j + 0.5) / TH) * (sec.length - 1))];
      px.c = [1, 1, 1]; px.r = 0.4; px.m = 0.1; px.e = 0;
      paint(x, y, z, px);
      const o = ((TH - 1 - j) * TW + i) * 4; // canvas rows run top-down; uv v=0 is the bottom row
      iC.data[o] = px.c[0] * 255; iC.data[o + 1] = px.c[1] * 255; iC.data[o + 2] = px.c[2] * 255; iC.data[o + 3] = 255;
      iO.data[o] = 255; iO.data[o + 1] = px.r * 255; iO.data[o + 2] = px.m * 255; iO.data[o + 3] = 255;
      iE.data[o] = px.c[0] * px.e * 255; iE.data[o + 1] = px.c[1] * px.e * 255; iE.data[o + 2] = px.c[2] * px.e * 255; iE.data[o + 3] = 255;
    }
  }
  cC.getContext('2d')!.putImageData(iC, 0, 0); cO.getContext('2d')!.putImageData(iO, 0, 0); cE.getContext('2d')!.putImageData(iE, 0, 0);
  const tC = new THREE.CanvasTexture(cC), tO = new THREE.CanvasTexture(cO), tE = new THREE.CanvasTexture(cE);
  tC.colorSpace = THREE.SRGBColorSpace; tE.colorSpace = THREE.SRGBColorSpace;
  for (const t of [tC, tO, tE]) { t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  const mat = new THREE.MeshPhysicalMaterial({ map: tC, roughnessMap: tO, metalnessMap: tO, roughness: 1, metalness: 1, emissiveMap: tE, emissive: 0xffffff, emissiveIntensity: 1, clearcoat: 0.85, clearcoatRoughness: 0.16 });
  const outer = new THREE.Mesh(g, mat); outer.castShadow = true; outer.receiveShadow = true;
  const inner = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9, side: THREE.BackSide }));
  return { outer, inner, front: sectionAt(spec, spec.xF, 160), rear: sectionAt(spec, spec.xR, 160) };
}

/** Flat end cap from a section outline, painted by a 2D canvas callback in (z, y) metres.
 *  The shape is built in (X, y) with X = -z for the front (so it reads left→right from outside). */
export function endCap(outline: V2[], x: number, facing: 1 | -1, draw: (g: CanvasRenderingContext2D, toPx: (z: number, y: number) => [number, number]) => void, emissiveDraw?: (g: CanvasRenderingContext2D, toPx: (z: number, y: number) => [number, number]) => void) {
  const X = (z: number) => (facing > 0 ? -z : z);
  const pts = outline.map(([z, y]) => new THREE.Vector2(X(z), y));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
  const p = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - x0) / (x1 - x0), (p.getY(i) - y0) / (y1 - y0));
  g.rotateY(facing > 0 ? Math.PI / 2 : -Math.PI / 2);
  g.translate(x + facing * 0.0004, 0, 0);
  const TW = 512, TH = Math.max(64, Math.round(512 * (y1 - y0) / (x1 - x0)));
  const toPx = (z: number, y: number): [number, number] => [((X(z) - x0) / (x1 - x0)) * TW, (1 - (y - y0) / (y1 - y0)) * TH];
  const mkTex = (fn: typeof draw) => {
    const c = document.createElement('canvas'); c.width = TW; c.height = TH; fn(c.getContext('2d')!, toPx);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  };
  const m = new THREE.MeshPhysicalMaterial({ map: mkTex(draw), roughness: 0.4, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.18 });
  if (emissiveDraw) { m.emissiveMap = mkTex(emissiveDraw); m.emissive.set(0xffffff); }
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/** Smooth bent tube through points with rounded corners (fillet radius r). */
export function bentTube(pts: THREE.Vector3[], radius: number, fillet: number, m: THREE.Material, closed = false) {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const n = pts.length;
  const corner = (i: number) => {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const da = a.clone().sub(b), dc = c.clone().sub(b);
    const f = Math.min(fillet, da.length() * 0.45, dc.length() * 0.45);
    return { p0: b.clone().add(da.normalize().multiplyScalar(f)), b, p1: b.clone().add(dc.normalize().multiplyScalar(f)) };
  };
  if (closed) {
    const cs = pts.map((_, i) => corner(i));
    for (let i = 0; i < n; i++) { const c = cs[i], nx = cs[(i + 1) % n]; path.add(new THREE.QuadraticBezierCurve3(c.p0, c.b, c.p1)); path.add(new THREE.LineCurve3(c.p1, nx.p0)); }
  } else {
    let prev = pts[0].clone();
    for (let i = 1; i < n - 1; i++) { const c = corner(i); path.add(new THREE.LineCurve3(prev, c.p0)); path.add(new THREE.QuadraticBezierCurve3(c.p0, c.b, c.p1)); prev = c.p1; }
    path.add(new THREE.LineCurve3(prev, pts[n - 1]));
  }
  const g = new THREE.TubeGeometry(path, Math.max(24, n * 16), radius, 10, closed);
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; return mesh;
}

// ====================================================================================== wagon
const ARCH = { x: 0.16, y: -0.038, r: 0.083 };
const archTop = (x: number) => { let t = -1; for (const ax of [ARCH.x, -ARCH.x]) { const dx = x - ax; if (Math.abs(dx) < ARCH.r) t = Math.max(t, ARCH.y + Math.sqrt(ARCH.r * ARCH.r - dx * dx)); } return t; };
export const smax = (a: number, b: number, k: number) => { const h = THREE.MathUtils.clamp(0.5 + (b - a) / (2 * k), 0, 1); return a * (1 - h) + b * h + k * h * (1 - h); };

export const hex3 = (n: number): [number, number, number] => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];

/** Cragweld '76 Ranchero: classic two-door hard-body 4x4 wagon (TRX-4 / Trailrunner-style scale body). */
export function buildWagonBody(shell: THREE.Group, colors: { body: number; accent: number }) {
  const W = 0.106, XF = 0.262, XR = -0.258;
  const belt = profile([[XF, 0.058], [0.24, 0.062], [0.2, 0.064], [0.09, 0.067], [0.07, 0.064], [-0.2, 0.062], [XR, 0.06]]);
  const top = profile([[XF, 0.062], [0.248, 0.066], [0.2, 0.069], [0.1, 0.071], [0.076, 0.072], [0.031, 0.128], [0.022, 0.132], [-0.226, 0.132], [-0.243, 0.127], [-0.252, 0.112], [XR, 0.08]], 2);
  const cab = (x: number) => sstep(0.082, 0.064, x);
  const bot = (x: number) => {
    let b = x > 0.215 ? -0.021 + sstep(0.215, XF, x) * 0.008 : x < -0.225 ? -0.021 + sstep(-0.225, XR, x) * 0.006 : -0.021;
    const at = archTop(x); if (at > -1) b = smax(b, at, 0.008);
    return b;
  };
  // fender flare swell around each arch (strongest just outside the opening, fades by the beltline)
  const flare = (x: number, y: number) => {
    let f = 0;
    for (const ax of [ARCH.x, -ARCH.x]) { const d = Math.hypot(x - ax, y - ARCH.y); f = Math.max(f, Math.exp(-Math.pow((d - ARCH.r - 0.006) / 0.017, 2))); }
    return 0.011 * f * (1 - sstep(0.04, 0.06, y));
  };
  const spec: ShellSpec = {
    xF: XF, xR: XR, endRound: 0.012,
    half(x) {
      const b = bot(x), bl = belt(x), t = top(x), c = cab(x);
      const wTop = THREE.MathUtils.lerp(W - 0.009, 0.093, c);
      const y1 = THREE.MathUtils.lerp(b, bl, 0.45), y2 = bl - 0.011;
      const p4y = Math.min(bl + 0.004, t - 0.004);
      return [
        [W + flare(x, b) + 0.002, b],
        [W + flare(x, y1) + 0.001, y1],
        [W + flare(x, y2) + 0.0018, y2],
        [W, bl],
        [THREE.MathUtils.lerp(W - 0.002, wTop + 0.003, c), p4y],
        [wTop, t - THREE.MathUtils.lerp(0.003, 0.012, c)],
        [wTop - 0.013, t],
        [0, t + THREE.MathUtils.lerp(0.004, 0.002, c)],
      ];
    },
  };
  const body = hex3(colors.body), white = hex3(colors.accent), glass: [number, number, number] = [0.05, 0.07, 0.085];
  const black: [number, number, number] = [0.07, 0.07, 0.075], chrome: [number, number, number] = [0.86, 0.88, 0.9];
  const stripes: [number, number, number][] = [[0.95, 0.92, 0.86], [0.88, 0.64, 0.23], [0.54, 0.23, 0.1], [0.11, 0.11, 0.12]];
  // badge text sampled from a small canvas
  const bc = document.createElement('canvas'); bc.width = 256; bc.height = 40; const bg = bc.getContext('2d', { willReadFrequently: true })!;
  bg.fillStyle = '#fff'; bg.font = 'italic 900 34px "Barlow Condensed", "Arial Narrow", sans-serif'; bg.fillText('Ranchero', 4, 32);
  const bdata = bg.getImageData(0, 0, 256, 40).data;
  const badge = (x: number, y: number, z: number) => { const u = z > 0 ? (x + 0.02) / 0.07 : (0.05 - x) / 0.07, v = 1 - (y - 0.018) / 0.011; if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0; return bdata[(Math.floor(v * 40) * 256 + Math.floor(u * 256)) * 4 + 3] / 255; };
  const paint: Painter = (x, y, z, o) => {
    const az = Math.abs(z), bl = belt(x), t = top(x), c = cab(x);
    const wTop = THREE.MathUtils.lerp(W - 0.009, 0.093, c);
    o.c = body; o.r = 0.32; o.m = 0.12;
    const side = az > W - 0.004;
    // greenhouse
    if (y > bl + 0.003 && c > 0.5) {
      o.c = white; o.r = 0.3; o.m = 0.05;
      const onSide = az > wTop - 0.006 && y < t - 0.008;
      const wsX = 0.072 - ((y - 0.066) * 0.041) / 0.062; // A-pillar line
      const sideBand = y > bl + 0.009 && y < t - 0.012;
      if (onSide && sideBand && ((x < wsX - 0.009 && x > -0.064) || (x < -0.081 && x > -0.224 - (y - bl) * 0.12))) { o.c = glass; o.r = 0.05; o.m = 0.35; }
      const onTopFront = az < wTop - 0.011 && x < 0.069 && x > 0.035 && y > 0.074 && y < 0.122;
      if (onTopFront) { o.c = glass; o.r = 0.05; o.m = 0.35; }
      if (x < -0.247 && az < wTop - 0.013 && y > bl + 0.01 && y < t - 0.014) { o.c = glass; o.r = 0.05; o.m = 0.35; }
      // drip rail line along the roof edge
      if (onSide && Math.abs(y - (t - 0.0095)) < 0.0008) { o.c = black; o.r = 0.6; }
      return;
    }
    // hood seams + cowl vent
    if (!side && x > 0.078) {
      if (Math.abs(az - 0.091) < 0.0007 && x < 0.252) { o.c = black; o.r = 0.8; }
      if (x > 0.251 && x < 0.2525) { o.c = black; o.r = 0.8; }
      if (x > 0.078 && x < 0.088 && az < 0.07 && Math.sin(z * 900) > 0.3) { o.c = black; o.r = 0.8; }
    }
    if (side) {
      // lower rocker guard band, tri-stripe, door seams, handle, badge, fuel door, side markers
      if (y < -0.011) { o.c = black; o.r = 0.75; o.m = 0.05; }
      for (let k = 0; k < 4; k++) if (y > 0.0475 + k * -0.0035 - 0.0035 && y <= 0.0475 + k * -0.0035 + 0.0001 && y > archTop(x) + 0.004) { o.c = stripes[3 - k]; o.r = 0.35; }
      if (y > -0.012 && y < bl - 0.001 && (Math.abs(x - 0.069) < 0.0007 || Math.abs(x + 0.074) < 0.0007)) { o.c = black; o.r = 0.8; }
      if (x > -0.074 && x < 0.069 && Math.abs(y + 0.0115) < 0.0007) { o.c = black; o.r = 0.8; }
      if (x > -0.067 && x < -0.053 && y > 0.053 && y < 0.0565) { o.c = chrome; o.r = 0.12; o.m = 1; }
      const bA = badge(x, y, z); if (bA > 0.4) { o.c = chrome; o.r = 0.15; o.m = 1; }
      const fd = Math.hypot(x + 0.205, y - 0.022); if (Math.abs(fd - 0.008) < 0.0007) { o.c = black; o.r = 0.8; }
      if (x > 0.232 && x < 0.244 && y > 0.022 && y < 0.03) { o.c = [1, 0.62, 0.12]; o.r = 0.2; o.e = 0.5; }
      if (x < -0.236 && x > -0.248 && y > 0.022 && y < 0.03) { o.c = [0.85, 0.1, 0.08]; o.r = 0.2; o.e = 0.5; }
    }
  };
  const L = loftShell(spec, paint, { U: 106, V: 68, TW: 1024, TH: 512 });
  shell.add(L.outer, L.inner);
  // ---- end caps: grille face and tailgate
  const front = endCap(L.front, XF, 1, (g, P) => {
    const [x0, y0] = P(-0.12, 0.08), [x1, y1] = P(0.12, -0.03); g.fillStyle = `#${colors.body.toString(16).padStart(6, '0')}`; g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    // grille panel with chrome bars and centre lettering, lamp bezels drawn as dark sockets
    const [gx0, gy0] = P(-0.088, 0.054), [gx1, gy1] = P(0.088, 0.006);
    g.fillStyle = '#16171a'; g.beginPath(); g.roundRect(Math.min(gx0, gx1), gy0, Math.abs(gx1 - gx0), gy1 - gy0, 8); g.fill();
    g.fillStyle = '#d9dde1'; for (let i = 0; i < 4; i++) { const [, yy] = P(0, 0.016 + i * 0.0095); const [ax] = P(-0.055, 0), [bx] = P(0.055, 0); g.fillRect(Math.min(ax, bx), yy - 2, Math.abs(bx - ax), 4); }
    g.fillStyle = '#e8e3d6'; g.font = '900 30px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; const [cx, cy] = P(0, 0.047); g.fillText('C R A G W E L D', cx, cy + 10);
    for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.071, 0.032); g.fillStyle = '#0c0c0d'; g.beginPath(); g.arc(lx, ly, 34, 0, Math.PI * 2); g.fill(); const [tx, ty] = P(s * 0.071, 0.008); g.fillStyle = '#f0a020'; g.fillRect(tx - 18, ty - 6, 36, 12); }
    const [vx0, vy0] = P(-0.11, -0.006); const [vx1] = P(0.11, -0.006); g.fillStyle = '#16171a'; g.fillRect(Math.min(vx0, vx1), vy0, Math.abs(vx1 - vx0), 40);
  });
  const rear = endCap(L.rear, XR, -1, (g, P) => {
    g.fillStyle = `#${colors.body.toString(16).padStart(6, '0')}`; g.fillRect(0, 0, 4096, 4096);
    const [ax, ay] = P(-0.13, 0.07); g.fillStyle = `#${colors.accent.toString(16).padStart(6, '0')}`; g.fillRect(0, 0, 4096, ay);
    const [gx0, gy0] = P(-0.08, 0.118), [gx1, gy1] = P(0.08, 0.073); g.fillStyle = '#0d1216'; g.beginPath(); g.roundRect(Math.min(gx0, gx1), gy0, Math.abs(gx1 - gx0), gy1 - gy0, 10); g.fill();
    void ax;
    g.strokeStyle = '#0c0c0d'; g.lineWidth = 3; const [sx0, sy0] = P(-0.095, 0.064), [sx1, sy1] = P(0.095, -0.012); g.strokeRect(Math.min(sx0, sx1), sy0, Math.abs(sx1 - sx0), sy1 - sy0);
    for (const s of [-1, 1]) { const [tx, ty] = P(s * 0.094, 0.036); g.fillStyle = '#c8231b'; g.beginPath(); g.roundRect(tx - 14, ty - 34, 28, 68, 6); g.fill(); g.fillStyle = '#f2f2f2'; g.fillRect(tx - 14, ty + 18, 28, 10); }
    const [px0, py0] = P(0.02, 0.012); g.fillStyle = '#f1eadb'; g.fillRect(px0 - 40, py0 - 18, 80, 36); g.fillStyle = '#2a2a2a'; g.font = '700 22px system-ui'; g.textAlign = 'center'; g.fillText('CRG 76', px0, py0 + 8);
    g.fillStyle = '#16171a'; const [, ry] = P(0, -0.008); g.fillRect(0, ry, 4096, 200);
  }, (g, P) => { g.fillStyle = '#000'; g.fillRect(0, 0, 4096, 4096); for (const s of [-1, 1]) { const [tx, ty] = P(s * 0.094, 0.036); g.fillStyle = '#7a0d08'; g.fillRect(tx - 14, ty - 34, 28, 50); } });
  shell.add(front, rear);
  // ---- headlamps: chrome bezel ring + domed lens set into the grille face
  const chromeM = new THREE.MeshStandardMaterial({ color: 0xe3e6ea, roughness: 0.1, metalness: 1 });
  const lensM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: 0xfff0cc, emissiveIntensity: 0.9, roughness: 0.05, transmission: 0, clearcoat: 1 });
  const bezel = lathe([[0.0105, 0], [0.0128, 0.001], [0.0132, 0.003], [0.0118, 0.0045], [0.0102, 0.004]], 28); bezel.rotateZ(-Math.PI / 2);
  const lens = lathe([[0.001, 0.0045], [0.006, 0.0042], [0.0098, 0.003], [0.0102, 0.0005]], 24); lens.rotateZ(-Math.PI / 2);
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(bezel, chromeM); b.position.set(XF - 0.0002, 0.032, s * 0.071); shell.add(b);
    const l = new THREE.Mesh(lens, lensM); l.position.set(XF - 0.0002, 0.032, s * 0.071); shell.add(l);
  }
  // ---- steel bumpers: chamfered profile swept along a gently wrapped path, winch + shackles
  const steel = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.42, metalness: 0.55 });
  const bProf = new THREE.Shape([[-0.011, -0.012], [0.009, -0.012], [0.011, -0.008], [0.011, 0.01], [0.007, 0.013], [-0.011, 0.013]].map(([a, b]) => new THREE.Vector2(a, b)));
  const sweep = (pts: THREE.Vector3[]) => { const g = new THREE.ExtrudeGeometry(bProf, { steps: 40, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(pts, false, 'centripetal') }); const m = new THREE.Mesh(g, steel); m.castShadow = true; shell.add(m); return m; };
  sweep([V3(0.255, -0.016, -0.125), V3(0.272, -0.016, -0.1), V3(0.276, -0.016, 0), V3(0.272, -0.016, 0.1), V3(0.255, -0.016, 0.125)]);
  sweep([V3(-0.25, -0.018, -0.118), V3(-0.266, -0.018, -0.095), V3(-0.27, -0.018, 0), V3(-0.266, -0.018, 0.095), V3(-0.25, -0.018, 0.118)]);
  const drum = lathe([[0.001, -0.026], [0.012, -0.026], [0.012, -0.022], [0.009, -0.02], [0.009, 0.02], [0.012, 0.022], [0.012, 0.026], [0.001, 0.026]], 24); drum.rotateX(Math.PI / 2);
  const winch = new THREE.Mesh(drum, new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.4 })); winch.position.set(0.291, -0.01, 0); shell.add(winch);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.036, 20, 1, true).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 })); rope.position.copy(winch.position); shell.add(rope);
  const red = new THREE.MeshStandardMaterial({ color: 0xc0281f, roughness: 0.4, metalness: 0.3 });
  for (const s of [-1, 1]) { const sh = new THREE.Mesh(new THREE.TorusGeometry(0.0065, 0.002, 8, 16, Math.PI * 1.4), red); sh.position.set(0.284, -0.026, s * 0.074); sh.rotation.set(0, Math.PI / 2, -Math.PI * 0.2); shell.add(sh); }
  // ---- rock sliders (bent tube), roof rack (bent tube basket), spare carrier, mirrors, wipers
  const blk = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.45, metalness: 0.4 });
  for (const s of [-1, 1]) shell.add(bentTube([V3(-0.086, -0.012, s * 0.098), V3(-0.08, -0.029, s * 0.118), V3(0.08, -0.029, s * 0.118), V3(0.086, -0.012, s * 0.098)], 0.0042, 0.012, blk));
  const ry = 0.146, rz = 0.084;
  shell.add(bentTube([V3(-0.215, ry, -rz), V3(0.0, ry, -rz), V3(0.0, ry, rz), V3(-0.215, ry, rz)], 0.0026, 0.016, blk, true));
  for (let i = 1; i < 4; i++) { const x = -0.215 + i * 0.054; shell.add(bentTube([V3(x, ry, -rz), V3(x, ry, rz)], 0.002, 0, blk)); }
  for (const x of [-0.2, -0.015]) for (const s of [-1, 1]) shell.add(bentTube([V3(x, 0.131, s * 0.09), V3(x, 0.138, s * 0.089), V3(x, ry, s * rz)], 0.0022, 0.004, blk));
  // jerry can: lofted rounded slab with the X stamp
  const can = new THREE.Mesh(lathe([[0.001, -0.014], [0.018, -0.014], [0.02, -0.011], [0.02, 0.011], [0.018, 0.014], [0.001, 0.014]], 4).rotateY(Math.PI / 4).scale(1, 1, 0.42), new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.55, metalness: 0.25 }));
  can.position.set(-0.16, ry + 0.016, 0.042); can.castShadow = true; shell.add(can);
  // light bar on the rack front
  const lb = lathe([[0.001, -0.065], [0.007, -0.065], [0.008, -0.062], [0.008, 0.062], [0.007, 0.065], [0.001, 0.065]], 12); lb.rotateX(Math.PI / 2);
  const lbm = new THREE.Mesh(lb, blk); lbm.position.set(0.004, ry + 0.006, 0); lbm.scale.set(1, 0.8, 1); shell.add(lbm);
  for (let i = 0; i < 5; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.0048, 16).rotateY(Math.PI / 2), lensM); d.position.set(0.0122, ry + 0.006, -0.05 + i * 0.025); shell.add(d); }
  // swing-out spare carrier + spare
  shell.add(bentTube([V3(-0.258, -0.004, 0.092), V3(-0.284, 0.0, 0.092), V3(-0.29, 0.05, 0.06), V3(-0.29, 0.06, -0.02)], 0.0035, 0.012, blk));
  const sp = tireGeometry(0.058, 0.042, 6, 20); sp.rotateZ(Math.PI / 2);
  const spare = new THREE.Mesh(sp, surface('rubber', { color: 0x1a1a1a, repeat: [2, 2], normalScale: 1.6 })); spare.position.set(-0.306, 0.05, 0.012); spare.castShadow = true; shell.add(spare);
  const spr = new THREE.Mesh(rimGeometry(0.036, 0.04).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.6 })); spr.position.copy(spare.position); shell.add(spr);
  for (const s of [-1, 1]) {
    shell.add(bentTube([V3(0.064, 0.068, s * 0.097), V3(0.07, 0.074, s * 0.108), V3(0.072, 0.082, s * 0.114)], 0.0016, 0.004, blk));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.01, 16, 12), blk); head.scale.set(0.45, 0.75, 1); head.position.set(0.072, 0.088, s * 0.116); shell.add(head);
  }
  for (const z of [-0.04, 0.025]) shell.add(bentTube([V3(0.074, 0.074, z), V3(0.06, 0.098, z + 0.02)], 0.0011, 0, blk));
  shell.add(bentTube([V3(-0.238, 0.072, -0.088), V3(-0.242, 0.22, -0.09)], 0.001, 0, blk));
}

// ====================================================================================== UTB
/** Griphold UTB: Capra-style unlimited trail buggy. Continuous bent-tube cage (rounded bends, no joints),
 *  a sculpted domed hood/nose panel, roof skin, aluminium doors, seats + driver, rear tyre carrier. */
export function buildUTBBody(shell: THREE.Group, colors: { body: number; accent: number }) {
  const cageM = new THREE.MeshPhysicalMaterial({ color: colors.accent, roughness: 0.35, metalness: 0.5, clearcoat: 0.5 });
  const paintM = new THREE.MeshPhysicalMaterial({ color: colors.body, roughness: 0.38, metalness: 0.12, clearcoat: 0.85, clearcoatRoughness: 0.15, side: THREE.DoubleSide });
  const alu = new THREE.MeshStandardMaterial({ color: 0xc8cdd3, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
  const R = 0.0046, F = 0.02;
  // side loops: nose → hood rail → A-pillar → roof → C-pillar → rear deck → tail → floor rail → back to nose
  const sideLoop = (s: number) => [
    V3(0.262, -0.004, s * 0.04), V3(0.205, 0.046, s * 0.058), V3(0.078, 0.07, s * 0.078), V3(0.02, 0.138, s * 0.068),
    V3(-0.105, 0.138, s * 0.068), V3(-0.152, 0.074, s * 0.08), V3(-0.24, 0.07, s * 0.07), V3(-0.262, 0.0, s * 0.058),
    V3(-0.112, -0.018, s * 0.08), V3(0.112, -0.018, s * 0.08),
  ];
  for (const s of [-1, 1]) {
    shell.add(bentTube(sideLoop(s), R, F, cageM, true));
    shell.add(bentTube([V3(0.078, 0.07, s * 0.078), V3(0.112, -0.018, s * 0.08)], R * 0.9, 0, cageM));       // door front post
    shell.add(bentTube([V3(-0.152, 0.074, s * 0.08), V3(-0.112, -0.018, s * 0.08)], R * 0.9, 0, cageM));    // door rear post
    shell.add(bentTube([V3(0.078, 0.07, s * 0.078), V3(-0.152, 0.074, s * 0.08)], R * 0.85, 0, cageM));      // door bar
    shell.add(bentTube([V3(-0.105, 0.138, s * 0.068), V3(-0.112, -0.018, s * 0.08)], R * 0.8, 0, cageM));    // B-pillar
  }
  // hoops across: bent in plan so the cage reads as one welded structure
  const hoop = (x: number, y: number, hw: number, drop = 0) => shell.add(bentTube([V3(x, y - drop, -hw), V3(x, y, -hw * 0.6), V3(x, y, hw * 0.6), V3(x, y - drop, hw)], R * 0.85, 0.012, cageM));
  hoop(0.262, -0.004, 0.04); hoop(0.205, 0.046, 0.058); hoop(0.02, 0.138, 0.068, 0.004); hoop(-0.105, 0.138, 0.068, 0.004); hoop(-0.24, 0.07, 0.07); hoop(-0.262, 0.0, 0.058);
  shell.add(bentTube([V3(0.02, 0.138, -0.068), V3(-0.105, 0.138, 0.068)], R * 0.7, 0, cageM));
  // sculpted panels (parametric, slightly domed)
  const panel = (c00: THREE.Vector3, c10: THREE.Vector3, c11: THREE.Vector3, c01: THREE.Vector3, dome: number, m: THREE.Material, nU = 18, nV = 12) => {
    const n = c10.clone().sub(c00).cross(c01.clone().sub(c00)).normalize();
    const g = new THREE.BufferGeometry(); const P: number[] = [], UVs: number[] = [], I: number[] = [];
    for (let i = 0; i <= nU; i++) for (let j = 0; j <= nV; j++) {
      const u = i / nU, v = j / nV;
      const p = c00.clone().multiplyScalar((1 - u) * (1 - v)).add(c10.clone().multiplyScalar(u * (1 - v))).add(c11.clone().multiplyScalar(u * v)).add(c01.clone().multiplyScalar((1 - u) * v));
      p.addScaledVector(n, dome * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
      P.push(p.x, p.y, p.z); UVs.push(u, v);
    }
    for (let i = 0; i < nU; i++) for (let j = 0; j < nV; j++) { const a = i * (nV + 1) + j, b = a + 1, c = a + nV + 1, d = c + 1; I.push(a, c, b, b, c, d); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2)); g.setIndex(I); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; shell.add(mesh); return mesh;
  };
  panel(V3(0.258, 0.0, -0.038), V3(0.258, 0.0, 0.038), V3(0.203, 0.05, 0.056), V3(0.203, 0.05, -0.056), 0.006, paintM);
  panel(V3(0.203, 0.05, -0.056), V3(0.203, 0.05, 0.056), V3(0.08, 0.074, 0.076), V3(0.08, 0.074, -0.076), 0.01, paintM);
  panel(V3(0.018, 0.142, -0.066), V3(0.018, 0.142, 0.066), V3(-0.103, 0.142, 0.066), V3(-0.103, 0.142, -0.066), 0.006, paintM);
  for (const s of [-1, 1]) panel(V3(0.11, -0.016, s * 0.082), V3(-0.11, -0.016, s * 0.082), V3(-0.15, 0.072, s * 0.082), V3(0.076, 0.068, s * 0.08), 0.004 * s, alu);
  panel(V3(0.11, -0.014, -0.078), V3(0.11, -0.014, 0.078), V3(-0.11, -0.014, 0.078), V3(-0.11, -0.014, -0.078), 0, dark, 4, 4);
  panel(V3(-0.152, 0.077, -0.078), V3(-0.152, 0.077, 0.078), V3(-0.238, 0.073, 0.068), V3(-0.238, 0.073, -0.068), 0, dark, 4, 4);
  // hood louvres + number board decal
  const dc = document.createElement('canvas'); dc.width = 256; dc.height = 128; const dg = dc.getContext('2d')!;
  dg.fillStyle = '#f1eadb'; dg.beginPath(); dg.ellipse(128, 64, 100, 54, 0, 0, Math.PI * 2); dg.fill(); dg.fillStyle = '#1c1c1e'; dg.font = 'italic 900 84px "Barlow Condensed", sans-serif'; dg.textAlign = 'center'; dg.fillText('17', 128, 94);
  const dt = new THREE.CanvasTexture(dc); dt.colorSpace = THREE.SRGBColorSpace;
  const num = panel(V3(0.17, 0.0575, -0.03), V3(0.17, 0.0575, 0.03), V3(0.12, 0.0665, 0.03), V3(0.12, 0.0665, -0.03), 0.006, new THREE.MeshStandardMaterial({ map: dt, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }), 6, 4);
  void num;
  // seats (lofted buckets) + driver
  for (const s of [-1, 1]) {
    const seat = new THREE.Mesh(lathe([[0.001, 0], [0.02, 0.0], [0.024, 0.006], [0.024, 0.05], [0.02, 0.058], [0.001, 0.058]], 16), dark);
    seat.scale.set(0.9, 1, 1); seat.rotation.z = 0.2; seat.position.set(-0.065, -0.01, s * 0.036); shell.add(seat);
  }
  const suit = new THREE.MeshStandardMaterial({ color: 0x2a5aa8, roughness: 0.7 });
  const torso = new THREE.Mesh(lathe([[0.001, 0], [0.016, 0.002], [0.019, 0.02], [0.017, 0.04], [0.008, 0.05], [0.001, 0.05]], 16), suit); torso.rotation.z = 0.25; torso.position.set(-0.05, 0.006, -0.036); shell.add(torso);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 20, 16), new THREE.MeshPhysicalMaterial({ color: 0xf1eadb, roughness: 0.25, clearcoat: 1 })); helmet.position.set(-0.058, 0.074, -0.036); shell.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.0168, 20, 12, -0.9, 1.8, 1.1, 0.7), new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.05, metalness: 0.6 })); visor.position.copy(helmet.position); visor.rotation.y = Math.PI / 2; shell.add(visor);
  for (const dz of [-0.014, 0.014]) shell.add(bentTube([V3(-0.052, 0.046, -0.036 + dz), V3(-0.02, 0.036, -0.036 + dz * 1.2), V3(0.012, 0.05, -0.036 + dz * 0.6)], 0.0045, 0.01, suit));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0024, 8, 24), dark); wheel.position.set(0.016, 0.052, -0.036); wheel.rotation.set(0, Math.PI / 2, 0.5); shell.add(wheel);
  // roof light pod (lathed bar), tail lamps, spare tyre on the deck
  const lens = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.1, roughness: 0.1 });
  const pod = lathe([[0.001, -0.05], [0.007, -0.05], [0.008, -0.047], [0.008, 0.047], [0.007, 0.05], [0.001, 0.05]], 12); pod.rotateX(Math.PI / 2);
  const pm = new THREE.Mesh(pod, dark); pm.position.set(0.024, 0.152, 0); shell.add(pm);
  for (let i = 0; i < 4; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 16).rotateY(Math.PI / 2), lens); d.position.set(0.0322, 0.152, -0.036 + i * 0.024); shell.add(d); }
  const sp = tireGeometry(0.058, 0.042, 6, 20);
  const spare = new THREE.Mesh(sp, surface('rubber', { color: 0x1a1a1a, repeat: [2, 2], normalScale: 1.6 })); spare.position.set(-0.196, 0.098, 0); spare.castShadow = true; shell.add(spare);
  const spr = new THREE.Mesh(rimGeometry(0.036, 0.04), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.6 })); spr.position.copy(spare.position); shell.add(spr);
  void mergeGeometries;
}
