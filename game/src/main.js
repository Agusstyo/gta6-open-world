// main.js — Port Marisol's conductor. Builds the renderer, scene and every
// system (world, player, traffic, pedestrians, police, missions, combat, HUD,
// audio, effects, save), owns the game state (title / playing / paused /
// dialogue / wasted), the cameras, the crime-and-damage wiring between
// systems, and the deterministic ?shot= scenes the screenshots are taken from.

import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';
import { buildWorld } from './world.js';
import { makeVehicle, stepVehicle, collideVehicles, CAR_COLORS } from './vehicles.js';
import { Player, makePersonMesh } from './player.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Wanted, Police } from './police.js';
import { Combat } from './combat.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import { loadSave, storeSave, clearSave } from './save.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1) || 1;
const shotMode = params.get('shot');
const rng = makeRng(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 900);
camera.position.set(-60, 42, 150);

const world = buildWorld(scene, rng);
const effects = new Effects(scene);
const audio = new AudioEngine();
const hud = new HUD();
const player = new Player(scene, world.playerStart.x, world.playerStart.z, world.playerStart.heading);
const traffic = new Traffic(scene, rng, world.colliders, 14);
const peds = new Pedestrians(scene, rng, 22);
const wanted = new Wanted();
const police = new Police(scene, world.colliders, world.policeStation);
const combat = new Combat(scene, effects, audio);
const missions = new Missions(rng);

// Sol Ferreira herself, holding court by the garage door.
const sol = makePersonMesh('#ff5a49', '#20303a', 2);
sol.position.set(world.garageDoor.x + 2.5, 0, world.garageDoor.z + 3);
sol.rotation.y = Math.PI / 2;
scene.add(sol);

// Parked cars in the kerbside spots, plus one coupe waiting by the garage.
const vehicles = [];
function addParked(kind, color, x, z, heading) {
  const v = makeVehicle(kind, color, x, z, heading);
  v.driver = 'parked';
  scene.add(v.mesh);
  vehicles.push(v);
  return v;
}
{
  const spots = [...world.parkSpots];
  for (let i = 0; i < 16 && i < spots.length; i++) {
    const s = spots[Math.floor(rng.next() * spots.length)];
    if (vehicles.some((v) => Math.hypot(v.x - s.x, v.z - s.z) < 6)) continue;
    const kinds = ['sedan', 'sedan', 'coupe', 'pickup', 'taxi'];
    addParked(kinds[rng.int(0, kinds.length - 1)], CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)], s.x, s.z, s.heading);
  }
  addParked('coupe', '#2ec4b6', -93, 78, Math.PI);
}
let markedCar = null;

// The objective beacon: a soft pillar of light on whatever matters right now.
const beacon = new THREE.Mesh(
  new THREE.CylinderGeometry(1.7, 1.7, 34, 18, 1, true),
  new THREE.MeshBasicMaterial({ color: '#ffd23e', transparent: true, opacity: 0.33, side: THREE.DoubleSide, depthWrite: false }),
);
beacon.position.y = 17;
beacon.visible = false;
scene.add(beacon);

// ---------------------------------------------------------------- state
const G = {
  mode: shotMode ? 'playing' : 'title',   // title | playing | paused | dialogue | wasted
  cash: 120, health: 100, clockMin: 11 * 60 + 20,
  inCar: null, invulnFor: 0, sinceHurt: 99, saveTimer: 0, crimeMuteFor: 0,
  camYaw: Math.PI, camPitch: 0.32, camDist: 8.5,
  dialogueQueue: [], dialogueDone: null, shake: 0, time: 0,
  stats: { missions: 0, crimes: 0 },
};
window.__game = G;
window.__marisol = { player, wanted, missions, traffic, police, vehicles, world, G };

const saveData = loadSave();
if (saveData && !shotMode) {
  document.getElementById('btn-continue').classList.remove('hidden');
}

function persist() {
  storeSave({
    cash: G.cash, health: G.health, clockMin: G.clockMin,
    missionIndex: missions.index, storyDone: missions.storyDone,
    x: player.x, z: player.z, stats: G.stats,
  });
}

