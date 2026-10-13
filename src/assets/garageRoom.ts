// Ruttworks Garage: the player's home hobby garage (PLACEHOLDER procedural art, board panels 1/1A–1C).
// Layout follows RC-Simulator-Garage-Layout-and-Lookaround-Claude.md, converted to three.js axes:
//   plan (x, y, z)  ->  three (x, y, -z)
// so the entry/garage door is at z = 0, the back wall at z = -7, left wall x = -3, right wall x = +3,
// and from the look-around anchor facing the back wall, "left" in the plan is left on screen.
// Every major object is built by its own function and tagged with a station id so it can be swapped later.
import * as THREE from 'three';
import { buildTransmitter } from './garageProps';
import { labelTexture, matTexture } from './textures';
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js';
import { lathe, roundedBox, surface, tireGeometry, rimGeometry } from './materials';
import { KIT, barPull, cable, caster, chargerBody, contactShadow, driver, drawerChest, kitBox, shopLight, taperedBin, wrenchGeometry } from './garageKit';

export type StationId = 'storage' | 'bench' | 'charging' | 'parts' | 'sandbox' | 'departure';
export type DecorId = 'club' | 'notes' | 'trophy';

export const ROOM = { w: 6, d: 7, h: 2.7 };
export const ANCHORS = {
  look: new THREE.Vector3(0, 1.6, -2.4),
  stand: new THREE.Vector3(0, 0.97, -6.42),           // buggy on the rotating stand
  shelf: new THREE.Vector3(-2.68, 0.96, -4.3),         // buggy's shelf spot (see SHELF_SLOTS)
  shellRest: new THREE.Vector3(-0.62, 0.905, -6.36),   // removed shell rests here (shell origin)
  benchPack: [new THREE.Vector3(0.82, 0.93, -6.22), new THREE.Vector3(0.82, 0.93, -6.36)],
  chargerPack: [new THREE.Vector3(2.55, 0.875, -5.15), new THREE.Vector3(2.55, 0.875, -4.45)],
};

/** Positions used for station labels and for "Tap a station" hit tests. */
export const STATION_LABELS: Record<StationId, { label: string; at: THREE.Vector3 }> = {
  bench: { label: 'Workbench', at: new THREE.Vector3(0, 1.25, -6.5) },
  storage: { label: 'Vehicles', at: new THREE.Vector3(-2.7, 2.62, -4.3) },
  charging: { label: 'Charging', at: new THREE.Vector3(2.65, 1.45, -4.7) },
  parts: { label: 'Parts', at: new THREE.Vector3(2.2, 2.0, -6.2) },
  sandbox: { label: 'Sandbox', at: new THREE.Vector3(2.45, 1.25, -2.55) },
  departure: { label: 'Go to Track', at: new THREE.Vector3(-0.4, 2.35, -0.05) },
};

const std = (color: number, rough = 0.7, metal = 0.05, map?: THREE.Texture | null) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map: map ?? null });

