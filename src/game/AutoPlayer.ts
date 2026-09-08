import type { GameEngine } from "./GameEngine";
import { PIECES, type PieceKind } from "./pieces";

/**
 * A competent bot.
 *
 * Two jobs. It drives the self-playing board on the landing page, so what a
 * visitor sees is the real game rather than a video of it; and it drives the
 * long-run engine test, which is only meaningful if the game it plays actually
 * survives long enough to clear thousands of lines.
 *
 * Placements are scored on the usual four terms — resulting stack height,
 * covered holes, surface bumpiness and lines made. It plays through the same
 * input path a person uses, one press at a time rather than teleporting, so
 * the board reads as somebody playing.
 */
export interface AutoPlayerOptions {
  /** Milliseconds between inputs. Lower is faster and less human. */
  moveIntervalMs?: number;
  /** Pause after a piece is planned, before the first input. */
  thinkMs?: number;
  /**
   * "survival" takes any line that is going; "scoring" holds out for
   * four-line clears, the way a player chasing points does. Survival keeps the
   * demo board alive; scoring is what makes a quad actually happen in a test
   * rather than being waited for and hoped for.
   */
  style?: "survival" | "scoring";
}

const WEIGHTS = {
  aggregateHeight: -0.51,
  linesCleared: 0.76,
  holes: -0.36,
  bumpiness: -0.18,
} as const;

/**
 * Scoring play: a four-line clear is worth far more than four singles, so
 * small clears are actively declined while the stack stays safe.
 *
 * Declining them is not enough on its own — a quad also needs somewhere to
 * put the fourth row. Reserving a one-wide well and building flat beside it is
 * how a person sets one up, and without it a four-line clear only happens when
 * the stack happens to line up.
 */
const QUAD_BONUS = 4.2;
const SMALL_CLEAR_PENALTY = -0.9;
/** Filling the reserved well costs this much while the stack is safe. */
const WELL_PENALTY = -6;
/** Above this stack height, take whatever clear is available and survive. */
const PANIC_HEIGHT = 13;

export class AutoPlayer {
  private plan: { rot: number; x: number } | null = null;
  private planFor: unknown = null;
  private timerMs = 0;
  private readonly moveIntervalMs: number;
  private readonly thinkMs: number;
  private readonly style: "survival" | "scoring";

  constructor(private engine: GameEngine, opts: AutoPlayerOptions = {}) {
    this.moveIntervalMs = opts.moveIntervalMs ?? 70;
    this.thinkMs = opts.thinkMs ?? 90;
    this.style = opts.style ?? "survival";
  }

  /** Call once per frame with the elapsed time. */
  update(dtMs: number, press: (a: "moveLeft" | "moveRight" | "rotateCW" | "hardDrop") => void): void {
    const e = this.engine;
    const piece = e.active;
    if (!piece || e.phase !== "playing") return;

    if (piece !== this.planFor) {
      this.planFor = piece;
      this.plan = this.bestPlacement(piece.kind);
      this.timerMs = -this.thinkMs;
      return;
    }

    this.timerMs += dtMs;
    if (this.timerMs < this.moveIntervalMs) return;
    this.timerMs = 0;

    const plan = this.plan;
    if (!plan) {
      press("hardDrop");
      return;
    }

    // Rotate first — a rotation can kick the piece sideways, so aligning the
    // column before the rotation is settled would leave it in the wrong place.
    if (piece.rot !== plan.rot) {
      press("rotateCW");
      return;
    }
    if (piece.x !== plan.x) {
      press(piece.x < plan.x ? "moveRight" : "moveLeft");
      return;
    }
    press("hardDrop");
  }

  /** Best (rotation, column) for this piece against the current board. */
  private bestPlacement(kind: PieceKind): { rot: number; x: number } | null {
    const e = this.engine;
    let best: { rot: number; x: number } | null = null;
    let bestScore = -Infinity;

    for (let rot = 0; rot < 4; rot++) {
      for (let x = -2; x < e.cols + 2; x++) {
        const score = this.evaluate(kind, rot, x);
        if (score !== null && score > bestScore) {
          bestScore = score;
          best = { rot, x };
        }
      }
    }
    return best;
  }

  private landingRow(grid: Int8Array, kind: PieceKind, rot: number, x: number): number | null {
    const e = this.engine;
    const cells = PIECES[kind][rot];
    const fits = (y: number): boolean => {
      for (const c of cells) {
        const cx = x + c[0];
        const cy = y + c[1];
        if (cx < 0 || cx >= e.cols || cy >= e.rows) return false;
        if (cy >= 0 && grid[cy * e.cols + cx] !== -1) return false;
      }
      return true;
    };
    let y = -4;
    if (!fits(y)) return null;
    while (fits(y + 1)) y++;
    return y;
  }

  private evaluate(kind: PieceKind, rot: number, x: number): number | null {
    const e = this.engine;
    const y = this.landingRow(e.grid, kind, rot, x);
    if (y === null) return null;

    const g = e.grid.slice();
    for (const c of PIECES[kind][rot]) {
      const cy = y + c[1];
      if (cy >= 0) g[cy * e.cols + (x + c[0])] = 0;
    }

    let cleared = 0;
    for (let r = 0; r < e.rows; r++) {
      let full = true;
      for (let cx = 0; cx < e.cols; cx++) {
        if (g[r * e.cols + cx] === -1) {
          full = false;
          break;
        }
      }
      if (full) cleared++;
    }

    let aggregate = 0;
    let holes = 0;
    const heights: number[] = [];
    for (let cx = 0; cx < e.cols; cx++) {
      let top = e.rows;
      for (let cy = 0; cy < e.rows; cy++) {
        if (g[cy * e.cols + cx] !== -1) {
          top = cy;
          break;
        }
      }
      heights.push(e.rows - top);
      aggregate += e.rows - top;
      for (let cy = top + 1; cy < e.rows; cy++) {
        if (g[cy * e.cols + cx] === -1) holes++;
      }
    }

    let bumpiness = 0;
    for (let cx = 0; cx + 1 < e.cols; cx++) {
      bumpiness += Math.abs(heights[cx] - heights[cx + 1]);
    }

    let lineScore = WEIGHTS.linesCleared * cleared;
    let wellCost = 0;
    let surface = bumpiness;

    if (this.style === "scoring") {
      const well = e.cols - 1;
      const tallest = Math.max(...heights);

      if (tallest < PANIC_HEIGHT) {
        // Hold out for the piece that empties four rows at once.
        lineScore = cleared === 4 ? QUAD_BONUS : cleared > 0 ? SMALL_CLEAR_PENALTY * cleared : 0;

        // Keep the last column clear so there is a well to clear four into.
        if (cleared === 0 && heights[well] > 0) {
          wellCost = WELL_PENALTY * heights[well];
        }

        // The well is meant to be a step down, so its own edge should not
        // count as roughness to be smoothed away.
        surface -= Math.abs(heights[well - 1] - heights[well]);
      }
    }

    return (
      WEIGHTS.aggregateHeight * aggregate +
      lineScore +
      wellCost +
      WEIGHTS.holes * holes +
      WEIGHTS.bumpiness * surface
    );
  }
}