function applySave(d) {
  G.cash = d.cash ?? G.cash;
  G.health = d.health ?? 100;
  G.clockMin = d.clockMin ?? G.clockMin;
  missions.index = Math.min(d.missionIndex ?? 0, 5);
  if (d.storyDone) missions.index = 5;
  G.stats = d.stats ?? G.stats;
  if (typeof d.x === 'number') player.teleport(d.x, d.z, Math.PI / 2);
}

// ---------------------------------------------------------------- input
const keys = new Set();
let mouseDown = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  audio.ensure();
  if (G.mode === 'dialogue' && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); advanceDialogue(); }
  else if (G.mode === 'playing') {
    if (e.code === 'KeyE') tryInteract();
    if (e.code === 'KeyF') tryShoot();
    if (e.code === 'KeyM') { audio.musicOn = !audio.musicOn; hud.toast(audio.musicOn ? 'Music on' : 'Music off'); }
    if (e.code === 'KeyP' || e.code === 'Escape') pauseGame(true);
  } else if (G.mode === 'paused' && (e.code === 'KeyP' || e.code === 'Escape')) pauseGame(false);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousedown', (e) => {
  audio.ensure();
  if (e.target.closest('button')) return;
  mouseDown = true;
  if (G.mode === 'dialogue') advanceDialogue();
  else if (G.mode === 'playing' && !G.inCar) tryShoot();
});
addEventListener('mouseup', () => { mouseDown = false; });
addEventListener('mousemove', (e) => {
  if (!mouseDown || G.mode !== 'playing') return;
  G.camYaw -= e.movementX * 0.005;
  G.camPitch = Math.max(0.06, Math.min(1.15, G.camPitch + e.movementY * 0.004));
});
addEventListener('wheel', (e) => {
  if (G.mode === 'playing') G.camDist = Math.max(5.5, Math.min(17, G.camDist + Math.sign(e.deltaY) * 1.2));
}, { passive: true });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- dialogue
function showDialogue(lines, done) {
  if (!lines || lines.length === 0) { if (done) done(); return; }
  G.dialogueQueue = [...lines];
  G.dialogueDone = done ?? null;
  G.mode = 'dialogue';
  const line = G.dialogueQueue[0];
  hud.dialogue(line.name, line.text);
}
function advanceDialogue() {
  G.dialogueQueue.shift();
  if (G.dialogueQueue.length === 0) {
    hud.dialogue(null);
    G.mode = 'playing';
    const done = G.dialogueDone; G.dialogueDone = null;
    if (done) done();
  } else {
    const line = G.dialogueQueue[0];
    hud.dialogue(line.name, line.text);
  }
}

// ---------------------------------------------------------------- crime wiring
function witnessed(x, z, radius = 22) {
  for (const u of police.units) if (Math.hypot(u.v.x - x, u.v.z - z) < 38) return true;
  for (const p of peds.peds) if (p.state !== 'down' && Math.hypot(p.mesh.position.x - x, p.mesh.position.z - z) < radius) return true;
  return false;
}
function reportCrime(kind, x, z) {
  wanted.addCrime(kind, witnessed(x, z));
  G.stats.crimes++;
}
peds.onCrime = (kind, x, z) => { reportCrime(kind, x, z); peds.scatter(x, z, 15); };
traffic.onCrash = (impact, x, z) => {
  audio.crash(impact);
  effects.sparks(x, 0.8, z, 8);
  if (impact > 9) reportCrime('crash', x, z);
};
combat.onCrime = (kind, x, z) => reportCrime(kind, x, z);
combat.onShotFired = (x, z) => {
  peds.scatter(x, z, 20);
  if (witnessed(x, z, 26)) reportCrime('shoot', x, z);
};
wanted.onStarsChanged = (stars) => {
  if (stars > 0) hud.toast(stars >= 3 ? 'Marisol PD is coming in force!' : 'The police have your description');
};
wanted.onEscaped = () => { hud.banner('YOU LOST THEM<small>heat cleared</small>', 2); audio.cash(); };

