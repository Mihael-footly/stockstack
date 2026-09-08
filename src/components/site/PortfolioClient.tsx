"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteNav } from "./SiteNav";
import { MobileTabsSpacer } from "./MobileTabs";
import { useProfile } from "@/lib/useProfile";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { num, relativeTime } from "@/lib/format";
import { RARITY_LABEL, stockByTicker } from "@/game/stocks";
import { track } from "@/lib/analytics";

interface Balance {
  ticker: string;
  units: number;
  games_mined: number;
  best_run: number;
  first_mined_at: string;
}

interface Tx {
  id: string;
  ticker: string;
  amount: number;
  reason: string;
  created_at: string;
}

/**
 * The stockpile.
 *
 * Presented as a game inventory, deliberately not as a brokerage account:
 * no prices, no percentage changes, no currency. Those would be fiction, and
 * the units are game collectibles, which the page says outright.
 */
export function PortfolioClient() {
  const { profile, loading: authLoading } = useProfile();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    track("portfolio_opened");
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      setLoading(false);
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data, error: err } = await supabase
        .from("portfolio_balances")
        .select("ticker, units, games_mined, best_run, first_mined_at")
        .eq("user_id", profile.id)
        .order("units", { ascending: false });

      if (cancelled) return;
      if (err) setError(err.message);
      else setBalances((data as Balance[]) ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [profile, authLoading]);

  useEffect(() => {
    if (!selected || !profile) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let cancelled = false;

    supabase
      .from("portfolio_transactions")
      .select("id, ticker, amount, reason, created_at")
      .eq("user_id", profile.id)
      .eq("ticker", selected)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (!cancelled && data) setTxs(data as Tx[]);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, profile]);

  const totalUnits = balances.reduce((s, b) => s + b.units, 0);
  const bestRun = balances.reduce((m, b) => Math.max(m, b.best_run), 0);
  const max = balances[0]?.units ?? 1;

  return (
    <div className="min-h-dvh">
      <SiteNav />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <span className="panel-label">Portfolio</span>
        <h1 className="font-display mt-1.5 text-sm text-white sm:text-base">YOUR STOCKPILE</h1>

        {!authLoading && !profile ? (
          <EmptyState
            title="SIGN IN TO KEEP YOUR STOCKPILE"
            body="Guest runs are playable in full, but there is no account to bank the units into. Sign in and everything you mine from then on is kept."
            cta={{ href: "/signin", label: "Sign in" }}
          />
        ) : loading || authLoading ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="block-surface h-28 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <EmptyState title="COULDN'T LOAD YOUR PORTFOLIO" body={error} cta={{ href: "/portfolio", label: "Try again" }} />
        ) : balances.length === 0 ? (
          <EmptyState
            title="NOTHING MINED YET"
            body="Clear your first line and the stocks inside it land here."
            cta={{ href: "/play", label: "Play" }}
          />
        ) : (
          <>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <Summary label="Total units" value={num(totalUnits)} />
              <Summary label="Stocks held" value={num(balances.length)} />
              <Summary label="Best single run" value={num(bestRun)} />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {balances.map((b) => {
                const def = stockByTicker(b.ticker);
                const color = def?.color ?? "#8AA0BC";
                const open = selected === b.ticker;
                return (
                  <button
                    key={b.ticker}
                    onClick={() => setSelected(open ? null : b.ticker)}
                    className="block-surface group p-4 text-left transition-transform hover:-translate-y-0.5"
                    style={{ borderColor: open ? color : undefined }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-9 w-9 items-center justify-center  text-[9px] font-extrabold"
                          style={{
                            background: `linear-gradient(160deg, ${def?.light ?? color}, ${color} 50%, ${def?.dark ?? color})`,
                            color: def?.ink ?? "#000",
                          }}
                        >
                          {b.ticker.slice(0, 4)}
                        </span>
                        <div>
                          <div className="text-sm font-extrabold text-white">{b.ticker}</div>
                          <div className="text-[9px] font-extrabold tracking-widest" style={{ color }}>
                            {def ? RARITY_LABEL[def.rarity] : ""}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="tabular text-lg font-extrabold" style={{ color }}>
                          {num(b.units)}
                        </div>
                        <div className="panel-label">units</div>
                      </div>
                    </div>

                    <div className="mt-3 h-1.5 overflow-hidden  bg-[var(--color-slate)]">
                      <div className="h-full " style={{ width: `${(b.units / max) * 100}%`, background: color }} />
                    </div>

                    <div className="mt-2.5 flex justify-between text-[10px] font-bold text-[var(--color-faint)]">
                      <span>MINED IN {b.games_mined} GAMES</span>
                      <span>BEST {num(b.best_run)}</span>
                    </div>

                    {open && (
                      <div className="mt-3 border-t border-[var(--color-line)] pt-3">
                        <div className="panel-label mb-1.5">Recent clears</div>
                        {txs.length === 0 ? (
                          <p className="text-[10px] font-semibold text-[var(--color-faint)]">Loading…</p>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {txs.map((t) => (
                              <div key={t.id} className="flex justify-between text-[10px] font-semibold">
                                <span className="text-[var(--color-muted)]">
                                  {t.reason.replace(/_/g, " ")}
                                </span>
                                <span className="tabular" style={{ color }}>
                                  +{num(t.amount)}
                                </span>
                                <span className="text-[var(--color-faint)]">{relativeTime(t.created_at)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="block-surface mt-8 p-5">
          <div className="panel-label">What these are</div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">
            Stock units are in-game collectibles earned by clearing lines. They are not shares,
            securities, or tokens; they cannot be bought, sold, transferred, or redeemed, and they
            carry no monetary value. Tickers name well-known public companies for flavour only —
            StockStack is not affiliated with any of them, and nothing here is investment advice.
          </p>
          <div className="mt-4 flex items-center gap-2 block-inset px-3 py-2.5">
            <span className="text-[10px] font-extrabold tracking-widest text-[var(--color-faint)]">
              ON-CHAIN BALANCE
            </span>
            <span className="ml-auto text-[10px] font-extrabold tracking-widest text-[var(--color-faint)]">
              NOT CONFIGURED
            </span>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed font-semibold text-[var(--color-faint)]">
            No settlement backend is connected, so there is no on-chain balance and nothing has been
            promised. If one is ever configured it will appear here as a separate ledger — game
            units will not silently become assets.
          </p>
        </div>
      </main>
      <MobileTabsSpacer />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="block-surface px-4 py-3">
      <div className="panel-label">{label}</div>
      <div className="tabular mt-0.5 text-2xl font-extrabold text-white">{value}</div>
    </div>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="block-surface mt-8 p-10 text-center">
      <div className="font-display text-base text-white">{title}</div>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>
      <Link href={cta.href} className="btn btn-primary mt-6 px-8 py-3 text-xs">
        {cta.label}
      </Link>
    </div>
  );
}
