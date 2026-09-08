import type { InputAction } from "./types";

export interface InputHandlers {
  action: (a: InputAction) => void;
  release: (dir: -1 | 1) => void;
  togglePause: () => void;
  restart: () => void;
}

/**
 * Keyboard and touch handling.
 *
 * Movement is edge-triggered: a keydown issues one move and starts the
 * engine's auto-shift, and the keyup ends it. The browser's own key repeat is
 * ignored, because its rate is a user OS setting and would make the game feel
 * different on every machine.
 */
export class InputManager {
  private held = new Set<string>();
  private attached = false;
  private target: HTMLElement | Window | null = null;

  constructor(private handlers: InputHandlers) {}

  attach(target: HTMLElement | Window = window): void {
    if (this.attached) this.detach();
    this.target = target;
    target.addEventListener("keydown", this.onKeyDown as EventListener);
    target.addEventListener("keyup", this.onKeyUp as EventListener);
    window.addEventListener("blur", this.onBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached || !this.target) return;
    this.target.removeEventListener("keydown", this.onKeyDown as EventListener);
    this.target.removeEventListener("keyup", this.onKeyUp as EventListener);
    window.removeEventListener("blur", this.onBlur);
    this.held.clear();
    this.attached = false;
  }

  private onBlur = (): void => {
    // Releasing everything on blur stops a key "sticking" when the player
    // tabs away mid-move.
    for (const code of this.held) {
      if (code === "ArrowLeft" || code === "KeyA") this.handlers.release(-1);
      if (code === "ArrowRight" || code === "KeyD") this.handlers.release(1);
      if (code === "ArrowDown" || code === "KeyS") this.handlers.action("softDropEnd");
    }
    this.held.clear();
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    // Let the page keep its own shortcuts.
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const code = ev.code;
    if (!HANDLED.has(code)) return;
    ev.preventDefault();
    if (ev.repeat || this.held.has(code)) return;
    this.held.add(code);

    switch (code) {
      case "ArrowLeft":
      case "KeyA":
        this.handlers.action("moveLeft");
        break;
      case "ArrowRight":
      case "KeyD":
        this.handlers.action("moveRight");
        break;
      case "ArrowDown":
      case "KeyS":
        this.handlers.action("softDropStart");
        break;
      case "Space":
        this.handlers.action("hardDrop");
        break;
      case "ArrowUp":
      case "KeyX":
        this.handlers.action("rotateCW");
        break;
      case "KeyZ":
      case "ControlLeft":
        this.handlers.action("rotateCCW");
        break;
      case "KeyC":
      case "ShiftLeft":
        this.handlers.action("hold");
        break;
      case "KeyP":
      case "Escape":
        this.handlers.togglePause();
        break;
      case "KeyR":
        this.handlers.restart();
        break;
    }
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    const code = ev.code;
    if (!HANDLED.has(code)) return;
    ev.preventDefault();
    this.held.delete(code);
    switch (code) {
      case "ArrowLeft":
      case "KeyA":
        this.handlers.release(-1);
        break;
      case "ArrowRight":
      case "KeyD":
        this.handlers.release(1);
        break;
      case "ArrowDown":
      case "KeyS":
        this.handlers.action("softDropEnd");
        break;
    }
  };

  // -------------------------------------------------------------------------
  // Touch gestures. The on-screen buttons are the reliable path; these are a
  // convenience on top, and deliberately generous about what counts as a swipe.
  // -------------------------------------------------------------------------

  attachTouch(el: HTMLElement): () => void {
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let lastStepX = 0;
    let moved = false;
    let softDropping = false;

    const CELL = 26; // px of travel per horizontal step

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      lastStepX = t.clientX;
      startT = performance.now();
      moved = false;
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - lastStepX;
      const dy = t.clientY - startY;

      if (Math.abs(dx) >= CELL) {
        const steps = Math.trunc(dx / CELL);
        for (let i = 0; i < Math.abs(steps); i++) {
          this.handlers.action(steps > 0 ? "moveRight" : "moveLeft");
          this.handlers.release(steps > 0 ? 1 : -1);
        }
        lastStepX += steps * CELL;
        moved = true;
      }

      if (dy > 40 && !softDropping && Math.abs(t.clientX - startX) < 40) {
        softDropping = true;
        this.handlers.action("softDropStart");
        moved = true;
      }
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = (e: TouchEvent) => {
      if (softDropping) {
        this.handlers.action("softDropEnd");
        softDropping = false;
      }
      const t = e.changedTouches[0];
      if (!t) return;
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      const dt = performance.now() - startT;

      // A fast flick downward is a hard drop.
      if (dy > 70 && dt < 260 && Math.abs(dx) < 60) {
        this.handlers.action("hardDrop");
        return;
      }
      // A tap that never moved rotates.
      if (!moved && dt < 260 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        this.handlers.action("rotateCW");
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }
}

const HANDLED = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowDown",
  "ArrowUp",
  "Space",
  "KeyA",
  "KeyD",
  "KeyS",
  "KeyZ",
  "KeyX",
  "KeyC",
  "KeyP",
  "KeyR",
  "Escape",
  "ShiftLeft",
  "ControlLeft",
]);