// Shared PBR materials (procedural textures with normal + roughness maps; see materials.ts)
const M = {
  wall: surface('drywall', { color: 0xe9dfcd, repeat: [3, 2] }),
  trim: surface('paint', { color: 0xd3c7b2, repeat: [4, 1] }),
  wood: surface('wood', { repeat: [1, 1] }),
  steel: surface('paint', { color: 0x5a5f66, metalness: 0.55, repeat: [2, 2] }),
  steelLight: surface('paint', { color: 0x9aa0a8, metalness: 0.55, repeat: [2, 2] }),
  black: surface('plastic', { color: 0x222225, repeat: [2, 2] }),
  rubber: surface('rubber', { color: 0x1b1b1b, repeat: [2, 2] }),
  red: surface('paint', { color: 0xb3261e, metalness: 0.25, repeat: [2, 2] }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.18, metalness: 1 }),
  cream: surface('plastic', { color: 0xf1eadb }),
  cork: surface('fabric', { color: 0xb88a58, repeat: [3, 3], normalScale: 2 }),
  blue: surface('plastic', { color: 0x2f5f9e }),
  cabinet: surface('paint', { color: 0x3b4048, metalness: 0.3, repeat: [2, 2] }),
  drawer: surface('paint', { color: 0x8d939c, metalness: 0.4, repeat: [2, 2] }),
};

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadow = true) {
  // every block gets softened edges so nothing reads as a raw primitive
  const mesh = new THREE.Mesh(roundedBox(w, h, d, Math.min(0.02, Math.min(w, h, d) * 0.25)), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function cyl(r: number, h: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, seg = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
/** Flat picture on a wall. `face` is the direction the picture faces. */
function picture(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, face: 'n' | 's' | 'e' | 'w', parent: THREE.Object3D, frame = 0x2a2420) {
  const g = new THREE.Group();
  const ry = { n: Math.PI, s: 0, e: Math.PI / 2, w: -Math.PI / 2 }[face];
  g.rotation.y = ry; g.position.set(x, y, z);
  box(w + 0.05, h + 0.05, 0.025, std(frame, 0.6), 0, 0, -0.012, g, false);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  p.position.z = 0.002; g.add(p);
  parent.add(g);
  return g;
}
function tag(o: THREE.Object3D, key: 'station' | 'decor', id: string) {
  o.traverse((c) => { c.userData[key] = id; });
  return o;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const DISPLAY = '800 {s}px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
function posterTex(title: string, sub: string, bg: string, accent: string, art: (g: CanvasRenderingContext2D) => void) {
  return canvasTex(256, 360, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 256, 360);
    art(g);
    g.fillStyle = accent; g.fillRect(0, 262, 256, 6);
    g.fillStyle = '#f4efe6'; g.font = DISPLAY.replace('{s}', '46'); g.textAlign = 'center';
    g.fillText(title, 128, 312);
    g.font = DISPLAY.replace('{s}', '20'); g.fillStyle = 'rgba(244,239,230,.75)';
    g.fillText(sub, 128, 340);
  });
}

// ---------------------------------------------------------------- shell + lights
export function buildShell(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'room';
  const { w, d, h } = ROOM;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), surface('concrete', { repeat: [2.5, 3], normalScale: 0.7, roughness: 0.62 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -d / 2); floor.receiveShadow = true; g.add(floor);
  // expansion joints
  for (const z of [-2.33, -4.66]) box(w, 0.004, 0.012, std(0x6e6a64), 0, 0.002, z, g, false);
  box(0.012, 0.004, d, std(0x6e6a64), 0, 0.002, -d / 2, g, false);

  box(w, h, 0.1, M.wall, 0, h / 2, -d - 0.05, g, false);       // back
  box(0.1, h, d, M.wall, -w / 2 - 0.05, h / 2, -d / 2, g, false); // left
  box(0.1, h, d, M.wall, w / 2 + 0.05, h / 2, -d / 2, g, false);  // right
  const ceil = new THREE.MeshStandardMaterial({ color: 0xe4dccd, roughness: 0.95, emissive: 0x3b342b, emissiveIntensity: 0.6 });
  box(w + 0.2, 0.1, d, ceil, 0, h + 0.05, -d / 2, g, false); // ceiling (lit from below, so a touch of fill)
  // skirting
  for (const [sw, sd, x, z] of [[w, 0.02, 0, -d + 0.01], [0.02, d, -w / 2 + 0.01, -d / 2], [0.02, d, w / 2 - 0.01, -d / 2]] as const) box(sw, 0.1, sd, M.trim, x, 0.05, z, g, false);

  // hanging LED shop lights (emissive) — the actual lights are added by the scene
  for (const z of [-1.8, -4.0, -6.0]) shopLight(g, 0, h - 0.22, z, 1.25);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- entry wall (z = 0)
export function buildEntryWall(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'entry-wall';
  const h = ROOM.h;
  const doorL = -2.0, doorR = 1.4, doorH = 2.2;
  box(doorL + 3, h, 0.1, M.wall, (-3 + doorL) / 2, h / 2, 0.05, g, false);
  box(3 - doorR, h, 0.1, M.wall, (doorR + 3) / 2, h / 2, 0.05, g, false);
  box(doorR - doorL, h - doorH, 0.1, M.wall, (doorL + doorR) / 2, doorH + (h - doorH) / 2, 0.05, g, false);
  // roll-up door, rails and opener: the way out to the track
  const door = new THREE.Group(); door.name = 'garage-door';
  const dw = doorR - doorL;
  const doorPaint = surface('paint', { color: 0xf1efea, repeat: [3, 2] });
  box(dw, doorH, 0.05, doorPaint, (doorL + doorR) / 2, doorH / 2, 0.0, door, false);
  const cx = (doorL + doorR) / 2, sectionH = doorH / 4;
  for (let row = 0; row < 4; row++) {
    const y = sectionH * (row + 0.5);
    box(dw - 0.02, 0.012, 0.06, surface('paint', { color: 0xd9d6cf }), cx, sectionH * row + 0.006, -0.02, door, false); // section joint
    for (let col = 0; col < 4; col++) {
      const x = doorL + (dw / 4) * (col + 0.5);
      if (row === 3) {
        // window row: daylight through glazing
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(dw / 4 - 0.14, sectionH - 0.2), new THREE.MeshBasicMaterial({ color: 0xbcd6ee }));
        glass.position.set(x, y, -0.03); glass.rotation.y = Math.PI; door.add(glass);
        box(dw / 4 - 0.1, sectionH - 0.16, 0.012, surface('paint', { color: 0xffffff }), x, y, -0.022, door, false).scale.set(1, 1, 0.5);
      } else {
        box(dw / 4 - 0.12, sectionH - 0.16, 0.03, doorPaint, x, y, -0.035, door, false); // raised panel
      }
    }
  }
  box(0.36, 0.04, 0.05, M.black, cx, 0.6, -0.05, door, false); // lift handle
  // daylight under the door
  const gap = new THREE.Mesh(new THREE.PlaneGeometry(dw, 0.02), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
  gap.position.set((doorL + doorR) / 2, 0.015, -0.03); gap.rotation.y = Math.PI; door.add(gap);
  tag(door, 'station', 'departure');
  g.add(door);
  for (const x of [doorL - 0.04, doorR + 0.04]) box(0.05, doorH, 0.08, M.steel, x, doorH / 2, -0.05, g);
  for (const x of [doorL + 0.05, doorR - 0.05]) box(0.05, 0.05, 2.6, M.steel, x, doorH + 0.05, -1.3, g, false);
  box(0.42, 0.16, 0.32, std(0x3a3d42, 0.5), (doorL + doorR) / 2, h - 0.12, -2.7, g, false);
  box(0.03, 0.03, 2.6, M.steel, (doorL + doorR) / 2, h - 0.12, -1.4, g, false);
  // EXIT sign above the door
  const exitSign = picture(labelTexture('TO THE TRACK', { bg: '#1c1c1e', fg: '#f2c230', stripe: '#d63a2f', w: 512, h: 96, font: '800 54px "Barlow Condensed", system-ui, sans-serif' }), 1.0, 0.19, (doorL + doorR) / 2, doorH + 0.22, -0.01, 'n', g);
  tag(exitSign, 'station', 'departure');
  // doormat
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), std(0x3a2f26, 0.98));
  mat.rotation.x = -Math.PI / 2; mat.position.set(-0.3, 0.004, -0.55); mat.receiveShadow = true; g.add(mat);
  // folded pit table + carry case leaned against the wall left of the door
  const table = new THREE.Group();
  box(0.9, 0.6, 0.04, std(0xe8e6e0, 0.6), 0, 0.31, 0, table);
  box(0.92, 0.03, 0.05, M.steelLight, 0, 0.6, 0.0, table);
  table.position.set(-2.55, 0, -0.22); table.rotation.set(-0.12, 0.0, 0); g.add(table);
  const caseG = new THREE.Group();
  box(0.5, 0.32, 0.22, M.black, 0, 0.16, 0, caseG);
  box(0.16, 0.04, 0.04, M.steelLight, 0, 0.34, 0, caseG);
  caseG.position.set(-2.55, 0, -0.62); caseG.rotation.y = 0.3; g.add(caseG);
  // poster beside the door + light switch
  picture(posterTex('PIT ROW', 'BRACKENBANK DIRT CIRCUIT', '#24486b', '#f2c230', (c) => {
    c.strokeStyle = '#f2c230'; c.lineWidth = 10; c.beginPath(); c.moveTo(30, 220); c.bezierCurveTo(80, 60, 180, 230, 226, 70); c.stroke();
  }), 0.5, 0.7, 2.25, 1.55, -0.01, 'n', g);
  box(0.08, 0.12, 0.02, M.cream, 1.62, 1.2, -0.01, g, false);
  g.traverse((o) => { (o as THREE.Mesh).receiveShadow = true; });
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- back wall: workbench + tool chest + parts cabinet
export function buildWorkbench(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'workbench';
  const cz = -6.5, top = 0.9;
  // butcher-block top with a slightly darker, eased front edge
  box(2.6, 0.06, 0.75, M.wood, 0, top - 0.03, cz, g);
  box(2.6, 0.045, 0.03, surface('wood', { color: 0xd9c4a0, repeat: [6, 0.3] }), 0, top - 0.035, cz + 0.37, g, false);
  // 4x4 legs, aprons and low stretchers (proper frame, not floating slabs)
  for (const x of [-1.25, 1.25]) for (const z of [cz - 0.32, cz + 0.32]) box(0.07, top - 0.06, 0.07, M.wood, x, (top - 0.06) / 2, z, g);
  for (const z of [cz - 0.32, cz + 0.33]) box(2.43, 0.09, 0.035, M.wood, 0, top - 0.11, z, g);
  for (const x of [-1.25, 1.25]) box(0.05, 0.07, 0.6, M.wood, x, 0.14, cz, g);
  // two roll cabinets under the bench, open knee space in the middle for the stool
  for (const x of [-0.78, 0.78]) {
    const chest = drawerChest(g, { w: 0.74, h: 0.76, d: 0.56, drawers: [1, 1, 1.3, 1.3, 2], color: 0x2a2d32, casters: true });
    chest.position.set(x, 0, cz + 0.04);
  }
  // service mat and rotating stand
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.62), std(0xffffff, 0.85, 0, matTexture()));
  mat.rotation.x = -Math.PI / 2; mat.position.set(0, top + 0.002, cz + 0.08); mat.receiveShadow = true; g.add(mat);
  const turntable = new THREE.Group(); turntable.name = 'turntable';
  const tt = new THREE.Mesh(lathe([[0.001, 0], [0.24, 0], [0.26, 0.006], [0.262, 0.03], [0.255, 0.036], [0.001, 0.036]], 48), surface('plastic', { color: 0x2a2c30, roughness: 0.5 }));
  tt.position.y = top + 0.002; tt.castShadow = true; tt.receiveShadow = true; turntable.add(tt);
  const ttTop = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.006, 48), surface('rubber', { color: 0x3a3d42, repeat: [6, 6], normalScale: 1.5 }));
  ttTop.position.y = top + 0.04; ttTop.receiveShadow = true; turntable.add(ttTop);
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.08 + i * 0.06, 0.0015, 4, 48), std(0x5a5e66, 0.5, 0.6)); r.rotation.x = Math.PI / 2; r.position.y = top + 0.044; turntable.add(r); }
  turntable.position.set(0, 0, ANCHORS.stand.z); g.add(turntable);
  // left zone: shell rest mat + tool roll with drivers
  const rest = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.34), std(0x2b2b2d, 0.95));
  rest.rotation.x = -Math.PI / 2; rest.position.set(-0.62, top + 0.003, cz + 0.14); g.add(rest);
  const roll = new THREE.Group();
  box(0.5, 0.008, 0.24, surface('fabric', { color: 0x4a3a2a, repeat: [4, 2] }), 0, 0, 0, roll);
  const handleCols = [0xd63a2f, 0x2557c9, 0xf2c230, 0xd63a2f, 0x2557c9];
  handleCols.forEach((c, i) => {
    const d = driver(roll, c, 0.07, i % 2 === 1);
    d.rotation.x = -Math.PI / 2; d.position.set(-0.18 + i * 0.09, 0.015, 0.08);
  });
  roll.position.set(-1.0, top + 0.006, cz + 0.28); roll.rotation.y = 0.05; g.add(roll);
  // right zone: parts tray, transmitter on its base
  const tray = new THREE.Mesh(lathe([[0.001, 0], [0.1, 0], [0.105, 0.004], [0.11, 0.028], [0.114, 0.03], [0.106, 0.03], [0.1, 0.006], [0.001, 0.006]], 4), surface('paint', { color: 0x9aa0a8, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }));
  tray.rotation.y = Math.PI / 4; tray.scale.set(1.2, 1, 0.8); tray.position.set(0.8, top, cz - 0.05); tray.castShadow = true; g.add(tray);
  buildTransmitter(g, new THREE.Vector3(1.1, top, cz - 0.16), 0.35);
  // back of bench: small-parts organizer + task lamp
  const org = new THREE.Group();
  box(0.5, 0.24, 0.16, surface('plastic', { color: 0x1d1d1f }), 0, 0.12, 0, org);
  const drawerGeo = roundedBox(0.105, 0.05, 0.012, 0.005);
  const drawers = new THREE.InstancedMesh(drawerGeo, new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, roughness: 0.1, transmission: 0, transparent: true, opacity: 0.45 }), 12);
  const bitsGeo = roundedBox(0.08, 0.025, 0.05, 0.006);
  const bits = new THREE.InstancedMesh(bitsGeo, surface('plastic', { color: 0x2f6fd6 }), 12);
  const mb = new THREE.Matrix4();
  for (let i = 0; i < 12; i++) { mb.makeTranslation(-0.18 + (i % 4) * 0.12, 0.045 + Math.floor(i / 4) * 0.068, 0.055); bits.setMatrixAt(i, mb); bits.setColorAt(i, new THREE.Color([0x2f6fd6, 0xc8ccd2, 0xe0782f, 0x2f6fd6, 0x1d1d1f][i % 5])); }
  org.add(bits);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 12; i++) { m4.makeTranslation(-0.18 + (i % 4) * 0.12, 0.05 + Math.floor(i / 4) * 0.068, 0.083); drawers.setMatrixAt(i, m4); }
  org.add(drawers);
  org.position.set(0.55, top, cz - 0.28); g.add(org);
  const lamp = new THREE.Group();
  const lampM = surface('paint', { color: 0x1d1d1f, metalness: 0.4, roughness: 0.45 });
  lamp.add(new THREE.Mesh(lathe([[0.001, 0], [0.065, 0], [0.068, 0.008], [0.05, 0.02], [0.014, 0.024], [0.001, 0.024]], 24), lampM));
  const j0 = new THREE.Vector3(0, 0.03, 0), j1 = new THREE.Vector3(0, 0.44, 0.15), j2 = new THREE.Vector3(0, 0.6, 0.42);
  for (const [a, b] of [[j0, j1], [j1, j2]] as const) for (const dx of [-0.012, 0.012]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, a.distanceTo(b), 8), lampM);
    rod.position.copy(a).add(b).multiplyScalar(0.5); rod.position.x += dx;
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); lamp.add(rod);
  }
  for (const j of [j0, j1]) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.04, 12), lampM); k.rotation.z = Math.PI / 2; k.position.copy(j); lamp.add(k); }
  const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([j0.clone().add(new THREE.Vector3(0, 0.08, 0.04)), j0.clone().lerp(j1, 0.6).add(new THREE.Vector3(0, 0, 0.04))]), 8, 0.004, 5), KIT.steel); lamp.add(spring);
  const shade = new THREE.Mesh(lathe([[0.015, 0.06], [0.03, 0.055], [0.055, 0.02], [0.085, -0.04], [0.08, -0.042], [0.05, 0.015], [0.026, 0.05], [0.012, 0.055]], 24), new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide }));
  shade.position.copy(j2); shade.rotation.x = 0.55; lamp.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0cc, emissiveIntensity: 2 }));
  bulb.position.copy(j2).add(new THREE.Vector3(0, -0.035, 0.02)); lamp.add(bulb);
  lamp.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  lamp.position.set(-0.95, top, cz - 0.3); g.add(lamp);
  // pegboard + tools: real drivers, combination wrenches, hex drivers in a rack
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.0), surface('pegboard', { repeat: [6, 2.2] }));
  peg.position.set(0, 1.55, -6.985); g.add(peg);
  box(2.74, 0.03, 0.02, M.wood, 0, 2.06, -6.98, g, false); box(2.74, 0.03, 0.02, M.wood, 0, 1.04, -6.98, g, false);
  for (let i = 0; i < 12; i++) {
    const d = driver(g, handleCols[i % handleCols.length], 0.08 + (i % 3) * 0.02, i % 4 === 3);
    d.rotation.x = Math.PI; d.position.set(-1.2 + i * 0.11, 1.84, -6.95);
  }
  box(1.4, 0.02, 0.035, M.black, -0.6, 1.85, -6.965, g, false); // driver rail
  for (let i = 0; i < 7; i++) {
    const len = 0.22 - i * 0.017;
    const w = new THREE.Mesh(wrenchGeometry(len), KIT.chrome);
    w.rotation.z = Math.PI / 2; w.position.set(0.25 + i * 0.075, 1.5, -6.968); w.castShadow = true; g.add(w);
    cyl(0.004, 0.03, M.chrome, 0.25 + i * 0.075, 1.5 + len / 2 - 0.01, -6.97, g, 6).rotation.x = Math.PI / 2;
  }
  // hex driver rack
  box(0.42, 0.03, 0.06, M.black, -0.55, 1.33, -6.95, g, false);
  for (let i = 0; i < 5; i++) {
    const d = driver(g, [0xd63a2f, 0x2557c9, 0xf2c230, 0x4ea83a, 0xe8e6e0][i], 0.06, true);
    d.rotation.x = Math.PI; d.position.set(-0.71 + i * 0.08, 1.42, -6.95);
  }
  tag(g, 'station', 'bench');
  parent.add(g);
  return g;
}