// ---------------------------------------------------------------- interaction
function nearestVehicle(maxDist) {
  let best = null, bd = maxDist;
  const all = [...vehicles, ...traffic.cars.map((c) => c.v), ...police.units.map((u) => u.v)];
  for (const v of all) {
    const d = Math.hypot(v.x - player.x, v.z - player.z);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

function tryInteract() {
  if (G.inCar) { exitCar(); return; }
  // Work first: Sol's marker.
  const offer = missions.offerTarget(world.garagePos);
  if (offer && Math.hypot(player.x - world.garagePos.x, player.z - world.garagePos.z) < 4.5) {
    const intro = missions.start();
    if (intro) showDialogue(intro);
    return;
  }
  const v = nearestVehicle(3.4);
  if (v) enterCar(v);
}

function enterCar(v) {
  if (v.driver === 'traffic') { traffic.release(v); reportCrime('carjack', v.x, v.z); }
  else if (v.driver === 'parked') reportCrime('theft', v.x, v.z);
  else if (v.driver === 'police') {
    reportCrime('carjack', v.x, v.z);
    const i = police.units.findIndex((u) => u.v === v); // the unit is yours now; PD sends another
    if (i >= 0) police.units.splice(i, 1);
  }
  v.driver = 'player';
  G.inCar = v;
  player.mesh.visible = false;
  hud.crosshair.classList.add('hidden');
  audio.ensure();
  if (v === markedCar) hud.toast('Got it — get it to Ferreira Motors');
}

function exitCar() {
  const v = G.inCar;
  if (!v) return;
  G.inCar = null;
  const sideX = v.forwardZ(), sideZ = -v.forwardX(); // left of the car
  player.teleport(v.x + sideX * 2.1, v.z + sideZ * 2.1, v.heading);
  player.mesh.visible = true;
  if (v !== markedCar && v.kind !== 'police' && !v.dead) { v.driver = 'parked'; traffic.adopt(v); }
  else v.driver = 'parked';
  hud.setSpeedo(null);
}

function tryShoot() {
  if (G.inCar || G.mode !== 'playing') return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = new THREE.Vector3(player.x, 1.45, player.z);
  combat.shoot(origin, dir, {
    peds: peds.peds, pedSystem: peds,
    vehicles: [...vehicles, ...traffic.cars.map((c) => c.v), ...police.units.map((u) => u.v)],
    colliders: world.colliders,
  });
}

// ---------------------------------------------------------------- harm & endings
function hurt(amount, why) {
  if (G.invulnFor > 0 || G.mode !== 'playing') return;
  G.health -= amount;
  G.sinceHurt = 0;
  hud.damageFlash(Math.min(0.85, 0.3 + amount * 0.02));
  if (G.health <= 0) endRun('wasted', why);
}
function endRun(kind, why) {
  G.mode = 'wasted';
  const word = document.getElementById('wasted-word');
  const detail = document.getElementById('wasted-detail');
  word.textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  const fine = kind === 'busted'
    ? Math.min(G.cash, 200 + wanted.stars * 60)
    : Math.min(G.cash, 150 + Math.floor(G.cash * 0.1));
  G.cash -= fine;
  detail.textContent = kind === 'busted'
    ? `Marisol PD takes $${fine} in fines. You walk out of the station lighter.`
    : `Marisol General patches you up for $${fine}. ${why ?? ''}`;
  document.getElementById('wasted-screen').classList.remove('hidden');
  hud.hide();
  if (kind === 'busted') audio.bustedJingle();
  wanted.clear();
  police.reset();
  if (G.inCar) { G.inCar.driver = 'parked'; G.inCar = null; player.mesh.visible = true; }
  setTimeout(() => {
    document.getElementById('wasted-screen').classList.add('hidden');
    const spot = kind === 'busted' ? world.policeStation : world.hospitalPos;
    player.teleport(spot.x, spot.z, Math.PI / 2);
    G.health = 100;
    G.mode = 'playing';
    hud.show();
    persist();
  }, 3000);
}

// ---------------------------------------------------------------- missions glue
function handleMissionEvents() {
  for (const ev of missions.events.splice(0)) {
    if (ev.type === 'needMarkedCar') {
      if (markedCar) { scene.remove(markedCar.mesh); vehicles.splice(vehicles.indexOf(markedCar), 1); }
      markedCar = addParked('coupe', '#e74c3c', ev.x, ev.z, Math.PI);
      markedCar.isMarked = true;
    } else if (ev.type === 'setStars') {
      wanted.heat = Math.max(wanted.heat, [0, 40, 110, 200, 320, 470][ev.stars] ?? 110);
    } else if (ev.type === 'checkpoint') {
      audio.cash(); hud.toast('Checkpoint!');
      effects.glint(player.x, 1.6, player.z);
    } else if (ev.type === 'stage') {
      audio.cash();
    } else if (ev.type === 'complete') {
      G.cash += ev.reward;
      G.stats.missions++;
      audio.chime();
      hud.banner(`MISSION COMPLETE<small>${ev.name} · +$${ev.reward}</small>`, 3);
      if (markedCar && ev.name === 'Hot Wheels') { markedCar.isMarked = false; markedCar = null; }
      persist();
      if (ev.outro) setTimeout(() => { if (G.mode === 'playing') showDialogue(ev.outro); }, 900);
    } else if (ev.type === 'fail') {
      hud.banner(`MISSION FAILED<small>${ev.name} — see Sol to try again</small>`, 3);
    }
  }
}

// ---------------------------------------------------------------- menus
function pauseGame(on) {
  if (on && G.mode === 'playing') {
    G.mode = 'paused';
    document.getElementById('pause-stats').innerHTML =
      `Cash $${Math.floor(G.cash)} · Jobs done ${G.stats.missions} · Crimes ${G.stats.crimes}<br>Progress is saved automatically.`;
    document.getElementById('pause-screen').classList.remove('hidden');
    persist();
  } else if (!on && G.mode === 'paused') {
    G.mode = 'playing';
    document.getElementById('pause-screen').classList.add('hidden');
  }
}
function startGame(fresh) {
  document.getElementById('title-screen').classList.add('hidden');
  hud.show();
  G.mode = 'playing';
  audio.ensure();
  if (fresh) {
    clearSave();
    G.cash = 120; G.health = 100; missions.index = 0; G.stats = { missions: 0, crimes: 0 };
    player.teleport(world.playerStart.x, world.playerStart.z, world.playerStart.heading);
    showDialogue([
      { name: 'Sol Ferreira', text: 'Rio! There you are. Car\'s by the garage if you need wheels — E to get in, same to get out.' },
      { name: 'Sol Ferreira', text: 'When you are ready for work, come stand by me at the garage door. I pay on time, every time.' },
    ]);
  } else if (saveData) applySave(saveData);
}
document.getElementById('btn-new').addEventListener('click', () => startGame(true));
document.getElementById('btn-continue').addEventListener('click', () => startGame(false));
document.getElementById('btn-how').addEventListener('click', () => document.getElementById('how-panel').classList.toggle('hidden'));
document.getElementById('btn-resume').addEventListener('click', () => pauseGame(false));
document.getElementById('btn-restart').addEventListener('click', () => { clearSave(); location.reload(); });

// ---------------------------------------------------------------- the loop
const clock = new THREE.Clock();
let framesRendered = 0;

function playerTarget() {
  const v = G.inCar;
  return {
    x: v ? v.x : player.x, z: v ? v.z : player.z,
    vx: v ? v.forwardX() * v.speed : Math.sin(player.heading) * player.speedNow,
    vz: v ? v.forwardZ() * v.speed : Math.cos(player.heading) * player.speedNow,
    onFoot: !v, inCar: !!v, speedAbs: v ? Math.abs(v.speed) : player.speedNow,
  };
}

function drivePlayerCar(dt) {
  const v = G.inCar;
  let throttle = 0, steer = 0;
  if (shotMode === 'drive' || shotMode === 'chase') {
    // Screenshot scenes drive a fixed avenue line, whatever the objective says.
    const t = shotMode === 'drive' ? { x: 26.6, z: 148 } : { x: 33.4, z: -150 };
    const want = Math.atan2(t.x - v.x, t.z - v.z);
    let err = want - v.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    steer = Math.max(-1, Math.min(1, err * 1.8));
    throttle = v.speed < 11 ? 0.9 : 0;
  } else {
    if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) steer += 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) steer -= 1;
  }
  const handbrake = keys.has('Space');
  if (v.damage >= 100) throttle = Math.min(throttle, 0); // a wrecked car goes nowhere
  const impact = stepVehicle(v, dt, { throttle, steer, handbrake }, world.colliders);
  player.mesh.position.set(v.x, -10, v.z); // Rio rides inside, out of sight
  if (impact > 6) {
    audio.crash(impact);
    effects.sparks(v.x + v.forwardX() * 2, 0.7, v.z + v.forwardZ() * 2, 10);
    G.shake = Math.min(0.5, impact * 0.02);
    if (impact > 10.5) { hurt((impact - 9.5) * 0.75, 'The crash did the rest.'); G.invulnFor = 0.6; }
    if (impact > 11 && witnessed(v.x, v.z)) reportCrime('crash', v.x, v.z);
  }
  hud.setSpeedo(Math.abs(v.speed) * 3.6);
}

