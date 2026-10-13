// Shared small props. The garage room itself lives in garageRoom.ts.
import * as THREE from 'three';
import { buildTransmitterBody } from './transmitterModel';

/** The player's wheel transmitter standing on its base (same model as the in-hand overlay). */
export function buildTransmitter(parent: THREE.Object3D, at: THREE.Vector3, scale = 0.35) {
  const { tx } = buildTransmitterBody();
  const s = 0.05 * (scale / 0.35);
  const g = new THREE.Group(); g.name = 'transmitter';
  tx.position.y = 1.47;
  g.add(tx);
  g.scale.setScalar(s);
  g.position.copy(at);
  g.rotation.y = -0.9; // wheel side toward the room
  g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  parent.add(g);
  return g;
}
