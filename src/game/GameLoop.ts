import { AudioManager } from "./AudioManager";
import { EffectsManager } from "./EffectsManager";
import { GameEngine, type EngineOptions } from "./GameEngine";
import { InputManager } from "./InputManager";
import { Renderer } from "./Renderer";
import { TIMING } from "./config";
import type { ClearEvent, GameSnapshot, InputAction } from "./types";

export interface LoopCallbacks {
  /** Throttled HUD update. Never called per frame. */
  onSnapshot?: (s: GameSnapshot) => void;
  onGameOver?: () => void;
  onClear?: (e: ClearEvent) => void;
  onFps?: (fps: number) => void;
}

/**
 * Drives the simulation and the drawing.
 *
 * The two are deliberately decoupled. The engine only ever advances in fixed
 * steps, taken from an accumulator, so a 144Hz monitor and a 60Hz monitor play
 * exactly the same game; drawing then happens once per animation frame at
 * whatever rate the display offers.
 *
 * React is told about state changes on a timer, not per frame — a `setState`
 * sixty times a second would re-render the HUD tree continuously and is the
 * usual reason browser games built on React feel sluggish.
 */
export class GameLoop {
  readonly engine: GameEngine;
  readonly effects = new EffectsManager();
  readonly audio: AudioManager;
  private renderer: Renderer | null = null;
  private input: InputManager;
  private detachTouch: (() => void) | null = null;

  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;
  private snapshotAccMs = 0;
  private fpsFrames = 0;
  private fpsAccMs = 0;

  /** How often the HUD is refreshed. Fast enough to feel live, cheap enough to ignore. */
  private static readonly SNAPSHOT_INTERVAL_MS = 66;
  /** Guard against a huge dt after a tab has been backgrounded. */
  private static readonly MAX_FRAME_MS = 100;

