// effects.js — cheap, cheerful feedback: one pooled THREE.Points cloud for every
// burst in the game (impact sparks, muzzle flashes, tyre smoke, damage smoke,
// confetti-bright pickup glints) plus short-lived tracer lines for gunfire.
// Nothing here allocates in the frame loop beyond the fixed pool.

import * as THREE from '../vendor/three.module.min.js';

const MAX = 900;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.head = 0;
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.32, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.tracers = [];
  }

  burst(x, y, z, { count = 10, color = '#ffb340', speed = 5, up = 2.5, life = 0.5, gravity = -6, spread = 1 } = {}) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.head; this.head = (this.head + 1) % MAX;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, r = (0.3 + Math.random() * 0.7) * speed * spread;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = Math.random() * up;
      this.vel[i * 3 + 2] = Math.sin(a) * r;
      const jitter = 0.75 + Math.random() * 0.4;
      this.col[i * 3] = c.r * jitter; this.col[i * 3 + 1] = c.g * jitter; this.col[i * 3 + 2] = c.b * jitter;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.7);
      this.grav[i] = gravity;
    }
  }

  sparks(x, y, z, n = 12) { this.burst(x, y, z, { count: n, color: '#ffc46b', speed: 6, up: 3, life: 0.4 }); }
  smoke(x, y, z, n = 2) { this.burst(x, y, z, { count: n, color: '#5a5f63', speed: 0.8, up: 2.2, life: 1.4, gravity: 1.5 }); }
  muzzle(x, y, z) { this.burst(x, y, z, { count: 5, color: '#ffe9a8', speed: 2.5, up: 0.8, life: 0.16, gravity: 0 }); }
  glint(x, y, z) { this.burst(x, y, z, { count: 14, color: '#8dff9a', speed: 2.6, up: 3.4, life: 0.7, gravity: -2 }); }
  dust(x, y, z, n = 8) { this.burst(x, y, z, { count: n, color: '#cbb98f', speed: 3, up: 1.4, life: 0.6, gravity: -1 }); }

  tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) this.pos[i * 3 + 1] = 0.05;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      tr.line.material.opacity = Math.max(0, tr.life / 0.07) * 0.9;
      if (tr.life <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose(); tr.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }
}
