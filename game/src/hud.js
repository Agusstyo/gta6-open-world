// hud.js — everything drawn over the 3D view: cash, wanted stars, health, the
// in-game clock, the objective panel, banners, toasts, dialogue boxes, the
// interact prompt, and the minimap — a live top-down canvas plot of the street
// grid with the player, traffic, police and the current objective on it.

import { ROAD_XS, ROAD_ZS, BEACH_Z } from './world.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.cashEl = $('cash');
    this.starsEl = $('stars');
    this.clockEl = $('clock');
    this.healthBar = $('health-bar');
    this.speedo = $('speedo');
    this.objTitle = $('objective-title');
    this.objText = $('objective-text');
    this.objDist = $('objective-dist');
    this.bannerEl = $('banner');
    this.toastEl = $('toast');
    this.interactEl = $('interact');
    this.dialogueEl = $('dialogue');
    this.dialogueName = $('dialogue-name');
    this.dialogueText = $('dialogue-text');
    this.crosshair = $('crosshair');
    this.vignette = $('damage-vignette');
    this.mapCtx = $('minimap').getContext('2d');
    this.bannerTimer = 0; this.toastTimer = 0; this.vignetteLevel = 0;
    this.lastCash = null; this.lastStars = -1;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setCash(n) {
    if (n === this.lastCash) return;
    this.lastCash = n;
    this.cashEl.textContent = '$' + Math.max(0, Math.floor(n)).toLocaleString('en-US');
  }
  setStars(n) {
    if (n === this.lastStars) return;
    this.lastStars = n;
    let html = '';
    for (let i = 0; i < 5; i++) html += i < n ? '★' : '<span class="off">★</span>';
    this.starsEl.innerHTML = html;
  }
  setHealth(frac) {
    this.healthBar.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }
  setClock(minutes) {
    const h = Math.floor(minutes / 60) % 24, m = Math.floor(minutes % 60);
    this.clockEl.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  setSpeedo(kmh) {
    if (kmh === null) { this.speedo.classList.add('hidden'); return; }
    this.speedo.classList.remove('hidden');
    this.speedo.textContent = Math.round(kmh) + ' km/h';
  }
  objective(title, text, distM) {
    this.objTitle.textContent = title;
    this.objText.textContent = text;
    this.objDist.textContent = distM === null || distM === undefined ? '' : Math.round(distM) + ' m';
  }
  banner(html, seconds = 2.6) {
    this.bannerEl.innerHTML = html;
    this.bannerEl.classList.remove('hidden');
    this.bannerTimer = seconds;
  }
  toast(text, seconds = 2.4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = seconds;
  }
  interact(text) {
    if (text) { this.interactEl.textContent = text; this.interactEl.classList.remove('hidden'); }
    else this.interactEl.classList.add('hidden');
  }
  dialogue(name, text) {
    if (!text) { this.dialogueEl.classList.add('hidden'); return; }
    this.dialogueName.textContent = name;
    this.dialogueText.textContent = text;
    this.dialogueEl.classList.remove('hidden');
  }
  damageFlash(amount = 0.55) { this.vignetteLevel = Math.max(this.vignetteLevel, amount); }

  update(dt) {
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.bannerEl.classList.add('hidden'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.classList.add('hidden'); }
    if (this.vignetteLevel > 0) {
      this.vignetteLevel = Math.max(0, this.vignetteLevel - dt * 1.4);
      this.vignette.style.opacity = this.vignetteLevel.toFixed(2);
    }
  }

  // World → minimap: the canvas covers x [-176, 176], z [-186, 214].
  mapX(x) { return ((x + 176) / 352) * 196; }
  mapY(z) { return ((z + 186) / 400) * 196; }

  drawMinimap(s, t) {
    const g = this.mapCtx;
    g.fillStyle = '#274b3a'; g.fillRect(0, 0, 196, 196);                       // land
    g.fillStyle = '#8fae56'; g.fillRect(0, this.mapY(97), 196, this.mapY(143) - this.mapY(97)); // park
    g.fillStyle = '#e9d09c'; g.fillRect(0, this.mapY(BEACH_Z), 196, 196 - this.mapY(BEACH_Z));   // sand
    g.fillStyle = '#1d7f96'; g.fillRect(0, this.mapY(205), 196, 196 - this.mapY(205));           // sea
    g.strokeStyle = '#454f57'; g.lineWidth = 7; g.lineCap = 'round';
    for (const x of ROAD_XS) { g.beginPath(); g.moveTo(this.mapX(x), this.mapY(-170)); g.lineTo(this.mapX(x), this.mapY(164)); g.stroke(); }
    for (const z of ROAD_ZS) { g.beginPath(); g.moveTo(this.mapX(-170), this.mapY(z)); g.lineTo(this.mapX(170), this.mapY(z)); g.stroke(); }
    const dot = (x, z, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(this.mapX(x), this.mapY(z), r, 0, 7); g.fill(); };
    dot(s.garage.x, s.garage.z, 3, '#ffb340');                                   // Ferreira Motors
    dot(s.hospital.x, s.hospital.z, 3, '#ff5a49');                              // hospital
    for (const v of s.traffic) dot(v.x, v.z, 1.6, 'rgba(230,230,220,0.75)');
    for (const v of s.police) dot(v.x, v.z, 2.6, Math.floor(t * 5) % 2 ? '#ff4444' : '#4488ff');
    if (s.objective) {                                                          // objective diamond
      const ox = this.mapX(s.objective.x), oy = this.mapY(s.objective.z);
      g.fillStyle = '#ffd23e';
      g.save(); g.translate(ox, oy); g.rotate(Math.PI / 4);
      const r = 4 + Math.sin(t * 5) * 0.8;
      g.fillRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4); g.restore();
    }
    // The player: a white arrow turned to heading.
    const px = this.mapX(s.player.x), py = this.mapY(s.player.z);
    g.save(); g.translate(px, py); g.rotate(Math.PI - s.player.heading);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(0, 2.6); g.lineTo(-4, 5); g.closePath(); g.fill();
    g.restore();
  }
}
