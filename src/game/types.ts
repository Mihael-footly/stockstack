import type { PieceKind } from "./pieces";

/** Every discrete thing a player can do. Recorded in the action log verbatim. */
export type InputAction =
  | "moveLeft"
  | "moveRight"
  | "rotateCW"
  | "rotateCCW"
  | "softDropStart"
  | "softDropEnd"
  | "hardDrop"
  | "hold";

/** An input stamped with the simulation frame it applied on. */
export interface LoggedAction {
  /** Simulation frame index, not wall-clock. Replays are frame-exact. */
  f: number;
  a: InputAction;
}

export type GameMode = "solo" | "daily" | "versus";

export type GamePhase = "ready" | "playing" | "paused" | "clearing" | "over";

export interface ActivePiece {
  kind: PieceKind;
  /** Index into the session's stock pool. */
  stock: number;
  x: number;
  y: number;
  rot: number;
}

export interface QueuedPiece {
  kind: PieceKind;
  stock: number;
}

/** What a completed line clear produced. Emitted as an event, not polled. */
export interface ClearEvent {
  rows: number[];
  lineCount: number;
  /** Units earned per stock index, before rounding. */
  units: number[];
  /** Product of every reward multiplier that applied. */
  multiplier: number;
  score: number;
  combo: number;
  backToBack: boolean;
  perfectClear: boolean;
  /** Human-readable multiplier breakdown for the HUD. */
  reasons: string[];
}

export interface MarketEventState {
  pumpPiecesLeft: number;
  bullRunMsLeft: number;
  momentum: number;
}

/** A cheap, allocation-free-ish snapshot the UI layer can read each frame. */
export interface GameSnapshot {
  phase: GamePhase;
  score: number;
  lines: number;
  level: number;
  combo: number;
  maxCombo: number;
  backToBack: number;
  quads: number;
  perfectClears: number;
  piecesPlaced: number;
  elapsedMs: number;
  /** Whole stock units banked so far, indexed by stock pool position. */
  units: number[];
  events: MarketEventState;
  hold: QueuedPiece | null;
  next: QueuedPiece[];
  canHold: boolean;
}

export interface GameResultSummary {
  score: number;
  lines: number;
  level: number;
  durationMs: number;
  maxCombo: number;
  quads: number;
  perfectClears: number;
  piecesPlaced: number;
  /** Ticker -> whole units earned. */
  units: Record<string, number>;
  unitsTotal: number;
  seed: string;
  mode: GameMode;
  rulesVersion: number;
  /** Compact action log for server-side replay. */
  actionLog: LoggedAction[];
  frames: number;
}
