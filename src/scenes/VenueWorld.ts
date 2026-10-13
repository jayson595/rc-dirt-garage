// The dirt-track venue: one 3D world shared by the driver's stand (TrackScene) and the pit table (PitScene).
import * as THREE from 'three';
import { createBuggy, BuggyModel, BuggyLook, lookKey } from '../assets/buggyModel';
import { blobShadowTexture, markerTexture } from '../assets/textures';
import {
  PIT, themeFor, trackTitle, buildBarriers, buildCheckpointMarkers, buildPit, buildSky, buildStand, buildStartLine, buildSurroundings, buildTerrain,
} from '../assets/venueProps';
import { BuggyId } from '../data/specs';
import { skyEnvironment } from '../assets/materials';
import { buildPitRowGround, buildTrackDecor } from '../assets/venueDecor';
import { batchStatic } from '../assets/staticBatch';
import { Track, TrackLayout, trackPoints } from '../sim/Track';
import { VehicleSimulation } from '../sim/VehicleSimulation';

export class VenueWorld {
  scene = new THREE.Scene();
  track: Track;
  car: BuggyModel;
  pitCar: BuggyModel;
  shadow: THREE.Mesh;
  marker: THREE.Sprite;
  guideArch: THREE.Mesh;
  sun: THREE.DirectionalLight;
  pitCarPos = new THREE.Vector3(PIT.x + 0.05, PIT.table + 0.02, PIT.z - 0.05);

