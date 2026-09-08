"use client";

import { STOCK_CATALOG } from "@/game/stocks";

/**
 * The decorative ticker strip.
 *
 * Deliberately shows no prices. A number here would be read as a live quote,
 * and there is no price feed behind this site — so the strip carries tickers
 * and the game's verbs instead.
 */
const WORDS = ["STACK", "CLEAR", "COLLECT", "BUILD"];

export function Ticker() {
  const items: { label: string; color: string; kind: "stock" | "verb" }[] = [];
  STOCK_CATALOG.forEach((s, i) => {
    items.push({ label: s.ticker, color: s.color, kind: "stock" });
    if (i % 4 === 3) {
      items.push({ label: WORDS[(i / 4) % WORDS.length | 0], color: "#8AA0BC", kind: "verb" });
    }
  });

  const strip = (
    <div className="flex shrink-0 items-center">
      {items.map((it, i) => (
        <span key={i} className="flex items-center whitespace-nowrap px-4">
          {it.kind === "stock" ? (
            <>
              <span className="mr-2 inline-block h-2.5 w-2.5" style={{ background: it.color, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.45), inset -1px -1px 0 rgba(0,0,0,0.4)" }} />
              <span className="font-display text-[8px]" style={{ color: it.color }}>
                {it.label}
              </span>
            </>
          ) : (
            <span className="font-display text-[8px] text-[var(--color-faint)]">
              {it.label}
            </span>
          )}
        </span>
      ))}
    </div>
  );

  return (
    <div
      className="relative flex overflow-hidden border-y-2 border-[var(--color-line)] bg-[var(--color-deep)] py-3"
      aria-hidden
    >
      <div className="animate-ticker flex">
        {strip}
        {strip}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-[var(--color-void)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-[var(--color-void)] to-transparent" />
    </div>
  );
}
