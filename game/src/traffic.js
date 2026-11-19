// traffic.js — Marisol's everyday drivers. Each traffic car follows the road
// graph intersection to intersection on the correct side of the road, slows for
// corners, brakes for whatever is in front of it, honks, and gives up gracefully
// when the player steals its car (it adopts the car back when the player leaves).

import { makeVehicle, stepVehicle, CAR_COLORS } from './vehicles.js';
import { ROAD_XS, ROAD_ZS } from './world.js';

const KINDS = ['sedan', 'sedan', 'coupe', 'pickup', 'taxi'];
const LANE = 3.4;

function lanePoint(from, to) {
  // The point a car aims at when travelling from intersection `from` to `to`,
  // offset onto the right-hand side of the road.
  if (from.x === to.x) return { x: from.x + (to.z > from.z ? -LANE : LANE), z: to.z };
  return { x: to.x, z: from.z + (to.x > from.x ? LANE : -LANE) };
}

function neighbours(node) {
  const out = [];
  for (const x of ROAD_XS) if (x !== node.x) out.push({ x, z: node.z });
  for (const z of ROAD_ZS) if (z !== node.z) out.push({ x: node.x, z });
  return out.filter((n) => (n.x === node.x) !== (n.z === node.z));
}

export class Traffic {
  constructor(scene, rng, colliders, count = 14) {
    this.cars = [];
    this.colliders = colliders;
    this.rng = rng;
    this.onCrash = null; // (impact, x, z) => {}
    const nodes = [];
    for (const x of ROAD_XS) for (const z of ROAD_ZS) nodes.push({ x, z });
    for (let i = 0; i < count; i++) {
      let node = nodes[rng.int(0, nodes.length - 1)];
      if (Math.hypot(node.x + 97, node.z - 70) < 40) node = { x: 90, z: -90 }; // keep the spawn corner clear
      const next = neighbours(node)[rng.int(0, 3)];
      const kind = KINDS[rng.int(0, KINDS.length - 1)];
      const start = node.x === next.x
        ? { x: node.x + (next.z > node.z ? -LANE : LANE), z: node.z }
        : { x: node.x, z: node.z + (next.x > node.x ? LANE : -LANE) };
      const v = makeVehicle(kind, CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)], start.x, start.z, 0);
      v.heading = Math.atan2(next.x - node.x, next.z - node.z);
      v.mesh.rotation.y = v.heading;
      v.driver = 'traffic';
      scene.add(v.mesh);
      this.cars.push({ v, from: node, to: next, cruise: rng.range(10, 14.5), stuckFor: 0, waitAfterTheft: 0 });
    }
  }

  release(vehicle) {
    const i = this.cars.findIndex((c) => c.v === vehicle);
    if (i >= 0) this.cars.splice(i, 1);
  }

  adopt(vehicle) {
    // Find the nearest intersection and send the car on its way again.
    let best = null, bd = 1e9;
    for (const x of ROAD_XS) for (const z of ROAD_ZS) {
      const d = Math.hypot(x - vehicle.x, z - vehicle.z);
      if (d < bd) { bd = d; best = { x, z }; }
    }
    const next = neighbours(best)[this.rng.int(0, 3)];
    this.cars.push({ v: vehicle, from: best, to: next, cruise: 11, stuckFor: 0, waitAfterTheft: 2 });
    vehicle.driver = 'traffic';
  }

  update(dt, obstacles) {
    for (const c of this.cars) {
      const v = c.v;
      if (c.waitAfterTheft > 0) { c.waitAfterTheft -= dt; stepVehicle(v, dt, { throttle: 0 }, this.colliders); continue; }
      const target = lanePoint(c.from, c.to);
      const dx = target.x - v.x, dz = target.z - v.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 6) { // reached the junction: pick the next leg, usually not a U-turn
        const opts = neighbours(c.to).filter((n) => !(n.x === c.from.x && n.z === c.from.z));
        const next = opts[this.rng.int(0, opts.length - 1)];
        c.from = c.to; c.to = next;
        continue;
      }
      const want = Math.atan2(dx, dz);
      let err = want - v.heading;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      // Something in front? Brake.
      let blocked = false;
      for (const o of obstacles) {
        if (o === v) continue;
        const ox = o.x - v.x, oz = o.z - v.z;
        const ahead = ox * v.forwardX() + oz * v.forwardZ();
        const side = Math.abs(ox * v.forwardZ() - oz * v.forwardX());
        if (ahead > 0.5 && ahead < 8.5 && side < 2.1) { blocked = true; break; }
      }
      let throttle = 0, targetSpeed = Math.abs(err) > 0.45 ? 5.5 : c.cruise;
      if (blocked) targetSpeed = 0;
      if (v.speed < targetSpeed) throttle = 0.85;
      else if (v.speed > targetSpeed + 1.5) throttle = -0.7;
      const impact = stepVehicle(v, dt, { throttle, steer: Math.max(-1, Math.min(1, err * 1.7)) }, this.colliders);
      if (impact > 7 && this.onCrash) this.onCrash(impact, v.x, v.z);
      if (Math.abs(v.speed) < 0.4 && !blocked) {
        c.stuckFor += dt;
        if (c.stuckFor > 3) { // nudge out: reverse and re-aim at the target junction
          v.speed = -3.5; c.stuckFor = 0;
        }
      } else c.stuckFor = 0;
    }
  }
}
