// Procedural PBR material library: tileable noise textures with matching normal and roughness maps,
// generated once at startup on small canvases (mobile-friendly sizes) and shared between materials.
// Everything here is original procedural art; finished texture sets can replace any entry by key.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- tileable value noise
function makeNoise(seed: number, period: number) {
  const grid = new Float32Array(period * period);
  let s = seed >>> 0;
  for (let i = 0; i < grid.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; grid[i] = s / 4294967296; }
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const g = (i: number, j: number) => grid[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

/** Fractal noise over [0,1)², seamless at the edges. */
function fbm(seed: number, base: number, octaves: number) {
  const layers = Array.from({ length: octaves }, (_, i) => ({ n: makeNoise(seed + i * 101, base << i), f: base << i, a: Math.pow(0.5, i) }));
  const norm = layers.reduce((t, l) => t + l.a, 0);
  return (u: number, v: number) => layers.reduce((t, l) => t + l.n(u * l.f, v * l.f) * l.a, 0) / norm;
}

interface Px { r: number; g: number; b: number; h: number; rough: number }

export interface TexSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }

/** Rasterise a sampler into colour, normal (from height) and roughness textures. */
function genTexSet(size: number, strength: number, sample: (u: number, v: number) => Px): TexSet {
  const col = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = sample(x / size, y / size);
    const i = y * size + x;
    col[i * 4] = p.r * 255; col[i * 4 + 1] = p.g * 255; col[i * 4 + 2] = p.b * 255; col[i * 4 + 3] = 255;
    const rr = Math.max(0, Math.min(1, p.rough)) * 255;
    rough[i * 4] = rr; rough[i * 4 + 1] = rr; rough[i * 4 + 2] = rr; rough[i * 4 + 3] = 255;
    hgt[i] = p.h;
  }
  const nrm = new Uint8ClampedArray(size * size * 4);
  const H = (x: number, y: number) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    nrm[i] = (-dx / l * 0.5 + 0.5) * 255; nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255; nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
  }
  const toTex = (data: Uint8ClampedArray, srgb: boolean) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d')!.putImageData(new ImageData(data, size, size), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: toTex(col, true), normalMap: toTex(nrm, false), roughnessMap: toTex(rough, false) };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const hex = (h: number) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];

