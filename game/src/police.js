// police.js — the wanted system and Marisol PD. Crimes build heat; heat shows as
// stars; stars bring interceptors. Police cars spawn out of sight, hunt the
// player across the whole map (roads or not), ram a fleeing car, and move in to
// make an arrest when the player is on foot or boxed in. Lose them — break line
// of sight and stay clean — and the heat bleeds away.

import { makeVehicle, stepVehicle } from './vehicles.js';
import { ROAD_XS, ROAD_ZS } from './world.js';

export const CRIME_HEAT = {
  carjack: 60, hitped: 80, assault: 130, shoot: 45, shootCop: 150,
  hitcar: 22, hitcop: 95, crash: 14, theft: 60,
};
const STAR_AT = [0, 40, 110, 200, 320, 470];

export class Wanted {
  constructor() {
    this.heat = 0;
    this.sinceCrime = 99;
    this.onStarsChanged = null; // (stars) => {}
    this.onEscaped = null;
  }
  get stars() {
    let s = 0;
    for (let i = 1; i < STAR_AT.length; i++) if (this.heat >= STAR_AT[i]) s = i;
    return s;
  }
  addCrime(kind, witnessed = true) {
    const before = this.stars;
    const add = (CRIME_HEAT[kind] ?? 20) * (witnessed ? 1 : 0.45);
    this.heat = Math.min(560, this.heat + add);
    this.sinceCrime = 0;
    if (this.stars !== before && this.onStarsChanged) this.onStarsChanged(this.stars);
  }
  update(dt, seenByPolice) {
    this.sinceCrime += dt;
    if (this.heat > 0 && this.sinceCrime > 5 && !seenByPolice) {
      const was = this.stars;
      this.heat = Math.max(0, this.heat - dt * (this.heat > 200 ? 5.5 : 9));
      if (was > 0 && this.stars === 0 && this.onEscaped) this.onEscaped();
      if (this.stars !== was && this.onStarsChanged) this.onStarsChanged(this.stars);
    }
  }
  clear() { this.heat = 0; this.sinceCrime = 99; }
}

export class Police {
  constructor(scene, colliders, station) {
    this.units = [];
    this.scene = scene;
    this.colliders = colliders;
    this.station = station;
    this.spawnCooldown = 0;
    this.bustMeter = 0;
    this.onRam = null; // (impact, x, z) => {}
  }

  desiredUnits(stars) { return [0, 1, 2, 3, 4, 5][stars] ?? 0; }

  spawnPointNear(px, pz) {
    // A junction 70–120 m from the player: close enough to matter, out of sight.
    let best = null, bestScore = -1;
    for (const x of ROAD_XS) for (const z of ROAD_ZS) {
      const d = Math.hypot(x - px, z - pz);
      if (d < 65 || d > 130) continue;
      const score = 100 - Math.abs(d - 95);
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    return best ?? { x: this.station.x, z: this.station.z };
  }

  update(dt, wanted, target, t) {
    const stars = wanted.stars;
    this.spawnCooldown -= dt;
    const active = this.units.filter((u) => !u.disabled);
    if (stars > 0 && active.length < this.desiredUnits(stars) && this.spawnCooldown <= 0) {
      const s = this.spawnPointNear(target.x, target.z);
      const v = makeVehicle('police', '#20242a', s.x, s.z, Math.atan2(target.x - s.x, target.z - s.z));
      v.driver = 'police';
      this.scene.add(v.mesh);
      this.units.push({ v, reverseFor: 0, stuckFor: 0 });
      this.spawnCooldown = 2.2;
    }
    let nearest = 1e9, anyClose = false;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i], v = u.v;
      const dx = target.x - v.x, dz = target.z - v.z;
      const dist = Math.hypot(dx, dz);
      nearest = Math.min(nearest, dist);
      if (dist < 42) anyClose = true;
      // Retire units that are far away with no heat, or wrecked and left behind.
      if ((stars === 0 && dist > 55) || (u.disabled && dist > 90)) {
        this.scene.remove(v.mesh);
        this.units.splice(i, 1);
        continue;
      }
      if (v.damage >= 88 && !u.disabled) { u.disabled = true; v.speed = 0; }
      // Lightbar strobe.
      const bar = v.mesh.userData.lightbar;
      if (bar) {
        const phase = Math.floor(t * 6 + i) % 2 === 0;
        bar.red.visible = phase; bar.blue.visible = !phase;
      }
      if (u.disabled || stars === 0) { stepVehicle(v, dt, { throttle: 0 }, this.colliders); continue; }
      // Pursuit: aim at a point just behind the target so contact is a ram, not a kiss.
      const lead = target.inCar ? 0.45 : 0.1;
      const tx = target.x + (target.vx ?? 0) * lead, tz = target.z + (target.vz ?? 0) * lead;
      const want = Math.atan2(tx - v.x, tz - v.z);
      let err = want - v.heading;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      let throttle = 1;
      if (target.onFoot && dist < 5.5) throttle = 0.12;          // roll up to make the arrest
      else if (target.onFoot && dist < 11) throttle = 0.45;
      if (u.reverseFor > 0) { u.reverseFor -= dt; throttle = -0.9; }
      const impact = stepVehicle(v, dt, { throttle, steer: Math.max(-1, Math.min(1, err * 1.9)) }, this.colliders);
      if (impact > 8) { v.damage = Math.min(100, v.damage + impact * 0.5); if (this.onRam) this.onRam(impact, v.x, v.z); }
      if (Math.abs(v.speed) < 0.6 && dist > 9) {
        u.stuckFor += dt;
        if (u.stuckFor > 2.2) { u.reverseFor = 0.85; u.stuckFor = 0; }
      } else u.stuckFor = 0;
    }
    // Arrest pressure: close + a slow or on-foot target = the meter fills.
    const arresting = stars > 0 && nearest < (target.onFoot ? 5.2 : 7.5) && target.speedAbs < (target.onFoot ? 2.2 : 1.6);
    this.bustMeter = Math.max(0, Math.min(1, this.bustMeter + (arresting ? dt / 2.4 : -dt / 1.2)));
    this.nearestDist = nearest;
    return { anyClose, busted: this.bustMeter >= 1 };
  }

  reset() {
    for (const u of this.units) this.scene.remove(u.v.mesh);
    this.units = [];
    this.bustMeter = 0;
  }
}
