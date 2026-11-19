// vehicles.js — the cars of Port Marisol: low-poly models built from boxes (sedan,
// coupe, pickup, taxi and the Marisol PD interceptor) and one arcade driving model
// that the player, the traffic and the police all share, so every car on the street
// handles the same way.

import * as THREE from '../vendor/three.module.min.js';
import { collideCircle, clampToCity } from './world.js';

export const CAR_COLORS = ['#e74c3c', '#f39c12', '#2ec4b6', '#ecf0f1', '#9b59b6', '#3498db', '#e67e22', '#1abc9c', '#fd79a8', '#95a5a6'];
export const CAR_KINDS = {
  sedan: { len: 4.3, topSpeed: 31, accel: 13, grip: 2.7 },
  coupe: { len: 4.1, topSpeed: 40, accel: 17, grip: 3.1 },
  pickup: { len: 4.7, topSpeed: 28, accel: 12, grip: 2.5 },
  taxi: { len: 4.3, topSpeed: 31, accel: 13, grip: 2.7 },
  police: { len: 4.4, topSpeed: 37, accel: 16, grip: 3.0 },
};

const bodyGeo = new THREE.BoxGeometry(1.82, 0.62, 1);
const cabinGeo = new THREE.BoxGeometry(1.62, 0.55, 1);
const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.26, 10);
const wheelMat = new THREE.MeshLambertMaterial({ color: '#15181a' });
const glassMat = new THREE.MeshLambertMaterial({ color: '#1d3038' });
const lightMat = new THREE.MeshBasicMaterial({ color: '#fff6c9' });
const tailMat = new THREE.MeshBasicMaterial({ color: '#ff2d20' });

export function makeCarMesh(kind, color) {
  const spec = CAR_KINDS[kind];
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: kind === 'police' ? '#20242a' : color });
  const body = new THREE.Mesh(bodyGeo, paint);
  body.scale.z = spec.len; body.position.y = 0.58; body.castShadow = true;
  g.add(body);
  if (kind === 'police') { // white doors band
    const band = new THREE.Mesh(bodyGeo, new THREE.MeshLambertMaterial({ color: '#eef2f0' }));
    band.scale.set(1.01, 0.34, spec.len * 0.52); band.position.y = 0.58; g.add(band);
  }
  const cabin = new THREE.Mesh(cabinGeo, kind === 'pickup' ? paint : glassMat);
  cabin.scale.z = kind === 'pickup' ? 1.7 : spec.len * 0.46;
  cabin.position.set(0, 1.12, kind === 'pickup' ? -spec.len * 0.22 : -0.2);
  cabin.castShadow = true;
  g.add(cabin);
  if (kind === 'pickup') { // open bed walls
    const bed = new THREE.Mesh(bodyGeo, paint);
    bed.scale.set(0.96, 0.4, spec.len * 0.4); bed.position.set(0, 0.95, spec.len * 0.26); g.add(bed);
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), new THREE.MeshBasicMaterial({ color: '#ffd23e' }));
    sign.position.set(0, 1.52, -0.2); g.add(sign);
    body.material = new THREE.MeshLambertMaterial({ color: '#f5b921' });
  }
  const wheelZ = spec.len / 2 - 0.85;
  for (const [wx, wz] of [[-0.85, wheelZ], [0.85, wheelZ], [-0.85, -wheelZ], [0.85, -wheelZ]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.35, wz);
    g.add(w);
  }
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), lightMat);
    hl.position.set(0.55 * s, 0.66, spec.len / 2 + 0.01); g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), tailMat);
    tl.position.set(0.55 * s, 0.7, -spec.len / 2 - 0.01); g.add(tl);
  }
  if (kind === 'police') {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.4), new THREE.MeshBasicMaterial({ color: '#ff2222' }));
    red.position.x = -0.3;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.4), new THREE.MeshBasicMaterial({ color: '#2266ff' }));
    blue.position.x = 0.3;
    bar.add(red, blue);
    bar.position.set(0, 1.5, -0.2);
    g.add(bar);
    g.userData.lightbar = { red, blue };
  }
  return g;
}

// A vehicle is a mesh plus driving state. forward = (sin heading, cos heading).
export function makeVehicle(kind, color, x, z, heading) {
  const mesh = makeCarMesh(kind, color);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  return {
    kind, mesh, heading, speed: 0, steer: 0, damage: 0,
    radius: 1.35, dead: false, driver: null, honkAt: 0,
    get x() { return mesh.position.x; }, get z() { return mesh.position.z; },
    forwardX() { return Math.sin(this.heading); }, forwardZ() { return Math.cos(this.heading); },
  };
}

// Advance one vehicle. control: { throttle: -1..1, steer: -1..1, handbrake: bool }.
// Returns the impact speed if it hit a building this step, else 0.
export function stepVehicle(v, dt, control, colliders) {
  const spec = CAR_KINDS[v.kind];
  const throttle = control.throttle ?? 0;
  const maxF = spec.topSpeed, maxR = 9;
  if (throttle > 0) v.speed += spec.accel * throttle * dt * (v.speed < 0 ? 2.2 : 1);
  else if (throttle < 0) v.speed += spec.accel * 0.8 * throttle * dt * (v.speed > 0.5 ? 2.4 : 1);
  v.speed -= v.speed * 0.55 * dt;                                  // drag
  if (Math.abs(throttle) < 0.05) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 4.5 * dt);
  if (control.handbrake) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 26 * dt);
  v.speed = Math.max(-maxR, Math.min(maxF, v.speed));
  const steerTarget = (control.steer ?? 0) * 0.58 / (1 + Math.abs(v.speed) * 0.055);
  v.steer += (steerTarget - v.steer) * Math.min(1, dt * 8);
  if (Math.abs(v.speed) > 0.05) {
    v.heading += v.steer * v.speed * dt * 0.42 * (control.handbrake ? 1.5 : 1);
  }
  let nx = v.x + v.forwardX() * v.speed * dt;
  let nz = v.z + v.forwardZ() * v.speed * dt;
  const before = Math.abs(v.speed);
  [nx, nz] = collideCircle(colliders, nx, nz, v.radius);
  [nx, nz] = clampToCity(nx, nz);
  const moved = Math.hypot(nx - v.x, nz - v.z);
  let impact = 0;
  if (before > 3 && moved < Math.abs(v.speed) * dt * 0.35) {
    impact = before;
    v.speed = -v.speed * 0.22;
    v.damage = Math.min(100, v.damage + impact * 1.1);
  }
  v.mesh.position.x = nx; v.mesh.position.z = nz;
  v.mesh.rotation.y = v.heading;
  v.mesh.rotation.z = -v.steer * Math.min(0.09, Math.abs(v.speed) * 0.004) * Math.sign(v.speed);
  return impact;
}

// Soft circle collision between two vehicles: separate them and trade a little speed.
export function collideVehicles(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz), min = a.radius + b.radius + 0.35;
  if (d === 0 || d >= min) return 0;
  const push = (min - d) / 2, ux = dx / d, uz = dz / d;
  a.mesh.position.x -= ux * push; a.mesh.position.z -= uz * push;
  b.mesh.position.x += ux * push; b.mesh.position.z += uz * push;
  const rel = Math.abs(a.speed - b.speed);
  const avg = (a.speed + b.speed) / 2;
  a.speed = avg * 0.92; b.speed = avg * 0.92;
  return rel;
}