export function buildToolChest(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'tool-chest';
  drawerChest(g, { w: 0.9, h: 0.95, d: 0.5, drawers: [1, 1, 1, 1.2, 1.6, 2], color: 0xb3261e, casters: true, topMat: true });
  // top box with hinged lid and side handles
  const topBox = drawerChest(g, { w: 0.86, h: 0.34, d: 0.46, drawers: [1, 1], color: 0xb3261e });
  topBox.position.y = 0.96;
  box(0.88, 0.05, 0.48, surface('paint', { color: 0xc22b22, metalness: 0.35, roughness: 0.45 }), 0, 1.33, 0, g);
  for (const s of [-1, 1]) { const h = barPull(g, 0.16, s * 0.46, 1.05, 0); h.rotation.y = s * Math.PI / 2; }
  // top clutter
  bottle(g, -0.25, 1.355, 0.02, 0x2557c9, 0xf2c230);
  bottle(g, 0.2, 1.355, 0.05, 0xf2c230, 0x1d1d1f);
  bottle(g, 0.3, 1.355, -0.05, 0xd63a2f);
  g.position.set(-2.25, 0, -6.25);
  parent.add(g);
  return g;
}

export function buildPartsCabinet(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'parts-cabinet';
  box(0.9, 1.8, 0.5, surface('plastic', { color: 0x1c1d20, roughness: 0.55 }), 0, 0.9, 0, g);
  const rows = 12, cols = 4;
  const n = rows * cols;
  const recess = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.125), KIT.gap, n);
  const fronts = new THREE.InstancedMesh(roundedBox(0.19, 0.115, 0.02, 0.008), new THREE.MeshPhysicalMaterial({ color: 0xe8f0f6, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.38 }), n);
  const content = new THREE.InstancedMesh(roundedBox(0.15, 0.04, 0.03, 0.01), surface('plastic', { color: 0xffffff }), n);
  const pulls = new THREE.InstancedMesh(roundedBox(0.05, 0.012, 0.012, 0.004), new THREE.MeshPhysicalMaterial({ color: 0xe8f0f6, roughness: 0.1, transparent: true, opacity: 0.6 }), n);
  const labels = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.08, 0.022), std(0xf1eadb, 0.8), n);
  const m4 = new THREE.Matrix4();
  const tints = [0x2f6fd6, 0xc8ccd2, 0xe0782f, 0x2a2a2d, 0xc9a23a, 0x4ea83a];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, x = -0.315 + c * 0.21, y = 0.15 + r * 0.135;
    m4.makeTranslation(x, y, 0.252); recess.setMatrixAt(i, m4);
    m4.makeTranslation(x, y, 0.262); fronts.setMatrixAt(i, m4);
    m4.makeTranslation(x, y - 0.03, 0.235); content.setMatrixAt(i, m4);
    content.setColorAt(i, new THREE.Color(tints[(i * 7 + r) % tints.length]));
    m4.makeTranslation(x, y - 0.045, 0.276); pulls.setMatrixAt(i, m4);
    m4.makeTranslation(x, y + 0.03, 0.2725); labels.setMatrixAt(i, m4);
  }
  g.add(recess, content, fronts, pulls, labels);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.13), new THREE.MeshBasicMaterial({ map: labelTexture('PARTS', { bg: '#1c1c1e', fg: '#f4efe6', stripe: '#d63a2f', w: 512, h: 96, font: '800 60px "Barlow Condensed", system-ui, sans-serif' }) }));
  sign.position.set(0, 1.86, 0.26); g.add(sign);
  // spare wheels on top
  const stg = tireGeometry(0.07, 0.055, 3, 20);
  for (let i = 0; i < 2; i++) {
    const t = new THREE.Mesh(stg, M.rubber);
    t.position.set(-0.2 + i * 0.16, 1.87, -0.05); t.castShadow = true; g.add(t);
    const rim = new THREE.Mesh(rimGeometry(0.045, 0.05), surface('plastic', { color: 0xe8e6e0 })); rim.position.copy(t.position); g.add(rim);
  }
  g.position.set(2.2, 0, -6.2);
  tag(g, 'station', 'parts');
  parent.add(g);
  return g;
}

export function buildBackWallDecor(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'back-wall-decor';
  // clock (no real time system — hands are static at a friendly hour)
  const clock = new THREE.Group();
  cyl(0.16, 0.04, M.black, 0, 0, 0, clock, 32).rotation.x = Math.PI / 2;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.14, 32), new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (c) => {
    c.fillStyle = '#f4efe6'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#1d1d1f';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.fillRect(64 + Math.sin(a) * 52 - 2, 64 - Math.cos(a) * 52 - 5, 4, 10); }
    c.lineCap = 'round'; c.strokeStyle = '#1d1d1f'; c.lineWidth = 6; c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + 26, 64 - 18); c.stroke();
    c.lineWidth = 4; c.beginPath(); c.moveTo(64, 64); c.lineTo(64 - 8, 64 - 44); c.stroke();
    c.strokeStyle = '#d63a2f'; c.lineWidth = 2; c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + 30, 64 + 30); c.stroke();
  }) }));
  face.position.z = 0.021; clock.add(face);
  clock.position.set(-2.25, 2.42, -6.97); g.add(clock);
  // original posters above the tool chest
  picture(posterTex('RUTTFORGE', 'RF-B1 RUTSPARK', '#3a2a22', '#e0782f', (c) => {
    c.fillStyle = '#e0782f'; c.beginPath(); c.moveTo(40, 200); c.lineTo(110, 120); c.lineTo(200, 120); c.lineTo(226, 200); c.closePath(); c.fill();
    c.fillStyle = '#1d1d1f'; for (const x of [70, 190]) { c.beginPath(); c.arc(x, 205, 26, 0, Math.PI * 2); c.fill(); }
  }), 0.46, 0.64, -2.48, 1.72, -6.985, 's', g);
  picture(posterTex('DIRT DAYS', 'CLUB RACING · SUNDAYS', '#2c3a2a', '#9cc35a', (c) => {
    c.fillStyle = '#9cc35a'; for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(40 + i * 45, 200 - (i % 2) * 40, 30, Math.PI, 0); c.fill(); }
  }), 0.46, 0.64, -1.92, 1.82, -6.985, 's', g);
  // setup-note board above the parts cabinet (tappable: shows current setup)
  const notes = new THREE.Group();
  box(0.66, 0.42, 0.02, std(0xf6f6f2, 0.4), 0, 0, 0, notes);
  box(0.7, 0.03, 0.04, M.steelLight, 0, -0.225, 0.01, notes, false);
  const scribble = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.36), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTex(256, 160, (c) => {
    c.strokeStyle = '#2557c9'; c.lineWidth = 3; c.font = '700 22px "Segoe Print", "Comic Sans MS", cursive'; c.fillStyle = '#2557c9';
    c.fillText('SETUP NOTES', 18, 32); c.fillStyle = '#333';
    c.font = '18px "Segoe Print", "Comic Sans MS", cursive';
    c.fillText('tires: mini-pin', 18, 66); c.fillText('shocks: med.', 18, 94); c.fillText('check diff!', 18, 122);
    c.strokeStyle = '#d63a2f'; c.beginPath(); c.arc(200, 110, 26, 0, Math.PI * 2); c.stroke();
  }) }));
  scribble.position.z = 0.012; notes.add(scribble);
  notes.position.set(2.2, 2.12, -6.97);
  tag(notes, 'decor', 'notes');
  g.add(notes);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- left wall: vehicle shelving, tires, shells, trophies
const gussetGeo = (() => {
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.05, 0); sh.lineTo(0, -0.05); sh.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.003, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  return geo;
})();

/** Vehicle shelving: three bays × four levels. Every vehicle has its own lit, labelled slot; vehicles you
 *  don't own yet sit there as a boxed kit. Positions are where each vehicle's ground origin goes. */
export const SHELF = { x: -2.68, z0: -5.85, z1: -2.75, depth: 0.62, levels: [0.35, 0.95, 1.55, 2.15] };
const BAY = (i: number) => SHELF.z0 + ((i + 0.5) / 3) * (SHELF.z1 - SHELF.z0);
export type ShelfVehicle = 'buggy' | 'buggy2wd' | 'stadium' | 'sct' | 'truggy' | 'crawler' | 'monster' | 'drift';
export const SHELF_SLOTS: Record<ShelfVehicle, { at: THREE.Vector3; rot: number; label: string; kit?: 'buggy' | 'truck' }> = {
  buggy2wd: { at: new THREE.Vector3(SHELF.x, 0.96, BAY(0)), rot: 0, label: 'KESTREL 2WD', kit: 'buggy' },
  buggy:    { at: new THREE.Vector3(SHELF.x, 0.96, BAY(1)), rot: 0, label: 'DIRT DART 1/8' },
  stadium:  { at: new THREE.Vector3(SHELF.x, 0.96, BAY(2)), rot: 0, label: 'THUMPER ST', kit: 'truck' },
  truggy:   { at: new THREE.Vector3(SHELF.x, 1.56, BAY(0)), rot: 0, label: 'BRUTE T8', kit: 'buggy' },
  sct:      { at: new THREE.Vector3(SHELF.x, 1.56, BAY(1)), rot: 0, label: 'DUNEWOLF SC10', kit: 'truck' },
  monster:  { at: new THREE.Vector3(SHELF.x, 1.56, BAY(2)), rot: Math.PI / 2, label: 'MUDHAMMER' },
  crawler:  { at: new THREE.Vector3(SHELF.x, 2.16, BAY(0)), rot: Math.PI / 2, label: 'CRAWLER' },
  drift:    { at: new THREE.Vector3(SHELF.x, 2.16, BAY(1)), rot: Math.PI / 2, label: 'RD-1 DRIFT' },
};