// HUD, objective beacon, interact prompt and minimap for the current moment.
// Runs every playing frame, and on dialogue/pause frames too so the panels
// never sit blank while the world is held.
function refreshHud(target) {
  hud.setCash(G.cash); hud.setStars(wanted.stars); hud.setHealth(G.health / 100); hud.setClock(G.clockMin);
  const obj = missions.objective();
  const offer = missions.offerTarget(world.garagePos);
  let beaconTarget = null, beaconColor = '#ffd23e';
  if (obj) {
    hud.objective(obj.title + (obj.timer !== null && obj.timer !== undefined ? ` — ${Math.ceil(obj.timer)}s` : ''), obj.text,
      obj.target ? Math.hypot(obj.target.x - target.x, obj.target.z - target.z) : null);
    beaconTarget = obj.target;
  } else if (offer) {
    hud.objective('Work available', `${offer.title} — see Sol at Ferreira Motors`, Math.hypot(offer.x - target.x, offer.z - target.z));
    beaconTarget = offer; beaconColor = '#2ec4b6';
  } else {
    hud.objective('Free roam', 'The city is yours. Odd jobs wait at Ferreira Motors.', null);
  }
  if (beaconTarget) {
    beacon.visible = true;
    beacon.position.x = beaconTarget.x; beacon.position.z = beaconTarget.z;
    beacon.material.color.set(beaconColor);
    beacon.material.opacity = 0.26 + Math.sin(G.time * 3.2) * 0.09;
  } else beacon.visible = false;

  if (G.mode !== 'playing') hud.interact(null);
  else if (G.inCar) hud.interact(null);
  else if (offer && Math.hypot(player.x - world.garagePos.x, player.z - world.garagePos.z) < 4.5) hud.interact('E — Talk to Sol');
  else {
    const v = nearestVehicle(3.4);
    hud.interact(v ? `E — ${v.driver === 'parked' ? 'Steal' : 'Drive'} the ${v.kind}` : null);
  }

  hud.drawMinimap({
    player: { x: target.x, z: target.z, heading: G.inCar ? G.inCar.heading : player.heading },
    traffic: traffic.cars.map((c) => c.v), police: police.units.map((u) => u.v),
    objective: obj?.target ?? (offer ?? null),
    garage: world.garagePos, hospital: world.hospitalPos,
  }, G.time);
}