// ---------------------------------------------------------------- texture recipes
const recipes: Record<string, () => TexSet> = {
  concrete: () => {
    const big = fbm(11, 4, 4), fine = fbm(12, 32, 3), crack = fbm(13, 6, 3);
    return genTexSet(512, 2.2, (u, v) => {
      const b = big(u, v), f = fine(u, v);
      const c = Math.abs(crack(u, v) - 0.5) < 0.0025 ? 0.9 : 1;
      const sm = Math.min(1, Math.max(0, (f - 0.5) / 0.35));
      const speck = lerp(1.03, 0.94, sm * sm * (3 - 2 * sm));
      const t = lerp(0.55, 0.64, b) * speck * c;
      return { r: t * 1.02, g: t, b: t * 0.96, h: f * 0.5 + b * 0.2 - (c < 1 ? 0.3 : 0), rough: lerp(0.6, 0.86, f) - (b > 0.62 ? 0.12 : 0) };
    });
  },
  wood: () => {
    const warp = fbm(21, 4, 3), fine = fbm(22, 64, 2), tone = fbm(23, 8, 2);
    return genTexSet(512, 1.6, (u, v) => {
      const strip = Math.floor(u * 8);
      const sv = (strip * 0.37) % 1;
      const grain = Math.sin((v * 28 + warp(u, v) * 9 + strip * 3.1) * Math.PI * 2) * 0.5 + 0.5;
      const edge = Math.min(u * 8 - strip, 1 - (u * 8 - strip)) < 0.02 ? 0.82 : 1;
      const base = lerp(0.8, 0.95, sv) * lerp(0.88, 1.03, tone(u, v));
      const g = lerp(0.88, 1.0, grain) * edge * lerp(0.95, 1.03, fine(u, v));
      return { r: base * g * 0.98, g: base * g * 0.8, b: base * g * 0.58, h: grain * 0.25 + (edge < 1 ? -0.5 : 0), rough: lerp(0.5, 0.72, grain) };
    });
  },
  planks: () => {
    const warp = fbm(31, 4, 3), fine = fbm(32, 48, 2), weather = fbm(33, 6, 3);
    return genTexSet(512, 2.4, (u, v) => {
      const row = Math.floor(v * 6), fv = v * 6 - row;
      const off = (row * 0.61) % 1;
      const seam = fv < 0.04 || fv > 0.96 || Math.abs(((u + off) % 0.5) - 0.0) < 0.004;
      const grain = Math.sin((u * 20 + warp(u, v) * 6 + row) * Math.PI * 2) * 0.5 + 0.5;
      const w = weather(u, v);
      const base = lerp(0.48, 0.66, (row * 0.43) % 1) * lerp(0.8, 1.05, w);
      const t = seam ? 0.25 : base * lerp(0.9, 1.0, grain) * lerp(0.95, 1.04, fine(u, v));
      return { r: t * 0.95, g: t * 0.78, b: t * 0.58, h: seam ? -0.8 : grain * 0.3, rough: seam ? 1 : lerp(0.68, 0.88, w) };
    });
  },
  paint: () => {
    const peel = fbm(41, 64, 2), wear = fbm(42, 6, 4);
    return genTexSet(256, 0.9, (u, v) => {
      const w = wear(u, v);
      const ww = Math.min(1, Math.max(0, (w - 0.62) / 0.2));
      const t = lerp(0.95, 1.0, peel(u, v)) * lerp(1, 0.96, ww);
      return { r: t, g: t, b: t, h: peel(u, v) * 0.4, rough: lerp(0.32, 0.5, peel(u, v)) + ww * 0.12 };
    });
  },
  plastic: () => {
    const stip = fbm(51, 96, 2);
    return genTexSet(256, 1.2, (u, v) => {
      const s = stip(u, v);
      const t = lerp(0.94, 1.0, s);
      return { r: t, g: t, b: t, h: s * 0.6, rough: lerp(0.45, 0.62, s) };
    });
  },
  rubber: () => {
    const n = fbm(61, 64, 3);
    return genTexSet(256, 1.0, (u, v) => {
      const s = n(u, v);
      const t = lerp(0.9, 1.0, s);
      return { r: t, g: t, b: t, h: s, rough: lerp(0.8, 0.95, s) };
    });
  },
  dirt: () => {
    const big = fbm(71, 4, 4), mid = fbm(72, 16, 3), fine = fbm(73, 64, 2), peb = fbm(74, 48, 1);
    return genTexSet(512, 3.0, (u, v) => {
      const p = peb(u, v);
      const pebble = p > 0.78 ? (p - 0.78) * 4 : 0;
      const t = lerp(0.82, 1.06, big(u, v)) * lerp(0.9, 1.04, mid(u, v)) * lerp(0.94, 1.03, fine(u, v)) * (pebble > 0 ? lerp(1.0, 1.25, pebble) : 1);
      return { r: t, g: t * 0.98, b: t * 0.94, h: mid(u, v) * 0.6 + fine(u, v) * 0.3 + pebble * 0.9, rough: 0.92 - pebble * 0.15 };
    });
  },
  grass: () => {
    const big = fbm(81, 4, 3), blades = fbm(82, 128, 1), dry = fbm(83, 8, 3);
    return genTexSet(512, 2.0, (u, v) => {
      const b = blades(u * 0.35, v * 1.6);
      const d = dry(u, v);
      // smooth blend between green and dry patches (no hard-edged camouflage blotches)
      const k = Math.min(1, Math.max(0, (d - 0.5) / 0.25)) * 0.6;
      const r = lerp(0.4, 0.58, k), g = lerp(0.53, 0.56, k), bb = lerp(0.25, 0.32, k);
      const t = lerp(0.8, 1.08, b) * lerp(0.92, 1.03, big(u, v));
      return { r: r * t, g: g * t, b: bb * t, h: b, rough: 0.95 };
    });
  },
  fabric: () => {
    return genTexSet(256, 1.4, (u, v) => {
      const wx = Math.sin(u * 256 * Math.PI) * 0.5 + 0.5, wy = Math.sin(v * 256 * Math.PI) * 0.5 + 0.5;
      const h = ((Math.floor(u * 128) + Math.floor(v * 128)) % 2 ? wx : wy);
      const t = lerp(0.9, 1.0, h);
      return { r: t, g: t, b: t, h, rough: 0.85 };
    });
  },
  skin: () => {
    const mott = fbm(91, 8, 3), pore = fbm(92, 128, 1);
    return genTexSet(256, 0.7, (u, v) => {
      const m = mott(u, v), p = pore(u, v);
      const t = lerp(0.94, 1.03, m) * (p > 0.8 ? 0.97 : 1);
      return { r: t * 1.0, g: t * lerp(0.96, 0.99, m), b: t * lerp(0.94, 0.98, m), h: p * 0.3 + m * 0.2, rough: lerp(0.5, 0.62, p) };
    });
  },
  corrugated: () => genTexSet(128, 3.5, (u, v) => {
    const r = Math.sin(u * 16 * Math.PI * 2) * 0.5 + 0.5;
    const t = lerp(0.85, 1.0, r);
    return { r: t, g: t, b: t, h: r, rough: lerp(0.5, 0.7, r) };
  }),
  drywall: () => {
    const n = fbm(101, 32, 3), big = fbm(102, 3, 2);
    return genTexSet(256, 0.6, (u, v) => {
      const t = lerp(0.95, 1.0, n(u, v)) * lerp(0.97, 1.01, big(u, v));
      return { r: t, g: t, b: t, h: n(u, v), rough: 0.9 };
    });
  },
  bark: () => {
    const n = fbm(111, 8, 4);
    return genTexSet(256, 3.0, (u, v) => {
      const ridge = Math.abs(Math.sin((u * 10 + n(u, v) * 3) * Math.PI));
      const t = lerp(0.6, 1.0, ridge);
      return { r: 0.42 * t, g: 0.31 * t, b: 0.22 * t, h: ridge, rough: 0.95 };
    });
  },
  slotted: () => {
    // galvanised slotted-angle steel for shelving uprights
    const n = fbm(131, 32, 2);
    return genTexSet(256, 3.0, (u, v) => {
      const cv = (v * 8) % 1, cu = u;
      const slot = Math.abs(cu - 0.5) < 0.12 && Math.abs(cv - 0.5) < 0.3;
      const t = slot ? 0.08 : lerp(0.62, 0.74, n(u, v));
      return { r: t, g: t * 1.01, b: t * 1.04, h: slot ? -1 : 0.1 * n(u, v), rough: slot ? 1 : lerp(0.35, 0.5, n(u, v)) };
    });
  },
  pegboard: () => {
    const base = fbm(121, 16, 2);
    return genTexSet(256, 3.0, (u, v) => {
      const cu = (u * 8) % 1 - 0.5, cv = (v * 8) % 1 - 0.5;
      const hole = Math.hypot(cu, cv) < 0.12;
      const t = hole ? 0.15 : lerp(0.68, 0.76, base(u, v));
      return { r: t * 1.12, g: t * 0.86, b: t * 0.58, h: hole ? -1 : 0.2 * base(u, v), rough: hole ? 1 : 0.8 };
    });
  },
};