export function buildStorageWall(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'storage-wall';
  const shelves = new THREE.Group(); shelves.name = 'vehicle-shelves';
  const { x: x0, z0, z1, depth } = SHELF, half = depth / 2 - 0.02, len = z1 - z0;
  const slotted = surface('slotted', { metalness: 0.6, repeat: [1, 18] });
  for (let i = 0; i <= 3; i++) for (const dx of [-half, half]) {
    const z = z0 + (i / 3) * len;
    box(0.045, 2.32, 0.008, slotted, x0 + dx, 1.16, z + (i === 3 ? -0.018 : 0.018), shelves);
    box(0.008, 2.32, 0.045, slotted, x0 + dx + (dx > 0 ? -0.018 : 0.018), 1.16, z, shelves);
  }
  const ys = SHELF.levels;
  const shelfM = surface('paint', { color: 0x6e7279, metalness: 0.45, roughness: 0.5, repeat: [1, 6] });
  const ledM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 1.6 });
  for (const y of ys) {
    box(depth - 0.04, 0.02, len + 0.04, shelfM, x0, y, (z0 + z1) / 2, shelves);
    // folded front/back lips so each shelf reads as formed steel, not a slab
    for (const dx of [-half - 0.01, half + 0.01]) box(0.02, 0.045, len + 0.04, shelfM, x0 + dx, y - 0.012, (z0 + z1) / 2, shelves, false);
    // corner gussets
    for (let i = 0; i <= 3; i++) for (const dx of [-half + 0.02, half - 0.02]) {
      const z = z0 + (i / 3) * len;
      const gus = new THREE.Mesh(gussetGeo, M.steelLight);
      gus.position.set(x0 + dx, y - 0.012, z + (i === 3 ? -0.03 : 0.03)); gus.rotation.y = i === 3 ? Math.PI : 0; shelves.add(gus);
    }
    // LED strip under the front lip lights the level below
    if (y > 0.4) { const led = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, len - 0.08), ledM); led.position.set(x0 + half - 0.03, y - 0.016, (z0 + z1) / 2); shelves.add(led); }
  }
  // a printed label plate on the front lip under every vehicle slot
  for (const [, slot] of Object.entries(SHELF_SLOTS)) {
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.05), new THREE.MeshBasicMaterial({ map: labelTexture(slot.label, { bg: '#1d1d1f', fg: '#f4efe6', w: 512, h: 76, font: '800 46px "Barlow Condensed", system-ui, sans-serif', stripe: '#e8b923' }) }));
    lab.rotation.y = Math.PI / 2; lab.position.set(x0 + half + 0.022, slot.at.y - 0.03, slot.at.z); shelves.add(lab);
    // rubber mat under each car
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(depth - 0.1, 0.62), std(0x2b2b2d, 0.95));
    mat.rotation.x = -Math.PI / 2; mat.position.set(x0, slot.at.y + 0.002, slot.at.z); shelves.add(mat);
  }
  // boxed kits for the buggy-class vehicles you don't own yet (the scene swaps each for the car once bought)
  for (const [id, slot] of Object.entries(SHELF_SLOTS)) {
    if (!slot.kit) continue;
    const kit = new THREE.Group(); kit.name = `kit-${id}`; shelves.add(kit);
    const kb = kitBox(kit, 0.36, 0.24, 0.46, (c, W, H) => {
      const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, slot.kit === 'truck' ? '#5a2a1c' : '#2a3b55'); gr.addColorStop(1, '#141414');
      c.fillStyle = gr; c.fillRect(0, 0, W, H);
      vehiclePrint(slot.kit!, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)'], '#f4efe6')(c, W, H);
      c.fillStyle = '#f4efe6'; c.font = '800 34px "Barlow Condensed", system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(slot.label, W / 2, H - 18);
    });
    kb.position.set(x0, slot.at.y + 0.002, slot.at.z);
  }
  // drift car kit box on the top shelf (the scene swaps it for the car once it's bought)
  const driftKit = new THREE.Group(); driftKit.name = 'drift-kit'; shelves.add(driftKit);
  const dkb = kitBox(driftKit, 0.36, 0.24, 0.42, (c, W, H) => {
    const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#b8bcc4'); gr.addColorStop(1, '#141414');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    vehiclePrint('drift', ['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)'], '#f4efe6')(c, W, H);
  });
  dkb.position.set(x0, SHELF_SLOTS.drift.at.y + 0.002, SHELF_SLOTS.drift.at.z);
  // numbered storage bins on the bottom shelf
  for (let i = 0; i < 6; i++) {
    const z = z0 + 0.27 + i * (len - 0.54) / 5;
    const bin = taperedBin(shelves, 0.4, 0.21, 0.4, 0x1f2023, [0xe8b923, 0xe8b923, 0x2557c9, 0xe8b923, 0xd63a2f, 0x2557c9][i]);
    bin.position.set(x0, 0.36, z);
    const n = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), new THREE.MeshBasicMaterial({ map: labelTexture(String(i + 1).padStart(2, '0'), { bg: '#f1eadb', fg: '#1d1d1f', w: 128, h: 96, font: '800 60px "Barlow Condensed", system-ui, sans-serif' }) }));
    n.rotation.y = Math.PI / 2; n.position.set(x0 + 0.205, 0.5, z); shelves.add(n);
  }
  // sign over the unit
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.16), new THREE.MeshBasicMaterial({ map: labelTexture('THE FLEET', { bg: '#1d1d1f', fg: '#e8b923', w: 768, h: 102, font: '900 64px "Barlow Condensed", system-ui, sans-serif' }) }));
  sign.rotation.y = Math.PI / 2; sign.position.set(-2.975, 2.5, BAY(1)); shelves.add(sign);
  tag(shelves, 'station', 'storage');
  g.add(shelves);
  // tire rack
  const rack = new THREE.Group();
  for (const y of [0.5, 1.1]) box(0.3, 0.025, 0.7, M.steel, 0, y, 0, rack);
  const tg = tireGeometry(0.075, 0.06, 3, 22), rg = rimGeometry(0.048, 0.056);
  const rimMat = surface('plastic', { color: 0x2a2a2d });
  for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
    const wheel = new THREE.Group();
    const t = new THREE.Mesh(tg, M.rubber); t.castShadow = true; wheel.add(t);
    wheel.add(new THREE.Mesh(rg, rimMat));
    wheel.rotation.z = Math.PI / 2; wheel.position.set(0, [0.59, 1.19][r], -0.24 + i * 0.16); rack.add(wheel);
  }
  rack.position.set(-2.82, 0, -2.3); g.add(rack);
  // body-shell hooks with spare shells
  const hook = new THREE.Group();
  box(0.04, 0.04, 0.9, M.steelLight, 0, 0, 0, hook);
  [[0xe0782f, -0.24], [0x4ea83a, 0.24]].forEach(([c, z]) => {
    const s = new THREE.Mesh(spareShellGeometry(), new THREE.MeshPhysicalMaterial({ color: c as number, roughness: 0.35, clearcoat: 1, side: THREE.DoubleSide }));
    // hung nose-down on a peg, open side to the wall
    s.rotation.set(0, 0, -Math.PI / 2); s.position.set(0.02, -0.02, z as number); s.castShadow = true; hook.add(s);
    cyl(0.006, 0.08, M.chrome, 0.03, 0.0, z as number, hook, 8).rotation.z = Math.PI / 2;
  });
  hook.position.set(-2.96, 1.75, -1.55); g.add(hook);
  // trophy shelf (tappable: shows best times)
  const trophies = new THREE.Group();
  box(0.2, 0.025, 0.6, M.wood, 0, 0, 0, trophies);
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Group();
    box(0.06, 0.03, 0.06, M.black, 0, 0.03, 0, t);
    cyl(0.012, 0.08 + i * 0.02, std(0xd4a62a, 0.3, 0.85), 0, 0.09 + i * 0.01, 0, t, 8);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.06, 14), std(0xd4a62a, 0.3, 0.85)); cup.position.y = 0.16 + i * 0.02; t.add(cup);
    t.position.set(0, 0, -0.18 + i * 0.18); trophies.add(t);
  }
  trophies.position.set(-2.88, 2.25, -2.3);
  tag(trophies, 'decor', 'trophy');
  g.add(trophies);
  // framed club photograph
  picture(canvasTex(240, 170, (c) => {
    const gr = c.createLinearGradient(0, 0, 0, 170); gr.addColorStop(0, '#8fb6d8'); gr.addColorStop(0.55, '#d5c49b'); gr.addColorStop(1, '#a4825a');
    c.fillStyle = gr; c.fillRect(0, 0, 240, 170);
    c.fillStyle = '#3d5a2e'; for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(i * 30, 92); c.lineTo(i * 30 + 15, 50); c.lineTo(i * 30 + 30, 92); c.fill(); }
    const cols = ['#2557c9', '#d63a2f', '#2b2b2d', '#e0782f', '#4ea83a'];
    cols.forEach((col, i) => { c.fillStyle = col; c.fillRect(30 + i * 40, 104, 22, 40); c.fillStyle = '#e8c4a0'; c.beginPath(); c.arc(41 + i * 40, 98, 9, 0, Math.PI * 2); c.fill(); });
    c.fillStyle = 'rgba(255,255,255,.85)'; c.font = '700 13px system-ui'; c.fillText('BRACKENBANK MODEL CLUB', 34, 162);
  }), 0.5, 0.36, -2.985, 1.55, -0.85, 'e', g, 0x3a2a1c);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- right wall: charging bench, club board, side door
export interface ChargerRig { group: THREE.Group; displays: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[]; leds: THREE.MeshStandardMaterial[] }

