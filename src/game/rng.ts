/**
 * A small, fast, fully deterministic PRNG.
 *
 * The daily run promises every player the identical board, so the generator
 * has to be reproducible across machines and browsers. `Math.random` is not,
 * and neither is anything that depends on float ordering — this is integer
 * arithmetic all the way down, using Math.imul so it stays exact in 32 bits.
 */
export class Rng {
  private s: number;

  constructor(seed: number | string) {
    this.s = typeof seed === "string" ? hashString(seed) : seed >>> 0;
    // A zero state is a fixed point for xorshift, so nudge it off zero.
    if (this.s === 0) this.s = 0x9e3779b9;
  }

  /** Next 32-bit unsigned integer. */
  nextUint32(): number {
    // mulberry32 — short period-free, passes the usual smoke tests, and is
    // trivial to reimplement identically on a server.
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Integer in [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** Pick an index from a list of non-negative weights. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return 0;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Snapshot of internal state, for forking a generator mid-game. */
  get state(): number {
    return this.s;
  }
}

/** FNV-1a. Stable across runtimes, which `String.prototype.hashCode` is not. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
