/**
 * Original arcade audio, synthesised at runtime.
 *
 * Everything is generated from oscillators and noise buffers rather than
 * sampled, so there is nothing here that could resemble another game's sound
 * set, and there is nothing to download before the first piece falls.
 */

type Wave = OscillatorType;

export interface AudioSettings {
  muted: boolean;
  sfxVolume: number;
  musicVolume: number;
}

const STORAGE_KEY = "stockstack.audio";

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicTempo = 132;

  settings: AudioSettings = { muted: false, sfxVolume: 0.7, musicVolume: 0.35 };

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) this.settings = { ...this.settings, ...JSON.parse(raw) };
      } catch {
        // A corrupt or blocked localStorage is not worth failing audio over.
      }
    }
  }

  /**
   * Must be called from a user gesture — browsers will not start an
   * AudioContext otherwise, and a silently suspended context is worse than no
   * audio because nothing reports it.
   */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.settings.muted ? 0 : 1;
      this.master.connect(ctx.destination);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.settings.sfxVolume;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.settings.musicVolume;
      this.musicBus.connect(this.master);

      // A short noise buffer, reused for every percussive sound.
      const len = Math.floor(ctx.sampleRate * 0.4);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    } catch {
      this.ctx = null;
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore — settings are a convenience, not state we must keep.
    }
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
    this.persist();
  }

  setSfxVolume(v: number): void {
    this.settings.sfxVolume = clamp01(v);
    if (this.sfxBus) this.sfxBus.gain.value = this.settings.sfxVolume;
    this.persist();
  }

  setMusicVolume(v: number): void {
    this.settings.musicVolume = clamp01(v);
    if (this.musicBus) this.musicBus.gain.value = this.settings.musicVolume;
    this.persist();
  }

  // -------------------------------------------------------------------------
  // Primitives
  // -------------------------------------------------------------------------

  private tone(
    freq: number,
    durMs: number,
    opts: {
      type?: Wave;
      gain?: number;
      sweepTo?: number;
      delayMs?: number;
      bus?: GainNode | null;
      attackMs?: number;
    } = {},
  ): void {
    const ctx = this.ctx;
    const bus = opts.bus ?? this.sfxBus;
    if (!ctx || !bus) return;
    const t0 = ctx.currentTime + (opts.delayMs ?? 0) / 1000;
    const dur = durMs / 1000;
    const attack = Math.min((opts.attackMs ?? 4) / 1000, dur * 0.5);

    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t0 + dur);

    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(durMs: number, opts: { gain?: number; filter?: number; delayMs?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return;
    const t0 = ctx.currentTime + (opts.delayMs ?? 0) / 1000;
    const dur = durMs / 1000;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = opts.filter ?? 1200;

    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // -------------------------------------------------------------------------
  // The game's voice
  // -------------------------------------------------------------------------

  move(): void {
    this.tone(680, 26, { type: "square", gain: 0.055 });
  }

  rotate(): void {
    this.tone(1180, 34, { type: "triangle", gain: 0.09, sweepTo: 1360 });
  }

  lock(): void {
    this.tone(150, 80, { type: "sine", gain: 0.16, sweepTo: 96 });
    this.noise(60, { gain: 0.05, filter: 700 });
  }

  hold(): void {
    this.tone(540, 60, { type: "triangle", gain: 0.1, sweepTo: 760 });
  }

  hardDrop(): void {
    this.tone(220, 70, { type: "sawtooth", gain: 0.1, sweepTo: 70 });
    this.noise(90, { gain: 0.08, filter: 1600 });
  }

  /** Line clear. Scales in weight with the number of rows. */
  clear(lines: number): void {
    if (lines >= 4) {
      // A four-line clear gets a real chord — the reward moment of the game.
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((f, i) => {
        this.tone(f, 620, { type: "triangle", gain: 0.13, delayMs: i * 28, attackMs: 8 });
        this.tone(f * 2, 420, { type: "sine", gain: 0.05, delayMs: i * 28 });
      });
      this.noise(260, { gain: 0.1, filter: 3200 });
      return;
    }
    const base = 480 + lines * 110;
    this.tone(base, 150 + lines * 40, { type: "triangle", gain: 0.12, sweepTo: base * 1.9 });
    this.noise(110, { gain: 0.06, filter: 2400 });
  }

  combo(depth: number): void {
    // Each combo step lands a semitone higher, capped so it stays musical.
    const semitone = Math.min(depth, 12);
    const freq = 440 * Math.pow(2, semitone / 12);
    this.tone(freq, 120, { type: "square", gain: 0.09, attackMs: 3 });
    this.tone(freq * 1.5, 100, { type: "sine", gain: 0.05, delayMs: 40 });
  }

  marketPump(): void {
    [392, 494, 587, 784].forEach((f, i) =>
      this.tone(f, 240, { type: "triangle", gain: 0.11, delayMs: i * 55 }),
    );
  }

  bullRun(): void {
    [261.6, 329.6, 392, 523.3, 659.3].forEach((f, i) =>
      this.tone(f, 420, { type: "sawtooth", gain: 0.09, delayMs: i * 48, attackMs: 10 }),
    );
    this.noise(400, { gain: 0.07, filter: 4000 });
  }

  levelUp(): void {
    [523.3, 698.5, 880].forEach((f, i) => this.tone(f, 200, { type: "triangle", gain: 0.1, delayMs: i * 60 }));
  }

  gameOver(): void {
    this.stopMusic();
    [440, 392, 329.6, 261.6].forEach((f, i) =>
      this.tone(f, 460, { type: "triangle", gain: 0.13, delayMs: i * 130, attackMs: 12 }),
    );
  }

  // -------------------------------------------------------------------------
  // Music — an original loop, sequenced rather than streamed.
  // -------------------------------------------------------------------------

  private readonly bass = [0, 0, 7, 0, 5, 5, 3, 3];
  private readonly arp = [12, 16, 19, 16, 12, 19, 24, 19, 12, 16, 19, 22, 21, 19, 16, 12];

  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.musicStep = 0;
    const stepMs = () => 60_000 / this.musicTempo / 4;
    const tick = () => {
      this.playMusicStep();
      this.musicTimer = window.setTimeout(tick, stepMs());
    };
    this.musicTimer = window.setTimeout(tick, stepMs());
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  /** Tempo follows the level, so the music tightens as the game speeds up. */
  setIntensity(level: number, bullRun: boolean): void {
    this.musicTempo = Math.min(178, 126 + level * 2.2 + (bullRun ? 14 : 0));
  }

  private playMusicStep(): void {
    const bus = this.musicBus;
    if (!bus || !this.ctx) return;
    const s = this.musicStep++;
    const root = 55; // A1

    if (s % 2 === 0) {
      const n = this.bass[(s / 2) % this.bass.length];
      this.tone(root * Math.pow(2, n / 12), 190, { type: "sawtooth", gain: 0.08, bus, attackMs: 6 });
    }
    const a = this.arp[s % this.arp.length];
    this.tone(root * 2 * Math.pow(2, a / 12), 110, { type: "square", gain: 0.028, bus, attackMs: 3 });
    if (s % 4 === 0) {
      this.tone(root * 4, 60, { type: "triangle", gain: 0.02, bus });
    }
  }

  dispose(): void {
    this.stopMusic();
    try {
      void this.ctx?.close();
    } catch {
      // Closing a context that is already gone is not an error worth raising.
    }
    this.ctx = null;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