export function buildChargingWall(parent: THREE.Object3D): ChargerRig {
  const g = new THREE.Group(); g.name = 'charging-wall';
  const bench = new THREE.Group(); bench.name = 'charging-bench';
  const x0 = 2.66, cz = -4.7, top = 0.85;
  box(0.62, 0.05, 1.7, M.wood, x0, top - 0.025, cz, bench);
  for (const dx of [-0.26, 0.26]) for (const dz of [-0.8, 0.8]) box(0.05, top - 0.05, 0.05, M.wood, x0 + dx, (top - 0.05) / 2, cz + dz, bench);
  box(0.56, 0.04, 1.6, M.wood, x0, 0.22, cz, bench);
  // LiPo storage: steel ammo-can style box with latch and carry handle (battery storage)
  const can = new THREE.Group();
  box(0.34, 0.19, 0.48, surface('paint', { color: 0x3b4a2c, metalness: 0.4, roughness: 0.55 }), 0, 0.095, 0, can);
  box(0.36, 0.035, 0.5, surface('paint', { color: 0x435433, metalness: 0.4, roughness: 0.5 }), 0, 0.205, 0, can);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16, Math.PI), KIT.steel); handle.rotation.y = Math.PI / 2; handle.position.set(0, 0.225, 0); can.add(handle);
  box(0.03, 0.08, 0.06, KIT.steel, -0.175, 0.16, 0, can, false);
  can.position.set(x0, 0.24, cz + 0.45); bench.add(can);
  const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.08), new THREE.MeshBasicMaterial({ map: labelTexture('LIPO STORAGE', { bg: '#f2c230', fg: '#1d1d1f', w: 512, h: 128, font: '800 60px "Barlow Condensed", system-ui, sans-serif' }) }));
  warn.rotation.y = -Math.PI / 2; warn.position.set(x0 - 0.172, 0.34, cz + 0.45); bench.add(warn);
  // pegboard, power strip with real sockets
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.9), surface('pegboard', { repeat: [6, 2.2] }));
  peg.rotation.y = -Math.PI / 2; peg.position.set(2.985, 1.4, cz); bench.add(peg);
  box(0.045, 0.06, 1.3, surface('plastic', { color: 0x1d1d1f, roughness: 0.5 }), 2.955, 1.05, cz, bench, false);
  for (let i = 0; i < 6; i++) {
    const zz = cz - 0.5 + i * 0.2;
    box(0.008, 0.045, 0.045, surface('plastic', { color: 0x2a2a2d }), 2.93, 1.05, zz, bench, false);
    for (const dz of [-0.008, 0.008]) box(0.004, 0.014, 0.004, KIT.gap, 2.925, 1.055, zz + dz, bench, false);
  }
  box(0.02, 0.03, 0.03, std(0xd63a2f, 0.4), 2.93, 1.05, cz + 0.6, bench, false); // illuminated switch
  // two hobby chargers with live displays (driven by battery state), leads to the pack slots
  const displays: ChargerRig['displays'] = [];
  const leds: THREE.MeshStandardMaterial[] = [];
  ANCHORS.chargerPack.forEach((p, i) => {
    const { group: ch, face } = chargerBody(bench, 0x1f2124, i ? 0x2557c9 : 0xd63a2f);
    ch.position.set(2.72, top, p.z);
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.052), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.3 }));
    disp.rotation.y = -Math.PI / 2; disp.position.set(-0.0075, 0.012, -0.03); face.add(disp);
    const led = new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x22cc44, emissiveIntensity: 1.4 });
    const ledM = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), led); ledM.position.set(-0.006, 0.035, 0.085); face.add(ledM);
    // charge leads from the front jacks down to where the pack sits; mains lead up to the strip
    const jx = 2.708, jy = top + 0.036;
    cable(bench, [[jx, jy, p.z + 0.06], [2.65, top + 0.03, p.z + 0.11], [2.655, top + 0.008, p.z + 0.06], [2.7, top + 0.012, p.z + 0.03]], 0.003, 0xb93228, 20);
    cable(bench, [[jx, jy, p.z + 0.09], [2.66, top + 0.024, p.z + 0.13], [2.66, top + 0.008, p.z + 0.07], [2.7, top + 0.012, p.z + 0.035]], 0.003, 0x1a1a1a, 20);
    cable(bench, [[jx, top + 0.022, p.z - 0.03], [2.66, top + 0.012, p.z - 0.09], [2.69, top + 0.008, p.z - 0.05]], 0.002, 0xf1eadb, 16);
    cable(bench, [[2.95, top + 0.06, p.z + 0.08], [2.975, top + 0.12, p.z + 0.06], [2.965, 0.98, p.z * 0.8 + cz * 0.2], [2.94, 1.03, cz - 0.5 + i * 0.2]], 0.005, 0x141414, 24);
    displays.push({ canvas, tex }); leds.push(led);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.14), new THREE.MeshBasicMaterial({ map: labelTexture('CHARGING', { bg: '#1c1c1e', fg: '#f4efe6', stripe: '#d63a2f', w: 512, h: 96, font: '800 60px "Barlow Condensed", system-ui, sans-serif' }) }));
  sign.rotation.y = -Math.PI / 2; sign.position.set(2.98, 1.95, cz); bench.add(sign);
  tag(bench, 'station', 'charging');
  g.add(bench);

  // club notice board (tappable: shows events)
  const club = new THREE.Group();
  box(0.03, 0.62, 0.86, M.cork, 0, 0, 0, club);
  box(0.035, 0.66, 0.9, std(0x5a3d22), 0.005, 0, 0, club, false).position.x = 0.012;
  const papers: [number, number, number, number, string][] = [[-0.12, 0.25, 0.22, 0.28, '#f4efe6'], [0.12, 0.25, 0.18, 0.22, '#f2c230'], [0.22, -0.28, 0.24, 0.18, '#f4efe6'], [-0.15, -0.3, 0.2, 0.2, '#cfe3f2']];
  papers.forEach(([dy, dz, w, hgt, col]) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshStandardMaterial({ roughness: 0.9, map: canvasTex(128, 160, (c) => {
      c.fillStyle = col; c.fillRect(0, 0, 128, 160); c.fillStyle = '#333';
      for (let i = 0; i < 6; i++) c.fillRect(12, 24 + i * 20, 70 + ((i * 37) % 30), 5);
      c.fillStyle = '#d63a2f'; c.beginPath(); c.arc(64, 8, 5, 0, Math.PI * 2); c.fill();
    }) }));
    p.rotation.y = -Math.PI / 2; p.position.set(-0.02, dy, dz); club.add(p);
  });
  const head = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.1), new THREE.MeshBasicMaterial({ map: labelTexture('CLUB BOARD', { bg: '#1c1c1e', fg: '#f2c230', w: 512, h: 96, font: '800 60px "Barlow Condensed", system-ui, sans-serif' }) }));
  head.rotation.y = -Math.PI / 2; head.position.set(-0.02, 0.37, 0); club.add(head);
  club.position.set(2.975, 1.5, -2.75);
  tag(club, 'decor', 'club');
  g.add(club);
  // coiled extension lead on a wall hook + framed race prints between the club board and the chargers
  const hook = new THREE.Group();
  box(0.03, 0.05, 0.12, M.steel, 0, 0, 0, hook, false);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 8, 32), surface('rubber', { color: 0xe0782f, repeat: [8, 1] }));
  coil.rotation.y = Math.PI / 2; coil.position.set(-0.04, -0.12, 0); coil.scale.set(1, 1.25, 1); hook.add(coil);
  for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.12 - i * 0.005, 0.015, 8, 32), coil.material); t.rotation.y = Math.PI / 2; t.position.set(-0.04 + i * 0.012, -0.13 - i * 0.01, 0); t.scale.set(1, 1.2, 1); hook.add(t); }
  hook.position.set(2.97, 1.55, -3.35); g.add(hook);
  framedPrint(g, 2.985, 2.05, -3.3, 'w', 0.4, 0.28, vehiclePrint('monster', ['#4a1c1c', '#200c0c'], '#d63a2f'));
  // side door with a small window (daylight)
  const door = new THREE.Group();
  const doorWhite = surface('paint', { color: 0xf3f1ec });
  box(0.07, 2.08, 0.94, surface('paint', { color: 0xe4e0d8 }), 0.012, 1.04, 0, door, false); // frame
  box(0.05, 2.0, 0.82, doorWhite, 0, 1.0, 0, door);
  for (const [y, hgt] of [[0.45, 0.62], [1.32, 0.86]] as const) for (const z of [-0.19, 0.19]) box(0.02, hgt, 0.3, doorWhite, -0.03, y, z, door, false);
  cyl(0.028, 0.07, M.chrome, -0.06, 1.0, -0.32, door, 14).rotation.z = Math.PI / 2;
  cyl(0.04, 0.012, M.chrome, -0.03, 1.0, -0.32, door, 14).rotation.z = Math.PI / 2;
  door.position.set(2.97, 0, -1.1);
  tag(door, 'station', 'departure');
  g.add(door);
  parent.add(g);
  return { group: g, displays, leds };
}

// ---------------------------------------------------------------- loose floor props
export function buildFloorProps(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'floor-props';
  const stool = new THREE.Group();
  const seat = new THREE.Mesh(lathe([[0.001, 0.0], [0.17, 0.0], [0.19, 0.015], [0.195, 0.04], [0.185, 0.062], [0.12, 0.072], [0.001, 0.074]], 32), surface('rubber', { color: 0x1d1d1f }));
  seat.position.y = 0.655; stool.add(seat);
  cyl(0.03, 0.4, M.chrome, 0, 0.47, 0, stool, 12);
  cyl(0.022, 0.3, M.black, 0, 0.3, 0, stool, 12);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.012, 8, 32), M.chrome); ring.rotation.x = Math.PI / 2; ring.position.y = 0.24; stool.add(ring);
  // five-star base with casters
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = new THREE.Mesh(roundedBox(0.3, 0.03, 0.045, 0.012), M.black);
    leg.position.set(Math.cos(a) * 0.15, 0.09, Math.sin(a) * 0.15); leg.rotation.y = -a; leg.rotation.z = 0.12 * Math.sign(Math.cos(0)); stool.add(leg);
    caster(stool, Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0.025);
  }
  stool.position.set(0.42, 0, -5.4); g.add(stool);
  const bin = new THREE.Mesh(lathe([[0.001, 0], [0.14, 0], [0.145, 0.01], [0.168, 0.4], [0.178, 0.41], [0.178, 0.425], [0.162, 0.425], [0.152, 0.41], [0.132, 0.02], [0.001, 0.02]], 28), surface('plastic', { color: 0x3b4048, side: THREE.DoubleSide }));
  bin.position.set(1.5, 0, -5.55); g.add(bin);
  g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  // soft contact shadows where furniture meets the floor (cheap, no extra shadow maps)
  const S: [number, number, number, number][] = [
    [-0.78, -6.46, 0.95, 0.75], [0.78, -6.46, 0.95, 0.75], [0, -6.5, 2.9, 0.95],          // bench + roll cabinets
    [-2.25, -6.25, 1.15, 0.75], [2.2, -6.2, 1.1, 0.7],                                   // tool chest, parts cabinet
    [-2.68, -4.3, 0.85, 3.25], [-2.82, -2.3, 0.45, 0.9],                                     // vehicle shelving, tyre rack
    [2.66, -4.7, 0.8, 1.9], [0.42, -5.4, 0.75, 0.75], [1.5, -5.55, 0.5, 0.5],             // charging bench, stool, bin
    [2.45, -0.45, 0.7, 0.55], [-2.2, -0.35, 0.5, 0.4], [-2.55, -0.25, 1.0, 0.3], [-2.62, -1.05, 0.7, 0.6], [2.66, -2.25, 0.65, 0.7],
  ];
  for (const [x, z, w, d] of S) contactShadow(g, x, z, w, d);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- shared small builders
