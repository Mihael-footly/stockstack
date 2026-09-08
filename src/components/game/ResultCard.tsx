"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StockDef } from "@/game/stocks";
import type { GameMode, GameResultSummary } from "@/game/types";
import type { SubmitOutcome } from "@/lib/session";
import { duration, num } from "@/lib/format";

/**
 * The game-over screen.
 *
 * Two things it must get right: show the run honestly, and never imply a
 * reward that was not actually banked. When the sync fails the numbers stay on
 * screen and a retry is offered — losing someone's run to a flaky network
 * would be the worst possible moment to be unhelpful.
 */
export function ResultCard({
  result,
  stocks,
  sync,
  mode,
  onPlayAgain,
  onRetrySync,
}: {
  result: GameResultSummary;
  stocks: readonly StockDef[];
  sync: SubmitOutcome | null;
  mode: GameMode;
  onPlayAgain: () => void;
  onRetrySync: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);

  const mined = Object.entries(result.units)
    .map(([ticker, units]) => ({ ticker, units, def: stocks.find((s) => s.ticker === ticker) }))
    .sort((a, b) => b.units - a.units);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const share = async () => {
    const text =
      `STOCKSTACK — ${mode === "daily" ? "Daily Run" : "Solo"}\n` +
      `${num(result.score)} pts · ${result.lines} lines · level ${result.level}\n` +
      `${num(result.unitsTotal)} stock units mined` +
      (mined[0] ? ` (top: ${mined[0].ticker} +${num(mined[0].units)})` : "");
    try {
      if (navigator.share) {
        await navigator.share({ title: "StockStack", text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      // A cancelled share sheet is not an error worth reporting.
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center border-2 border-[var(--color-line)] bg-[var(--color-void)]/96 p-3">
      <div className="animate-rise max-h-full w-full max-w-[19rem] overflow-y-auto">
        <div className="text-center">
          <div className="font-display text-base leading-snug text-white">GAME OVER</div>
          <div className="font-display mt-2 text-[7px] text-[var(--color-faint)]">
            {mode === "daily" ? "DAILY RUN" : "SOLO RUN"} · {duration(result.durationMs)}
          </div>
        </div>

        <div className="block-surface mt-4 p-3">
          <div className="text-center">
            <div className="panel-label">Score</div>
            <div className="tabular text-2xl text-white">{num(result.score)}</div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Cell label="Lines" value={num(result.lines)} />
            <Cell label="Level" value={num(result.level)} />
            <Cell label="Pieces" value={num(result.piecesPlaced)} />
          </div>
        </div>

        <div className="block-surface mt-2.5 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="panel-label">Stocks Mined</span>
            <span className="tabular text-xs font-extrabold text-[var(--color-gain)]">
              {num(result.unitsTotal)} units
            </span>
          </div>
          {mined.length === 0 ? (
            <p className="text-[11px] font-semibold text-[var(--color-faint)]">
              No lines cleared — nothing mined this run.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {mined.map((m) => (
                <div key={m.ticker} className="flex items-center gap-2">
                  <span
                    className="h-3.5 w-3.5 shrink-0"
                    style={{
                      background: m.def?.color ?? "#456",
                      boxShadow: `inset 2px 2px 0 ${m.def?.light ?? "#678"}, inset -2px -2px 0 ${m.def?.dark ?? "#234"}`,
                    }}
                  />
                  <span className="tabular flex-1 text-xs font-bold text-white">{m.ticker}</span>
                  <span
                    className="tabular text-xs font-extrabold"
                    style={{ color: m.def?.color ?? "#fff" }}
                  >
                    +{num(m.units)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="block-surface mt-2.5 grid grid-cols-3 divide-x-2 divide-[var(--color-line)]">
          <Cell label="Combo" value={result.maxCombo > 0 ? `x${result.maxCombo}` : "—"} pad />
          <Cell label="4-line" value={num(result.quads)} pad />
          <Cell label="Perfect" value={num(result.perfectClears)} pad />
        </div>

        <SyncNotice sync={sync} retrying={retrying} onRetry={async () => {
          setRetrying(true);
          await onRetrySync();
          setRetrying(false);
        }} />

        <div className="mt-3 flex flex-col gap-2">
          <button className="btn btn-primary w-full py-3 text-sm" onClick={onPlayAgain}>
            Play again
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/portfolio" className="btn btn-ghost w-full py-2.5 text-[11px]">
              Portfolio
            </Link>
            <button className="btn btn-ghost w-full py-2.5 text-[11px]" onClick={share}>
              {copied ? "Copied!" : "Share"}
            </button>
          </div>
          <Link
            href="/lobby"
            className="mt-1 text-center text-[10px] font-bold tracking-widest text-[var(--color-faint)] hover:text-white"
          >
            BACK TO LOBBY
          </Link>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, pad = false }: { label: string; value: string; pad?: boolean }) {
  return (
    <div className={pad ? "px-2 py-2.5 text-center" : ""}>
      <div className="panel-label">{label}</div>
      <div className="tabular text-base font-extrabold text-white">{value}</div>
    </div>
  );
}

/**
 * Says exactly what happened to the run, in the player's terms. "Saved",
 * "not banked because you are a guest", and "we could not reach the server"
 * are three different things and must not look the same.
 */
function SyncNotice({
  sync,
  retrying,
  onRetry,
}: {
  sync: SubmitOutcome | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (!sync) {
    return (
      <div className="block-inset mt-2.5 px-3 py-2 text-[11px] font-semibold text-[var(--color-muted)]">
        Saving your run…
      </div>
    );
  }

  if (sync.status === "saved") {
    return (
      <div className="mt-2.5 border-2 border-[var(--color-gain)] bg-[var(--color-gain)]/12 px-3 py-2.5 text-[11px] font-bold text-[var(--color-gain)]">
        Banked to your stockpile{sync.xpAwarded ? ` · +${num(sync.xpAwarded)} XP` : ""}
      </div>
    );
  }

  if (sync.status === "guest" || sync.status === "offline") {
    return (
      <div className="block-inset mt-2.5 px-3 py-2.5">
        <p className="text-[11px] font-semibold text-[var(--color-muted)]">
          {sync.message ?? "This run was not banked."}
        </p>
        <Link
          href="/signin"
          className="mt-1 inline-block text-[11px] font-extrabold text-[var(--color-gain)] hover:underline"
        >
          Sign in to keep your stockpile →
        </Link>
      </div>
    );
  }

  if (sync.status === "rejected") {
    return (
      <div className="mt-2.5 border-2 border-[var(--color-loss)] bg-[var(--color-loss)]/12 px-3 py-2.5">
        <p className="text-[11px] font-bold text-[var(--color-loss)]">{sync.message}</p>
        {sync.validation && (
          <p className="mt-1 text-[10px] font-semibold text-[var(--color-muted)]">{sync.validation}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2.5 border-2 border-[var(--color-gold)] bg-[var(--color-gold)]/12 px-3 py-2.5">
      <p className="text-[11px] font-bold text-[var(--color-gold)]">
        Your game finished, but rewards couldn&apos;t sync yet.
      </p>
      {sync.message && (
        <p className="mt-0.5 text-[10px] font-semibold text-[var(--color-muted)]">{sync.message}</p>
      )}
      <button
        className="btn btn-ghost mt-2 w-full py-1.5 text-[10px]"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Retrying…" : "Retry sync"}
      </button>
    </div>
  );
}
