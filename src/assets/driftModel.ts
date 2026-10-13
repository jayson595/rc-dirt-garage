// Slideway RD-1: a modern 1/10 RWD drift chassis wearing the "Kanjo '89" body — an original late-80s
// Japanese fastback coupe, sculpted as one lofted shell (wedge nose, long hood with pop-up lamp lids,
// raked screen, fastback glass, ducktail deck, bolted-on overfenders) and painted per texel: carbon hood,
// two-tone white/charcoal, red hockey-stick stripe, door number, sponsor decals, tinted glass with a
// screen banner, seams, vents and lamps. Underneath: carbon deck, A-arms, big-angle knuckles, deep-dish
// six-spoke wheels on hard plastic drift tyres with negative camber, and LED lights.
// Frame: x forward, y up, z right; origin on the ground under the centre of mass.
import * as THREE from 'three';
import { batchStatic } from './staticBatch';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DRIFT_SPEC } from '../sim/DriftSim';
import { lathe, roundedBox } from './materials';
import { bentTube, endCap, hex3, loftShell, Painter, profile, ShellSpec, smax, sstep } from './crawlerBodies';

const S = DRIFT_SPEC;
export const DRIFT_COLORS = { body: 0xf1f0ec, lower: 0x26282c, stripe: 0xd2232a, stripe2: 0x1f3f8f };
export const DRIFT_BODY_NAME = "Kanjo '89";

export interface DriftModel {
  root: THREE.Group;
  pose(sim: { x: number; z: number; psi: number; steer: number; spinF: number; spinR: number; bodyRoll: number; bodyPitch: number }, brake?: boolean): void;
  rest(): void;
}

const R = S.wheelR;                 // 0.0315
const FX = S.a, RX = -S.b;          // axle x relative to the CG
const TZ = 0.086;                   // wheel centre |z|
const MID = (FX + RX) / 2;          // body is built about the axle midpoint
const ARCH = { x: 0.129, y: 0, r: 0.0405 };
const archTop = (x: number) => { let t = -1; for (const ax of [ARCH.x, -ARCH.x]) { const dx = x - ax; if (Math.abs(dx) < ARCH.r) t = Math.max(t, ARCH.y + Math.sqrt(ARCH.r * ARCH.r - dx * dx)); } return t; };

/** Text → alpha sampler (u, v in 0..1, v down). */
function decal(text: string, font: string, w = 512, h = 96, align: CanvasTextAlign = 'center') {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff'; g.font = font; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(text, align === 'center' ? w / 2 : 4, h / 2 + 2);
  const d = g.getImageData(0, 0, w, h).data;
  return (u: number, v: number) => (u < 0 || u >= 1 || v < 0 || v >= 1 ? 0 : d[(Math.floor(v * h) * w + Math.floor(u * w)) * 4 + 3] / 255);
}

