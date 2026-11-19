// player.js — Rio Calloway on foot: a low-poly person built from boxes with a
// swing-limb walk cycle, and the third-person on-foot controller (camera-relative
// WASD movement, sprint, building collision). Also exports the person factory the
// pedestrian system dresses its crowd from.

import * as THREE from '../vendor/three.module.min.js';
import { collideCircle, clampToCity } from './world.js';

const SKIN = ['#f2c79b', '#c68863', '#8a5a3b', '#6e4530'];

export function makePersonMesh(shirt, pants, skinTone = 0) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: SKIN[skinTone % SKIN.length] });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.3), shirtMat);
  torso.position.y = 1.08; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.3), skin);
  head.position.y = 1.62; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.32), new THREE.MeshLambertMaterial({ color: '#2b2019' }));
  hair.position.y = 1.82; g.add(hair);
  const limb = (mat, w, len) => {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
    m.position.y = -len / 2; m.castShadow = true; pivot.add(m);
    return pivot;
  };
  const armL = limb(skin, 0.13, 0.62); armL.position.set(-0.34, 1.38, 0); g.add(armL);
  const armR = limb(skin, 0.13, 0.62); armR.position.set(0.34, 1.38, 0); g.add(armR);
  const legL = limb(pantsMat, 0.17, 0.78); legL.position.set(-0.14, 0.78, 0); g.add(legL);
  const legR = limb(pantsMat, 0.17, 0.78); legR.position.set(0.14, 0.78, 0); g.add(legR);
  g.userData.parts = { armL, armR, legL, legR, torso };
  return g;
}

// Swing the limbs for a walker who has covered `dist` metres at `speed`.
export function animateWalk(mesh, dist, speed, dt) {
  const p = mesh.userData.parts;
  const swing = Math.sin(dist * 2.4) * Math.min(0.75, speed * 0.13);
  p.legL.rotation.x = swing; p.legR.rotation.x = -swing;
  p.armL.rotation.x = -swing * 0.8; p.armR.rotation.x = swing * 0.8;
  mesh.position.y = Math.abs(Math.sin(dist * 2.4)) * 0.045;
  return dt; // (kept for symmetry with other updaters)
}

export class Player {
  constructor(scene, x, z, heading) {
    this.mesh = makePersonMesh('#12b5a5', '#2c3e50', 1); // Rio: teal shirt
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
    this.heading = heading;
    this.walkPhase = 0;
    this.speedNow = 0;
  }
  get x() { return this.mesh.position.x; }
  get z() { return this.mesh.position.z; }

  // wishX/wishZ: desired move direction in world space (normalised or zero).
  update(dt, wishX, wishZ, running, colliders) {
    const moving = Math.hypot(wishX, wishZ) > 0.05;
    const target = moving ? (running ? 8.8 : 5.0) : 0;
    this.speedNow += (target - this.speedNow) * Math.min(1, dt * 9);
    if (moving) {
      const want = Math.atan2(wishX, wishZ);
      let diff = want - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * 12);
      let nx = this.x + Math.sin(this.heading) * this.speedNow * dt * Math.max(0.25, Math.cos(diff));
      let nz = this.z + Math.cos(this.heading) * this.speedNow * dt * Math.max(0.25, Math.cos(diff));
      [nx, nz] = collideCircle(colliders, nx, nz, 0.45);
      [nx, nz] = clampToCity(nx, nz);
      this.mesh.position.x = nx; this.mesh.position.z = nz;
      this.walkPhase += this.speedNow * dt;
    }
    this.mesh.rotation.y = this.heading;
    animateWalk(this.mesh, this.walkPhase, this.speedNow, dt);
  }

  teleport(x, z, heading = this.heading) {
    this.mesh.position.set(x, 0, z);
    this.heading = heading;
  }
}