let shellGeoCache: THREE.BufferGeometry | null = null;
/** A spare Lexan buggy body for decor (same family of shape as the real shell). */
function spareShellGeometry() {
  if (shellGeoCache) return shellGeoCache;
  shellGeoCache = new ParametricGeometry((u: number, v: number, t: THREE.Vector3) => {
    const x = 0.24 - u * 0.46, th = v * Math.PI, sn = Math.sin(th);
    const w = 0.05 + 0.04 * Math.sin(Math.min(1, (0.26 - x) / 0.3) * Math.PI / 2);
    const hgt = 0.015 + 0.085 * Math.exp(-Math.pow((x + 0.02) / 0.14, 2));
    t.set(x, hgt * Math.pow(sn, 0.55), Math.cos(th) * w);
  }, 32, 16);
  shellGeoCache.computeVertexNormals();
  return shellGeoCache;
}

function bottle(parent: THREE.Object3D, x: number, y: number, z: number, color: number, cap = 0xf4efe6, scale = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(lathe([[0.001, 0], [0.024, 0], [0.026, 0.004], [0.026, 0.07], [0.02, 0.085], [0.009, 0.095], [0.009, 0.105], [0.001, 0.105]], 18), surface('plastic', { color }));
  const lid = new THREE.Mesh(lathe([[0.001, 0.104], [0.011, 0.104], [0.011, 0.122], [0.004, 0.13], [0.001, 0.13]], 14), surface('plastic', { color: cap }));
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0265, 0.0265, 0.035, 18, 1, true), surface('plastic', { color: 0xf1eadb }));
  label.position.y = 0.035;
  g.add(body, lid, label);
  g.position.set(x, y, z); g.scale.setScalar(scale);
  g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  parent.add(g);
  return g;
}

function plant(parent: THREE.Object3D, x: number, y: number, z: number, scale = 1) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(lathe([[0.001, 0], [0.06, 0], [0.075, 0.11], [0.08, 0.115], [0.08, 0.125], [0.072, 0.125], [0.001, 0.1]], 22), surface('plastic', { color: 0x2b2b2d }));
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), surface('dirt', { color: 0x3a2a1c }));
  soil.rotation.x = -Math.PI / 2; soil.position.y = 0.11; g.add(soil);
  const leafGeo = new THREE.SphereGeometry(1, 10, 6);
  leafGeo.scale(0.02, 0.006, 0.075); leafGeo.translate(0, 0, 0.07);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.6, side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 22);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < 22; i++) {
    const a = i * 2.39996, tilt = 0.25 + (i % 5) * 0.16;
    e.set(-tilt, a, 0); q.setFromEuler(e);
    m.compose(new THREE.Vector3(0, 0.11 + (i % 4) * 0.025, 0), q, new THREE.Vector3(1, 1, 0.8 + (i % 3) * 0.25));
    leaves.setMatrixAt(i, m);
    leaves.setColorAt(i, new THREE.Color(0x3f7a35).multiplyScalar(0.75 + (i % 4) * 0.12));
  }
  g.add(leaves);
  g.position.set(x, y, z); g.scale.setScalar(scale);
  parent.add(g);
  return g;
}

function screwdriver(parent: THREE.Object3D, x: number, y: number, z: number, color: number, rotY: number) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(lathe([[0.001, 0], [0.008, 0.002], [0.01, 0.02], [0.009, 0.05], [0.0075, 0.065], [0.003, 0.068], [0.001, 0.068]], 12), surface('plastic', { color }));
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.07, 8), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.25 }));
  shaft.position.y = 0.1;
  g.add(handle, shaft);
  g.rotation.set(0, rotY, Math.PI / 2);
  g.position.set(x, y + 0.01, z);
  g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  parent.add(g);
}

function pliers(parent: THREE.Object3D, x: number, y: number, z: number, color: number, rot: number, vertical = false) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.08, 4, 8), surface('plastic', { color }));
    grip.position.set(0, -0.06, 0); arm.add(grip);
    const jaw = new THREE.Mesh(roundedBox(0.008, 0.05, 0.006, 0.002), steel);
    jaw.position.set(0, 0.03, 0); arm.add(jaw);
    arm.rotation.z = s * 0.1; arm.position.x = s * 0.006;
    g.add(arm);
  }
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 12), steel);
  pivot.rotation.x = Math.PI / 2; g.add(pivot);
  if (!vertical) g.rotation.set(-Math.PI / 2, 0, rot); else g.rotation.z = rot;
  g.position.set(x, y, z);
  parent.add(g);
}

function tote(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, lid = 0xe8b923, rotY = 0) {
  const g = taperedBin(parent, w, h, d, 0x1f2023, lid);
  g.position.set(x, y, z); g.rotation.y = rotY;
  return g;
}

function framedPrint(parent: THREE.Object3D, x: number, y: number, z: number, face: 'n' | 's' | 'e' | 'w', w: number, h: number, draw: (c: CanvasRenderingContext2D, W: number, H: number) => void) {
  const tex = canvasTex(256, Math.round(256 * h / w), (c) => draw(c, 256, Math.round(256 * h / w)));
  return picture(tex, w, h, x, y, z, face, parent, 0x141414);
}

/** Original vehicle illustrations for the framed prints (fictional names, no real brands). */
const PRINT_NAMES: Record<string, [string, string]> = {
  buggy: ['DIRT DART', '1/8 OFF-ROAD BUGGY'], crawler: ['ROCK HOUND', 'SCALE TRAIL CRAWLER'], truck: ['RUTT HAULER', 'SHORT COURSE TRUCK'],
  monster: ['MUDMAULER', 'BASH MONSTER'], drift: ['SLIDEWAY', 'TOURING DRIFT'],
};
function vehiclePrint(kind: 'buggy' | 'crawler' | 'monster' | 'drift' | 'truck', bg: [string, string], body: string) {
  return (c: CanvasRenderingContext2D, W: number, H: number) => {
    const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]);
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    // sunburst
    c.save(); c.translate(W * 0.62, H * 0.55); c.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 18; i++) { c.rotate(Math.PI / 9); c.beginPath(); c.moveTo(0, 0); c.lineTo(W, -14); c.lineTo(W, 14); c.closePath(); c.fill(); }
    c.restore();
    // dirt ground + dust
    const gy = H * 0.74;
    const dg = c.createLinearGradient(0, gy, 0, H); dg.addColorStop(0, '#7a5a3a'); dg.addColorStop(1, '#3a2a1a');
    c.fillStyle = dg; c.fillRect(0, gy, W, H - gy);
    c.fillStyle = 'rgba(230,205,170,.18)';
    for (let i = 0; i < 9; i++) { c.beginPath(); c.ellipse(W * 0.12 + i * 13, gy - 6 - (i % 3) * 5, 22 - i, 12 - i * 0.6, 0, 0, Math.PI * 2); c.fill(); }
    // speed streaks
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 2;
    for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(12, H * 0.38 + i * 9); c.lineTo(52 + (i % 2) * 14, H * 0.38 + i * 9); c.stroke(); }
    const big = kind === 'monster' ? 30 : kind === 'crawler' ? 25 : kind === 'drift' ? 15 : kind === 'truck' ? 21 : 19;
    const wy = gy - big * 0.55;
    const x0 = W * 0.3, x1 = W * 0.82;
    const bodyY = wy - (kind === 'monster' ? big * 1.1 : kind === 'crawler' ? big * 0.9 : big * 0.5);
    // body with shading
    const bgd = c.createLinearGradient(0, bodyY - 30, 0, bodyY + 18); bgd.addColorStop(0, '#ffffff'); bgd.addColorStop(0.18, body); bgd.addColorStop(1, 'rgba(0,0,0,.85)');
    c.fillStyle = body; c.beginPath();
    if (kind === 'buggy') { c.moveTo(x0 - 26, bodyY + 8); c.quadraticCurveTo(x0, bodyY - 6, x0 + 40, bodyY - 18); c.quadraticCurveTo(x1 - 30, bodyY - 24, x1 + 12, bodyY + 2); c.lineTo(x1 + 16, bodyY + 10); c.closePath(); }
    else if (kind === 'drift') { c.moveTo(x0 - 30, bodyY + 10); c.lineTo(x0 - 18, bodyY - 4); c.quadraticCurveTo(x0 + 20, bodyY - 30, x0 + 62, bodyY - 28); c.lineTo(x1 + 4, bodyY - 6); c.lineTo(x1 + 22, bodyY + 10); c.closePath(); }
    else { c.moveTo(x0 - 28, bodyY + 10); c.lineTo(x0 - 24, bodyY - 12); c.lineTo(x0 + 18, bodyY - 14); c.lineTo(x0 + 34, bodyY - 34); c.lineTo(x1 - 6, bodyY - 34); c.lineTo(x1 + 10, bodyY - 12); c.lineTo(x1 + 22, bodyY - 10); c.lineTo(x1 + 22, bodyY + 10); c.closePath(); }
    c.fill(); c.fillStyle = bgd; c.globalAlpha = 0.55; c.fill(); c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1.5; c.stroke();
    // windows / cockpit
    c.fillStyle = 'rgba(15,20,26,.85)';
    if (kind === 'buggy') { c.beginPath(); c.ellipse(x0 + 52, bodyY - 14, 18, 7, -0.1, 0, Math.PI * 2); c.fill(); c.fillStyle = '#18181a'; c.fillRect(x0 - 40, bodyY - 30, 30, 6); c.fillRect(x0 - 30, bodyY - 26, 4, 18); }
    else if (kind === 'drift') { c.beginPath(); c.moveTo(x0 + 8, bodyY - 8); c.quadraticCurveTo(x0 + 30, bodyY - 26, x0 + 60, bodyY - 24); c.lineTo(x0 + 70, bodyY - 8); c.closePath(); c.fill(); }
    else { c.fillRect(x0 + 38, bodyY - 30, 34, 14); c.fillRect(x0 + 78, bodyY - 30, 30, 14); }
    if (kind === 'crawler') { c.strokeStyle = '#1d1d1f'; c.lineWidth = 3; c.strokeRect(x0 + 30, bodyY - 44, 80, 12); }
    // wheels with tread and rims
    const wheel = (x: number) => {
      c.fillStyle = '#121212'; c.beginPath(); c.arc(x, wy, big, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2a2a2a'; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; c.save(); c.translate(x + Math.cos(a) * big, wy + Math.sin(a) * big); c.rotate(a); c.fillRect(-2, -3, 4, 6); c.restore(); }
      const rg = c.createRadialGradient(x - 3, wy - 3, 1, x, wy, big * 0.5); rg.addColorStop(0, '#e6e8ea'); rg.addColorStop(1, '#6a6f76');
      c.fillStyle = rg; c.beginPath(); c.arc(x, wy, big * 0.48, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#2a2a2a'; c.lineWidth = 2; for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; c.beginPath(); c.moveTo(x, wy); c.lineTo(x + Math.cos(a) * big * 0.44, wy + Math.sin(a) * big * 0.44); c.stroke(); }
    };
    wheel(x0); wheel(x1);
    // title block
    const [name, sub] = PRINT_NAMES[kind];
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, W, 34);
    c.fillStyle = '#f4efe6'; c.font = '800 24px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif'; c.fillText(name, 10, 25);
    c.fillStyle = 'rgba(244,239,230,.7)'; c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'right'; c.fillText(sub, W - 8, 23); c.textAlign = 'left';
    // glass sheen
    const sh = c.createLinearGradient(0, 0, W, H); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.45, 'rgba(255,255,255,.1)'); sh.addColorStop(0.55, 'rgba(255,255,255,0)');
    c.fillStyle = sh; c.fillRect(0, 0, W, H);
  };
}

