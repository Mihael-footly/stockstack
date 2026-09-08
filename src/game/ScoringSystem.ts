import { REWARD, SCORE } from "./config";

/** A clear counts as "difficult" — and so extends a back-to-back chain — at four lines. */
export function isDifficult(lineCount: number): boolean {
  return lineCount >= 4;
}

export function lineScore(lineCount: number, level: number): number {
  const base = SCORE.lineClear[Math.min(lineCount, 4)] ?? 0;
  return base * level;
}

export function comboScore(combo: number, level: number): number {
  return combo > 0 ? SCORE.comboPerStep * combo * level : 0;
}

export function perfectClearScore(lineCount: number, level: number): number {
  const base = SCORE.perfectClear[Math.min(lineCount, 4)] ?? 0;
  return base * level;
}

export function comboMultiplier(combo: number): number {
  const table = REWARD.comboMultiplier;
  return combo <= 0 ? 1 : table[Math.min(combo, table.length - 1)];
}

export function linesMultiplier(lineCount: number): number {
  return REWARD.linesMultiplier[Math.min(lineCount, 4)] ?? 1;
}