function updatePlaying(dt) {
  G.time += dt;
  G.clockMin = (G.clockMin + dt * 1.5) % (24 * 60);
  G.invulnFor = Math.max(0, G.invulnFor - dt);
  G.crimeMuteFor = Math.max(0, G.crimeMuteFor - dt);
  G.sinceHurt += dt;
  if (G.sinceHurt > 6 && G.health > 0) G.health = Math.min(100, G.health + dt * 4);

  if (G.inCar) drivePlayerCar(dt);
  else {
    const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw);
    const rx = -fz, rz = fx;
    let wx = 0, wz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) { wx += fx; wz += fz; }
    if (keys.has('KeyS') || keys.has('ArrowDown')) { wx -= fx; wz -= fz; }
    if (keys.has('KeyD') || keys.has('ArrowRight')) { wx += rx; wz += rz; }
    if (keys.has('KeyA') || keys.has('ArrowLeft')) { wx -= rx; wz -= rz; }
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    player.update(dt, wx, wz, run, world.colliders);
    hud.setSpeedo(null);
    hud.crosshair.classList.remove('hidden');
  }
  if (!G.inCar) hud.crosshair.classList.remove('hidden'); else hud.crosshair.classList.add('hidden');

  const allVehicles = [...vehicles, ...traffic.cars.map((c) => c.v), ...police.units.map((u) => u.v)];
  traffic.update(dt, allVehicles);
  const threats = allVehicles.map((v) => ({ x: v.x, z: v.z, speed: v.speed }));
  peds.update(dt, threats);

  // Vehicle-on-vehicle contact across the whole fleet.
  for (let i = 0; i < allVehicles.length; i++) for (let j = i + 1; j < allVehicles.length; j++) {
    const a = allVehicles[i], b = allVehicles[j];
    if (Math.abs(a.x - b.x) > 5 || Math.abs(a.z - b.z) > 5) continue;
    const rel = collideVehicles(a, b);
    if (rel > 6.5) {
      a.damage = Math.min(100, a.damage + rel * 0.55);
      b.damage = Math.min(100, b.damage + rel * 0.55);
      effects.sparks((a.x + b.x) / 2, 0.8, (a.z + b.z) / 2, 7);
      if (G.crimeMuteFor <= 0) {
        audio.crash(rel);
        G.crimeMuteFor = 0.4;
        const playerInvolved = G.inCar && (a === G.inCar || b === G.inCar);
        if (playerInvolved) {
          const other = a === G.inCar ? b : a;
          if (rel > 8) reportCrime(other.kind === 'police' ? 'hitcop' : 'hitcar', other.x, other.z);
          if (rel > 12) { hurt((rel - 10) * 0.5, 'The crash did the rest.'); G.invulnFor = 0.6; }
        }
      }
    }
  }
  // Cars are dangerous to people on foot — Rio included.
  if (!G.inCar) {
    for (const v of allVehicles) {
      if (Math.abs(v.speed) > 4 && Math.hypot(v.x - player.x, v.z - player.z) < 1.6) {
        hurt(17, 'Run down in the street.');
        G.invulnFor = 1.2;
        player.teleport(player.x + v.forwardX() * 2.4, player.z + v.forwardZ() * 2.4, player.heading);
        break;
      }
    }
  }
  // Damage smoke on anything badly bent.
  for (const v of allVehicles) {
    if (v.damage > 58 && Math.random() < dt * 7) effects.smoke(v.x, 1.25, v.z, 1);
    if (v.damage >= 100) v.dead = true;
  }

  const target = playerTarget();
  const res = police.update(dt, wanted, target, G.time);
  wanted.update(dt, res.anyClose);
  if (res.busted && G.mode === 'playing') endRun('busted');
  combat.update(dt);

  missions.update(dt, {
    x: target.x, z: target.z, inCar: !!G.inCar,
    drivingMarked: !!markedCar && G.inCar === markedCar,
    wantedStars: wanted.stars,
  });
  handleMissionEvents();

  refreshHud(target);

  // Sound: engine, sirens, music.
  audio.engine(!!G.inCar, G.inCar ? G.inCar.speed / 38 : 0, dt);
  const near = police.nearestDist ?? 1e9;
  audio.siren(wanted.stars > 0 && police.units.length > 0, Math.max(0, 1 - near / 75), G.time);
  audio.music(dt);

  G.saveTimer += dt;
  if (G.saveTimer > 8) { G.saveTimer = 0; persist(); }
}

