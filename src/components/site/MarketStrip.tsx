"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { RARITY_LABEL, marketForDate, stockByTicker, todayKey, type Rarity, type StockDef } from "@/game/stocks";

/** More pips means the ticker turns up more often in the piece stream. */
const RARITY_PIPS: Record<Rarity, number> = { common: 3, uncommon: 2, rare: 1, epic: 0 };

/**
 * Today's market.
 *
 * Read from the server, which is the authority — the same list the daily run
 * is dealt from. The local derivation is only a fallback so the section is
 * never empty while the request is in flight or if the backend is down.
 */
export function MarketStrip() {
  const [stocks, setStocks] = useState<StockDef[]>(() => marketForDate(todayKey()));
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let cancelled = false;

    supabase.rpc("current_daily_market").then(({ data, error }) => {
      if (cancelled || error) return;
      const row = Array.isArray(data) ? data[0] : data;
      const pool: string[] | undefined = row?.stock_pool;
      if (!pool?.length) return;
      const resolved = pool.map((t) => stockByTicker(t)).filter((s): s is StockDef => Boolean(s));
      if (resolved.length) {
        setStocks(resolved);
        setLive(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="block-surface p-5">
      <div className="flex items-baseline justify-between">
        <span className="panel-label">Today&apos;s market</span>
        <span className="tabular text-[10px] font-extrabold tracking-widest text-[var(--color-faint)]">
          {live ? todayKey() : "…"}
        </span>
      </div>

      {/*
        Stacked, not side by side. This panel appears both in a wide landing
        column and in a narrow lobby rail, and a horizontal card had nowhere to
        put the rarity in the narrow one — it truncated to a single character.
      */}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {stocks.map((s) => (
          <div
            key={s.ticker}
            className="flex flex-col items-center gap-1.5 border-2 px-1 py-2.5"
            style={{ borderColor: s.color, background: "var(--color-void)" }}
            title={`${s.name} — ${RARITY_LABEL[s.rarity]} (game spawn rate)`}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center text-[8px] font-extrabold"
              style={{
                background: s.color,
                color: s.ink,
                boxShadow: `inset 3px 3px 0 ${s.light}, inset -3px -3px 0 ${s.dark}`,
              }}
            >
              {s.ticker.slice(0, 4)}
            </span>
            <span className="font-display text-[7px] leading-none text-white">{s.ticker}</span>
            {/* Rarity as a row of pips: it survives any width, and it reads as
                a frequency rather than as a grade. */}
            <span className="flex gap-[2px]" aria-label={RARITY_LABEL[s.rarity]}>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5"
                  style={{ background: i <= RARITY_PIPS[s.rarity] ? s.color : "var(--color-slate)" }}
                />
              ))}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 border-t-2 border-[var(--color-line)] pt-3 text-[10px] leading-relaxed font-semibold text-[var(--color-faint)]">
        Pips show spawn frequency in the piece stream — a game rate, not an investment rating.
      </p>
    </div>
  );
}