const cache = new Map<string, TexSet>();
export function texSet(key: keyof typeof recipes): TexSet {
  let t = cache.get(key);
  if (!t) { t = recipes[key](); cache.set(key, t); }
  return t;
}

/** A texture set with its own repeat (the images are shared). */
function repeatSet(key: keyof typeof recipes, rx: number, ry: number) {
  const base = texSet(key);
  const c = (t: THREE.Texture) => { const n = t.clone(); n.repeat.set(rx, ry); n.needsUpdate = true; return n; };
  return { map: c(base.map), normalMap: c(base.normalMap), roughnessMap: c(base.roughnessMap) };
}

export type Surface = 'slotted' | 'concrete' | 'wood' | 'planks' | 'paint' | 'plastic' | 'rubber' | 'dirt' | 'grass' | 'fabric' | 'skin' | 'corrugated' | 'drywall' | 'bark' | 'pegboard';

export interface SurfaceOpts { color?: number; repeat?: [number, number]; metalness?: number; roughness?: number; normalScale?: number; envMapIntensity?: number; side?: THREE.Side }

/** Physically based material for a surface type. Colour multiplies the (mostly neutral) texture. */
export function surface(kind: Surface, o: SurfaceOpts = {}) {
  const [rx, ry] = o.repeat ?? [1, 1];
  const t = repeatSet(kind, rx, ry);
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    side: o.side ?? THREE.FrontSide,
  });
  const ns = o.normalScale ?? 1;
  m.normalScale.set(ns, ns);
  if (o.envMapIntensity !== undefined) m.envMapIntensity = o.envMapIntensity;
  return m;
}

