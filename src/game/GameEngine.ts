import {
  BOARD,
  GRAVITY_MS,
  LINES_PER_LEVEL,
  MIN_GRAVITY_MS,
  NEXT_QUEUE_SIZE,
  REWARD,
  RULES_VERSION,
  SCORE,
  TIMING,
  TOTAL_ROWS,
} from "./config";
import { EventSystem } from "./EventSystem";
import { PieceGenerator } from "./PieceGenerator";
import { PIECES, SPAWN_X, kicksFor, type PieceKind } from "./pieces";
import {
  comboMultiplier,
  comboScore,
  isDifficult,
  lineScore,
  linesMultiplier,
  perfectClearScore,
} from "./ScoringSystem";
import type { StockDef } from "./stocks";
import type {
  ActivePiece,
  ClearEvent,
  GameMode,
  GamePhase,
  GameResultSummary,
  GameSnapshot,
  InputAction,
  LoggedAction,
  QueuedPiece,
} from "./types";

/** Empty cell marker. Occupied cells hold an index into the session stock pool. */
const EMPTY = -1;

export interface EngineOptions {
  seed: string;
  mode: GameMode;
  stocks: readonly StockDef[];
  startLevel?: number;
  /** Versus only: garbage arriving from an opponent, applied at lock time. */
  onAttack?: (lines: number) => void;
}

/**
 * The simulation.
 *
 * Two rules hold this file together:
 *
 *   1. It touches nothing outside itself — no DOM, no React, no clock. Time
 *      arrives as an argument. That is what makes it testable headlessly and
 *      replayable on a server.
 *   2. It advances only in fixed steps. `update()` is called once per
 *      simulation frame with a constant dt, so the same seed and the same
 *      inputs always produce the same game, on any refresh rate.
 */
export class GameEngine {
  // --- board ---------------------------------------------------------------
  readonly cols = BOARD.cols;
  readonly rows = TOTAL_ROWS;
  readonly visibleRows = BOARD.visibleRows;
  readonly hiddenRows = BOARD.hiddenRows;
  /** Row-major, `rows * cols`. EMPTY or a stock index. */
  readonly grid: Int8Array;

  // --- session -------------------------------------------------------------
  readonly seed: string;
  readonly mode: GameMode;
  readonly stocks: readonly StockDef[];
  readonly rulesVersion = RULES_VERSION;

  // --- pieces --------------------------------------------------------------
  private generator: PieceGenerator;
  active: ActivePiece | null = null;
  nextQueue: QueuedPiece[] = [];
  hold: QueuedPiece | null = null;
  canHold = true;

  // --- scoring -------------------------------------------------------------
  score = 0;
  lines = 0;
  level = 1;
  combo = -1;
  maxCombo = 0;
  backToBack = 0;
  quads = 0;
  perfectClears = 0;
  piecesPlaced = 0;

  /**
   * Units are accumulated as floats and only floored for display or submission.
   * Rounding each clear would quietly eat a third of a fractional multiplier
   * every time, which over a long run is a large silent loss.
   */
  readonly unitsExact: number[];

  readonly events = new EventSystem();

  // --- timing --------------------------------------------------------------
  phase: GamePhase = "ready";
  frame = 0;
  elapsedMs = 0;
  private gravityAccMs = 0;
  private lockTimerMs = 0;
  private lockResets = 0;
  private grounded = false;
  private clearTimerMs = 0;
  private spawnTimerMs = 0;
  private pendingClearRows: number[] = [];

  // --- input state ---------------------------------------------------------
  private dasDir = 0;
  private dasTimerMs = 0;
  private dasCharged = false;
  private softDropping = false;
  private pendingGarbage = 0;

