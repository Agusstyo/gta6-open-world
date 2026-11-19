// combat.js — Rio's pistol: hitscan shooting with a tracer, impact sparks and
// real consequences. Shots are resolved against pedestrians, vehicles (police
// included) and the city's building boxes, nearest hit first, and every hit is
// reported through onCrime so the wanted system can react. Firing itself is a
// crime when anyone is around to hear it.

import * as THREE from '../vendor/three.module.min.js';

const RANGE = 46;

export class Combat {
  constructor(scene, effects, audio) {
    this.effects = effects;
    this.audio = audio;
    this.cooldown = 0;
    this.onCrime = null;      // (kind, x, z) => {}
    this.onShotFired = null;  // (x, z) => {} — peds scatter, etc.
  }

  update(dt) { this.cooldown = Math.max(0, this.cooldown - dt); }

  // Ray vs a sphere; returns distance along the ray or Infinity.
  raySphere(origin, dir, cx, cy, cz, r) {
    const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
    const t = ox * dir.x + oy * dir.y + oz * dir.z;
    if (t < 0) return Infinity;
    const d2 = ox * ox + oy * oy + oz * oz - t * t;
    if (d2 > r * r) return Infinity;
    return t;
  }

  // Ray vs the 2D building boxes (any height); returns distance or Infinity.
  rayBuildings(origin, dir, colliders) {
    let best = Infinity;
    for (const c of colliders) {
      let t0 = 0, t1 = RANGE;
      if (Math.abs(dir.x) < 1e-6) { if (origin.x < c.x0 || origin.x > c.x1) continue; }
      else {
        let ta = (c.x0 - origin.x) / dir.x, tb = (c.x1 - origin.x) / dir.x;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      if (Math.abs(dir.z) < 1e-6) { if (origin.z < c.z0 || origin.z > c.z1) continue; }
      else {
        let ta = (c.z0 - origin.z) / dir.z, tb = (c.z1 - origin.z) / dir.z;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      if (t0 < best) best = t0;
    }
    return best;
  }

  // origin/dir are THREE.Vector3. world: { peds, vehicles, colliders }.
  shoot(origin, dir, world) {
    if (this.cooldown > 0) return null;
    this.cooldown = 0.21;
    this.audio.shot();
    const muzzle = origin.clone().addScaledVector(dir, 0.7);
    muzzle.y -= 0.12;
    this.effects.muzzle(muzzle.x, muzzle.y, muzzle.z);
    if (this.onShotFired) this.onShotFired(origin.x, origin.z);

    let bestT = this.rayBuildings(origin, dir, world.colliders);
    let hit = null;
    for (const p of world.peds) {
      if (p.state === 'down') continue;
      const t = this.raySphere(origin, dir, p.mesh.position.x, 1.0, p.mesh.position.z, 0.62);
      if (t < bestT) { bestT = t; hit = { type: 'ped', ped: p }; }
    }
    for (const v of world.vehicles) {
      const t = this.raySphere(origin, dir, v.x, 0.85, v.z, 2.3);
      if (t < bestT) { bestT = t; hit = { type: 'vehicle', vehicle: v }; }
    }
    const end = origin.clone().addScaledVector(dir, Math.min(bestT, RANGE));
    if (bestT === Infinity) { this.effects.tracer(muzzle, end); return { type: 'miss' }; }
    this.effects.tracer(muzzle, end);
    this.effects.sparks(end.x, end.y, end.z, 8);
    if (!hit) { this.effects.dust(end.x, Math.max(0.3, end.y), end.z, 6); return { type: 'wall' }; }
    if (hit.type === 'ped') {
      world.pedSystem.knockDown(hit.ped, 'shot');
      return { type: 'ped' };
    }
    const v = hit.vehicle;
    v.damage = Math.min(100, v.damage + 24);
    if (v.damage > 55) this.effects.smoke(v.x, 1.3, v.z, 3);
    if (this.onCrime) this.onCrime(v.kind === 'police' ? 'shootCop' : 'shoot', v.x, v.z);
    return { type: 'vehicle', vehicle: v };
  }
}
