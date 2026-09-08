import { Rng } from "./rng";
import { PIECE_KINDS, type PieceKind } from "./pieces";
import type { QueuedPiece } from "./types";
import { RARITY_WEIGHT, type StockDef } from "./stocks";

/**
 * Produces the piece stream.
 *
 * Shapes come from a shuffled seven-bag, which is what keeps the game fair:
 * you are guaranteed every piece once per seven, so a run never dies to a
 * twenty-piece S/Z drought. Stock identity is drawn separately and weighted by
 * rarity, so a ticker is never welded to a shape — the same seed produces the
 * same pairing, but across a session an I-piece may be any stock in the pool.
 */
export class PieceGenerator {
  private readonly rng: Rng;
  private readonly stockWeights: number[];
  private bag: PieceKind[] = [];

  constructor(seed: string, stocks: readonly StockDef[]) {
    this.rng = new Rng(`${seed}:pieces`);
    this.stockWeights = stocks.map((s) => RARITY_WEIGHT[s.rarity]);
  }

  next(): QueuedPiece {
    if (this.bag.length === 0) {
      this.bag = this.rng.shuffle(PIECE_KINDS.slice());
    }
    const kind = this.bag.pop()!;
    const stock = this.rng.weightedIndex(this.stockWeights);
    return { kind, stock };
  }
}
