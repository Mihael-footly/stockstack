/**
 * Every tunable number in StockStack lives here.
 *
 * The engine reads these at construction and never mutates them, so a session
 * can be replayed exactly by pairing a seed with a RULES_VERSION. Bump
 * RULES_VERSION whenever a change here would alter the outcome of a replay —
 * the server stores it alongside each result so old scores stay interpretable.
 */

export const RULES_VERSION = 1;

export const BOARD = {
  /** Playfield columns. */
  cols: 10,
  /** Rows the player can see. */
  visibleRows: 20,
  /**
   * Rows above the visible field where pieces spawn. Four is enough for an
   * I-piece to rotate fully out of sight, so a spawn never visually pops.
   */
  hiddenRows: 4,
} as const;

export const TOTAL_ROWS = BOARD.visibleRows + BOARD.hiddenRows;

export const TIMING = {
  /**
   * The simulation runs on a fixed step so that a given seed plus a given
   * input log always produces the same game. Rendering is decoupled and may
   * run at any refresh rate.
   */
  stepMs: 1000 / 60,

  /** Delay before a held left/right starts auto-repeating. */
  dasMs: 150,
  /** Auto-repeat interval once DAS has charged. */
  arrMs: 33,

  /** Grace period on the floor before a piece locks. */
  lockDelayMs: 500,
  /** How many times a move/rotate may reset that grace period. */
  lockResetLimit: 15,

  /** Pause between the clear animation starting and the rows collapsing. */
  clearAnimMs: 150,
  /** Delay between one piece locking and the next spawning. */
  spawnDelayMs: 60,
} as const;

/**
 * Gravity per level, in milliseconds per cell. Roughly a doubling of speed
 * across the first ten levels, then a long tail so high levels stay playable
 * rather than becoming a coin flip.
 */
export const GRAVITY_MS: readonly number[] = [
  1000, 830, 690, 570, 470, 390, 320, 260, 210, 170,
  140, 115, 95, 78, 64, 53, 43, 36, 29, 24, 20,
];

/** Gravity floor — the game never drops faster than this. */
export const MIN_GRAVITY_MS = 18;

/** Lines cleared per level. */
export const LINES_PER_LEVEL = 10;

/** How many upcoming pieces the player can see. */
export const NEXT_QUEUE_SIZE = 5;

// ---------------------------------------------------------------------------
// Scoring — pure skill. Kept separate from stock rewards on purpose.
// ---------------------------------------------------------------------------

export const SCORE = {
  /** Base score per line-clear size, multiplied by level. Index by line count. */
  lineClear: [0, 100, 300, 500, 800],
  /** Per cell travelled under a soft drop. */
  softDropPerCell: 1,
  /** Per cell travelled under a hard drop. */
  hardDropPerCell: 2,
  /** Per combo step, multiplied by level. */
  comboPerStep: 50,
  /** Multiplier applied to a difficult clear following another difficult clear. */
  backToBack: 1.5,
  /** Flat bonus by line count for clearing the whole board. */
  perfectClear: [0, 800, 1200, 1800, 2800],
} as const;

// ---------------------------------------------------------------------------
// Stock rewards — the economy. Deliberately a separate curve from score.
// ---------------------------------------------------------------------------

export const REWARD = {
  /** Multiplier by number of lines cleared at once. Index by line count. */
  linesMultiplier: [0, 1.0, 1.15, 1.35, 1.75],

  /**
   * Combo multiplier, indexed by combo depth (0 = no combo). Past the end of
   * the table the last value holds, so a long combo is strong but bounded.
   */
  comboMultiplier: [1.0, 1.0, 1.05, 1.1, 1.2, 1.3, 1.38, 1.45, 1.5, 1.55, 1.6],

  /** Applied on a difficult clear that follows another difficult clear. */
  backToBackMultiplier: 1.25,

  /** Applied when a clear empties the board completely. */
  perfectClearMultiplier: 2.5,

  /** Ceiling on the product of every multiplier, so nothing can run away. */
  maxMultiplier: 12,
} as const;

// ---------------------------------------------------------------------------
// Market events — earned through play, never random, never purchasable.
// ---------------------------------------------------------------------------

export const MARKET_PUMP = {
  /**
   * Momentum accrues on every clear and decays when a piece locks without
   * clearing anything. At full it triggers a pump.
   */
  momentumPerLine: 1,
  momentumBonusPerMultiLine: 1,
  momentumDecayPerDryLock: 0.5,
  momentumRequired: 10,
  /** Pump lasts a number of placed pieces rather than a wall-clock duration. */
  durationPieces: 8,
  rewardMultiplier: 1.5,
} as const;

export const BULL_RUN = {
  /** A combo this deep sets off a bull run. */
  comboTrigger: 5,
  /** This many back-to-back difficult clears also sets one off. */
  backToBackTrigger: 3,
  durationMs: 15_000,
  rewardMultiplier: 2.0,
  /** Gravity is scaled by this — faster, but still readable. */
  gravityScale: 0.72,
  /** A bull run cannot retrigger until this much time has passed since the last. */
  cooldownMs: 20_000,
} as const;

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

export const XP = {
  perLine: 12,
  perLevel: 40,
  perGame: 60,
  quadBonus: 50,
  perfectClearBonus: 120,
  matchWinBonus: 250,
  /** XP needed to go from level n to n+1. */
  curve: (level: number) => 800 + level * 400,
} as const;

/** Attack table for versus play. Index by lines cleared. */
export const ATTACK = {
  lines: [0, 0, 1, 2, 4],
  comboBonus: [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5],
  backToBackBonus: 1,
  perfectClear: 8,
} as const;