  constructor(
    options: EngineOptions,
    private callbacks: LoopCallbacks = {},
    audio?: AudioManager,
  ) {
    this.engine = new GameEngine(options);
    this.audio = audio ?? new AudioManager();

    this.input = new InputManager({
      action: (a) => this.handleAction(a),
      release: (dir) => this.engine.releaseDirection(dir),
      togglePause: () => this.togglePause(),
      restart: () => {},
    });

    this.wireEngineEvents();
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  private wireEngineEvents(): void {
    const e = this.engine;

    e.onMove = () => this.audio.move();
    e.onRotate = () => this.audio.rotate();
    e.onHold = () => this.audio.hold();
    e.onLock = () => {
      this.audio.lock();
      this.effects.kick(1.5);
    };
    e.onLevelUp = (level) => {
      this.audio.levelUp();
      this.audio.setIntensity(level, e.events.bullRunActive);
      this.effects.addText("LEVEL UP", e.cols / 2, e.hiddenRows + 3, {
        color: "#FFD84A",
        size: 20,
        lifeMs: 1100,
      });
    };
    e.onGameOver = () => {
      this.audio.gameOver();
      this.effects.kick(10);
      this.stop();
      this.pushSnapshot();
      this.callbacks.onGameOver?.();
    };
    e.onClear = (ev) => this.handleClear(ev);

    e.events.onPumpStart = () => {
      this.audio.marketPump();
      this.effects.glow(0.7);
      this.effects.addText("MARKET PUMP", e.cols / 2, e.hiddenRows + 5, {
        color: "#19F28A",
        size: 22,
        lifeMs: 1400,
      });
    };
    e.events.onBullRunStart = () => {
      this.audio.bullRun();
      this.audio.setIntensity(e.level, true);
      this.effects.glow(1);
      this.effects.kick(7);
      this.effects.addText("BULL RUN", e.cols / 2, e.hiddenRows + 4, {
        color: "#FFD84A",
        size: 28,
        lifeMs: 1700,
      });
      this.effects.addText("2X STOCKS", e.cols / 2, e.hiddenRows + 6.4, {
        color: "#FFFFFF",
        size: 15,
        lifeMs: 1700,
      });
    };
  }

  private handleClear(ev: ClearEvent): void {
    const e = this.engine;
    this.audio.clear(ev.lineCount);
    if (ev.combo > 0) this.audio.combo(ev.combo);

    this.effects.flashRows(ev.rows, ev.lineCount >= 4 ? 1 : 0.6 + ev.lineCount * 0.12);
    this.effects.kick(2 + ev.lineCount * 2.2);
    this.effects.glow(0.2 + ev.lineCount * 0.14);

    // Particles in the colour of whatever was actually cleared.
    for (const row of ev.rows) {
      for (let x = 0; x < e.cols; x++) {
        const stock = e.at(x, row);
        const def = stock >= 0 ? e.stocks[stock] : null;
        if (def && Math.random() < 0.5) {
          this.effects.burst(x + 0.5, row + 0.5, def.color, 3);
        }
      }
    }

    // --- clear banners -----------------------------------------------------
    //
    // Every label from one clear is laid out as a single block: one shared
    // anchor, one shared drift, fixed spacing. Placing them independently made
    // them collide and then drift through each other, because a faster drift
    // on one line overtakes a slower one — "DOUBLE" ended up printed across
    // "META +5".
    const DRIFT = -1.5;
    const SPACING = 1.7;

    const banners: { text: string; color: string; size: number }[] = [];

    if (ev.combo > 0) {
      banners.push({ text: `COMBO x${ev.combo}`, color: "#FFD84A", size: 17 });
    }
    if (ev.lineCount >= 4) {
      banners.push({ text: "MARKET CLEAR", color: "#19F28A", size: 23 });
    } else if (ev.lineCount === 3) {
      banners.push({ text: "TRIPLE", color: "#43A5FF", size: 19 });
    } else if (ev.lineCount === 2) {
      banners.push({ text: "DOUBLE", color: "#9CCEFF", size: 17 });
    }
    if (ev.perfectClear) {
      banners.push({ text: "MARKET WIPEOUT", color: "#FFD84A", size: 19 });
    }
    if (ev.multiplier > 1.001) {
      banners.push({ text: `${ev.multiplier.toFixed(2)}X`, color: "#FFFFFF", size: 16 });
    }

    // The tickers that were actually mined. The running totals live in the
    // HUD; these are the moment-to-moment feedback that ties a clear to the
    // stocks that were in it.
    const earned = ev.units
      .map((u, i) => ({ u, def: e.stocks[i] }))
      .filter((x) => x.u > 0 && x.def)
      .sort((a, b) => b.u - a.u)
      .slice(0, 3);
    for (const x of earned) {
      banners.push({ text: `${x.def.ticker} +${Math.round(x.u)}`, color: x.def.color, size: 13 });
    }

    // Sit the block in open air above the stack, never across it.
    const stackTop = this.highestOccupiedRow();
    const span = (banners.length - 1) * SPACING;
    const ideal = Math.min(stackTop - 2.5 - span, e.rows - 6);
    const top = Math.max(e.hiddenRows + 1.2, ideal);

    // A combo lands the next clear before this set has faded, and two sets
    // drifting at one speed never separate. Replace rather than overlay.
    this.effects.clearTagged("clear");

    banners.forEach((b, i) => {
      this.effects.addText(b.text, e.cols / 2, top + i * SPACING, {
        color: b.color,
        size: b.size,
        lifeMs: b.size >= 19 ? 1350 : 1150,
        weight: b.size >= 19 ? 800 : 700,
        driftY: DRIFT,
        tag: "clear",
      });
    });

    this.callbacks.onClear?.(ev);
  }

  /** Row index of the topmost occupied cell, or the floor if the board is empty. */
  private highestOccupiedRow(): number {
    const e = this.engine;
    for (let y = 0; y < e.rows; y++) {
      for (let x = 0; x < e.cols; x++) {
        if (e.at(x, y) !== -1) return y;
      }
    }
    return e.rows;
  }

  private handleAction(a: InputAction): void {
    if (a === "hardDrop" && this.engine.phase === "playing") this.audio.hardDrop();
    this.engine.input(a);
  }

  // -------------------------------------------------------------------------
  // Attachment
  // -------------------------------------------------------------------------

  attachCanvas(canvas: HTMLCanvasElement): void {
    this.renderer = new Renderer(canvas, this.engine, this.effects);
  }

  attachInput(touchTarget?: HTMLElement): void {
    this.input.attach(window);
    if (touchTarget) this.detachTouch = this.input.attachTouch(touchTarget);
  }

  resize(w: number, h: number): void {
    this.renderer?.resize(w, h);
  }

  get view(): Renderer | null {
    return this.renderer;
  }

  /** Fire an action from an on-screen control. */
  press(a: InputAction): void {
    this.handleAction(a);
  }

  release(dir: -1 | 1): void {
    this.engine.releaseDirection(dir);
  }

  // -------------------------------------------------------------------------
  // Run control
  // -------------------------------------------------------------------------

  start(): void {
    this.audio.unlock();
    this.audio.setIntensity(this.engine.level, false);
    if (this.audio.settings.musicVolume > 0) this.audio.startMusic();
    this.engine.start();
    this.resumeLoop();
    this.pushSnapshot();
  }

  private resumeLoop(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.audio.stopMusic();
  }

  togglePause(): void {
    if (this.engine.phase === "playing") this.pause();
    else if (this.engine.phase === "paused") this.resume();
  }

  pause(): void {
    if (this.engine.phase !== "playing") return;
    this.engine.pause();
    this.audio.stopMusic();
    this.pushSnapshot();
  }

  resume(): void {
    if (this.engine.phase !== "paused") return;
    this.engine.resume();
    // Reset the accumulator so the pause does not become a burst of catch-up
    // steps the moment play resumes.
    this.lastTime = performance.now();
    this.accumulator = 0;
    if (this.audio.settings.musicVolume > 0) this.audio.startMusic();
    this.resumeLoop();
    this.pushSnapshot();
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    let dt = now - this.lastTime;
    this.lastTime = now;
    if (dt < 0) dt = 0;
    // A backgrounded tab produces a single enormous dt. Clamping it means the
    // player returns to the game as they left it rather than to a dead run.
    if (dt > GameLoop.MAX_FRAME_MS) dt = GameLoop.MAX_FRAME_MS;

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= TIMING.stepMs && steps < 8) {
      this.engine.update(TIMING.stepMs);
      this.accumulator -= TIMING.stepMs;
      steps++;
    }
    if (steps === 8) this.accumulator = 0;

    this.effects.update(dt);
    this.renderer?.draw();

    this.snapshotAccMs += dt;
    if (this.snapshotAccMs >= GameLoop.SNAPSHOT_INTERVAL_MS) {
      this.snapshotAccMs = 0;
      this.pushSnapshot();
    }

    this.fpsFrames++;
    this.fpsAccMs += dt;
    if (this.fpsAccMs >= 1000) {
      this.callbacks.onFps?.(Math.round((this.fpsFrames * 1000) / this.fpsAccMs));
      this.fpsFrames = 0;
      this.fpsAccMs = 0;
    }
  };

  pushSnapshot(): void {
    this.callbacks.onSnapshot?.(this.engine.snapshot());
  }

  dispose(): void {
    this.stop();
    this.input.detach();
    this.detachTouch?.();
    this.detachTouch = null;
    this.effects.clear();
  }
}
