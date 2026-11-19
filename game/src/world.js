// world.js — Port Marisol itself: the street grid, city blocks and buildings, the
// beachfront, landmarks (Ferreira Motors, Marisol General hospital, the police
// station, the Grand Marisol hotel), props, lighting and the road network data the
// traffic, pedestrians, police and minimap all share. Everything is placed from a
// seeded layout so a given seed always builds the same city.

import * as THREE from '../vendor/three.module.min.js';

export const PITCH = 60;               // distance between block centres
export const BLOCK_HALF = 23;          // a block is 46 m square
export const ROAD_XS = [-156, -90, -30, 30, 90, 156];   // vertical road centre lines
export const ROAD_ZS = [-156, -90, -30, 30, 90, 150];   // horizontal roads; 150 is the coast road
export const BLOCK_XS = [-120, -60, 0, 60, 120];
export const BLOCK_ZS = [-120, -60, 0, 60];
export const PARK_Z = 120;             // the promenade row: park, palms, no towers
export const BEACH_Z = 157;            // sand starts here
export const WATER_Z = 205;            // the sea starts here
export const BOUNDS = { x: 168, zMin: -168, zMax: 200 };

const PASTELS = ['#f6d8a8', '#f2b8a0', '#a8d8d0', '#f6efdd', '#e8a2b4', '#bcd8f0', '#ffe9a8', '#d9e6b8'];

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A facade texture: coloured render with a grid of windows, a few lit warm.
function facadeTexture(rng, base) {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, w, 10);
    const cols = 5, rows = 10, ww = 14, wh = 15, gx = (w - cols * ww) / (cols + 1), gy = (h - rows * wh) / (rows + 1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const lit = rng.chance(0.24);
      g.fillStyle = lit ? '#ffd98a' : (rng.chance(0.5) ? '#33505e' : '#27404e');
      g.fillRect(gx + c * (ww + gx), gy + r * (wh + gy), ww, wh);
    }
  });
}

function signTexture(text, bg, fg, sub) {
  return canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 52px "Avenir Next", sans-serif';
    g.fillText(text, w / 2, sub ? h / 2 - 14 : h / 2);
    if (sub) { g.font = '700 26px "Avenir Next", sans-serif'; g.fillText(sub, w / 2, h / 2 + 34); }
  });
}