  constructor(renderer?: THREE.WebGLRenderer, readonly layout: TrackLayout = 'course') {
    this.track = new Track(trackPoints(layout), 900, layout);
    const s = this.scene, theme = themeFor(layout), title = trackTitle(layout);
    s.fog = theme === 'night' ? new THREE.Fog(0x0e1220, 40, 110) : theme === 'desert' ? new THREE.Fog(0xf0dcb8, 50, 130) : new THREE.Fog(0xcfe0ec, 45, 120);
    if (renderer) { s.environment = skyEnvironment(renderer); s.environmentIntensity = theme === 'night' ? 0.12 : 0.45; }
    s.add(theme === 'night' ? new THREE.HemisphereLight(0x5a6a90, 0x2a1c14, 0.45) : theme === 'desert' ? new THREE.HemisphereLight(0xe8f0ff, 0xc8a070, 0.7) : new THREE.HemisphereLight(0xd8ecff, 0x8a6a45, 0.6));
    // night: the floodlights stand in for the sun (white, from high overhead)
    this.sun = new THREE.DirectionalLight(theme === 'night' ? 0xfff6e8 : theme === 'desert' ? 0xffe8c8 : 0xfff0d8, theme === 'night' ? 1.7 : theme === 'desert' ? 2.3 : 2.0);
    this.sun.position.set(-12, 22, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0006;
    s.add(this.sun, this.sun.target);

    buildSky(s, theme);
    buildTerrain(this.track, s, 0.3, theme);
    this.guideArch = buildCheckpointMarkers(this.track, s).arch;
    // everything static around the track is built into one group and batched into a few draw calls
    const deco = new THREE.Group(); deco.name = 'venue-static';
    s.add(deco);
    buildBarriers(this.track, deco);
    buildStartLine(this.track, deco, title);
    buildStand(deco);
    buildPit(deco);
    buildSurroundings(deco, theme);
    buildPitRowGround(deco);
    buildTrackDecor(this.track, deco, title);
    batchStatic(deco, () => false);

    this.car = createBuggy();
    this.car.root.rotation.order = 'YZX';
    s.add(this.car.root);
    this.pitCar = createBuggy();
    this.pitCar.root.position.copy(this.pitCarPos);
    this.pitCar.root.rotation.y = 0.5;
    s.add(this.pitCar.root);

    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.55), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    s.add(this.shadow);

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(), depthTest: false, transparent: true }));
    this.marker.renderOrder = 10;
    s.add(this.marker);
  }

  /** Swap the driven + pit-table models to another buggy class (built on demand). */
  useClass(id: BuggyId, look?: BuggyLook) {
    if (look ? this.car.root.userData.lookKey === lookKey(id, look) : this.car.root.userData.buggyClass === id) return;
    const dispose = (m: BuggyModel) => { this.scene.remove(m.root); m.root.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) me.geometry.dispose(); }); };
    const carVis = this.car.root.visible, pitVis = this.pitCar.root.visible;
    dispose(this.car); dispose(this.pitCar);
    this.car = createBuggy(id, look);
    this.car.root.rotation.order = 'YZX';
    this.car.root.visible = carVis;
    this.scene.add(this.car.root);
    this.pitCar = createBuggy(id, look);
    this.pitCar.root.position.copy(this.pitCarPos);
    this.pitCar.root.rotation.y = 0.5;
    this.pitCar.root.visible = pitVis;
    this.scene.add(this.pitCar.root);
  }

  /** AI rival cars for races (built on demand, hidden otherwise). */
  rivals: { model: BuggyModel; shadow: THREE.Mesh; key: string }[] = [];

  /** Show `looks.length` rival cars of class `id`; hides the rest. */
  setRivals(id: BuggyId, looks: Partial<BuggyLook>[]) {
    looks.forEach((look, i) => {
      const key = `${id}|${look.body}|${look.accent}|${look.livery}`;
      let r = this.rivals[i];
      if (!r || r.key !== key) {
        if (r) { this.scene.remove(r.model.root); r.model.root.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) me.geometry.dispose(); }); }
        const model = createBuggy(id, look);
        model.root.rotation.order = 'YZX';
        model.freeze();
        this.scene.add(model.root);
        const shadow = r?.shadow ?? new THREE.Mesh(this.shadow.geometry, (this.shadow.material as THREE.Material).clone());
        shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1;
        if (!r) this.scene.add(shadow);
        r = this.rivals[i] = { model, shadow, key };
      }
      r.model.root.visible = r.shadow.visible = true;
    });
    for (let i = looks.length; i < this.rivals.length; i++) this.rivals[i].model.root.visible = this.rivals[i].shadow.visible = false;
  }

  hideRivals() { for (const r of this.rivals) r.model.root.visible = r.shadow.visible = false; }

  poseRival(i: number, sim: VehicleSimulation) { const r = this.rivals[i]; this.poseModel(r.model, r.shadow, sim); }

  /** Pose the driving model from the simulation. */
  poseCar(sim: VehicleSimulation) { this.poseModel(this.car, this.shadow, sim); }

  private poseModel(m: BuggyModel, shadow: THREE.Mesh, sim: VehicleSimulation) {
    const eqComp = 9.81 / (520 * sim.spec.springMul);
    m.root.position.set(sim.x, sim.y - (sim.spec.springRest - eqComp), sim.z);
    if (sim.flipped) {
      m.root.position.y += 0.16;
      m.root.rotation.set(Math.PI, -sim.heading, 0);
    } else {
      m.root.rotation.set(-sim.roll, -sim.heading, sim.pitch);
    }
    const lean = sim.bodyLean;
    m.body.position.y = THREE.MathUtils.clamp(-(sim.compression - eqComp) * 0.7, -0.03, 0.03);
    m.body.rotation.set(-THREE.MathUtils.clamp(lean.roll, -0.12, 0.12), 0, THREE.MathUtils.clamp(lean.pitch, -0.08, 0.08));
    m.wheels[0].steer.rotation.y = -sim.steerAngle;
    m.wheels[1].steer.rotation.y = -sim.steerAngle;
    for (const w of m.wheels) w.spin.rotation.z = -sim.wheelSpin;
    // blob shadow on the ground, spreads and fades with height
    const g = this.track.heightAt(sim.s, sim.d);
    const air = Math.max(0, sim.y - g - 0.07);
    shadow.position.set(sim.x, g + 0.015, sim.z);
    shadow.rotation.z = -sim.heading;
    shadow.scale.setScalar(1 + air * 1.2);
    (shadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(1 - air * 1.5, 0.25, 1);
  }

  /** Move the sun's shadow box to follow whatever the camera is looking at. */
  focusShadows(target: THREE.Vector3) {
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x - 12, 22, target.z + 10);
  }

  /** Guide arch over the next checkpoint (practice). */
  placeGuide(s: number | null) {
    if (s == null) { this.guideArch.visible = false; return; }
    const p = this.track.sampleAt(s);
    this.guideArch.visible = true;
    this.guideArch.position.set(p.x, this.track.heightAt(s, 0) + 0.02, p.z);
    this.guideArch.rotation.set(0, -Math.atan2(p.tz, p.tx) + Math.PI / 2, 0);
  }
}
