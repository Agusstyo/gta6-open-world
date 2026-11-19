// audio.js — every sound in Port Marisol is synthesised with WebAudio; there are
// no audio files. A two-oscillator engine hum that follows the car's speed, a
// two-tone siren that swells as a unit gets close, noise-burst gunshots and
// crashes, chimes for cash and completed work, and a small step-sequenced
// coastal groove for the music. The context starts on the first user gesture.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.step = 0;
    this.nextStepAt = 0;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);
    // Engine: detuned saws through a lowpass, gain driven per frame.
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    this.engineOscA = ctx.createOscillator(); this.engineOscA.type = 'sawtooth'; this.engineOscA.frequency.value = 55;
    this.engineOscB = ctx.createOscillator(); this.engineOscB.type = 'square'; this.engineOscB.frequency.value = 28;
    this.engineOscA.connect(lp); this.engineOscB.connect(lp);
    lp.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOscA.start(); this.engineOscB.start();
    // Siren: one square osc whose frequency the update loop wobbles.
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'triangle'; this.sirenOsc.frequency.value = 750;
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.nextStepAt = ctx.currentTime + 0.1;
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }

  engine(on, speedRatio, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = on && !this.muted ? 0.05 + Math.abs(speedRatio) * 0.05 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.08);
    const f = 52 + Math.abs(speedRatio) * 118;
    this.engineOscA.frequency.setTargetAtTime(f, t, 0.05);
    this.engineOscB.frequency.setTargetAtTime(f / 2, t, 0.05);
    return dt;
  }

  siren(on, closeness, t) {
    if (!this.ctx) return;
    const target = on && !this.muted ? 0.028 + closeness * 0.05 : 0;
    this.sirenGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
    if (on) this.sirenOsc.frequency.value = 720 + Math.sin(t * 4.4) * 190;
  }

  noiseBurst(dur, freq, gain, type = 'lowpass') {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  }

  shot() { this.noiseBurst(0.13, 2600, 0.5, 'highpass'); this.noiseBurst(0.2, 300, 0.4); }
  crash(i) { this.noiseBurst(0.28, 240, Math.min(0.6, 0.15 + i * 0.04)); }
  honk() {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = 372;
    g.gain.setValueAtTime(0.07, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.22);
    o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + 0.24);
  }
  tone(freq, at, dur, gain = 0.12, type = 'sine') {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    const t0 = this.ctx.currentTime + at;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  chime() { this.tone(1318, 0, 0.22); this.tone(1760, 0.09, 0.3); }
  cash() { this.tone(1568, 0, 0.1, 0.09); this.tone(2093, 0.06, 0.16, 0.09); }
  bustedJingle() { this.tone(392, 0, 0.3, 0.14, 'triangle'); this.tone(311, 0.22, 0.34, 0.14, 'triangle'); this.tone(262, 0.46, 0.55, 0.14, 'triangle'); }

  // A 16-step loop at ~112 BPM: roots-and-fifths bass in A minor with a soft
  // off-beat pluck, scheduled a step ahead each frame.
  music(dt) {
    if (!this.ctx || !this.musicOn || this.muted) return;
    const stepDur = 60 / 112 / 2;
    while (this.nextStepAt < this.ctx.currentTime + 0.12) {
      const at = Math.max(0, this.nextStepAt - this.ctx.currentTime);
      const s = this.step % 16, bar = Math.floor(this.step / 16) % 4;
      const roots = [55, 55, 65.41, 49]; // A1 A1 C2 G1
      if (s % 4 === 0) this.tone(roots[bar], at, 0.34, 0.16, 'triangle');
      if (s % 8 === 6) this.tone(roots[bar] * 1.5, at, 0.2, 0.08, 'triangle');
      if (s % 2 === 1) this.noiseAt(at, 0.03, 6000, 0.015);
      if (s === 0 && bar % 2 === 0) { this.tone(220, at, 1.4, 0.035, 'sine'); this.tone(261.6, at, 1.4, 0.03, 'sine'); this.tone(329.6, at, 1.4, 0.03, 'sine'); }
      this.nextStepAt += stepDur;
      this.step++;
    }
    return dt;
  }

  noiseAt(at, dur, freq, gain) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(ctx.currentTime + at);
  }
}