  // --- observability -------------------------------------------------------
  readonly actionLog: LoggedAction[] = [];
  onClear: ((e: ClearEvent) => void) | null = null;
  onLock: ((piece: ActivePiece) => void) | null = null;
  onGameOver: (() => void) | null = null;
  onHold: (() => void) | null = null;
  onMove: (() => void) | null = null;
  onRotate: (() => void) | null = null;
  onLevelUp: ((level: number) => void) | null = null;
  private readonly onAttack?: (lines: number) => void;

  constructor(opts: EngineOptions) {
    this.seed = opts.seed;
    this.mode = opts.mode;
    this.stocks = opts.stocks;
    this.onAttack = opts.onAttack;
    this.level = Math.max(1, opts.startLevel ?? 1);
    this.grid = new Int8Array(this.rows * this.cols).fill(EMPTY);
    this.unitsExact = new Array(opts.stocks.length).fill(0);
    this.generator = new PieceGenerator(opts.seed, opts.stocks);
    for (let i = 0; i < NEXT_QUEUE_SIZE; i++) this.nextQueue.push(this.generator.next());
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.phase !== "ready") return;
    this.phase = "playing";
    this.spawn();
  }

  pause(): void {
    if (this.phase === "playing") this.phase = "paused";
  }

  resume(): void {
    if (this.phase === "paused") this.phase = "playing";
  }

  get isOver(): boolean {
    return this.phase === "over";
  }

  // -------------------------------------------------------------------------
  // Grid access
  // -------------------------------------------------------------------------

  at(x: number, y: number): number {
    return this.grid[y * this.cols + x];
  }

  private set(x: number, y: number, v: number): void {
    this.grid[y * this.cols + x] = v;
  }

  /** True when the cell is outside the field or already filled. */
  private blocked(x: number, y: number): boolean {
    if (x < 0 || x >= this.cols || y >= this.rows) return true;
    if (y < 0) return false; // above the field is open air, not a wall
    return this.grid[y * this.cols + x] !== EMPTY;
  }

  private collides(kind: PieceKind, rot: number, px: number, py: number): boolean {
    const cells = PIECES[kind][rot];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (this.blocked(px + c[0], py + c[1])) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Piece lifecycle
  // -------------------------------------------------------------------------

  private spawn(): void {
    const q = this.nextQueue.shift()!;
    this.nextQueue.push(this.generator.next());
    this.beginPiece(q);
  }

  private beginPiece(q: QueuedPiece): void {
    // Spawn so the piece's topmost cell lands on the first visible row.
    //
    // Spawning up inside the hidden rows is the usual convention, but at level
    // one gravity is a second per cell, so the player would watch an empty
    // board for three seconds before the first piece appeared. Deriving the
    // offset from the piece's own geometry puts every shape on screen the
    // instant it spawns; the hidden rows above stay as headroom for rotation
    // kicks and for pieces that lock partly off the top.
    const cells = PIECES[q.kind][0];
    let minY = cells[0][1];
    for (let i = 1; i < cells.length; i++) {
      if (cells[i][1] < minY) minY = cells[i][1];
    }

    const piece: ActivePiece = {
      kind: q.kind,
      stock: q.stock,
      x: SPAWN_X,
      y: this.hiddenRows - minY,
      rot: 0,
    };

    // Block out: if the spawn position is already occupied the run is over.
    if (this.collides(piece.kind, piece.rot, piece.x, piece.y)) {
      // One nudge upward, which is the usual courtesy before declaring a top-out.
      if (!this.collides(piece.kind, piece.rot, piece.x, piece.y - 1)) {
        piece.y -= 1;
      } else {
        this.active = piece;
        this.gameOver();
        return;
      }
    }

    this.active = piece;
    this.grounded = false;
    this.lockTimerMs = 0;
    this.lockResets = 0;
    this.gravityAccMs = 0;
  }

  private gameOver(): void {
    this.phase = "over";
    this.active = null;
    this.onGameOver?.();
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  /**
   * Queue a player action. Logged with the current frame so the whole run can
   * be replayed exactly from `seed + actionLog`.
   */
  input(action: InputAction): void {
    if (this.phase !== "playing") {
      // Pause toggling is handled by the host, not here; ignore everything else.
      return;
    }
    this.actionLog.push({ f: this.frame, a: action });
    this.applyAction(action);
  }

  /** Applies an action without logging it — used by the replay validator. */
  applyAction(action: InputAction): void {
    switch (action) {
      case "moveLeft":
        this.startDas(-1);
        break;
      case "moveRight":
        this.startDas(1);
        break;
      case "rotateCW":
        this.rotate(1);
        break;
      case "rotateCCW":
        this.rotate(-1);
        break;
      case "softDropStart":
        this.softDropping = true;
        break;
      case "softDropEnd":
        this.softDropping = false;
        break;
      case "hardDrop":
        this.hardDrop();
        break;
      case "hold":
        this.holdPiece();
        break;
    }
  }

  /** Release a held direction. Not logged as a distinct action — DAS state is derived. */
  releaseDirection(dir: -1 | 1): void {
    if (this.dasDir === dir) {
      this.dasDir = 0;
      this.dasCharged = false;
      this.dasTimerMs = 0;
    }
  }

  private startDas(dir: -1 | 1): void {
    this.dasDir = dir;
    this.dasTimerMs = 0;
    this.dasCharged = false;
    this.tryMove(dir, 0);
  }

  private tryMove(dx: number, dy: number): boolean {
    const p = this.active;
    if (!p) return false;
    if (this.collides(p.kind, p.rot, p.x + dx, p.y + dy)) return false;
    p.x += dx;
    p.y += dy;
    if (dx !== 0) {
      this.onMove?.();
      this.resetLockTimer();
    }
    return true;
  }

  private rotate(dir: 1 | -1): void {
    const p = this.active;
    if (!p) return;
    const from = p.rot;
    const to = (p.rot + dir + 4) % 4;
    const kicks = kicksFor(p.kind, from, to);
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      if (!this.collides(p.kind, to, p.x + kx, p.y + ky)) {
        p.rot = to;
        p.x += kx;
        p.y += ky;
        this.onRotate?.();
        this.resetLockTimer();
        return;
      }
    }
  }

  private holdPiece(): void {
    if (!this.canHold || !this.active) return;
    const current: QueuedPiece = { kind: this.active.kind, stock: this.active.stock };
    if (this.hold) {
      const swap = this.hold;
      this.hold = current;
      this.beginPiece(swap);
    } else {
      this.hold = current;
      this.spawn();
    }
    this.canHold = false;
    this.onHold?.();
  }

  private hardDrop(): void {
    const p = this.active;
    if (!p) return;
    let cells = 0;
    while (!this.collides(p.kind, p.rot, p.x, p.y + 1)) {
      p.y += 1;
      cells++;
    }
    this.score += cells * SCORE.hardDropPerCell;
    this.lockPiece();
  }

  /** Row the active piece would land on if dropped. Used to draw the ghost. */
  ghostY(): number {
    const p = this.active;
    if (!p) return 0;
    let y = p.y;
    while (!this.collides(p.kind, p.rot, p.x, y + 1)) y++;
    return y;
  }

  private resetLockTimer(): void {
    if (this.grounded && this.lockResets < TIMING.lockResetLimit) {
      this.lockTimerMs = 0;
      this.lockResets++;
    }
  }

  // -------------------------------------------------------------------------
  // Simulation step
  // -------------------------------------------------------------------------

  /** Advance one fixed simulation step. `dtMs` is always TIMING.stepMs. */
  update(dtMs: number): void {
    if (this.phase === "over" || this.phase === "ready" || this.phase === "paused") return;

    this.frame++;
    this.elapsedMs += dtMs;
    this.events.tick(dtMs);

    if (this.phase === "clearing") {
      this.clearTimerMs -= dtMs;
      if (this.clearTimerMs <= 0) this.finishClear();
      return;
    }

    if (this.spawnTimerMs > 0) {
      this.spawnTimerMs -= dtMs;
      if (this.spawnTimerMs <= 0) {
        this.spawnTimerMs = 0;
        this.applyPendingGarbage();
        this.spawn();
      }
      return;
    }

    this.updateDas(dtMs);
    this.updateGravity(dtMs);
    this.updateLock(dtMs);
  }

  private updateDas(dtMs: number): void {
    if (this.dasDir === 0) return;
    this.dasTimerMs += dtMs;
    if (!this.dasCharged) {
      if (this.dasTimerMs >= TIMING.dasMs) {
        this.dasCharged = true;
        this.dasTimerMs = 0;
        this.tryMove(this.dasDir, 0);
      }
      return;
    }
    while (this.dasTimerMs >= TIMING.arrMs) {
      this.dasTimerMs -= TIMING.arrMs;
      if (!this.tryMove(this.dasDir, 0)) break;
    }
  }

  /** Milliseconds per cell at the current level, including any event scaling. */
  gravityIntervalMs(): number {
    const idx = Math.min(this.level - 1, GRAVITY_MS.length - 1);
    const base = Math.max(MIN_GRAVITY_MS, GRAVITY_MS[idx]);
    return Math.max(MIN_GRAVITY_MS, base * this.events.gravityScale);
  }

  private updateGravity(dtMs: number): void {
    const p = this.active;
    if (!p) return;

    const interval = this.softDropping
      ? Math.min(this.gravityIntervalMs(), TIMING.stepMs * 1.5)
      : this.gravityIntervalMs();

    this.gravityAccMs += dtMs;
    let guard = 0;
    while (this.gravityAccMs >= interval && guard++ < 32) {
      this.gravityAccMs -= interval;
      if (this.collides(p.kind, p.rot, p.x, p.y + 1)) {
        this.gravityAccMs = 0;
        break;
      }
      p.y += 1;
      if (this.softDropping) this.score += SCORE.softDropPerCell;
    }
  }

  private updateLock(dtMs: number): void {
    const p = this.active;
    if (!p) return;

    const onFloor = this.collides(p.kind, p.rot, p.x, p.y + 1);
    if (!onFloor) {
      this.grounded = false;
      this.lockTimerMs = 0;
      return;
    }

    if (!this.grounded) {
      this.grounded = true;
      this.lockTimerMs = 0;
    }
    this.lockTimerMs += dtMs;
    if (this.lockTimerMs >= TIMING.lockDelayMs) this.lockPiece();
  }

  // -------------------------------------------------------------------------
  // Locking and clearing
  // -------------------------------------------------------------------------

  private lockPiece(): void {
    const p = this.active;
    if (!p) return;

    const cells = PIECES[p.kind][p.rot];
    let lowestY = -1;
    for (let i = 0; i < cells.length; i++) {
      const x = p.x + cells[i][0];
      const y = p.y + cells[i][1];
      if (y < 0) continue; // locked partly off the top — those cells are simply lost
      this.set(x, y, p.stock);
      if (y > lowestY) lowestY = y;
    }

    // Lock out: the whole piece finished above the visible field.
    if (lowestY < this.hiddenRows) {
      this.onLock?.(p);
      this.active = null;
      this.gameOver();
      return;
    }

    this.piecesPlaced++;
    this.events.onPiecePlaced();
    this.onLock?.(p);
    this.active = null;
    this.canHold = true;
    this.softDropping = false;

    const full = this.findFullRows();
    if (full.length > 0) {
      this.pendingClearRows = full;
      this.resolveClear(full);
      this.phase = "clearing";
      this.clearTimerMs = TIMING.clearAnimMs;
    } else {
      this.combo = -1;
      this.events.onDryLock();
      this.spawnTimerMs = TIMING.spawnDelayMs;
    }
  }

  private findFullRows(): number[] {
    const out: number[] = [];
    for (let y = 0; y < this.rows; y++) {
      let full = true;
      const base = y * this.cols;
      for (let x = 0; x < this.cols; x++) {
        if (this.grid[base + x] === EMPTY) {
          full = false;
          break;
        }
      }
      if (full) out.push(y);
    }
    return out;
  }

  /**
   * Works out everything a clear is worth, and banks it.
   *
   * Deliberately runs before the rows are removed, because the reward depends
   * on which stock sits in each cleared cell.
   */
  private resolveClear(rows: number[]): void {
    const lineCount = rows.length;

    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    const difficult = isDifficult(lineCount);
    const chained = difficult && this.backToBack > 0;
    if (difficult) this.backToBack++;
    else this.backToBack = 0;

    if (lineCount >= 4) this.quads++;

    // Count the stock in the cleared rows.
    const perStock = new Array(this.stocks.length).fill(0);
    for (const y of rows) {
      const base = y * this.cols;
      for (let x = 0; x < this.cols; x++) {
        const s = this.grid[base + x];
        if (s >= 0 && s < perStock.length) perStock[s]++;
      }
    }

    // Perfect clear is decided against the board as it will be once these rows
    // are gone, so it must be computed here rather than after the collapse.
    const perfect = this.wouldBeEmpty(rows);
    if (perfect) this.perfectClears++;

    // --- score (skill) ---
    let gained = lineScore(lineCount, this.level) + comboScore(this.combo, this.level);
    if (chained) gained = Math.floor(gained * SCORE.backToBack);
    if (perfect) gained += perfectClearScore(lineCount, this.level);
    this.score += gained;

    // --- reward multiplier (economy) ---
    const reasons: string[] = [];
    let mult = linesMultiplier(lineCount);
    if (lineCount >= 2) reasons.push(`${lineCount} LINES ${mult.toFixed(2)}x`);

    const cm = comboMultiplier(this.combo);
    if (cm > 1) {
      mult *= cm;
      reasons.push(`COMBO x${this.combo} ${cm.toFixed(2)}x`);
    }
    if (chained) {
      mult *= REWARD.backToBackMultiplier;
      reasons.push(`BACK-TO-BACK ${REWARD.backToBackMultiplier}x`);
    }
    if (perfect) {
      mult *= REWARD.perfectClearMultiplier;
      reasons.push(`MARKET WIPEOUT ${REWARD.perfectClearMultiplier}x`);
    }
    if (this.events.pumpActive) reasons.push("MARKET PUMP 1.5x");
    if (this.events.bullRunActive) reasons.push("BULL RUN 2x");
    mult *= this.events.rewardMultiplier;
    mult = Math.min(mult, REWARD.maxMultiplier);

    const units: number[] = new Array(this.stocks.length).fill(0);
    for (let i = 0; i < perStock.length; i++) {
      if (perStock[i] === 0) continue;
      const earned = perStock[i] * mult;
      units[i] = earned;
      this.unitsExact[i] += earned;
    }

    // Versus: send garbage. Computed here so solo and versus share one path.
    if (this.onAttack) {
      const attack = this.attackFor(lineCount, this.combo, chained, perfect);
      if (attack > 0) this.onAttack(attack);
    }

    this.events.onClear(lineCount, this.combo, this.backToBack);

    this.onClear?.({
      rows,
      lineCount,
      units,
      multiplier: mult,
      score: gained,
      combo: this.combo,
      backToBack: chained,
      perfectClear: perfect,
      reasons,
    });
  }

  private attackFor(lineCount: number, combo: number, chained: boolean, perfect: boolean): number {
    if (perfect) return 8;
    let a = [0, 0, 1, 2, 4][Math.min(lineCount, 4)] ?? 0;
    const comboTable = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5];
    a += comboTable[Math.min(Math.max(combo, 0), comboTable.length - 1)];
    if (chained) a += 1;
    return a;
  }

  /** Would the board be completely empty once `rows` are removed? */
  private wouldBeEmpty(rows: number[]): boolean {
    const clearing = new Set(rows);
    for (let y = 0; y < this.rows; y++) {
      if (clearing.has(y)) continue;
      const base = y * this.cols;
      for (let x = 0; x < this.cols; x++) {
        if (this.grid[base + x] !== EMPTY) return false;
      }
    }
    return true;
  }

  /** Removes the cleared rows and drops everything above them down. */
  private finishClear(): void {
    const rows = this.pendingClearRows;
    this.pendingClearRows = [];
    const clearing = new Set(rows);

    // Compact from the bottom up: walk a write cursor and a read cursor.
    let write = this.rows - 1;
    for (let read = this.rows - 1; read >= 0; read--) {
      if (clearing.has(read)) continue;
      if (write !== read) {
        this.grid.copyWithin(write * this.cols, read * this.cols, read * this.cols + this.cols);
      }
      write--;
    }
    // Everything left above the write cursor is new empty space.
    for (let y = write; y >= 0; y--) {
      this.grid.fill(EMPTY, y * this.cols, y * this.cols + this.cols);
    }

    this.lines += rows.length;
    const newLevel = Math.max(this.level, Math.floor(this.lines / LINES_PER_LEVEL) + 1);
    if (newLevel !== this.level) {
      this.level = newLevel;
      this.onLevelUp?.(newLevel);
    }

    this.phase = "playing";
    this.spawnTimerMs = TIMING.spawnDelayMs;
  }

  // -------------------------------------------------------------------------
  // Versus garbage
  // -------------------------------------------------------------------------

  /** Queue incoming garbage. It lands between pieces, never under one. */
  receiveGarbage(lines: number): void {
    this.pendingGarbage += lines;
  }

  private applyPendingGarbage(): void {
    if (this.pendingGarbage <= 0) return;
    const n = Math.min(this.pendingGarbage, this.rows - 1);
    this.pendingGarbage = 0;

    // Garbage carries a real ticker so a line cleared out of it still pays.
    const stockIdx = this.stocks.length > 0 ? this.stocks.length - 1 : 0;
    const holeRng = (this.frame * 2654435761) >>> 0;
    const hole = holeRng % this.cols;

    this.grid.copyWithin(0, n * this.cols);
    for (let i = 0; i < n; i++) {
      const y = this.rows - 1 - i;
      const base = y * this.cols;
      for (let x = 0; x < this.cols; x++) {
        this.grid[base + x] = x === hole ? EMPTY : stockIdx;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reading state
  // -------------------------------------------------------------------------

  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      score: this.score,
      lines: this.lines,
      level: this.level,
      combo: this.combo,
      maxCombo: this.maxCombo,
      backToBack: this.backToBack,
      quads: this.quads,
      perfectClears: this.perfectClears,
      piecesPlaced: this.piecesPlaced,
      elapsedMs: this.elapsedMs,
      units: this.unitsExact.map((u) => Math.floor(u)),
      events: this.events.snapshot(),
      hold: this.hold,
      next: this.nextQueue.slice(0, NEXT_QUEUE_SIZE),
      canHold: this.canHold,
    };
  }

  result(): GameResultSummary {
    const units: Record<string, number> = {};
    let total = 0;
    for (let i = 0; i < this.stocks.length; i++) {
      const whole = Math.floor(this.unitsExact[i]);
      if (whole > 0) {
        units[this.stocks[i].ticker] = whole;
        total += whole;
      }
    }
    return {
      score: this.score,
      lines: this.lines,
      level: this.level,
      durationMs: Math.round(this.elapsedMs),
      maxCombo: Math.max(0, this.maxCombo),
      quads: this.quads,
      perfectClears: this.perfectClears,
      piecesPlaced: this.piecesPlaced,
      units,
      unitsTotal: total,
      seed: this.seed,
      mode: this.mode,
      rulesVersion: this.rulesVersion,
      actionLog: this.actionLog,
      frames: this.frame,
    };
  }
}