// ====================================================================================== body shell
function buildKanjoBody(shell: THREE.Group, col = DRIFT_COLORS) {
  const XF = 0.222, XR = -0.222;
  const top = profile([[XF, 0.03], [0.214, 0.036], [0.2, 0.041], [0.13, 0.05], [0.07, 0.055], [0.052, 0.057], [0.04, 0.064],
    [-0.012, 0.093], [-0.026, 0.097], [-0.088, 0.096], [-0.1, 0.093], [-0.163, 0.066], [-0.172, 0.062], [-0.2, 0.061], [-0.212, 0.064], [-0.217, 0.058], [XR, 0.044]], 3);
  const belt = profile([[XF, 0.028], [0.214, 0.033], [0.2, 0.038], [0.13, 0.047], [0.06, 0.052], [-0.05, 0.054], [-0.12, 0.058], [-0.2, 0.058], [-0.214, 0.056], [XR, 0.043]], 3);
  const cab = (x: number) => sstep(0.058, 0.044, x) * sstep(-0.176, -0.164, x);
  // plan-view taper at the ends so the nose and tail are rounded
  const W0 = 0.0915;
  const Wx = (x: number) => W0 - 0.011 * Math.pow(sstep(0.17, XF, x), 1.5) - 0.007 * Math.pow(sstep(-0.18, XR, x), 1.5);
  const bot = (x: number) => {
    let b = -0.0185 + 0.006 * sstep(0.2, XF, x) + 0.004 * sstep(-0.205, XR, x);
    const at = archTop(x); if (at > -1) b = smax(b, at, 0.006);
    return b;
  };
  // bolt-on overfenders: a crisp swell around each arch that fades out by the shoulder
  const flare = (x: number, y: number) => {
    let f = 0;
    for (const ax of [ARCH.x, -ARCH.x]) { const d = Math.hypot((x - ax) * 0.92, y - ARCH.y); f = Math.max(f, sstep(ARCH.r + 0.03, ARCH.r + 0.004, d)); }
    return (ARCH.x > 0 ? 0.0075 : 0) * f * (1 - sstep(0.036, 0.05, y));
  };
  const spec: ShellSpec = {
    xF: XF, xR: XR, endRound: 0.016,
    half(x) {
      const W = Wx(x), b = bot(x), bl = belt(x), t = Math.max(top(x), bl + 0.002), c = cab(x);
      const wTop = THREE.MathUtils.lerp(W - 0.016, 0.066 + 0.012 * sstep(-0.02, 0.05, x), c);
      const y1 = THREE.MathUtils.lerp(b, bl, 0.42);
      return [
        [W + flare(x, b) - 0.002, b],
        [W + flare(x, y1) + 0.0015, y1],
        [W + flare(x, bl - 0.008) + 0.0008, bl - 0.008],
        [W - 0.0005, bl],
        [THREE.MathUtils.lerp(W - 0.007, wTop + 0.006, c), THREE.MathUtils.lerp(bl + 0.0018, bl + 0.004, c)],
        [THREE.MathUtils.lerp(W * 0.62, wTop, c), THREE.MathUtils.lerp(t - 0.0012, t - 0.009, c)],
        [THREE.MathUtils.lerp(W * 0.3, wTop - 0.016, c), t - 0.0004],
        [0, t],
      ];
    },
  };
  const white = hex3(col.body), lower = hex3(col.lower), red = hex3(col.stripe), blue = hex3(col.stripe2);
  const glass: [number, number, number] = [0.035, 0.045, 0.06], black: [number, number, number] = [0.05, 0.05, 0.055], chrome: [number, number, number] = [0.85, 0.87, 0.9];
  const banner = decal('KANJO HALL · SLIDEWAY', '800 54px "Barlow Condensed", "Arial Narrow", sans-serif', 1024, 80);
  const brand = decal('SLIDEWAY', 'italic 900 70px "Barlow Condensed", "Arial Narrow", sans-serif', 512, 96);
  const tyres = decal('GRIPHOLD', '900 60px "Barlow Condensed", "Arial Narrow", sans-serif', 512, 80);
  const num = decal('07', 'italic 900 88px "Barlow Condensed", "Arial Narrow", sans-serif', 160, 96);
  const paint: Painter = (x, y, z, o) => {
    const az = Math.abs(z), W = Wx(x), bl = belt(x), t = top(x), c = cab(x), right = z > 0;
    o.c = white; o.r = 0.26; o.m = 0.08;
    const side = az > W - 0.005;
    // ---- greenhouse
    if (y > bl + 0.0025 && c > 0.5) {
      o.c = white;
      const wTop = THREE.MathUtils.lerp(W - 0.016, 0.066 + 0.012 * sstep(-0.02, 0.05, x), c);
      const onSide = az > wTop - 0.004 && y < t - 0.006;
      const isGlass = () => { o.c = glass; o.r = 0.04; o.m = 0.4; };
      // windscreen (front of the cabin) with a banner across its top; blacked-out A-pillars
      const aLine = 0.046 - (y - bl) * 1.38;
      if (x > aLine - 0.012 && x < 0.056 && y > bl + 0.004) {
        if (az < wTop - 0.007) {
          isGlass();
          if (y > 0.0868) { o.c = blue; o.r = 0.3; o.m = 0.05; const a = banner((0.058 - z) / 0.116, 1 - (y - 0.0868) / 0.0072); if (a > 0.45) o.c = [0.96, 0.96, 0.94]; }
        } else { o.c = black; o.r = 0.45; }
      }
      // side glass: door glass + quarter glass, B-pillar blacked out, following the A and C pillars
      if (onSide && y > bl + 0.005) {
        const cLine = -0.158 + (y - bl) * 1.3;   // fastback C-pillar
        if (x < aLine - 0.016 && x > cLine + 0.004) { isGlass(); if (Math.abs(x + 0.064) < 0.0035) { o.c = black; o.r = 0.5; } }
      }
      // fastback rear glass
      if (x < -0.104 && x > -0.162 && az < wTop - 0.01 && y > bl + 0.006) isGlass();
      // roof gutter line
      if (onSide && Math.abs(y - (t - 0.0075)) < 0.0006) { o.c = black; o.r = 0.6; }
      return;
    }
    // ---- carbon hood with white pop-up lamp lids
    if (!side && x > 0.06 && x < 0.208 && az < W - 0.011 && y > bl - 0.001) {
      const wv = (Math.floor((x + 1) * 520) + Math.floor((z + 1) * 520)) % 2, fine = 0.5 + 0.5 * Math.sin((wv ? x : z) * 3300);
      o.c = [0.07 + 0.035 * fine, 0.07 + 0.035 * fine, 0.075 + 0.04 * fine]; o.r = 0.2; o.m = 0.35;
      // hood scoop vents
      if (x > 0.09 && x < 0.13 && az > 0.012 && az < 0.04 && Math.sin(x * 1100) > 0.55) { o.c = [0.02, 0.02, 0.02]; o.r = 0.9; }
    }
    if (!side && x > 0.168 && x < 0.204 && az > 0.042 && az < W - 0.012 && (x < 0.1695 || x > 0.2025 || az < 0.0435 || az > W - 0.0135)) { o.c = [0.01, 0.01, 0.012]; o.r = 0.8; }
    // hood edge seam
    if (!side && x > 0.055 && x < 0.21 && Math.abs(az - (W - 0.011)) < 0.0005) { o.c = black; o.r = 0.8; }
    // deck-lid seams + ducktail lip line
    if (!side && x < -0.172 && x > -0.216 && Math.abs(az - (W - 0.012)) < 0.0005) { o.c = black; o.r = 0.8; }
    if (!side && Math.abs(x + 0.172) < 0.0006 && az < W - 0.012) { o.c = black; o.r = 0.8; }
    // ---- sides
    if (side) {
      // two-tone: charcoal below the swage line, side skirt
      if (y < -0.0025) { o.c = lower; o.r = 0.35; o.m = 0.15; }
      // red hockey-stick stripe (kicks up over the rear quarter) with a thin blue pinline
      const kick = sstep(-0.075, -0.12, x) * 0.022;
      const sy = 0.026 + kick, inStripe = Math.abs(y - sy) < 0.0042 && x < 0.2 && x > -0.205 && y > archTop(x) + 0.004;
      if (inStripe) { o.c = red; o.r = 0.25; }
      if (Math.abs(y - (sy - 0.0062)) < 0.0007 && x < 0.2 && x > -0.205 && y > archTop(x) + 0.003) o.c = blue;
      // door number roundel
      const dx = x - 0.004, dy = y - 0.031;
      const rr = Math.hypot(dx / 1.25, dy);
      if (rr < 0.0145) { o.c = white; if (rr > 0.0132) o.c = red; const a = num(right ? (dx + 0.016) / 0.032 : (0.016 - dx) / 0.032, 1 - (dy + 0.0105) / 0.021); if (a > 0.45) o.c = black; }
      // sponsor decals
      const bA = brand(right ? (x + 0.2) / 0.075 : (-0.125 - x) / 0.075, 1 - (y - 0.039) / 0.013); if (bA > 0.45) o.c = black;
      const gA = tyres(right ? (x - 0.172) / -0.06 * -1 : (0.232 - x) / 0.06, 1 - (y - 0.008) / 0.009); if (gA > 0.45 && x > 0.17) o.c = blue;
      // door + quarter seams, handle, fuel door, fender vents, side markers
      if (y > -0.016 && y < bl - 0.002 && (Math.abs(x - 0.041) < 0.0005 || Math.abs(x + 0.068) < 0.0005)) { o.c = black; o.r = 0.8; }
      if (x > -0.064 && x < -0.05 && y > 0.044 && y < 0.047) { o.c = black; o.r = 0.4; }
      if (Math.abs(Math.hypot(x + 0.155, y - 0.044) - 0.0065) < 0.0005) { o.c = black; o.r = 0.8; }
      if (x > 0.075 && x < 0.088 && y > 0.008 && y < 0.03 && Math.sin((y - 0.008) * 900) > 0.2) { o.c = [0.02, 0.02, 0.02]; o.r = 0.9; }
      if (x > 0.196 && x < 0.209 && y > 0.017 && y < 0.024) { o.c = [1, 0.6, 0.1]; o.r = 0.2; o.e = 0.7; }
      if (x < -0.198 && x > -0.211 && y > 0.024 && y < 0.031) { o.c = [0.9, 0.08, 0.06]; o.r = 0.2; o.e = 0.6; }
      // overfender bolts
      for (const ax of [ARCH.x, -ARCH.x]) for (let k = 0; k < 7; k++) {
        const a = Math.PI * (0.12 + 0.76 * (k / 6)), bx = ax + Math.cos(a) * (ARCH.r + 0.006), by = Math.sin(a) * (ARCH.r + 0.006);
        if (Math.hypot(x - bx, y - by) < 0.0013) { o.c = chrome; o.r = 0.2; o.m = 1; }
      }
    }
  };
  const L = loftShell(spec, paint, { U: 124, V: 76, TW: 1536, TH: 640 });
  shell.add(L.outer, L.inner);
  // ---- nose: charcoal bumper, wide lower intake, LED strip, turn signals, red tow hook
  const hx = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const front = endCap(L.front, XF, 1, (g, P) => {
    g.fillStyle = hx(col.body); g.fillRect(0, 0, 4096, 4096);
    const [, ly] = P(0, -0.0025); g.fillStyle = hx(col.lower); g.fillRect(0, ly, 4096, 4096);
    const [ix0, iy0] = P(-0.06, 0.006), [ix1, iy1] = P(0.06, -0.012);
    g.fillStyle = '#0b0b0c'; g.beginPath(); g.roundRect(Math.min(ix0, ix1), iy0, Math.abs(ix1 - ix0), iy1 - iy0, 14); g.fill();
    g.strokeStyle = '#2a2b2e'; g.lineWidth = 2; for (let k = -40; k < 60; k++) { g.beginPath(); g.moveTo(Math.min(ix0, ix1) + k * 10, iy0); g.lineTo(Math.min(ix0, ix1) + k * 10 + 22, iy1); g.stroke(); }
    const [gx0, gy0] = P(-0.034, 0.024), [gx1, gy1] = P(0.034, 0.016); g.fillStyle = '#121214'; g.beginPath(); g.roundRect(Math.min(gx0, gx1), gy0, Math.abs(gx1 - gx0), gy1 - gy0, 6); g.fill();
    for (const s of [-1, 1]) {
      const [tx, ty] = P(s * 0.072, 0.012); g.fillStyle = '#f0a020'; g.beginPath(); g.roundRect(tx - 22, ty - 7, 44, 14, 4); g.fill();
      const [lx, lyy] = P(s * 0.057, 0.026); g.fillStyle = '#dfe6ee'; g.beginPath(); g.roundRect(lx - 34, lyy - 5, 68, 10, 4); g.fill();
    }
    const [hx0, hy0] = P(0.042, -0.006); g.strokeStyle = '#d2232a'; g.lineWidth = 7; g.beginPath(); g.arc(hx0, hy0, 11, 0, Math.PI * 2); g.stroke();
  }, (g, P) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 4096, 4096);
    for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.057, 0.026); g.fillStyle = '#e8f0ff'; g.beginPath(); g.roundRect(lx - 34, ly - 5, 68, 10, 4); g.fill(); const [tx, ty] = P(s * 0.072, 0.012); g.fillStyle = '#7a4a08'; g.fillRect(tx - 22, ty - 7, 44, 14); }
  });
  // ---- tail: full-width lamp bar, plate, charcoal diffuser
  const tailCanvas: { mat?: THREE.MeshPhysicalMaterial } = {};
  const rear = endCap(L.rear, XR, -1, (g, P) => {
    g.fillStyle = hx(col.body); g.fillRect(0, 0, 4096, 4096);
    const [, ly] = P(0, -0.004); g.fillStyle = hx(col.lower); g.fillRect(0, ly, 4096, 4096);
    const [tx0, ty0] = P(-0.08, 0.04), [tx1, ty1] = P(0.08, 0.028);
    g.fillStyle = '#5a0c0a'; g.beginPath(); g.roundRect(Math.min(tx0, tx1), ty0, Math.abs(tx1 - tx0), ty1 - ty0, 8); g.fill();
    g.fillStyle = '#d01c18'; for (const s of [-1, 1]) { const [a] = P(s * 0.078, 0), [b] = P(s * 0.05, 0); g.fillRect(Math.min(a, b), ty0 + 4, Math.abs(b - a), ty1 - ty0 - 8); }
    g.fillStyle = '#f2f2f2'; for (const s of [-1, 1]) { const [a] = P(s * 0.05, 0); g.fillRect(a - 8, ty0 + 6, 16, ty1 - ty0 - 12); }
    const [px, py] = P(0, 0.012); g.fillStyle = '#f1eadb'; g.fillRect(px - 52, py - 16, 104, 32); g.fillStyle = '#1d1d1f'; g.font = '700 24px system-ui'; g.textAlign = 'center'; g.fillText('KNJ 89', px, py + 9);
  }, (g, P) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 4096, 4096);
    const [tx0, ty0] = P(-0.08, 0.04), [tx1, ty1] = P(0.08, 0.028);
    g.fillStyle = '#ff2a1a'; for (const s of [-1, 1]) { const [a] = P(s * 0.078, 0), [b] = P(s * 0.05, 0); g.fillRect(Math.min(a, b), ty0 + 4, Math.abs(b - a), ty1 - ty0 - 8); }
    g.fillStyle = '#5a0505'; g.fillRect(Math.min(tx0, tx1), ty0 + 4, Math.abs(tx1 - tx0), ty1 - ty0 - 8);
  });
  tailCanvas.mat = rear.material as THREE.MeshPhysicalMaterial;
  shell.add(front, rear);
  // ---- front lip splitter (thin plate following the nose plan) and rear diffuser fins
  const blk = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.2 });
  const lip = new THREE.Shape();
  lip.moveTo(XF - 0.03, -0.088); lip.quadraticCurveTo(XF + 0.009, -0.07, XF + 0.009, 0); lip.quadraticCurveTo(XF + 0.009, 0.07, XF - 0.03, 0.088);
  lip.lineTo(XF - 0.035, 0.08); lip.quadraticCurveTo(XF - 0.004, 0.06, XF - 0.004, 0); lip.quadraticCurveTo(XF - 0.004, -0.06, XF - 0.035, -0.08); lip.closePath();
  const lipG = new THREE.ExtrudeGeometry(lip, { depth: 0.0022, bevelEnabled: false }); lipG.rotateX(Math.PI / 2); lipG.translate(0, -0.0145, 0);
  const lipM = new THREE.Mesh(lipG, blk); lipM.castShadow = true; shell.add(lipM);
  for (let k = -2; k <= 2; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.009, 0.0016), blk); fin.position.set(XR + 0.012, -0.012, k * 0.022); shell.add(fin); }
  // ---- exhaust: canted tip under the rear bumper
  const pipe = lathe([[0.0062, -0.012], [0.0066, -0.011], [0.0066, 0.012], [0.0058, 0.0125], [0.0052, 0.011], [0.0052, -0.01]], 20);
  pipe.rotateZ(Math.PI / 2);
  const ex = new THREE.Mesh(pipe, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.25, metalness: 1 }));
  ex.position.set(XR - 0.002, -0.011, 0.055); ex.rotation.y = -0.15; shell.add(ex);
  const soot = new THREE.Mesh(new THREE.CircleGeometry(0.0052, 16).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050505 })); soot.position.set(XR - 0.0135, -0.011, 0.0533); soot.rotation.y = -0.15; shell.add(soot);
  // ---- aero mirrors on the doors
  for (const s of [-1, 1]) {
    shell.add(bentTube([new THREE.Vector3(0.036, 0.056, s * 0.083), new THREE.Vector3(0.033, 0.061, s * 0.092), new THREE.Vector3(0.031, 0.064, s * 0.097)], 0.0011, 0.003, blk));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 12), new THREE.MeshPhysicalMaterial({ color: col.body, roughness: 0.3, clearcoat: 0.8 }));
    head.scale.set(0.55, 0.62, 1.05); head.position.set(0.029, 0.066, s * 0.1); head.castShadow = true; shell.add(head);
    const glassM = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 16).rotateY(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xaab4c0, roughness: 0.05, metalness: 1 }));
    glassM.scale.set(1, 0.8, 1.4); glassM.position.set(0.0245, 0.066, s * 0.1); shell.add(glassM);
  }
  // ---- wipers
  for (const zz of [-0.034, 0.02]) shell.add(bentTube([new THREE.Vector3(0.049, 0.0585, zz), new THREE.Vector3(0.04, 0.0625, zz + 0.034)], 0.0007, 0, blk));
  // ---- body posts with R-clips (it's an RC car)
  const post = new THREE.CylinderGeometry(0.0022, 0.0022, 0.012, 10);
  const clipM = new THREE.MeshStandardMaterial({ color: 0xc8cdd3, roughness: 0.25, metalness: 1 });
  for (const [px, py] of [[0.139, 0.051], [-0.19, 0.063]] as const) for (const s of [-1, 1]) {
    const p = new THREE.Mesh(post, blk); p.position.set(px, py + 0.003, s * 0.024); shell.add(p);
    const clip = new THREE.Mesh(new THREE.TorusGeometry(0.0042, 0.0006, 6, 16, Math.PI * 1.6), clipM); clip.position.set(px, py + 0.0045, s * 0.024); clip.rotation.set(Math.PI / 2, 0, s * 0.6); shell.add(clip);
  }
  return { tail: tailCanvas.mat! };
}

