// Sculpted bodies for the buggy-class trucks, built the same way as the crawler bodies: one lofted shell
// per body (cross-sections along x), detail painted per texel from the same shape functions, flat painted
// end caps, and bent-tube / extruded accessories.
//  · Dunewolf SC10: a full-fender short course race truck (covers the wheels, cut arches, bumpers, nerf bars).
//  · Thumper ST: a stadium-truck cab body that sits between the wheels (tyres fully exposed), big wing.
// Coordinates are the buggy chassis frame in 1/8 units: x forward, y up, z right; wheel centres at
// (±hx, yc, ±tz) where yc = 0.06 − ride.
import * as THREE from 'three';
import { bentTube, endCap, hex3, loftShell, Painter, profile, ShellSpec, smax, sstep } from './crawlerBodies';
import { lathe } from './materials';

export interface BodyLayout { hx: number; tz: number; rF: number; rR: number; wF: number; wR: number; ride: number }
export interface BodyColors { body: number; accent: number }

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hx6 = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Text → alpha sampler (u, v in 0..1, v down). */
function decal(text: string, font: string, w = 512, h = 96) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff'; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2, w - 8);
  const d = g.getImageData(0, 0, w, h).data;
  return (u: number, v: number) => (u < 0 || u >= 1 || v < 0 || v >= 1 ? 0 : d[(Math.floor(v * h) * w + Math.floor(u * w)) * 4 + 3] / 255);
}
/** Sample a decal on a side panel: x range [x0, x1], y range [y0, y1]; reads front→back on both sides. */
const onSide = (dec: ReturnType<typeof decal>, x: number, y: number, z: number, x0: number, x1: number, y0: number, y1: number) => {
  // viewed from the +z side, +x is on the viewer's right; from the −z side it's on the left
  const u = z > 0 ? (x - x0) / (x1 - x0) : (x1 - x) / (x1 - x0);
  return dec(u, 1 - (y - y0) / (y1 - y0));
};