// ---------------------------------------------------------------- lived-in detail pass (from the realism reference sheet)
export function buildClutter(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'clutter';
  // framed vehicle prints above the pegboard
  const prints: [Parameters<typeof vehiclePrint>[0], [string, string], string][] = [
    ['buggy', ['#2a3b55', '#141c2a'], '#2f6fd6'], ['crawler', ['#3a4a2c', '#1a2214'], '#5bb33f'], ['truck', ['#5a2a1c', '#2a140e'], '#e0782f'],
    ['monster', ['#4a1c1c', '#200c0c'], '#d63a2f'], ['drift', ['#2e3238', '#121418'], '#c8ccd2'],
  ];
  prints.forEach(([k, bg, col], i) => framedPrint(g, -1.08 + i * 0.54, 2.36, -6.98, 's', 0.46, 0.32, vehiclePrint(k, bg, col)));
  // warm LED bar over the bench (the real light is added by the scene)
  box(2.5, 0.025, 0.05, M.steelLight, 0, 2.1, -6.93, g, false);
  const led = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.01, 0.03), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe7c4, emissiveIntensity: 2.2 }));
  led.position.set(0, 2.084, -6.92); g.add(led);
  // bottles + oils along the back of the bench
  bottle(g, 0.12, 0.93, -6.82, 0xd63a2f); bottle(g, 0.2, 0.93, -6.84, 0xf4efe6, 0xd63a2f); bottle(g, 0.28, 0.93, -6.8, 0x2557c9, 0xf2c230, 0.85);
  bottle(g, -0.62, 0.93, -6.84, 0xf2c230, 0x1d1d1f, 0.9);
  // screwdrivers laid out on the mat + pliers
  [0xd63a2f, 0x2557c9, 0xd63a2f, 0x1d1d1f].forEach((c, i) => screwdriver(g, 0.36, 0.93, -6.22 + i * 0.035, c, 0.12));
  pliers(g, -0.33, 0.935, -6.17, 0xd63a2f, 0.6);
  // screws in the parts tray
  const screw = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.012, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a2d, metalness: 0.9, roughness: 0.35 }), 36);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < 36; i++) {
    q.setFromEuler(new THREE.Euler(Math.PI / 2, (i * 1.7) % Math.PI, (i * 0.9) % 1));
    m4.compose(new THREE.Vector3(0.8 - 0.09 + ((i * 37) % 18) / 100, 0.935, -6.55 - 0.06 + ((i * 53) % 12) / 100), q, new THREE.Vector3(1, 1, 1));
    screw.setMatrixAt(i, m4);
  }
  g.add(screw);
  // pliers + wrenches on the pegboard
  pliers(g, 0.95, 1.38, -6.955, 0xd63a2f, 0, true); pliers(g, 1.08, 1.38, -6.955, 0x2557c9, 0, true); pliers(g, 1.21, 1.38, -6.955, 0xd63a2f, 0, true);
  // central ribbed floor mat
  const mat = new THREE.Mesh(roundedBox(1.7, 0.012, 1.05, 0.006), surface('corrugated', { color: 0x5c5c61, repeat: [30, 1], normalScale: 1.2, roughness: 1 }));
  mat.position.set(0, 0.006, -4.45);
  const matEdge = new THREE.Mesh(roundedBox(1.78, 0.008, 1.13, 0.004), surface('rubber', { color: 0x2c2c2f }));
  matEdge.position.set(0, 0.004, -4.45); g.add(matEdge); mat.receiveShadow = true; g.add(mat);
  // plants (warmth, as in the reference)
  plant(g, -2.62, 2.17, -3.3, 1.2);
  plant(g, 2.82, 2.33, -5.25, 1.0);
  plant(g, 1.95, 1.82, -6.12, 0.9);
  // right wall: shelf above the charging bench with LiPo bags, bottles and a cable reel
  box(0.3, 0.03, 1.4, M.wood, 2.85, 2.3, -4.7, g);
  for (const z of [-5.25, -4.15]) box(0.02, 0.12, 0.22, M.black, 2.94, 2.24, z, g, false);
  for (let i = 0; i < 3; i++) box(0.12, 0.08, 0.2, surface('fabric', { color: [0xd63a2f, 0x1d1d1f, 0xd63a2f][i], repeat: [2, 2] }), 2.85, 2.355, -4.9 + i * 0.16, g);
  bottle(g, 2.85, 2.315, -4.35, 0xf2c230); bottle(g, 2.85, 2.315, -4.25, 0x2557c9);
  const reel = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.03, 10, 20), surface('rubber', { color: 0xe0782f }));
  reel.rotation.y = Math.PI / 2; reel.position.set(2.85, 2.41, -5.0); g.add(reel);
  // extra outlet plates on the charging pegboard
  for (let i = 0; i < 4; i++) {
    const z = -5.25 + i * 0.3;
    box(0.012, 0.11, 0.07, surface('plastic', { color: 0xf1eadb }), 2.978, 1.3, z, g, false);
    for (const dy of [-0.025, 0.025]) box(0.004, 0.02, 0.025, M.black, 2.972, 1.3 + dy, z, g, false);
  }
  // soldering station + multimeter at the end of the charging bench
  const iron = new THREE.Group();
  box(0.16, 0.08, 0.12, surface('plastic', { color: 0x1d1d1f }), 0, 0.04, 0, iron);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.025), new THREE.MeshBasicMaterial({ color: 0xff5a2a }));
  disp.rotation.y = -Math.PI / 2; disp.position.set(-0.081, 0.055, 0); iron.add(disp);
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.08, 10, 1, true), M.chrome);
  coil.position.set(0, 0.12, 0.03); coil.rotation.z = 0.5; iron.add(coil);
  iron.position.set(2.75, 0.85, -4.05); g.add(iron);
  box(0.07, 0.025, 0.13, surface('plastic', { color: 0xf2c230 }), 2.55, 0.865, -4.0, g);
  // fire extinguisher by the LiPo area
  const ext = new THREE.Group();
  const tank = new THREE.Mesh(lathe([[0.001, 0], [0.06, 0], [0.065, 0.02], [0.065, 0.36], [0.05, 0.4], [0.02, 0.42], [0.001, 0.42]], 20), surface('paint', { color: 0xc4231a, metalness: 0.3 }));
  ext.add(tank);
  box(0.03, 0.05, 0.08, M.black, 0, 0.45, 0, ext);
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.008, 6, 12, Math.PI), M.black); hose.position.set(0, 0.36, 0.06); hose.rotation.y = Math.PI / 2; ext.add(hose);
  box(0.02, 0.1, 0.08, M.steel, 0.07, 0.3, 0, ext, false); // wall bracket
  ext.position.set(2.88, 0.32, -3.62); g.add(ext);
  // totes under the charging bench and by the entry
  tote(g, 2.66, 0.24, -5.15, 0.4, 0.26, 0.5);
  tote(g, 2.45, 0, -0.45, 0.5, 0.3, 0.38, 0x2557c9, 0.1);
  tote(g, 2.45, 0.335, -0.45, 0.5, 0.26, 0.38, 0xe8b923, -0.05);
  // stacked storage totes along both side walls
  tote(g, -2.62, 0, -1.05, 0.5, 0.3, 0.4, 0xe8b923, 0.06);
  tote(g, -2.62, 0.335, -1.05, 0.5, 0.26, 0.4, 0x2557c9, -0.04);
  tote(g, 2.66, 0, -2.25, 0.4, 0.3, 0.5, 0xe8b923, Math.PI / 2 + 0.05);
  // rolling carry bags by the folded pit table
  const bag = (x: number, z: number, rot: number) => {
    const b = new THREE.Group();
    box(0.36, 0.5, 0.22, surface('fabric', { color: 0x1d1d1f, repeat: [2, 3] }), 0, 0.29, 0, b);
    box(0.2, 0.025, 0.03, M.black, 0, 0.56, 0, b, false);
    for (const s of [-1, 1]) cyl(0.03, 0.025, M.rubber, s * 0.13, 0.03, -0.09, b, 12).rotation.z = Math.PI / 2;
    b.position.set(x, 0, z); b.rotation.y = rot; g.add(b);
  };
  bag(-2.2, -0.35, 0.15);
  // framed club photos by the side door
  framedPrint(g, 2.985, 1.62, -1.85, 'w', 0.32, 0.24, vehiclePrint('buggy', ['#6a8fb5', '#c9b38a'], '#e0782f'));
  framedPrint(g, 2.985, 1.3, -1.85, 'w', 0.32, 0.24, vehiclePrint('truck', ['#7aa0c4', '#b89a6a'], '#2f6fd6'));
  // broom leaning by the door
  const broom = new THREE.Group();
  cyl(0.012, 1.25, M.wood, 0, 0.7, 0, broom, 8);
  box(0.3, 0.06, 0.06, surface('plastic', { color: 0xd63a2f }), 0, 0.06, 0, broom);
  broom.position.set(1.75, 0, -0.15); broom.rotation.x = 0.12; g.add(broom);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow === undefined) (o as THREE.Mesh).castShadow = true; });
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- wall fill: upper cabinets, high shelves, wheel wall, ceiling rack
export function buildWallFill(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'wall-fill';
  const shelfWood = M.wood;
  const bracket = (x: number, y: number, z: number, faceLeftWall: boolean) => {
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.22, 0); sh.lineTo(0.03, -0.2); sh.lineTo(0, -0.2); sh.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false });
    const m = new THREE.Mesh(geo, M.black);
    m.position.set(x, y, z); m.rotation.y = faceLeftWall ? 0 : Math.PI; m.castShadow = true; g.add(m);
  };
  // left wall: high shelf over the shell hooks with totes and boxes
  {
    box(0.3, 0.03, 1.6, shelfWood, -2.84, 2.32, -1.1, g);
    for (const z of [-0.4, -1.1, -1.8]) bracket(-2.99, 2.305, z - 0.01, true);
    tote(g, -2.82, 2.335, -0.55, 0.26, 0.2, 0.36, 0xd63a2f, Math.PI / 2);
    tote(g, -2.82, 2.335, -0.98, 0.26, 0.2, 0.36, 0xe8b923, Math.PI / 2);
    kitBox(g, 0.26, 0.2, 0.4, (c, W, H) => vehiclePrint('truck', ['#5a2a1c', '#2a140e'], '#e0782f')(c, W, H)).position.set(-2.84, 2.335, -1.5);
  }
  // right wall: wheel wall beside the parts cabinet (spare wheel sets on pegs)
  {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), surface('pegboard', { repeat: [2, 2.4] }));
    board.rotation.y = -Math.PI / 2; board.position.set(2.985, 1.55, -6.45); g.add(board);
    const tg = tireGeometry(0.06, 0.05, 3, 20), rg = rimGeometry(0.039, 0.048);
    const rimCols = [0xe8e6e0, 0x2a2a2d, 0xf2c230];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) {
      const wh = new THREE.Group();
      const t = new THREE.Mesh(tg, M.rubber); t.castShadow = true; wh.add(t);
      wh.add(new THREE.Mesh(rg, surface('plastic', { color: rimCols[r] })));
      wh.rotation.z = Math.PI / 2; wh.position.set(2.94, 1.2 + r * 0.32, -6.75 + i * 0.27); g.add(wh);
      cyl(0.005, 0.08, M.chrome, 2.96, 1.2 + r * 0.32 + 0.065, -6.75 + i * 0.27, g, 6).rotation.z = Math.PI / 2;
    }
  }
  // right wall: small shelf over the side door with a helmet-style pit case and a radio
  {
    box(0.26, 0.025, 0.9, shelfWood, 2.86, 2.25, -1.1, g);
    for (const z of [-0.75, -1.45]) bracket(2.99, 2.24, z + 0.01, false);
    const radio = new THREE.Group();
    box(0.12, 0.14, 0.3, surface('plastic', { color: 0x2d3846 }), 0, 0.07, 0, radio);
    const grille = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), surface('fabric', { color: 0x1d1d1f, repeat: [4, 4] }));
    grille.rotation.y = -Math.PI / 2; grille.position.set(-0.061, 0.07, 0.07); radio.add(grille);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.01, 14), M.chrome); dial.rotation.z = Math.PI / 2; dial.position.set(-0.062, 0.08, -0.08); radio.add(dial);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.25, 6), M.chrome); ant.position.set(0, 0.2, -0.12); ant.rotation.x = 0.4; radio.add(ant);
    radio.position.set(2.86, 2.263, -1.3); g.add(radio);
    tote(g, 2.86, 2.263, -0.85, 0.2, 0.16, 0.3, 0x2557c9, 0);
  }
  // ceiling storage rack over the left side (steel frame, hanging rods, totes)
  {
    const rack = new THREE.Group();
    const steel = surface('paint', { color: 0x5a5f66, metalness: 0.55, roughness: 0.45 });
    box(1.2, 0.03, 0.9, steel, 0, 0, 0, rack);
    for (const x of [-0.58, 0.58]) for (const z of [-0.43, 0.43]) cyl(0.012, 0.42, steel, x, 0.21, z, rack, 8);
    tote(rack, -0.32, 0.015, 0, 0.5, 0.3, 0.38, 0xe8b923, 0.03);
    tote(rack, 0.3, 0.015, 0.02, 0.5, 0.3, 0.38, 0x1f2023, -0.03);
    rack.position.set(-1.95, ROOM.h - 0.34, -0.95); g.add(rack);
  }
  // more wall art: two framed prints on the left wall between the shelving and the tyre rack
  framedPrint(g, -2.985, 1.62, -2.3, 'e', 0.3, 0.22, vehiclePrint('drift', ['#2e3238', '#121418'], '#c8ccd2'));
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true; });
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- sandbox table (test anything for free)
export const SANDBOX = { x: 2.48, z: -2.55, top: 0.86 };
/** Steel-frame assembly table under the club board: gridded blue cutting mat, a lit display turntable
 *  (the preview vehicle is added by the scene), a sorted parts tray, a tent sign and a task lamp. */
