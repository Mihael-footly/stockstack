"use client";

import { memo, useCallback, useRef } from "react";
import type { InputAction } from "@/game/types";

/**
 * On-screen controls for touch devices.
 *
 * Buttons, not just gestures. Gestures are a nice extra but they are
 * ambiguous under pressure, and a stacker is unplayable if the game has to
 * guess whether you meant "move left" or "hard drop". Left/right repeat while
 * held, matching the keyboard's auto-shift.
 */
export const TouchControls = memo(function TouchControls({
  onPress,
  onRelease,
  disabled = false,
}: {
  onPress: (a: InputAction) => void;
  onRelease: (dir: -1 | 1) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid w-full max-w-md grid-cols-4 gap-2 select-none">
      <HoldButton
        label="◀"
        aria="Move left"
        action="moveLeft"
        onPress={onPress}
        onRelease={() => onRelease(-1)}
        disabled={disabled}
      />
      <HoldButton
        label="▶"
        aria="Move right"
        action="moveRight"
        onPress={onPress}
        onRelease={() => onRelease(1)}
        disabled={disabled}
      />
      <TapButton label="↻" aria="Rotate" action="rotateCW" onPress={onPress} disabled={disabled} />
      <TapButton label="HOLD" aria="Hold piece" action="hold" onPress={onPress} disabled={disabled} small />

      <SoftDropButton onPress={onPress} disabled={disabled} />
      <TapButton
        label="DROP"
        aria="Hard drop"
        action="hardDrop"
        onPress={onPress}
        disabled={disabled}
        variant="primary"
        className="col-span-2"
        small
      />
      <TapButton label="↺" aria="Rotate left" action="rotateCCW" onPress={onPress} disabled={disabled} />
    </div>
  );
});

const SHAPE =
  "flex h-14 items-center justify-center border-2 text-xl font-extrabold active:translate-y-[3px] transition-transform disabled:opacity-40 touch-none select-none";

/** The same slab as every other surface: lit top-left, shaded bottom-right. */
const BASE = `${SHAPE} border-[var(--color-line)] bg-[var(--color-slate)] text-white [box-shadow:inset_3px_3px_0_rgba(120,175,235,0.18),inset_-3px_-3px_0_rgba(0,0,0,0.6),0_3px_0_0_#060D16] active:[box-shadow:inset_3px_3px_0_rgba(120,175,235,0.12),inset_-3px_-3px_0_rgba(0,0,0,0.6)]`;

/** The primary action gets the accent, so the thumb finds it without looking. */
const PRIMARY = `${SHAPE} border-[#0B7A46] bg-[var(--color-gain)] text-[#04200F] [box-shadow:inset_3px_3px_0_rgba(255,255,255,0.5),inset_-3px_-3px_0_rgba(0,60,30,0.45),0_3px_0_0_#04351E] active:[box-shadow:inset_3px_3px_0_rgba(255,255,255,0.4),inset_-3px_-3px_0_rgba(0,60,30,0.45)]`;

function TapButton({
  label,
  aria,
  action,
  onPress,
  disabled,
  className = "",
  small = false,
  variant = "default",
}: {
  label: string;
  aria: string;
  action: InputAction;
  onPress: (a: InputAction) => void;
  disabled?: boolean;
  className?: string;
  small?: boolean;
  variant?: "default" | "primary";
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      disabled={disabled}
      className={`${variant === "primary" ? PRIMARY : BASE} ${small ? "font-display text-[10px]" : ""} ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress(action);
      }}
    >
      {label}
    </button>
  );
}

/** Repeats while held, so a long move is one press rather than eight taps. */
function HoldButton({
  label,
  aria,
  action,
  onPress,
  onRelease,
  disabled,
}: {
  label: string;
  aria: string;
  action: InputAction;
  onPress: (a: InputAction) => void;
  onRelease: () => void;
  disabled?: boolean;
}) {
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
    onRelease();
  }, [onRelease]);

  const start = useCallback(() => {
    onPress(action);
    // The engine's own auto-shift handles repeat once it is charged; this only
    // needs to keep the direction held down.
    if (timer.current === null) {
      timer.current = window.setInterval(() => onPress(action), 90);
    }
  }, [action, onPress]);

  return (
    <button
      type="button"
      aria-label={aria}
      disabled={disabled}
      className={BASE}
      onPointerDown={(e) => {
        e.preventDefault();
        start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      {label}
    </button>
  );
}

function SoftDropButton({
  onPress,
  disabled,
}: {
  onPress: (a: InputAction) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Soft drop"
      disabled={disabled}
      className={BASE}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress("softDropStart");
      }}
      onPointerUp={() => onPress("softDropEnd")}
      onPointerLeave={() => onPress("softDropEnd")}
      onPointerCancel={() => onPress("softDropEnd")}
    >
      ▼
    </button>
  );
}