function updateCamera(dt) {
  if (G.mode === 'title') {
    const t = G.time * 0.05;
    camera.position.set(Math.sin(t) * 128, 44 + Math.sin(G.time * 0.13) * 5, 60 + Math.cos(t) * 128);
    camera.lookAt(0, 2, 30);
    return;
  }
  const target = playerTarget();
  const focusY = G.inCar ? 1.5 : 1.7;
  if (G.inCar && !mouseDown) {
    let want = G.inCar.heading + Math.PI;
    let diff = want - G.camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    G.camYaw += diff * Math.min(1, dt * 2.6);
  }
  const dist = G.inCar ? Math.max(G.camDist, 10) : G.camDist;
  const cx = target.x + Math.sin(G.camYaw) * Math.cos(G.camPitch) * dist;
  const cz = target.z + Math.cos(G.camYaw) * Math.cos(G.camPitch) * dist;
  const cy = focusY + Math.sin(G.camPitch) * dist;
  camera.position.x += (cx - camera.position.x) * Math.min(1, dt * 9);
  camera.position.y += (cy - camera.position.y) * Math.min(1, dt * 9);
  camera.position.z += (cz - camera.position.z) * Math.min(1, dt * 9);
  if (camera.position.y < 0.7) camera.position.y = 0.7;
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt);
    camera.position.x += (Math.random() - 0.5) * G.shake;
    camera.position.y += (Math.random() - 0.5) * G.shake;
  }
  camera.lookAt(target.x, focusY, target.z);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (G.mode === 'playing') updatePlaying(dt);
  else G.time += dt;
  if (G.mode === 'dialogue' || G.mode === 'paused') refreshHud(playerTarget());
  world.update(dt, G.time);
  if (G.mode === 'playing' || G.mode === 'dialogue' || G.mode === 'paused') effects.update(dt);
  hud.update(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  framesRendered++;
  if (shotMode && framesRendered > 55 && !window.__shotReady) window.__shotReady = true;
}

