import type { SimEvent, Phase } from '@lf/shared';

/**
 * Procedural WebAudio: all SFX synthesized, ambient music from layered
 * oscillators. No audio assets.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicNodes: OscillatorNode[] = [];
  private currentMood: 'day' | 'night' | 'boss' | null = null;
  private lastSfx = new Map<string, number>();

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.12;
    this.musicGain.connect(this.master);
  }

  handle(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'projectile':
          if (e.weapon === 'arrow' || e.weapon === 'bolt') this.sfx('arrow', () => this.arrow());
          else if (e.weapon === 'ice') this.sfx('ice', () => this.ice());
          else if (e.weapon === 'spit') this.sfx('spit', () => this.spit());
          break;
        case 'melee': this.sfx('swing', () => this.swing()); break;
        case 'splash': this.sfx('splash', () => this.splash()); break;
        case 'gather':
          if (e.resource === 'wood') this.sfx('chop', () => this.chop());
          else this.sfx('mine', () => this.mine());
          break;
        case 'explosion': this.sfx('boom', () => this.boom()); break;
        case 'chain': this.sfx('zap', () => this.zap()); break;
        case 'death': this.sfx('growl', () => this.growl()); break;
        case 'coins': this.sfx('coin', () => this.coin()); break;
        case 'build_placed': this.sfx('thud', () => this.thud(220)); break;
        case 'building_destroyed': this.sfx('crumble', () => this.thud(80)); break;
        case 'wave_start': this.horn(e.boss); this.setMood(e.boss ? 'boss' : 'night'); break;
        case 'phase_change': if (e.phase === 'day') this.setMood('day'); break;
        case 'game_over': this.setMood(null); this.dirge(); break;
      }
    }
  }

  setPhase(phase: Phase): void {
    if (this.currentMood === 'boss') return;
    this.setMood(phase === 'day' ? 'day' : 'night');
  }

  /** throttle identical SFX to avoid 50-arrow chorus */
  private sfx(key: string, fn: () => void): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if ((this.lastSfx.get(key) ?? 0) > now - 0.05) return;
    this.lastSfx.set(key, now);
    fn();
  }

  private env(duration: number, peak = 0.25): GainNode {
    const g = this.ctx!.createGain();
    const t = this.ctx!.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    g.connect(this.master!);
    return g;
  }
  private osc(type: OscillatorType, freq: number, dest: AudioNode, dur: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type; o.frequency.value = freq;
    o.connect(dest);
    o.start();
    o.stop(this.ctx!.currentTime + dur);
    return o;
  }
  private noise(dur: number, dest: AudioNode): void {
    const len = Math.floor(this.ctx!.sampleRate * dur);
    const buf = this.ctx!.createBuffer(1, len, this.ctx!.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();
  }

  private arrow(): void {
    if (!this.ctx) return;
    const g = this.env(0.12, 0.08);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2400;
    f.connect(g);
    this.noise(0.12, f);
  }
  private ice(): void {
    if (!this.ctx) return;
    const g = this.env(0.25, 0.1);
    const o = this.osc('sine', 1800, g, 0.25);
    o.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.25);
  }
  private boom(): void {
    if (!this.ctx) return;
    const g = this.env(0.6, 0.4);
    const o = this.osc('sine', 110, g, 0.6);
    o.frequency.exponentialRampToValueAtTime(35, this.ctx.currentTime + 0.5);
    const ng = this.env(0.4, 0.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    f.connect(ng);
    this.noise(0.4, f);
  }
  private zap(): void {
    if (!this.ctx) return;
    const g = this.env(0.15, 0.12);
    const o = this.osc('sawtooth', 880, g, 0.15);
    o.frequency.exponentialRampToValueAtTime(140, this.ctx.currentTime + 0.14);
  }
  /** axe biting into wood: sharp knock + woody resonance */
  chop(): void {
    if (!this.ctx) return;
    const g = this.env(0.16, 0.18);
    const o = this.osc('triangle', 180, g, 0.16);
    o.frequency.exponentialRampToValueAtTime(90, this.ctx.currentTime + 0.14);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2;
    f.connect(this.env(0.06, 0.12));
    this.noise(0.06, f);
  }

  /** pickaxe on rock: bright metallic clink + stony crunch */
  mine(): void {
    if (!this.ctx) return;
    const g = this.env(0.1, 0.1);
    this.osc('square', 2400 + Math.random() * 600, g, 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 900;
    f.connect(this.env(0.14, 0.1));
    this.noise(0.14, f);
  }

  /** soft boot-on-grass thud; quieter for teammates */
  footstep(self: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if ((this.lastSfx.get('step') ?? 0) > now - 0.12) return;
    this.lastSfx.set('step', now);
    const g = this.env(0.09, self ? 0.05 : 0.025);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300 + Math.random() * 200;
    f.connect(g);
    this.noise(0.09, f);
  }

  /** watery wading slosh: filtered noise sweep + low plop */
  private splash(): void {
    if (!this.ctx) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 600 + Math.random() * 300;
    f.frequency.exponentialRampToValueAtTime(220, this.ctx.currentTime + 0.22);
    f.Q.value = 1.2;
    f.connect(this.env(0.25, 0.08));
    this.noise(0.25, f);
    const g = this.env(0.12, 0.05);
    const o = this.osc('sine', 240, g, 0.12);
    o.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.11);
  }

  private swing(): void {
    if (!this.ctx) return;
    const g = this.env(0.1, 0.09);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900;
    f.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.1);
    f.connect(g);
    this.noise(0.1, f);
  }

  private spit(): void {
    if (!this.ctx) return;
    const g = this.env(0.2, 0.07);
    const o = this.osc('sine', 520, g, 0.2);
    o.frequency.exponentialRampToValueAtTime(180, this.ctx.currentTime + 0.18);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 700;
    f.connect(this.env(0.15, 0.05));
    this.noise(0.15, f);
  }

  private growl(): void {
    if (!this.ctx) return;
    const g = this.env(0.3, 0.1);
    const o = this.osc('sawtooth', 90 + Math.random() * 40, g, 0.3);
    o.frequency.linearRampToValueAtTime(55, this.ctx.currentTime + 0.3);
  }
  private coin(): void {
    if (!this.ctx) return;
    const g = this.env(0.18, 0.07);
    this.osc('square', 1320, g, 0.06);
    setTimeout(() => {
      if (!this.ctx) return;
      const g2 = this.env(0.15, 0.07);
      this.osc('square', 1760, g2, 0.1);
    }, 60);
  }
  private thud(freq: number): void {
    if (!this.ctx) return;
    const g = this.env(0.2, 0.2);
    const o = this.osc('sine', freq, g, 0.2);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, this.ctx.currentTime + 0.18);
  }
  private horn(boss: boolean): void {
    if (!this.ctx) return;
    const base = boss ? 98 : 147;
    for (const [mult, delay] of [[1, 0], [1.5, 0.25], [2, 0.5]] as const) {
      setTimeout(() => {
        if (!this.ctx) return;
        const g = this.env(1.2, 0.15);
        this.osc('sawtooth', base * mult, g, 1.2);
        this.osc('sawtooth', base * mult * 1.005, g, 1.2);
      }, delay * 1000);
    }
  }
  private dirge(): void {
    if (!this.ctx) return;
    for (const [freq, delay] of [[220, 0], [196, 0.5], [165, 1], [147, 1.5]] as const) {
      setTimeout(() => {
        if (!this.ctx) return;
        const g = this.env(1.4, 0.1);
        this.osc('triangle', freq, g, 1.4);
      }, delay * 1000);
    }
  }

  /** Ambient drone layers per mood. */
  private setMood(mood: 'day' | 'night' | 'boss' | null): void {
    if (!this.ctx || !this.musicGain || mood === this.currentMood) return;
    this.currentMood = mood;
    for (const o of this.musicNodes) { try { o.stop(); } catch { /* already stopped */ } }
    this.musicNodes = [];
    if (!mood) return;
    const chords: Record<string, number[]> = {
      day: [110, 165, 220, 330],            // A minor add9, open and calm
      night: [82.4, 123.5, 146.8, 196],     // E minor, low and tense
      boss: [73.4, 110, 138.6, 185],        // D minor, heavy
    };
    for (const freq of chords[mood]!) {
      const o = this.ctx.createOscillator();
      o.type = mood === 'day' ? 'triangle' : 'sawtooth';
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.value = mood === 'day' ? 0.06 : 0.045;
      // slow tremolo
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.1 + Math.random() * 0.15;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0.02;
      lfo.connect(lfoGain); lfoGain.connect(g.gain);
      lfo.start();
      o.connect(g); g.connect(this.musicGain);
      o.start();
      this.musicNodes.push(o, lfo);
    }
  }
}