// ---------------------------------------------------------------- geometry helpers
/** Rounded box: removes the hard "primitive" silhouette from every block in the scene. */
export function roundedBox(w: number, h: number, d: number, radius?: number) {
  const r = Math.min(radius ?? 0.015, Math.min(w, h, d) * 0.3);
  if (r < 0.0015) return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, 2, r);
}

/** Lathe from (radius, y) pairs — for bins, stool seats, lamp shades, tires, rims, cups. */
export function lathe(points: [number, number][], segments = 28) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

// ---------------------------------------------------------------- image-based lighting
/** Soft indoor reflections so plastic, metal and paint read as real materials. */
export function roomEnvironment(renderer: THREE.WebGLRenderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return env;
}

/** Outdoor reflections from a simple sky/ground gradient scene. */
const envCache = new Map<string, THREE.Texture>();
/** Sky-gradient environment map (PMREM). Cached: every venue shares the same few. */
export function skyEnvironment(renderer: THREE.WebGLRenderer, top = 0x7fb2e5, horizon = 0xdfe9ee, ground = 0x8a7350) {
  const key = `${top}:${horizon}:${ground}`;
  const hit = envCache.get(key); if (hit) return hit;
  const env = buildSkyEnvironment(renderer, top, horizon, ground);
  envCache.set(key, env);
  return env;
}
function buildSkyEnvironment(renderer: THREE.WebGLRenderer, top: number, horizon: number, ground: number) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const colors: number[] = [];
  const pos = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) c.setHex(horizon).lerp(new THREE.Color(top), Math.pow(y, 0.6)); else c.setHex(horizon).lerp(new THREE.Color(ground), Math.min(1, -y * 3));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 5) }));
  sun.position.set(-5, 7, 4); s.add(sun);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return env;
}

export const COLORS = { hex, clamp01 };

/** RC tire: lathe body with rounded shoulders plus merged pin/knob tread, centred on the axle (axis = y). */
export function tireGeometry(radius: number, width: number, knobRows = 4, knobsPerRow = 26) {
  const r0 = radius * 0.62, w = width / 2, sh = radius * 0.16;
  const prof: [number, number][] = [
    [r0, -w], [radius - sh, -w], [radius - sh * 0.35, -w + sh * 0.25], [radius - sh * 0.1, -w + sh * 0.7], [radius - sh * 0.1, w - sh * 0.7],
    [radius - sh * 0.35, w - sh * 0.25], [radius - sh, w], [r0, w],
  ];
  const parts: THREE.BufferGeometry[] = [lathe(prof, 40)];
  const kh = radius * 0.08, kw = Math.max(0.004, width / (knobRows * 1.9));
  for (let row = 0; row < knobRows; row++) {
    const y = -w + sh * 0.6 + (row + 0.5) * ((width - sh * 1.2) / knobRows);
    for (let k = 0; k < knobsPerRow; k++) {
      const a = (k / knobsPerRow) * Math.PI * 2 + (row % 2) * (Math.PI / knobsPerRow);
      const knob = new THREE.BoxGeometry(kw, kw * 1.1, kh);
      knob.translate(0, 0, radius - sh * 0.1 + kh * 0.35);
      knob.rotateY(a);
      knob.translate(0, y, 0);
      parts.push(knob);
    }
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}

/** Dished 5-spoke wheel rim, axis = y. */
export function rimGeometry(radius: number, width: number) {
  const w = width / 2;
  const parts: THREE.BufferGeometry[] = [
    lathe([[radius * 0.98, -w], [radius, -w * 0.9], [radius, w * 0.9], [radius * 0.98, w], [radius * 0.9, w], [radius * 0.9, -w], [radius * 0.98, -w]], 32),
    lathe([[0.001, w * 0.55], [radius * 0.22, w * 0.55], [radius * 0.25, w * 0.35], [radius * 0.22, w * 0.15], [0.001, w * 0.15]], 20),
  ];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.BoxGeometry(radius * 0.16, width * 0.18, radius * 0.72);
    s.translate(0, w * 0.4, radius * 0.55);
    s.rotateY((i / 5) * Math.PI * 2);
    parts.push(s);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}