// ====================================================================================== short course truck
export function buildSCTBody(shell: THREE.Group, col: BodyColors, L: BodyLayout) {
  const yc = 0.06 - L.ride, R = Math.max(L.rF, L.rR), Ra = R + 0.013;
  const XF = 0.292, XR = -0.298;
  const W0 = L.tz + L.wR / 2 + 0.011;
  const archTop = (x: number) => { let t = -1; for (const ax of [L.hx, -L.hx]) { const dx = x - ax; if (Math.abs(dx) < Ra) t = Math.max(t, yc + Math.sqrt(Ra * Ra - dx * dx)); } return t; };
  const top = profile([[XF, yc + 0.07], [XF - 0.025, yc + 0.093], [0.2, yc + 0.103], [0.08, yc + 0.11], [0.066, yc + 0.112], [0.012, yc + 0.168], [-0.004, yc + 0.173], [-0.1, yc + 0.172], [-0.112, yc + 0.166], [-0.121, yc + 0.114], [-0.13, yc + 0.104], [XR + 0.012, yc + 0.104], [XR, yc + 0.092]], 3);
  const belt = profile([[XF, yc + 0.066], [XF - 0.025, yc + 0.088], [0.2, yc + 0.096], [0.08, yc + 0.099], [-0.02, yc + 0.097], [-0.13, yc + 0.1], [XR + 0.012, yc + 0.1], [XR, yc + 0.088]], 3);
  const cab = (x: number) => sstep(0.072, 0.06, x) * sstep(-0.13, -0.118, x);
  const Wx = (x: number) => W0 - 0.016 * Math.pow(sstep(0.24, XF, x), 1.4) - 0.01 * Math.pow(sstep(-0.26, XR, x), 1.4);
  const bot = (x: number) => {
    let b = yc - 0.018 - 0.004 * sstep(0.2, XF, x) - 0.002 * sstep(-0.24, XR, x);
    const at = archTop(x); if (at > -1) b = smax(b, at, 0.008);
    return b;
  };
  // moulded fender flares: a swell around each arch fading out by the belt
  const flare = (x: number, y: number) => {
    let f = 0;
    for (const ax of [L.hx, -L.hx]) { const d = Math.hypot(x - ax, y - yc); f = Math.max(f, sstep(Ra + 0.034, Ra + 0.004, d)); }
    return 0.011 * f * (1 - sstep(yc + 0.08, yc + 0.098, y));
  };
  const spec: ShellSpec = {
    xF: XF, xR: XR, endRound: 0.02,
    half(x) {
      const W = Wx(x), b = bot(x), bl = belt(x), t = Math.max(top(x), bl + 0.003), c = cab(x);
      const wTop = THREE.MathUtils.lerp(W - 0.02, 0.112, c);
      const y1 = THREE.MathUtils.lerp(b, bl, 0.45);
      return [
        [W + flare(x, b) - 0.002, b],
        [W + flare(x, y1) + 0.002, y1],
        [W + flare(x, bl - 0.012) + 0.001, bl - 0.012],
        [W - 0.001, bl],
        [THREE.MathUtils.lerp(W - 0.012, wTop + 0.008, c), THREE.MathUtils.lerp(bl + 0.003, bl + 0.006, c)],
        [THREE.MathUtils.lerp(W * 0.7, wTop, c), THREE.MathUtils.lerp(t - 0.002, t - 0.014, c)],
        [THREE.MathUtils.lerp(W * 0.35, wTop - 0.025, c), t - 0.0006],
        [0, t],
      ];
    },
  };
  const body = hex3(col.body), white = hex3(col.accent), black: [number, number, number] = [0.06, 0.06, 0.065], glass: [number, number, number] = [0.04, 0.05, 0.06];
  const blue: [number, number, number] = [0.12, 0.3, 0.75], yellow: [number, number, number] = [0.95, 0.76, 0.18];
  const brand = decal('DUNEWOLF', 'italic 900 78px "Barlow Condensed", "Arial Narrow", sans-serif');
  const tyre = decal('GRIPHOLD', '900 70px "Barlow Condensed", "Arial Narrow", sans-serif');
  const volt = decal('VOLTSTACK', '900 70px "Barlow Condensed", "Arial Narrow", sans-serif');
  const num = decal('21', 'italic 900 88px "Barlow Condensed", "Arial Narrow", sans-serif', 160, 96);
  const bedTxt = decal('DUNEWOLF', '900 80px "Barlow Condensed", "Arial Narrow", sans-serif', 512, 96);
  const paint: Painter = (x, y, z, o) => {
    const az = Math.abs(z), W = Wx(x), bl = belt(x), t = top(x), c = cab(x);
    o.c = body; o.r = 0.3; o.m = 0.1;
    const side = az > W - 0.008;
    // ---- cab: windscreen, side windows with nets, back glass, roof graphic
    if (y > bl + 0.004 && c > 0.5) {
      const wTop = THREE.MathUtils.lerp(W - 0.02, 0.112, c);
      const sideFace = az > wTop - 0.006;
      if (!sideFace && x > 0.004 && x < 0.07) { o.c = glass; o.r = 0.05; o.m = 0.4; if (y > t - 0.012) { o.c = black; const a = brand((0.09 - z) / 0.18, 1 - (y - (t - 0.012)) / 0.012); if (a > 0.45) o.c = white; } }
      if (sideFace && y > bl + 0.01 && y < t - 0.012 && x < 0.06 - (y - bl) * 0.75 && x > -0.112) {
        o.c = glass; o.r = 0.05; o.m = 0.4;
        // window net: woven black straps
        if (Math.abs(Math.sin(x * 700)) > 0.82 || Math.abs(Math.sin(y * 700)) > 0.82) { o.c = [0.02, 0.02, 0.02]; o.r = 0.9; o.m = 0; }
        if (Math.abs(x + 0.03) < 0.003) { o.c = black; o.r = 0.5; }
      }
      if (!sideFace && x < -0.108 && y > bl + 0.01 && y < t - 0.008) { o.c = glass; o.r = 0.05; o.m = 0.4; }
      if (!sideFace && x < 0.004 && x > -0.105 && az < 0.012) o.c = white; // roof stripe
      return;
    }
    // ---- bed: black tonneau with lettering
    if (!side && x < -0.128 && x > XR + 0.012 && az < W - 0.012) {
      o.c = [0.08, 0.08, 0.085]; o.r = 0.7; o.m = 0.05;
      const a = bedTxt((z + 0.075) / 0.15, (-0.19 - x) / 0.028); if (a > 0.45) o.c = white;
    }
    // ---- hood: twin vents + bonnet pins + stripes
    if (!side && x > 0.075) {
      if (az < 0.012) o.c = white;
      if (az > 0.02 && az < 0.06 && x > 0.12 && x < 0.18 && Math.sin(x * 900) > 0.4) { o.c = [0.02, 0.02, 0.02]; o.r = 0.9; }
      if (Math.hypot(x - 0.26, az - 0.07) < 0.004) { o.c = [0.8, 0.82, 0.85]; o.m = 1; o.r = 0.2; }
    }
    // ---- sides: rocker, door number, decals, seams
    if (side) {
      if (y < yc + 0.008) { o.c = black; o.r = 0.6; o.m = 0.05; }
      // swoosh: white band rising toward the rear with a blue keyline
      const sw = yc + 0.05 + (0.05 - x) * 0.08;
      if (Math.abs(y - sw) < 0.006 && y > archTop(x) + 0.004) o.c = white;
      if (Math.abs(y - (sw - 0.0085)) < 0.0012 && y > archTop(x) + 0.004) o.c = blue;
      const dx = x - 0.012, dy = y - (yc + 0.066);
      if (Math.abs(dx) < 0.034 && Math.abs(dy) < 0.022) { o.c = white; const a = num(z > 0 ? (dx + 0.034) / 0.068 : (0.034 - dx) / 0.068, 1 - (dy + 0.022) / 0.044); if (a > 0.45) o.c = black; }
      if (onSide(brand, x, y, z, -0.27, -0.14, yc + 0.03, yc + 0.06) > 0.45) o.c = white;
      if (onSide(tyre, x, y, z, 0.15, 0.25, yc + 0.06, yc + 0.08) > 0.45) o.c = yellow;
      if (onSide(volt, x, y, z, -0.11, -0.04, yc + 0.02, yc + 0.036) > 0.45) o.c = white;
      if (y > yc + 0.01 && y < bl - 0.004 && (Math.abs(x - 0.062) < 0.0007 || Math.abs(x + 0.115) < 0.0007)) { o.c = black; o.r = 0.8; }
      if (x > -0.09 && x < -0.075 && y > bl - 0.016 && y < bl - 0.012) { o.c = black; o.r = 0.4; }
    }
  };
  const Ls = loftShell(spec, paint, { U: 112, V: 68, TW: 1536, TH: 640 });
  shell.add(Ls.outer, Ls.inner);
  const front = endCap(Ls.front, XF, 1, (g, P) => {
    g.fillStyle = hx6(col.body); g.fillRect(0, 0, 4096, 4096);
    const [gx0, gy0] = P(-0.11, yc + 0.06), [gx1, gy1] = P(0.11, yc + 0.02);
    g.fillStyle = '#121214'; g.beginPath(); g.roundRect(Math.min(gx0, gx1), gy0, Math.abs(gx1 - gx0), gy1 - gy0, 16); g.fill();
    g.strokeStyle = '#2b2c30'; g.lineWidth = 6; for (let k = 0; k < 5; k++) { const [, yy] = P(0, yc + 0.026 + k * 0.008); g.beginPath(); g.moveTo(Math.min(gx0, gx1) + 10, yy); g.lineTo(Math.max(gx0, gx1) - 10, yy); g.stroke(); }
    g.fillStyle = '#f1f0ec'; g.font = '900 54px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; const [cx, cy] = P(0, yc + 0.04); g.fillText('DUNEWOLF', cx, cy + 18);
    for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.135, yc + 0.055); g.fillStyle = '#e6eef8'; g.beginPath(); g.roundRect(lx - 40, ly - 14, 80, 28, 10); g.fill(); }
    const [, by] = P(0, yc + 0.012); g.fillStyle = '#16171a'; g.fillRect(0, by, 4096, 4096);
  }, (g, P) => { g.fillStyle = '#000'; g.fillRect(0, 0, 4096, 4096); for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.135, yc + 0.055); g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(lx - 40, ly - 14, 80, 28, 10); g.fill(); } });
  const rear = endCap(Ls.rear, XR, -1, (g, P) => {
    g.fillStyle = hx6(col.body); g.fillRect(0, 0, 4096, 4096);
    for (const s of [-1, 1]) { const [tx, ty] = P(s * 0.14, yc + 0.07); g.fillStyle = '#c01c18'; g.beginPath(); g.roundRect(tx - 20, ty - 34, 40, 68, 8); g.fill(); }
    g.fillStyle = '#f1f0ec'; g.font = 'italic 900 64px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; const [cx, cy] = P(0, yc + 0.07); g.fillText('DUNEWOLF', cx, cy + 20);
    const [, by] = P(0, yc + 0.014); g.fillStyle = '#16171a'; g.fillRect(0, by, 4096, 4096);
  }, (g, P) => { g.fillStyle = '#000'; g.fillRect(0, 0, 4096, 4096); for (const s of [-1, 1]) { const [tx, ty] = P(s * 0.14, yc + 0.07); g.fillStyle = '#5a0805'; g.fillRect(tx - 20, ty - 34, 40, 68); } });
  shell.add(front, rear);
  // ---- moulded bumpers / skid plates (chassis-mounted on the real truck), nerf bars, light bar, roof scoop
  const blk = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.55, metalness: 0.1 });
  const bump = (x0: number, dir: 1 | -1) => {
    const sh = new THREE.Shape([[-0.012, -0.014], [0.014, -0.014], [0.016, 0.004], [0.006, 0.016], [-0.012, 0.016]].map(([a, b]) => new THREE.Vector2(a, b)));
    const pts = [V3(x0 - dir * 0.02, yc - 0.008, -W0 + 0.02), V3(x0 + dir * 0.008, yc - 0.006, -W0 * 0.5), V3(x0 + dir * 0.012, yc - 0.006, 0), V3(x0 + dir * 0.008, yc - 0.006, W0 * 0.5), V3(x0 - dir * 0.02, yc - 0.008, W0 - 0.02)];
    const g = new THREE.ExtrudeGeometry(sh, { steps: 40, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(pts, false, 'centripetal') });
    const m = new THREE.Mesh(g, blk); m.castShadow = true; shell.add(m);
  };
  bump(XF, 1); bump(XR, -1);
  for (const s of [-1, 1]) shell.add(bentTube([V3(L.hx - Ra - 0.004, yc - 0.006, s * (W0 - 0.004)), V3(L.hx - Ra - 0.012, yc - 0.012, s * (W0 + 0.012)), V3(-L.hx + Ra + 0.012, yc - 0.012, s * (W0 + 0.012)), V3(-L.hx + Ra + 0.004, yc - 0.006, s * (W0 - 0.004))], 0.0045, 0.014, blk));
  const lensM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.9, roughness: 0.05, clearcoat: 1 });
  const lb = lathe([[0.001, -0.07], [0.008, -0.07], [0.009, -0.066], [0.009, 0.066], [0.008, 0.07], [0.001, 0.07]], 12); lb.rotateX(Math.PI / 2);
  const bar = new THREE.Mesh(lb, blk); bar.position.set(0.0, yc + 0.18, 0); bar.scale.set(1, 0.75, 1); shell.add(bar);
  for (let i = 0; i < 6; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.0052, 16).rotateY(Math.PI / 2), lensM); d.position.set(0.0092, yc + 0.18, -0.055 + i * 0.022); shell.add(d); }
  for (const s of [-1, 1]) shell.add(bentTube([V3(0.0, yc + 0.172, s * 0.055), V3(0.0, yc + 0.18, s * 0.06)], 0.0018, 0, blk));
  const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: col.accent, roughness: 0.3, clearcoat: 0.8 }));
  scoop.scale.set(1.3, 0.35, 0.8); scoop.position.set(-0.06, yc + 0.172, 0); scoop.castShadow = true; shell.add(scoop);
  const scoopMouth = new THREE.Mesh(new THREE.CircleGeometry(0.02, 18, 0, Math.PI).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  scoopMouth.scale.set(1, 0.4, 1.1); scoopMouth.position.set(-0.03, yc + 0.172, 0); shell.add(scoopMouth);
  // mirrors
  for (const s of [-1, 1]) {
    shell.add(bentTube([V3(0.055, yc + 0.118, s * (W0 - 0.03)), V3(0.05, yc + 0.124, s * (W0 - 0.01))], 0.0016, 0, blk));
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 10), blk); hd.scale.set(0.5, 0.7, 1.1); hd.position.set(0.048, yc + 0.127, s * (W0 - 0.005)); shell.add(hd);
  }
}