// ====================================================================================== wheels
function driftWheel(face: number, tyreCol = 0x2a2b2e, tyreRough = 0.32) {
  const g = new THREE.Group();
  // hard plastic drift tyre: thin, square-shouldered, glossy
  const w = 0.0125, rIn = 0.0262;
  const tyre = lathe([[rIn, -w], [R - 0.0016, -w], [R - 0.0004, -w + 0.0012], [R, -w + 0.003], [R, w - 0.003], [R - 0.0004, w - 0.0012], [R - 0.0016, w], [rIn, w]], 40);
  const tyreM = new THREE.MeshPhysicalMaterial({ color: tyreCol, roughness: tyreRough, metalness: 0, clearcoat: tyreRough > 0.5 ? 0 : 0.4, clearcoatRoughness: 0.3 });
  const t = new THREE.Mesh(tyre, tyreM); t.castShadow = true; g.add(t);
  // deep-dish rim: polished lip, stepped dish, recessed six-spoke face, centre nut
  const lipM = new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.12, metalness: 1 });
  const faceM = new THREE.MeshStandardMaterial({ color: face, roughness: 0.35, metalness: 0.7 });
  const lipG = lathe([[0.0258, w - 0.0002], [0.0272, w + 0.0006], [0.0268, w + 0.0014], [0.0238, w + 0.0012], [0.0232, w + 0.0002], [0.0232, -w + 0.002], [0.0258, -w + 0.001], [0.0262, -w]], 36);
  g.add(new THREE.Mesh(lipG, lipM));
  const dishY = w - 0.0075;   // spoke face sits deep inside the dish
  const barrel = lathe([[0.0233, w], [0.0228, dishY + 0.0006], [0.0205, dishY], [0.0205, -w + 0.003]], 32);
  g.add(new THREE.Mesh(barrel, new THREE.MeshStandardMaterial({ color: 0xbfc4ca, roughness: 0.2, metalness: 1, side: THREE.DoubleSide })));
  const spokes: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 12; k++) {
    const sh = new THREE.Shape([[-0.0011, 0.006], [0.0011, 0.006], [0.0016, 0.0212], [-0.0016, 0.0212]].map(([a, b]) => new THREE.Vector2(a, b)));
    const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.0026, bevelEnabled: true, bevelSize: 0.0006, bevelThickness: 0.0006, bevelSegments: 2 });
    sg.rotateX(-Math.PI / 2); sg.translate(0, dishY - 0.0014, 0); sg.rotateY((Math.floor(k / 2) / 6) * Math.PI * 2 + (k % 2 ? 0.17 : -0.17));
    spokes.push(sg);
  }
  spokes.push(lathe([[0.001, dishY + 0.0018], [0.0072, dishY + 0.0016], [0.0078, dishY], [0.0078, dishY - 0.003], [0.001, dishY - 0.003]], 24));
  const sp = new THREE.Mesh(mergeGeometries(spokes.map((x) => x.toNonIndexed()), false)!, faceM); sp.castShadow = true; g.add(sp);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.004, 6).translate(0, dishY + 0.003, 0), new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.4, metalness: 0.8 }));
  g.add(nut);
  return g;
}