// ---------------------------------------------------------------- shot scenes
// Deterministic stagings for the entry's screenshots (shots.json). Each sets up
// a real moment of the game — no faked overlays — and the page flags
// window.__shotReady once it has rendered enough frames to capture.
function stageShot(name) {
  const title = document.getElementById('title-screen');
  if (name === 'start') { G.mode = 'title'; return; }
  title.classList.add('hidden');
  hud.show();
  G.mode = 'playing';
  if (name === 'drive') {
    const car = addParked('coupe', '#2ec4b6', 26.6, 20, 0);
    car.driver = 'player';
    G.inCar = car;
    player.mesh.visible = false;
    car.speed = 10;
    G.camYaw = Math.PI;
    // Company on the avenue: one car ahead in our lane, one coming the other way.
    traffic.addCar(26.6, 38, { x: 30, z: 30 }, { x: 30, z: 90 }, 10.5);
    traffic.addCar(33.4, 86, { x: 30, z: 90 }, { x: 30, z: 30 }, 11);
    missions.start(); // First Run, silently: the objective is on the HUD
    missions.events.length = 0;
  } else if (name === 'chase') {
    const car = addParked('coupe', '#e74c3c', 33.4, 40, Math.PI);
    car.driver = 'player';
    G.inCar = car;
    player.mesh.visible = false;
    car.speed = 13;
    G.camYaw = 0;
    wanted.heat = 215; // three stars
    // Two interceptors on the bumper, a third closing — lightbars strobing.
    for (const [px, pz] of [[30.2, 49.5], [36.8, 51.5], [33.2, 61]]) {
      const v = makeVehicle('police', '#20242a', px, pz, Math.PI);
      v.driver = 'police';
      v.speed = 13;
      scene.add(v.mesh);
      police.units.push({ v, reverseFor: 0, stuckFor: 0 });
    }
    missions.start();
    missions.events.length = 0;
  } else if (name === 'mission') {
    // Forecourt of Ferreira Motors: Rio's shoulder in the foreground, Sol facing
    // him, and the avenue with the city beyond — the briefing, framed wide.
    sol.position.set(-98.5, 0, 66);
    sol.rotation.y = -1.11;
    player.teleport(-101.5, 67.5, 2.03);
    player.mesh.rotation.y = 2.03;
    G.camYaw = -1.33;
    G.camDist = 8;
    G.camPitch = 0.22;
    const intro = missions.start();
    if (intro) showDialogue(intro);
  }
}

if (shotMode) stageShot(shotMode);
frame();
