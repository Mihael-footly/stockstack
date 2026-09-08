"use client";

import { memo } from "react";
import { PiecePreview } from "./PiecePreview";
import { MARKET_PUMP } from "@/game/config";
import type { StockDef } from "@/game/stocks";
import type { GameSnapshot } from "@/game/types";
import { num } from "@/lib/format";

export const HoldPanel = memo(function HoldPanel({
  snapshot,
  stocks,
}: {
  snapshot: GameSnapshot;
  stocks: readonly StockDef[];
}) {
  return (
    <div className="panel p-3">
      <div className="panel-label mb-2">Hold</div>
      <div className="flex h-[52px] items-center justify-center">
        {snapshot.hold ? (
          <PiecePreview
            kind={snapshot.hold.kind}
            stock={stocks[snapshot.hold.stock]}
            size={14}
            dim={!snapshot.canHold}
          />
        ) : (
          <span className="text-[10px] font-semibold tracking-wider text-[var(--color-faint)]">
            PRESS C
          </span>
        )}
      </div>
    </div>
  );
});

export const NextPanel = memo(function NextPanel({
  snapshot,
  stocks,
}: {
  snapshot: GameSnapshot;
  stocks: readonly StockDef[];
}) {
  return (
    <div className="panel p-3">
      <div className="panel-label mb-2">Next</div>
      <div className="flex flex-col gap-2.5">
        {snapshot.next.map((p, i) => (
          <PiecePreview
            key={`${i}-${p.kind}-${p.stock}`}
            kind={p.kind}
            stock={stocks[p.stock]}
            size={i === 0 ? 14 : 11}
            dim={i > 2}
          />
        ))}
      </div>
    </div>
  );
});

export const StatsPanel = memo(function StatsPanel({ snapshot }: { snapshot: GameSnapshot }) {
  return (
    <div className="panel divide-y divide-[var(--color-line)]">
      <Stat label="Score" value={num(snapshot.score)} big />
      <div className="grid grid-cols-2 divide-x divide-[var(--color-line)]">
        <Stat label="Lines" value={num(snapshot.lines)} />
        <Stat label="Level" value={num(snapshot.level)} />
      </div>
    </div>
  );
});

function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="px-3 py-2.5">
      <div className="panel-label">{label}</div>
      <div
        className={`tabular font-extrabold text-white ${big ? "text-2xl" : "text-lg"}`}
        style={{ letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Live tally of what the run has mined so far. This is the panel that makes
 * the game's premise legible while you play — the numbers move when you clear.
 */
export const MinedPanel = memo(function MinedPanel({
  snapshot,
  stocks,
}: {
  snapshot: GameSnapshot;
  stocks: readonly StockDef[];
}) {
  const rows = snapshot.units
    .map((units, i) => ({ units, stock: stocks[i] }))
    .filter((r) => r.stock)
    .sort((a, b) => b.units - a.units);
  const total = rows.reduce((sum, r) => sum + r.units, 0);

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="panel-label">Stocks Mined</span>
        <span className="tabular text-xs font-extrabold text-[var(--color-gain)]">{num(total)}</span>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.stock.ticker} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0"
              style={{
                background: r.stock.color,
                boxShadow: `inset 2px 2px 0 ${r.stock.light}, inset -2px -2px 0 ${r.stock.dark}`,
              }}
            />
            <span className="tabular flex-1 text-[11px] font-bold text-[var(--color-muted)]">
              {r.stock.ticker}
            </span>
            <span
              className="tabular text-[11px] font-extrabold"
              style={{ color: r.units > 0 ? r.stock.color : "var(--color-faint)" }}
            >
              {r.units > 0 ? `+${num(r.units)}` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

/**
 * The market-event strip. Shows the momentum meter when nothing is running, so
 * a player can see a pump coming rather than being surprised by it.
 */
export const EventPanel = memo(function EventPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const { pumpPiecesLeft, bullRunMsLeft, momentum } = snapshot.events;
  const bull = bullRunMsLeft > 0;
  const pump = pumpPiecesLeft > 0;

  if (bull || pump) {
    const color = bull ? "var(--color-gold)" : "var(--color-gain)";
    return (
      <div
        className="relative overflow-hidden border-2 p-3"
        style={{
          borderColor: color,
          background: "var(--color-navy)",
          boxShadow: `inset 3px 3px 0 ${color}33, inset -3px -3px 0 rgba(0,0,0,0.6)`,
        }}
      >
        <div className="animate-pulse-glow font-display text-[10px]" style={{ color }}>
          {bull ? "BULL RUN" : "MARKET PUMP"}
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span
            className="font-display px-1.5 py-1 text-[9px]"
            style={{ background: color, color: "#04121F" }}
          >
            {bull ? "2.00X" : "1.50X"}
          </span>
          <span className="tabular text-[10px] text-[var(--color-muted)]">
            {bull ? `${(bullRunMsLeft / 1000).toFixed(1)}s` : `${pumpPiecesLeft} pieces`}
          </span>
        </div>
      </div>
    );
  }

  const pct = Math.min(100, (momentum / MARKET_PUMP.momentumRequired) * 100);
  return (
    <div className="panel p-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="panel-label">Momentum</span>
        <span className="tabular text-[10px] font-bold text-[var(--color-faint)]">
          {Math.floor(momentum)}/{MARKET_PUMP.momentumRequired}
        </span>
      </div>
      {/* Ten cells, filling like a row about to clear. */}
      <div className="flex gap-[3px]">
        {Array.from({ length: 10 }, (_, i) => {
          const on = i < Math.round((pct / 100) * 10);
          return (
            <span
              key={i}
              className="h-3 flex-1"
              style={{
                background: on ? "var(--color-gain)" : "var(--color-slate)",
                boxShadow: on
                  ? "inset 2px 2px 0 rgba(255,255,255,0.45), inset -2px -2px 0 rgba(0,0,0,0.4)"
                  : "inset 2px 2px 0 rgba(0,0,0,0.5)",
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 text-[10px] leading-snug font-semibold text-[var(--color-faint)]">
        Fill it to trigger a Market Pump
      </div>
    </div>
  );
});

export const ComboPanel = memo(function ComboPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const active = snapshot.combo > 0;
  return (
    <div className="panel grid grid-cols-2 divide-x divide-[var(--color-line)]">
      <div className="px-3 py-2">
        <div className="panel-label">Combo</div>
        <div
          className="tabular text-lg font-extrabold"
          style={{ color: active ? "var(--color-gold)" : "var(--color-faint)" }}
        >
          {active ? `x${snapshot.combo}` : "—"}
        </div>
      </div>
      <div className="px-3 py-2">
        <div className="panel-label">B2B</div>
        <div
          className="tabular text-lg font-extrabold"
          style={{ color: snapshot.backToBack > 1 ? "var(--color-sky)" : "var(--color-faint)" }}
        >
          {snapshot.backToBack > 1 ? `x${snapshot.backToBack}` : "—"}
        </div>
      </div>
    </div>
  );
});
