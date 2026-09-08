import { BULL_RUN, MARKET_PUMP } from "./config";
import type { MarketEventState } from "./types";

/**
 * Market Pump and Bull Run — the two ways a good run compounds.
 *
 * Both are strictly earned. Nothing here reads a random number, so a player
 * who understands the rules can aim for them, and a replay of the same inputs
 * always triggers them at the same moment.
 */
export class EventSystem {
  momentum = 0;
  pumpPiecesLeft = 0;
  bullRunMsLeft = 0;
  private bullRunCooldownMs = 0;

  /** Fired so the presentation layer can react without polling. */
  onPumpStart: (() => void) | null = null;
  onBullRunStart: (() => void) | null = null;

  tick(dtMs: number): void {
    if (this.bullRunMsLeft > 0) this.bullRunMsLeft = Math.max(0, this.bullRunMsLeft - dtMs);
    if (this.bullRunCooldownMs > 0) this.bullRunCooldownMs = Math.max(0, this.bullRunCooldownMs - dtMs);
  }

  /** Called on every lock that cleared at least one line. */
  onClear(lineCount: number, combo: number, backToBack: number): void {
    this.momentum += MARKET_PUMP.momentumPerLine * lineCount;
    if (lineCount >= 2) this.momentum += MARKET_PUMP.momentumBonusPerMultiLine;

    if (this.momentum >= MARKET_PUMP.momentumRequired) {
      this.momentum = 0;
      this.pumpPiecesLeft = MARKET_PUMP.durationPieces;
      this.onPumpStart?.();
    }

    const earnedBullRun =
      combo >= BULL_RUN.comboTrigger || backToBack >= BULL_RUN.backToBackTrigger;
    if (earnedBullRun && this.bullRunCooldownMs === 0) {
      this.bullRunMsLeft = BULL_RUN.durationMs;
      this.bullRunCooldownMs = BULL_RUN.cooldownMs + BULL_RUN.durationMs;
      this.onBullRunStart?.();
    }
  }

  /** Called on every lock that cleared nothing. */
  onDryLock(): void {
    this.momentum = Math.max(0, this.momentum - MARKET_PUMP.momentumDecayPerDryLock);
  }

  /** A pump is spent in pieces, so it burns down as they are placed. */
  onPiecePlaced(): void {
    if (this.pumpPiecesLeft > 0) this.pumpPiecesLeft--;
  }

  get pumpActive(): boolean {
    return this.pumpPiecesLeft > 0;
  }

  get bullRunActive(): boolean {
    return this.bullRunMsLeft > 0;
  }

  /** Reward multiplier contributed by whichever events are live. */
  get rewardMultiplier(): number {
    let m = 1;
    if (this.pumpActive) m *= MARKET_PUMP.rewardMultiplier;
    if (this.bullRunActive) m *= BULL_RUN.rewardMultiplier;
    return m;
  }

  /** Gravity scale contributed by live events. */
  get gravityScale(): number {
    return this.bullRunActive ? BULL_RUN.gravityScale : 1;
  }

  snapshot(): MarketEventState {
    return {
      pumpPiecesLeft: this.pumpPiecesLeft,
      bullRunMsLeft: this.bullRunMsLeft,
      momentum: this.momentum,
    };
  }
}