export function buildSandboxTable(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'sandbox-table';
  const { top } = SANDBOX, L = 1.16, D = 0.62;
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.38, metalness: 0.7 });
  // top: thick laminated board with a rounded edge band
  const board = new THREE.Mesh(roundedBox(D, 0.04, L, 0.012), surface('wood', { color: 0xcaa778, repeat: [1, 2] }));
  board.position.y = top - 0.02; board.castShadow = true; board.receiveShadow = true; g.add(board);
  const band = new THREE.Mesh(roundedBox(D + 0.008, 0.016, L + 0.008, 0.006), frame); band.position.y = top - 0.046; g.add(band);
  // legs (lathed tube with levelling feet), lower shelf with a tote
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(lathe([[0.02, 0], [0.026, 0.004], [0.026, 0.012], [0.018, 0.016], [0.018, top - 0.05], [0.001, top - 0.05]], 14), frame);
    leg.position.set(sx * (D / 2 - 0.04), 0, sz * (L / 2 - 0.05)); leg.castShadow = true; g.add(leg);
  }
  const shelf = new THREE.Mesh(roundedBox(D - 0.06, 0.018, L - 0.08, 0.006), frame); shelf.position.y = 0.2; g.add(shelf);
  tote(g, -0.03, 0.21, -0.2, 0.42, 0.16, 0.3, 0x2557c9);
  tote(g, -0.03, 0.21, 0.22, 0.42, 0.16, 0.3, 0xe8b923);
  // blue self-healing mat with grid + SANDBOX lettering
  const matT = canvasTex(512, 1024, (c) => {
    c.fillStyle = '#2a5aa8'; c.fillRect(0, 0, 512, 1024);
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1; for (let i = 0; i <= 512; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 1024); c.stroke(); } for (let j = 0; j <= 1024; j += 32) { c.beginPath(); c.moveTo(0, j); c.lineTo(512, j); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 2; for (let i = 0; i <= 512; i += 128) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 1024); c.stroke(); }
    c.save(); c.translate(470, 980); c.rotate(-Math.PI / 2); c.fillStyle = 'rgba(255,255,255,.75)'; c.font = '800 44px "Barlow Condensed", system-ui, sans-serif'; c.fillText('SANDBOX · TEST ANYTHING', 0, 0); c.restore();
  });
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.06, L - 0.08), new THREE.MeshStandardMaterial({ map: matT, roughness: 0.85 }));
  mat.rotation.x = -Math.PI / 2; mat.position.y = top + 0.002; mat.receiveShadow = true; g.add(mat);
  // display turntable with a lit LED ring
  const tt = new THREE.Mesh(lathe([[0.001, 0], [0.2, 0], [0.205, 0.006], [0.2, 0.018], [0.19, 0.022], [0.001, 0.022]], 48), new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.4, metalness: 0.5 }));
  tt.position.set(0.02, top + 0.002, 0.08); tt.receiveShadow = true; tt.castShadow = true; g.add(tt);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.004, 6, 64), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x58b4ff, emissiveIntensity: 1.6 }));
  ring.rotation.x = Math.PI / 2; ring.position.set(0.02, top + 0.012, 0.08); g.add(ring);
  // parts tray: compartments of screws, a spare wheel, shock, servo, pinion
  const tray = new THREE.Group(); tray.position.set(0.13, top + 0.004, -0.4); g.add(tray);
  const tr = new THREE.Mesh(roundedBox(0.2, 0.025, 0.24, 0.008), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.6 })); tr.position.y = 0.0125; tray.add(tr);
  const spare = new THREE.Mesh(tireGeometry(0.05, 0.04, 3, 20), surface('rubber', { color: 0x1a1a1a })); spare.position.set(-0.13, 0.025, -0.36 + 0.4); spare.rotation.x = 0; g.add(spare);
  spare.position.set(-0.13, top + 0.024, -0.38);
  const rim = new THREE.Mesh(rimGeometry(0.032, 0.038), new THREE.MeshStandardMaterial({ color: 0xe8b923, roughness: 0.4, metalness: 0.3 })); rim.position.copy(spare.position); g.add(rim);
  const shock = new THREE.Mesh(lathe([[0.001, 0], [0.008, 0], [0.008, 0.06], [0.004, 0.065], [0.003, 0.1], [0.001, 0.1]], 12), new THREE.MeshStandardMaterial({ color: 0xd63a2f, roughness: 0.35, metalness: 0.6 }));
  shock.rotation.z = Math.PI / 2; shock.position.set(0.05, top + 0.009, -0.47); g.add(shock);
  const servo = new THREE.Mesh(roundedBox(0.04, 0.022, 0.02, 0.004), new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.5 })); servo.position.set(-0.17, top + 0.011, -0.2); g.add(servo);
  // tent sign
  const signT = canvasTex(512, 160, (c) => { c.fillStyle = '#f2c230'; c.fillRect(0, 0, 512, 160); c.fillStyle = '#1c1c1e'; c.font = '900 84px "Barlow Condensed", system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('SANDBOX', 256, 98); c.font = '700 30px system-ui, sans-serif'; c.fillText('free to test · nothing counts', 256, 142); });
  for (const s of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.062), new THREE.MeshStandardMaterial({ map: signT, roughness: 0.6, side: THREE.DoubleSide }));
    pl.position.set(-0.2 + s * 0.012, top + 0.03, 0.42); pl.rotation.set(0, -Math.PI / 2, s * 0.35); g.add(pl);
  }
  // task lamp clamped on the back edge
  const lamp = new THREE.Group(); lamp.position.set(0.27, top, -0.52); lamp.rotation.y = -0.6; g.add(lamp);
  cable(lamp, [[0, 0.0, 0], [0.0, 0.2, 0.02], [-0.1, 0.34, 0.06], [-0.17, 0.33, 0.1]], 0.007, 0x2b2e33, 24);
  const shade = new THREE.Mesh(lathe([[0.001, 0.06], [0.02, 0.06], [0.05, 0.0], [0.055, -0.004]], 24), new THREE.MeshStandardMaterial({ color: 0x2557c9, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }));
  shade.position.set(-0.19, 0.29, 0.11); shade.rotation.z = 0.5; lamp.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 2 })); bulb.position.set(-0.19, 0.29, 0.11); lamp.add(bulb);
  contactShadow(g, 0, 0, D + 0.1, L + 0.1);
  g.position.set(SANDBOX.x, 0, SANDBOX.z);
  tag(g, 'station', 'sandbox');
  parent.add(g);
  return { group: g, turntableAt: new THREE.Vector3(SANDBOX.x + 0.02, top + 0.024, SANDBOX.z + 0.08) };
}