// ====================================================================================== stadium truck
export function buildStadiumBody(shell: THREE.Group, col: BodyColors, L: BodyLayout) {
  const yc = 0.06 - L.ride;
  const XF = L.hx + 0.03, XR = -(L.hx + 0.012);
  const W0 = L.tz - L.wR / 2 - 0.014;
  const top = profile([[XF, yc + 0.036], [XF - 0.02, yc + 0.054], [0.13, yc + 0.064], [0.075, yc + 0.07], [0.062, yc + 0.072], [0.018, yc + 0.12], [0.004, yc + 0.124], [-0.066, yc + 0.124], [-0.076, yc + 0.118], [-0.082, yc + 0.078], [-0.09, yc + 0.07], [XR + 0.01, yc + 0.07], [XR, yc + 0.06]], 3);
  const belt = profile([[XF, yc + 0.032], [XF - 0.02, yc + 0.05], [0.13, yc + 0.06], [0.06, yc + 0.064], [-0.09, yc + 0.066], [XR + 0.01, yc + 0.066], [XR, yc + 0.056]], 3);
  const cab = (x: number) => sstep(0.068, 0.058, x) * sstep(-0.09, -0.08, x);
  const Wx = (x: number) => W0 - 0.02 * Math.pow(sstep(0.13, XF, x), 1.3) - 0.008 * Math.pow(sstep(-0.15, XR, x), 1.3);
  const spec: ShellSpec = {
    xF: XF, xR: XR, endRound: 0.016,
    half(x) {
      const W = Wx(x), b = yc - 0.01, bl = belt(x), t = Math.max(top(x), bl + 0.003), c = cab(x);
      const wTop = THREE.MathUtils.lerp(W - 0.016, 0.066, c);
      return [
        [W - 0.004, b], [W + 0.002, THREE.MathUtils.lerp(b, bl, 0.5)], [W + 0.001, bl - 0.008], [W - 0.001, bl],
        [THREE.MathUtils.lerp(W - 0.01, wTop + 0.006, c), THREE.MathUtils.lerp(bl + 0.003, bl + 0.005, c)],
        [THREE.MathUtils.lerp(W * 0.68, wTop, c), THREE.MathUtils.lerp(t - 0.002, t - 0.011, c)],
        [THREE.MathUtils.lerp(W * 0.34, wTop - 0.02, c), t - 0.0005],
        [0, t],
      ];
    },
  };
  const body = hex3(col.body), white = hex3(col.accent), black: [number, number, number] = [0.06, 0.06, 0.065], glass: [number, number, number] = [0.04, 0.05, 0.06];
  const flameA: [number, number, number] = [0.98, 0.78, 0.2], flameB: [number, number, number] = [0.95, 0.42, 0.12];
  const brand = decal('THUMPER', 'italic 900 80px "Barlow Condensed", "Arial Narrow", sans-serif');
  const rutt = decal('RUTTWORKS', '900 70px "Barlow Condensed", "Arial Narrow", sans-serif');
  const num = decal('5', 'italic 900 90px "Barlow Condensed", "Arial Narrow", sans-serif', 96, 96);
  const paint: Painter = (x, y, z, o) => {
    const az = Math.abs(z), W = Wx(x), bl = belt(x), t = top(x), c = cab(x);
    o.c = body; o.r = 0.28; o.m = 0.1;
    const side = az > W - 0.006;
    if (y > bl + 0.003 && c > 0.5) {
      const wTop = THREE.MathUtils.lerp(W - 0.016, 0.066, c);
      const sideFace = az > wTop - 0.005;
      if (!sideFace && x > 0.006 && x < 0.066) { o.c = glass; o.r = 0.05; o.m = 0.4; }
      if (sideFace && y > bl + 0.008 && y < t - 0.01 && x < 0.056 - (y - bl) * 0.8 && x > -0.074) { o.c = glass; o.r = 0.05; o.m = 0.4; }
      if (!sideFace && x < -0.07 && y > bl + 0.008 && y < t - 0.008) { o.c = glass; o.r = 0.05; o.m = 0.4; }
      if (!sideFace && x < 0.006 && x > -0.068) { const v = Math.abs(z) < 0.03 ? 1 : 0; if (v) o.c = white; }
      return;
    }
    // hood flames licking back from the nose
    if (x > 0.07) {
      const ph = (x - 0.07) / (XF - 0.07);
      const lick = 0.5 + 0.5 * Math.sin(az * 160 + 1.3);
      if (ph > 0.35 + 0.35 * lick) o.c = ph > 0.55 + 0.35 * lick ? flameA : flameB;
    }
    if (!side && x < -0.088 && az < W - 0.01) { o.c = [0.09, 0.09, 0.1]; o.r = 0.75; o.m = 0; } // bed liner
    if (side) {
      if (y < yc + 0.008) { o.c = black; o.r = 0.6; }
      const dx = x - 0.0, dy = y - (yc + 0.04);
      if (Math.hypot(dx / 1.2, dy) < 0.018) { o.c = white; const a = num(z > 0 ? (dx + 0.02) / 0.04 : (0.02 - dx) / 0.04, 1 - (dy + 0.018) / 0.036); if (a > 0.45) o.c = black; }
      if (onSide(brand, x, y, z, -0.17, -0.06, yc + 0.03, yc + 0.056) > 0.45) o.c = white;
      if (onSide(rutt, x, y, z, 0.06, 0.15, yc + 0.012, yc + 0.028) > 0.45) o.c = white;
    }
  };
  const Ls = loftShell(spec, paint, { U: 100, V: 62, TW: 1280, TH: 512 });
  shell.add(Ls.outer, Ls.inner);
  shell.add(endCap(Ls.front, XF, 1, (g, P) => {
    g.fillStyle = hx6(col.body); g.fillRect(0, 0, 4096, 4096);
    const [gx0, gy0] = P(-0.06, yc + 0.03), [gx1, gy1] = P(0.06, yc + 0.006); g.fillStyle = '#121214'; g.beginPath(); g.roundRect(Math.min(gx0, gx1), gy0, Math.abs(gx1 - gx0), gy1 - gy0, 10); g.fill();
    for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.07, yc + 0.022); g.fillStyle = '#e6eef8'; g.beginPath(); g.arc(lx, ly, 16, 0, Math.PI * 2); g.fill(); }
  }));
  shell.add(endCap(Ls.rear, XR, -1, (g, P) => {
    g.fillStyle = hx6(col.body); g.fillRect(0, 0, 4096, 4096);
    for (const s of [-1, 1]) { const [tx, ty] = P(s * 0.08, yc + 0.045); g.fillStyle = '#c01c18'; g.fillRect(tx - 14, ty - 22, 28, 44); }
    g.fillStyle = '#f1f0ec'; g.font = 'italic 900 52px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; const [cx, cy] = P(0, yc + 0.04); g.fillText('THUMPER', cx, cy + 16);
  }));
  // tube roll bar in the bed + nerf-style front bumper hoop
  const blk = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.45, metalness: 0.4 });
  shell.add(bentTube([V3(-0.1, yc + 0.07, -0.06), V3(-0.1, yc + 0.11, -0.05), V3(-0.1, yc + 0.11, 0.05), V3(-0.1, yc + 0.07, 0.06)], 0.004, 0.014, blk));
  for (const s of [-1, 1]) shell.add(bentTube([V3(-0.1, yc + 0.108, s * 0.045), V3(-0.15, yc + 0.072, s * 0.05)], 0.0032, 0, blk));
}
