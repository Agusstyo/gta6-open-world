// pedestrians.js — the people of Port Marisol. Each pedestrian walks a pavement
// loop around a city block or along the promenade, minds their own business, and
// runs screaming (well, running) from gunfire, crashes and speeding cars. Being
// run over or shot knocks them down; a crime witness point is reported through
// the onCrime callback so the wanted system hears about it.

import * as THREE from '../vendor/three.module.min.js';
import { makePersonMesh, animateWalk } from './player.js';
import { BLOCK_XS, BLOCK_ZS, PARK_Z } from './world.js';

const SHIRTS = ['#e67e22', '#ecf0f1', '#9b59b6', '#e74c3c', '#f1c40f', '#1abc9c', '#fd79a8', '#54a0ff', '#ff9f43', '#c8d6e5'];
const PANTS = ['#2c3e50', '#576574', '#222f3e', '#8395a7', '#5f27cd'];

export class Pedestrians {
  constructor(scene, rng, count = 22) {
    this.peds = [];
    this.onCrime = null; // (kind, x, z) => {}
    const loops = [];
    for (const bx of BLOCK_XS) for (const bz of BLOCK_ZS) loops.push({ cx: bx, cz: bz, half: 26.5 });
    loops.push({ cx: 0, cz: PARK_Z, half: 30 });
    for (let i = 0; i < count; i++) {
      const loop = loops[rng.int(0, loops.length - 1)];
      const mesh = makePersonMesh(rng.pick(SHIRTS), rng.pick(PANTS), rng.int(0, 3));
      scene.add(mesh);
      this.peds.push({
        mesh, loop,
        side: rng.int(0, 3), along: rng.range(0, 53),
        speed: rng.range(1.1, 1.8), phase: rng.range(0, 9),
        state: 'walk', fleeX: 0, fleeZ: 0, timer: 0, downTime: 0,
      });
    }
  }

  // Everyone within `radius` of (x, z) runs away from it.
  scatter(x, z, radius = 16) {
    for (const p of this.peds) {
      const d = Math.hypot(p.mesh.position.x - x, p.mesh.position.z - z);
      if (d < radius && p.state === 'walk') {
        p.state = 'flee';
        p.fleeX = x; p.fleeZ = z; p.timer = 2.6;
      }
    }
  }

  knockDown(ped, cause) {
    if (ped.state === 'down') return;
    ped.state = 'down';
    ped.downTime = cause === 'shot' ? 14 : 8;
    ped.mesh.rotation.x = -Math.PI / 2;
    ped.mesh.position.y = 0.25;
    if (this.onCrime) this.onCrime(cause === 'shot' ? 'assault' : 'hitped', ped.mesh.position.x, ped.mesh.position.z);
  }

  update(dt, threats) {
    for (const p of this.peds) {
      const m = p.mesh;
      if (p.state === 'down') {
        p.downTime -= dt;
        if (p.downTime <= 0) { p.state = 'walk'; m.rotation.x = 0; m.position.y = 0; }
        continue;
      }
      if (p.state === 'flee') {
        p.timer -= dt;
        const dx = m.position.x - p.fleeX, dz = m.position.z - p.fleeZ;
        const d = Math.hypot(dx, dz) || 1;
        m.position.x += (dx / d) * 5.4 * dt;
        m.position.z += (dz / d) * 5.4 * dt;
        m.rotation.y = Math.atan2(dx, dz);
        p.phase += 5.4 * dt;
        animateWalk(m, p.phase, 5.4, dt);
        if (p.timer <= 0) p.state = 'walk';
        continue;
      }
      // Walk the block loop: four straight sides, turn at the corners.
      const h = p.loop.half, per = h * 2;
      p.along += p.speed * dt;
      if (p.along >= per) { p.along -= per; p.side = (p.side + 1) % 4; }
      const a = p.along - h;
      let x, z, heading;
      if (p.side === 0) { x = p.loop.cx + a; z = p.loop.cz - h; heading = Math.PI / 2; }
      else if (p.side === 1) { x = p.loop.cx + h; z = p.loop.cz + a; heading = 0; }
      else if (p.side === 2) { x = p.loop.cx - a; z = p.loop.cz + h; heading = -Math.PI / 2; }
      else { x = p.loop.cx - h; z = p.loop.cz - a; heading = Math.PI; }
      m.position.x = x; m.position.z = z;
      m.rotation.y = heading;
      p.phase += p.speed * dt;
      animateWalk(m, p.phase, p.speed, dt);
      // A fast car close by startles them off the kerb.
      for (const t of threats) {
        if (Math.abs(t.speed) > 9 && Math.hypot(t.x - x, t.z - z) < 6) {
          p.state = 'flee'; p.fleeX = t.x; p.fleeZ = t.z; p.timer = 1.6;
          break;
        }
      }
    }
  }

  nearest(x, z, maxDist) {
    let best = null, bd = maxDist;
    for (const p of this.peds) {
      if (p.state === 'down') continue;
      const d = Math.hypot(p.mesh.position.x - x, p.mesh.position.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