// ====================================================================================== chassis
export function createDrift(colors = DRIFT_COLORS, fitted: Partial<Record<string, string>> = {}): DriftModel {
  const has = (id: string) => Object.values(fitted).includes(id);
  const rmr = has('dr-layout-rmr');
  const root = new THREE.Group(); root.name = 'drift-car';
  const sprung = new THREE.Group(); root.add(sprung);
  const carbon = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.35, metalness: 0.4 });
  const alu = new THREE.MeshStandardMaterial({ color: 0x3a6fd8, roughness: 0.3, metalness: 0.85 });   // blue anodised
  const aluP = new THREE.MeshStandardMaterial({ color: 0xc4c9cf, roughness: 0.28, metalness: 0.9 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.6, metalness: 0.05 });
  // carbon main deck + upper deck, motor, ESC, battery (seen through the arches and from low angles)
  const deck = new THREE.Mesh(roundedBox(0.36, 0.0025, 0.098, 0.0012), carbon); deck.position.set(-0.005, 0.0075, 0); deck.castShadow = true; sprung.add(deck);
  const motorM = has('dr-motor-105') ? new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.3, metalness: 0.85 }) : alu;
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.0181, 0.0181, 0.052, 20).rotateX(Math.PI / 2), motorM); motor.position.set(rmr ? -0.088 : 0.035, 0.028, -0.006); sprung.add(motor);
  if (has('dr-motor-105')) { // sensored brushless: finned heatsink + fan on the can
    for (let i = 0; i < 6; i++) { const fin = new THREE.Mesh(new THREE.TorusGeometry(0.0186, 0.0011, 4, 18), aluP); fin.position.set(motor.position.x, 0.028, -0.026 + i * 0.008); sprung.add(fin); }
    const fan = new THREE.Mesh(roundedBox(0.026, 0.008, 0.026, 0.003), carbon); fan.position.set(motor.position.x, 0.05, -0.006); sprung.add(fan);
  }
  const batt = new THREE.Mesh(roundedBox(0.094, 0.023, 0.047, 0.003), new THREE.MeshStandardMaterial({ color: 0x232428, roughness: 0.6 })); batt.position.set(rmr ? 0.03 : -0.03, 0.021, 0.022); sprung.add(batt);
  const esc = new THREE.Mesh(roundedBox(0.034, 0.017, 0.03, 0.003), new THREE.MeshStandardMaterial({ color: 0xc0281f, roughness: 0.5 })); esc.position.set(-0.075, 0.018, -0.026); sprung.add(esc);
  const gyroBox = new THREE.Mesh(roundedBox(0.018, has('dr-gyro-pro') ? 0.011 : 0.008, 0.018, 0.002), new THREE.MeshStandardMaterial({ color: has('dr-gyro-pro') ? 0x141416 : 0xe8b923, roughness: 0.4, metalness: has('dr-gyro-pro') ? 0.5 : 0 }));
  if (has('dr-gyro-pro')) { const cap = new THREE.Mesh(roundedBox(0.012, 0.002, 0.012, 0.0008), new THREE.MeshStandardMaterial({ color: 0xd2232a, roughness: 0.4 })); cap.position.set(0, 0.019, -0.03); sprung.add(cap); }
  if (has('dr-servo-fast')) { const sv = new THREE.Mesh(roundedBox(0.03, 0.012, 0.016, 0.002), new THREE.MeshStandardMaterial({ color: 0x2f6fd8, roughness: 0.3, metalness: 0.8 })); sv.position.set(FX - 0.035, 0.016, 0.02); sprung.add(sv); } gyroBox.position.set(0.0, 0.013, -0.03); sprung.add(gyroBox);
  // body
  const shell = new THREE.Group(); shell.position.set(MID, R, 0); sprung.add(shell);
  const { tail } = buildKanjoBody(shell, colors);

  // suspension + wheels
  interface Corner { hub: THREE.Group; steer: THREE.Group; spin: THREE.Group; front: boolean; s: number }
  const corners: Corner[] = [];
  const armG = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 8).translate(0, 0.5, 0);
  const faces = [0xb98a3e, 0xb98a3e];   // bronze faces
  for (const [x, front] of [[FX, true], [RX, false]] as const) for (const s of [-1, 1]) {
    const hub = new THREE.Group(); hub.position.set(x, R, s * TZ); root.add(hub);
    const steer = new THREE.Group(); hub.add(steer);
    const cam = new THREE.Group(); cam.rotation.x = -s * (front ? 0.12 : 0.04); steer.add(cam);
    const spin = new THREE.Group(); cam.add(spin);
    const wheel = has('dr-tyres-lf') ? driftWheel(faces[front ? 0 : 1], 0x3c3d40, 0.75) : driftWheel(faces[front ? 0 : 1]); wheel.rotation.x = s * Math.PI / 2; spin.add(wheel);
    // knuckle / hub carrier (blue alu)
    const knuckle = new THREE.Mesh(roundedBox(0.012, 0.022, 0.006, 0.002), front && has('dr-angle-kit') ? new THREE.MeshStandardMaterial({ color: 0xc9a23a, roughness: 0.3, metalness: 0.9 }) : alu); knuckle.position.set(0, 0, -s * 0.013); cam.add(knuckle);
    // A-arms from the deck to the hub (unsprung look is fine at this scale)
    for (const dy of [-0.012, 0.01]) for (const dx of [-0.012, 0.012]) {
      const arm = new THREE.Mesh(armG, dy < 0 ? plastic : aluP);
      const a = new THREE.Vector3(x + dx * 1.4, R + dy, s * 0.03), b = new THREE.Vector3(x, R + dy * 0.7, s * (TZ - 0.014));
      const d = b.clone().sub(a); arm.position.copy(a); arm.scale.set(1, d.length(), 1); arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      root.add(arm);
    }
    // coil-over (angled, mostly hidden under the body)
    const shock = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.034, 12), plastic);
    shock.position.set(x + (front ? -0.016 : 0.016), R + 0.022, s * 0.042); shock.rotation.x = s * 0.5; sprung.add(shock);
    corners.push({ hub, steer, spin, front, s });
  }
  const tailBase = tail.emissiveIntensity;
  // fewer draw calls: the sprung body + chassis and each wheel become a few merged meshes
  batchStatic(sprung, () => false);
  for (const c of corners) batchStatic(c.spin, () => false);
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; } });

  return {
    root,
    pose(sim, brake = false) {
      root.position.set(sim.x, 0, sim.z);
      root.rotation.set(0, -sim.psi, 0);
      sprung.rotation.set(sim.bodyRoll, 0, -sim.bodyPitch);
      sprung.position.y = Math.abs(sim.bodyRoll) * 0.04;
      for (const c of corners) {
        c.steer.rotation.y = c.front ? -sim.steer * (1 + 0.12 * Math.sign(sim.steer) * c.s) : 0; // a little Ackermann
        c.spin.rotation.z = -(c.front ? sim.spinF : sim.spinR);
      }
      tail.emissiveIntensity = brake ? tailBase * 2.6 : tailBase;
    },
    rest() { this.pose({ x: 0, z: 0, psi: 0, steer: 0, spinF: 0, spinR: 0, bodyRoll: 0, bodyPitch: 0 }); root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); },
  };
}