// Paints the whole city from above onto one big texture: pavement, asphalt with lane
// dashes and crosswalks, the park, the promenade and the sand.
function groundTexture() {
  const S = 2048, world = 400; // texture covers x [-200,200], z [-186,214]
  const px = (x) => ((x + 200) / world) * S;
  const pz = (z) => ((z + 186) / world) * S;
  const m = S / world;
  return canvasTexture(S, S, (g) => {
    g.fillStyle = '#8f9296'; g.fillRect(0, 0, S, S);                       // pavement
    g.fillStyle = '#7fae56'; g.fillRect(px(-176), pz(97), 352 * m, 46 * m); // park grass
    g.fillStyle = '#e9d09c'; g.fillRect(px(-200), pz(BEACH_Z), S, (214 - BEACH_Z) * m); // sand
    g.fillStyle = '#dfc48c'; g.fillRect(px(-200), pz(196), S, 9 * m);       // wet sand line
    g.fillStyle = '#c9a86a'; g.fillRect(px(-200), pz(143), S, 14 * m);      // promenade boards
    const road = (x0, z0, wdt, hgt) => { g.fillStyle = '#33373c'; g.fillRect(px(x0), pz(z0), wdt * m, hgt * m); };
    for (const x of ROAD_XS) road(x - 7, -176, 14, 340);
    for (const z of ROAD_ZS) road(-176, z - 7, 352, 14);
    g.strokeStyle = '#e8e4da'; g.lineWidth = 2.4; g.setLineDash([14, 12]);
    for (const x of ROAD_XS) { g.beginPath(); g.moveTo(px(x), pz(-176)); g.lineTo(px(x), pz(164)); g.stroke(); }
    for (const z of ROAD_ZS) { g.beginPath(); g.moveTo(px(-176), pz(z)); g.lineTo(px(176), pz(z)); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = 'rgba(240,240,235,0.85)';                                  // crosswalks
    for (const x of ROAD_XS) for (const z of ROAD_ZS) {
      for (let i = -2; i <= 2; i++) {
        g.fillRect(px(x + i * 2.6 - 0.8), pz(z - 10.5), 1.6 * m, 3.4 * m);
        g.fillRect(px(x - 10.5), pz(z + i * 2.6 - 0.8), 3.4 * m, 1.6 * m);
      }
    }
  });
}

export function buildWorld(scene, rng) {
  const colliders = [];
  const addCollider = (cx, cz, w, d) => colliders.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 });

  // Sky, sun and sea air.
  scene.background = new THREE.Color('#8fd4e8');
  scene.fog = new THREE.Fog('#a8d8e2', 190, 460);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
  sun.position.set(-90, 130, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -190; sun.shadow.camera.right = 190;
  sun.shadow.camera.top = 190; sun.shadow.camera.bottom = -190;
  sun.shadow.camera.far = 420; sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight('#bfe6f2', '#caa06a', 0.85));

  // Ground and sea.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 14);
  ground.receiveShadow = true;
  scene.add(ground);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(760, 150),
    new THREE.MeshPhongMaterial({ color: '#1d7f96', shininess: 120, transparent: true, opacity: 0.94 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.35, WATER_Z + 72);
  scene.add(sea);

  // Buildings: two to four per block on a 2x2 plot grid, taller downtown.
  const facades = PASTELS.map((c) => facadeTexture(rng, c));
  const roofMat = new THREE.MeshLambertMaterial({ color: '#6d6a66' });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const bx of BLOCK_XS) for (const bz of BLOCK_ZS) {
    if ((bx === -120 && bz === 60) || (bx === 120 && bz === -120) || (bx === 0 && bz === -60) || (bx === 60 && bz === 0)) continue; // landmarks
    const downtown = Math.max(0, 1 - (Math.abs(bx) + Math.abs(bz)) / 260);
    for (const ox of [-11.5, 11.5]) for (const oz of [-11.5, 11.5]) {
      if (rng.chance(0.14)) continue; // a parking lot / plaza gap
      const w = rng.range(15, 20), d = rng.range(15, 20);
      const h = rng.range(10, 20) + downtown * rng.range(8, 30);
      const mat = new THREE.MeshLambertMaterial({ map: facades[rng.int(0, facades.length - 1)] });
      const b = new THREE.Mesh(boxGeo, [mat, mat, roofMat, roofMat, mat, mat]);
      b.scale.set(w, h, d);
      b.position.set(bx + ox, h / 2, bz + oz);
      b.castShadow = true; b.receiveShadow = true;
      scene.add(b);
      addCollider(bx + ox, bz + oz, w, d);
    }
  }

  // A landmark block: one wide building, a sign, and a collider.
  function landmark(bx, bz, w, h, d, color, sign, sub) {
    const mat = new THREE.MeshLambertMaterial({ color });
    const b = new THREE.Mesh(boxGeo, [mat, mat, roofMat, roofMat, mat, mat]);
    b.scale.set(w, h, d); b.position.set(bx, h / 2, bz);
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
    addCollider(bx, bz, w, d);
    if (sign) {
      const s = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(w * 0.92, 30), 4.6),
        new THREE.MeshBasicMaterial({ map: signTexture(sign, '#12333f', '#ffd23e', sub) }),
      );
      s.position.set(bx, h - 3.4, bz + d / 2 + 0.06);
      scene.add(s);
      const s2 = s.clone(); s2.rotation.y = Math.PI; s2.position.z = bz - d / 2 - 0.06; scene.add(s2);
    }
    return b;
  }
  landmark(-120, 60, 34, 11, 30, '#d96f4e', 'FERREIRA MOTORS', 'repairs · tuning · quiet favours');
  landmark(120, -120, 32, 16, 30, '#eef2f0', 'MARISOL GENERAL', 'hospital');
  landmark(0, -60, 24, 56, 24, '#f3c96b', 'GRAND MARISOL', 'hotel & casino');
  landmark(60, 0, 30, 13, 28, '#5d7484', 'MARISOL PD', 'police department');

  // The promenade: palms, a fountain and food stands along the park row.
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 5.6, 6);
  const crownGeo = new THREE.ConeGeometry(2.6, 1.6, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#8a6a44' });
  const crownMat = new THREE.MeshLambertMaterial({ color: '#3f9e4d' });
  const palmSpots = [];
  for (let x = -168; x <= 168; x += 16) palmSpots.push([x + rng.range(-2, 2), 147 + rng.range(-1.5, 1.5)]);
  for (const bx of BLOCK_XS) for (let i = 0; i < 3; i++) palmSpots.push([bx + rng.range(-19, 19), PARK_Z + rng.range(-18, 18)]);
  for (let i = 0; i < 16; i++) palmSpots.push([rng.range(-165, 165), rng.range(166, 196)]);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palmSpots.length);
  const dummy = new THREE.Object3D();
  palmSpots.forEach(([x, z], i) => {
    const lean = rng.range(-0.09, 0.09);
    dummy.position.set(x, 2.8, z); dummy.rotation.set(lean, 0, lean); dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + lean * 20, 5.9, z + lean * 20); dummy.rotation.set(0, rng.range(0, 3), 0); dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });
  trunks.castShadow = true; crowns.castShadow = true;
  scene.add(trunks, crowns);

  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.6, 1, 20), new THREE.MeshLambertMaterial({ color: '#cfd6d2' }));
  fountain.position.set(0, 0.5, PARK_Z); fountain.castShadow = true; scene.add(fountain);
  addCollider(0, PARK_Z, 11, 11);
  const awning = ['#ff5a49', '#ffb340', '#2ec4b6'];
  [-60, 60].forEach((sx, i) => {
    const stand = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: awning[i % awning.length] }));
    stand.scale.set(7, 3.4, 5); stand.position.set(sx, 1.7, PARK_Z + 14);
    stand.castShadow = true; scene.add(stand);
    addCollider(sx, PARK_Z + 14, 7, 5);
  });

  // Street lamps at intersection corners (instanced posts, emissive heads).
  const lampGeo = new THREE.CylinderGeometry(0.09, 0.09, 5.4, 5);
  const lampMat = new THREE.MeshLambertMaterial({ color: '#3c464c' });
  const lampPts = [];
  for (const x of ROAD_XS) for (const z of ROAD_ZS) lampPts.push([x + 8.6, z + 8.6]);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampPts.length);
  lampPts.forEach(([x, z], i) => { dummy.position.set(x, 2.7, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); lamps.setMatrixAt(i, dummy.matrix); });
  scene.add(lamps);

  // Road network data shared by traffic, police, peds and the minimap.
  const intersections = [];
  for (const x of ROAD_XS) for (const z of ROAD_ZS) intersections.push({ x, z });

  // Kerbside parking spots along the vertical avenues, clear of junctions.
  const parkSpots = [];
  for (const x of ROAD_XS.slice(1, 5)) for (const bz of [...BLOCK_ZS, PARK_Z]) {
    for (const side of [-5.9, 5.9]) for (const off of [-13, 0, 13]) {
      parkSpots.push({ x: x + side, z: bz + off, heading: side > 0 ? Math.PI : 0 });
    }
  }

  return {
    colliders, intersections, parkSpots,
    garagePos: { x: -99, z: 60 },
    garageDoor: { x: -102, z: 60 },
    hospitalPos: { x: 99, z: -120 },
    policeStation: { x: 41, z: 0 },
    playerStart: { x: -97, z: 70, heading: Math.PI / 2 },
    update(dt, t) { sea.position.y = -0.35 + Math.sin(t * 0.7) * 0.07; },
  };
}

// Circle-vs-buildings collision: push (x, z) out of every AABB it overlaps.
export function collideCircle(colliders, x, z, r) {
  for (const c of colliders) {
    if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) {
      const dxl = x - (c.x0 - r), dxr = (c.x1 + r) - x, dzl = z - (c.z0 - r), dzr = (c.z1 + r) - z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) x = c.x0 - r; else if (m === dxr) x = c.x1 + r;
      else if (m === dzl) z = c.z0 - r; else z = c.z1 + r;
    }
  }
  return [x, z];
}

export function clampToCity(x, z) {
  return [
    Math.max(-BOUNDS.x, Math.min(BOUNDS.x, x)),
    Math.max(BOUNDS.zMin, Math.min(BOUNDS.zMax, z)),
  ];
}
