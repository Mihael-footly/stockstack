/**
 * The stock catalog and the daily market drawn from it.
 *
 * Rarity here is a *spawn frequency* only. It says how often a ticker shows up
 * in the piece stream and nothing whatsoever about the company. That
 * distinction is load-bearing, so it is repeated in the UI wherever rarity is
 * displayed.
 */

export type Rarity = "common" | "uncommon" | "rare" | "epic";

export interface StockDef {
  ticker: string;
  name: string;
  /** Base hue for the block face. */
  color: string;
  /** Lighter edge used for the bevel highlight. */
  light: string;
  /** Darker edge used for the bevel shadow. */
  dark: string;
  /** Colour for the ticker label — chosen for contrast against `color`. */
  ink: string;
  rarity: Rarity;
}

/** Spawn weight by rarity. Higher is more frequent. */
export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 100,
  uncommon: 62,
  rare: 34,
  epic: 16,
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "COMMON",
  uncommon: "UNCOMMON",
  rare: "RARE",
  epic: "EPIC",
};

/**
 * The full catalog. A day's market is a subset of this, so the pool is wide
 * enough that consecutive days feel different.
 */
export const STOCK_CATALOG: readonly StockDef[] = [
  { ticker: "NVDA",  name: "NVIDIA",            color: "#19F28A", light: "#7DFFC4", dark: "#0B9B57", ink: "#04231A", rarity: "rare" },
  { ticker: "AAPL",  name: "Apple",             color: "#E8EDF4", light: "#FFFFFF", dark: "#98A4B4", ink: "#131A24", rarity: "common" },
  { ticker: "HOOD",  name: "Robinhood",         color: "#C6F24E", light: "#E6FFA0", dark: "#7FA317", ink: "#1B2404", rarity: "uncommon" },
  { ticker: "TSLA",  name: "Tesla",             color: "#FF5C5C", light: "#FF9E9E", dark: "#A82C2C", ink: "#2B0707", rarity: "uncommon" },
  { ticker: "META",  name: "Meta",              color: "#43A5FF", light: "#9CCEFF", dark: "#1D66B4", ink: "#04182B", rarity: "common" },
  { ticker: "MSFT",  name: "Microsoft",         color: "#5CC8E8", light: "#A8E6F7", dark: "#2482A0", ink: "#03222B", rarity: "common" },
  { ticker: "AMZN",  name: "Amazon",            color: "#FFB03A", light: "#FFD494", dark: "#B36F12", ink: "#2B1704", rarity: "common" },
  { ticker: "GOOGL", name: "Alphabet",          color: "#9B8BFF", light: "#CBC2FF", dark: "#5C4BC4", ink: "#100A2B", rarity: "uncommon" },
  { ticker: "AMD",   name: "AMD",               color: "#FF7A45", light: "#FFB08C", dark: "#B34818", ink: "#2B0F04", rarity: "uncommon" },
  { ticker: "COIN",  name: "Coinbase",          color: "#3B7BFF", light: "#8FB4FF", dark: "#1A46B4", ink: "#03112B", rarity: "rare" },
  { ticker: "PLTR",  name: "Palantir",          color: "#00D6C2", light: "#7DFFF3", dark: "#00877A", ink: "#022725", rarity: "rare" },
  { ticker: "SPOT",  name: "Spotify",           color: "#5FE87A", light: "#A9FFBB", dark: "#2A9A42", ink: "#052B10", rarity: "uncommon" },
  { ticker: "NFLX",  name: "Netflix",           color: "#F2456B", light: "#FF93AB", dark: "#A81640", ink: "#2B0512", rarity: "rare" },
  { ticker: "UBER",  name: "Uber",              color: "#7E93AD", light: "#B4C6DA", dark: "#455A73", ink: "#0A121C", rarity: "common" },
  { ticker: "SHOP",  name: "Shopify",           color: "#8BD44E", light: "#C4F0A0", dark: "#4F8A1F", ink: "#0B2204", rarity: "uncommon" },
  { ticker: "AVGO",  name: "Broadcom",          color: "#FF4FD8", light: "#FFA3EC", dark: "#B01A94", ink: "#2B0423", rarity: "epic" },
  { ticker: "ARM",   name: "Arm Holdings",      color: "#00B2FF", light: "#84D9FF", dark: "#0070A8", ink: "#021C2B", rarity: "epic" },
];

export const CATALOG_BY_TICKER: ReadonlyMap<string, StockDef> = new Map(
  STOCK_CATALOG.map((s) => [s.ticker, s]),
);

export function stockByTicker(ticker: string): StockDef | undefined {
  return CATALOG_BY_TICKER.get(ticker);
}

/** How many tickers are in play on any given day. */
export const MARKET_SIZE = 7;

/**
 * The pool of tickers for a given calendar day.
 *
 * Derived from the date alone so the client and the server agree without a
 * round trip, and so a daily run is genuinely the same market for everyone.
 * `dateKey` is an ISO date in UTC, e.g. "2026-09-08".
 */
export function marketForDate(dateKey: string, size = MARKET_SIZE): StockDef[] {
  const rng = new RngLocal(hashLocal(`market:${dateKey}`));
  const pool = STOCK_CATALOG.slice();

  // Guarantee a spread of rarities so a day is never all-epic or all-common.
  const picked: StockDef[] = [];
  const byRarity: Record<Rarity, StockDef[]> = { common: [], uncommon: [], rare: [], epic: [] };
  for (const s of pool) byRarity[s.rarity].push(s);
  for (const tier of ["common", "common", "uncommon", "rare"] as Rarity[]) {
    const bucket = byRarity[tier];
    if (!bucket.length) continue;
    const idx = rng.nextInt(bucket.length);
    picked.push(bucket.splice(idx, 1)[0]);
  }

  // Fill the rest from whatever is left, weighted so rares stay scarcer.
  const rest = pool.filter((s) => !picked.includes(s));
  while (picked.length < size && rest.length) {
    const weights = rest.map((s) => RARITY_WEIGHT[s.rarity]);
    const idx = rng.weightedIndex(weights);
    picked.push(rest.splice(idx, 1)[0]);
  }

  // Stable presentation order, independent of draw order.
  return picked.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** Today's date key in UTC, so the market rolls over at the same instant globally. */
export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// A private copy of the RNG so this module can be imported by the server
// without dragging in the engine. Kept byte-identical to game/rng.ts.
function hashLocal(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

class RngLocal {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  private nextUint32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  next(): number {
    return this.nextUint32() / 4294967296;
  }
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return 0;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}
