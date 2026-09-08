/**
 * Transient visual flourishes.
 *
 * Kept apart from the engine so that nothing here can influence the
 * simulation — effects read game events and have no way to write back.
 */

export interface FloatingText {
  text: string;
  /** Groups related labels so a later event can retire an earlier one. */
  tag?: string;
  /** Board-space column, 0..cols. */
  x: number;
  /** Board-space row, in visible-row coordinates. */
  y: number;
  color: string;
  size: number;
  ageMs: number;
  lifeMs: number;
  driftY: number;
  weight: number;
}

export interface RowFlash {
  row: number;
  ageMs: number;
  lifeMs: number;
  intensity: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  ageMs: number;
  lifeMs: number;
  size: number;
}

export class EffectsManager {
  texts: FloatingText[] = [];
  flashes: RowFlash[] = [];
  particles: Particle[] = [];

  /** Whole-board tint, driven by big clears. 0..1. */
  boardGlow = 0;
  /** Screen shake amplitude in pixels. */
  shake = 0;

  addText(
    text: string,
    x: number,
    y: number,
    opts: Partial<Pick<FloatingText, "color" | "size" | "lifeMs" | "driftY" | "weight" | "tag">> = {},
  ): void {
    this.texts.push({
      text,
      tag: opts.tag,
      x,
      y,
      color: opts.color ?? "#FFFFFF",
      size: opts.size ?? 16,
      ageMs: 0,
      lifeMs: opts.lifeMs ?? 900,
      driftY: opts.driftY ?? -1.4,
      weight: opts.weight ?? 800,
    });
    // Never let a stall build an unbounded queue.
    if (this.texts.length > 24) this.texts.splice(0, this.texts.length - 24);
  }

  /**
   * Retires a group of labels.
   *
   * Combos land clears within a few hundred milliseconds of each other, and
   * two sets of banners drifting at the same speed never separate — the second
   * clear prints straight over the first. The new set replaces the old.
   */
  clearTagged(tag: string): void {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      if (this.texts[i].tag === tag) this.texts.splice(i, 1);
    }
  }

  flashRows(rows: number[], intensity: number): void {
    for (const row of rows) {
      this.flashes.push({ row, ageMs: 0, lifeMs: 180, intensity });
    }
  }

  burst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 0.02 + Math.random() * 0.06;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.02,
        color,
        ageMs: 0,
        lifeMs: 420 + Math.random() * 260,
        size: 2 + Math.random() * 3,
      });
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }

  kick(amount: number): void {
    this.shake = Math.min(14, this.shake + amount);
  }

  glow(amount: number): void {
    this.boardGlow = Math.min(1, this.boardGlow + amount);
  }

  update(dtMs: number): void {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.ageMs += dtMs;
      t.y += (t.driftY * dtMs) / 1000;
      if (t.ageMs >= t.lifeMs) this.texts.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.ageMs += dtMs;
      if (f.ageMs >= f.lifeMs) this.flashes.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ageMs += dtMs;
      p.x += p.vx * dtMs;
      p.y += p.vy * dtMs;
      p.vy += 0.00022 * dtMs;
      if (p.ageMs >= p.lifeMs) this.particles.splice(i, 1);
    }
    this.boardGlow = Math.max(0, this.boardGlow - dtMs / 700);
    this.shake = Math.max(0, this.shake - dtMs / 45);
  }

  clear(): void {
    this.texts.length = 0;
    this.flashes.length = 0;
    this.particles.length = 0;
    this.boardGlow = 0;
    this.shake = 0;
  }
}
