// Static batching for the garage: hundreds of small, non-moving props are merged into a few dozen
// meshes (grouped by equivalent material, shadow flag and tap tag) so the room stays cheap on phones.
// Picking still works because the station/decor tags are part of the grouping key.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function matKey(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial;
  const tex = (t: THREE.Texture | null | undefined) => (t ? `${t.source.uuid}:${t.repeat.x.toFixed(3)},${t.repeat.y.toFixed(3)}:${t.offset.x.toFixed(3)}` : '-');
  return [
    m.type, s.color?.getHexString(), s.roughness?.toFixed(3), s.metalness?.toFixed(3), s.emissive?.getHexString(), s.emissiveIntensity?.toFixed(2),
    tex(s.map), tex(s.normalMap), tex(s.roughnessMap), tex(s.emissiveMap), s.normalScale ? s.normalScale.x.toFixed(2) : '-',
    m.transparent ? `t${m.opacity.toFixed(2)}` : 'o', m.side, m.depthWrite, (s as { clearcoat?: number }).clearcoat ?? '-', (s as { transmission?: number }).transmission ?? '-',
    s.envMapIntensity?.toFixed(2), m.polygonOffset ? 'po' : '', m.visible,
  ].join('|');
}


/** Clone a geometry into a merge-friendly form (position/normal/uv, 32-bit index) baked by `m`. */
export function bakeGeometry(src: THREE.BufferGeometry, m: THREE.Matrix4) {
  const g = src.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  g.morphAttributes = {};
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  // vertex colours are kept (terrain, rocks); everything else gets white so all pieces merge alike
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  else if (g.attributes.color.itemSize !== 3) { const c = g.attributes.color; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.getX(i); a[i * 3 + 1] = c.getY(i); a[i * 3 + 2] = c.getZ(i); } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
  if (!g.index) { const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  else if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array as ArrayLike<number>), 1));
  g.applyMatrix4(m);
  if (m.determinant() < 0) {
    const ix = g.index!;
    for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); }
  }
  g.groups = [];
  return g;
}

/** Merge every static mesh under `root` (except those `keep` returns true for). Returns stats. */
export function batchStatic(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean; tags: Record<string, unknown>; order: number }>();
  const victims: THREE.Mesh[] = [];
  const kept = new Set<THREE.Object3D>();
  root.traverse((o) => { if (keep(o)) o.traverse((c) => kept.add(c)); });
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (kept.has(mesh) || Array.isArray(mesh.material) || !mesh.visible) return;
    const g = bakeGeometry(mesh.geometry, new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const tags: Record<string, unknown> = {};
    for (const t of ['station', 'decor', 'solid']) if (mesh.userData[t] !== undefined) tags[t] = mesh.userData[t];
    const key = `${matKey(mesh.material as THREE.Material)}#${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}#${JSON.stringify(tags)}#${mesh.renderOrder}`;
    let e = groups.get(key);
    if (!e) { e = { mat: mesh.material as THREE.Material, geos: [], cast: mesh.castShadow, receive: mesh.receiveShadow, tags, order: mesh.renderOrder }; groups.set(key, e); }
    e.geos.push(g);
    victims.push(mesh);
  });
  for (const v of victims) v.removeFromParent();
  let made = 0;
  for (const e of groups.values()) {
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, e.mat);
    mesh.castShadow = e.cast; mesh.receiveShadow = e.receive;
    mesh.renderOrder = e.order;
    Object.assign(mesh.userData, e.tags);
    mesh.name = 'static-batch';
    root.add(mesh);
    for (const g of e.geos) g.dispose();
    made++;
  }
  // drop now-empty groups so traversal stays cheap
  const empties: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root && !(o as THREE.Mesh).isMesh && o.children.length === 0 && !kept.has(o) && o.type === 'Group') empties.push(o); });
  for (const o of empties) o.removeFromParent();
  return { before: victims.length, after: made };
}
