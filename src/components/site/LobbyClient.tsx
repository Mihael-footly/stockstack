"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteNav } from "./SiteNav";
import { MobileTabsSpacer } from "./MobileTabs";
import { MarketStrip } from "./MarketStrip";
import { useProfile, xpForLevel } from "@/lib/useProfile";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { compact, num, relativeTime } from "@/lib/format";
import { stockByTicker } from "@/game/stocks";

interface RecentGame {
  id: string;
  score: number;
  lines: number;
  level: number;
  mode: string;
  created_at: string;
}

interface Balance {
  ticker: string;
  units: number;
}

interface LeaderRow {
  username: string;
  score: number;
}

/**
 * The lobby: where a signed-in player lands.
 *
 * Everything here degrades rather than fails. A guest sees the same screen
 * with the personal panels replaced by a reason to sign in, and a backend that
 * is down costs the panels, not the Play button.
 */
export function LobbyClient() {
  const { profile, loading, configured } = useProfile();
  const [recent, setRecent] = useState<RecentGame[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [dailyDone, setDailyDone] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let cancelled = false;

    supabase
      .from("leaderboard_today")
      .select("username, score")
      .order("score", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (!cancelled && data) setLeaders(data as LeaderRow[]);
      });

    if (!profile) return;

    supabase
      .from("game_results")
      .select("id, score, lines, level, mode, created_at")
      .eq("user_id", profile.id)
      .eq("validation_status", "valid")
      .order("created_at", { ascending: false })
      .limit(4)
      .then(({ data }) => {
        if (!cancelled && data) setRecent(data as RecentGame[]);
      });

    supabase
      .from("portfolio_balances")
      .select("ticker, units")
      .eq("user_id", profile.id)
      .order("units", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (!cancelled && data) setBalances(data as Balance[]);
      });

    supabase
      .from("game_results")
      .select("id")
      .eq("user_id", profile.id)
      .eq("mode", "daily")
      .eq("market_date", new Date().toISOString().slice(0, 10))
      .then(({ data }) => {
        if (!cancelled) setDailyDone((data?.length ?? 0) > 0);
      });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  const need = profile ? xpForLevel(profile.level) : 0;
  const pct = profile ? Math.min(100, (profile.xp / need) * 100) : 0;

  return (
    <div className="min-h-dvh">
      <SiteNav cta={false} />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[240px_1fr_260px]">
          {/* Left: identity and progression */}
          <aside className="flex flex-col gap-3">
            <div className="block-surface p-5">
              {loading ? (
                <div className="h-24 animate-pulse  bg-[var(--color-slate)]/50" />
              ) : profile ? (
                <>
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-12 w-12 items-center justify-center  font-display text-xs"
                      style={{ background: "linear-gradient(150deg, var(--color-gain), var(--color-sky))", color: "#04140C" }}
                    >
                      {profile.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-white">@{profile.username}</div>
                      <div className="text-[10px] font-extrabold tracking-widest text-[var(--color-faint)]">
                        LEVEL {profile.level}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="panel-label">XP</span>
                      <span className="tabular text-[10px] font-bold text-[var(--color-muted)]">
                        {num(profile.xp)} / {num(need)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden  bg-[var(--color-slate)]">
                      <div
                        className="h-full  transition-[width] duration-500"
                        style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--color-gain-dim), var(--color-gain))" }}
                      />
                    </div>
                  </div>
                  <Link
                    href={`/player/${profile.username}`}
                    className="mt-4 block text-center text-[10px] font-extrabold tracking-widest text-[var(--color-faint)] hover:text-white"
                  >
                    VIEW PROFILE
                  </Link>
                </>
              ) : (
                <>
                  <div className="font-display text-xs text-white">PLAYING AS GUEST</div>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">
                    You can play everything solo right now. Sign in to keep your stockpile, earn XP,
                    and enter the leaderboards.
                  </p>
                  <Link href="/signin" className="btn btn-primary mt-4 w-full py-2.5 text-[11px]">
                    Sign in
                  </Link>
                  {!configured && (
                    <p className="mt-3 text-[10px] font-semibold text-[var(--color-loss)]">
                      Backend not configured — progress cannot be saved.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="block-surface p-4">
              <div className="panel-label mb-3">Controls</div>
              <div className="flex flex-col gap-2">
                {[
                  { keys: ["←", "→"], what: "Move" },
                  { keys: ["↓"], what: "Soft drop" },
                  { keys: ["Space"], what: "Hard drop" },
                  { keys: ["Z", "X"], what: "Rotate" },
                  { keys: ["C"], what: "Hold" },
                  { keys: ["P"], what: "Pause" },
                ].map((row) => (
                  <div key={row.what} className="flex items-center justify-between gap-2">
                    <span className="flex gap-1">
                      {row.keys.map((k) => (
                        <kbd
                          key={k}
                          className="border-2 border-[var(--color-line)] bg-[var(--color-slate)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
                          style={{ boxShadow: "inset 2px 2px 0 rgba(120,175,235,0.16), inset -2px -2px 0 rgba(0,0,0,0.5)" }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-[11px] font-semibold text-[var(--color-faint)]">{row.what}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 border-t-2 border-[var(--color-line)] pt-2.5 text-[10px] leading-relaxed font-semibold text-[var(--color-faint)]">
                On a phone: swipe to move, tap to rotate, flick down to drop — or use the buttons.
              </p>
            </div>

            {balances.length > 0 && (
              <div className="block-surface p-4">
                <div className="panel-label mb-2.5">Stockpile</div>
                <div className="flex flex-col gap-1.5">
                  {balances.map((b) => {
                    const def = stockByTicker(b.ticker);
                    return (
                      <div key={b.ticker} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: def?.color ?? "#456" }} />
                        <span className="tabular flex-1 text-[11px] font-bold text-white">{b.ticker}</span>
                        <span className="tabular text-[11px] font-extrabold" style={{ color: def?.color }}>
                          {compact(b.units)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <Link href="/portfolio" className="mt-3 block text-center text-[10px] font-extrabold tracking-widest text-[var(--color-faint)] hover:text-white">
                  FULL PORTFOLIO
                </Link>
              </div>
            )}
          </aside>

          {/* Centre: the reason you are here */}
          <section className="flex flex-col gap-3">
            <div className="block-surface relative overflow-hidden p-8 text-center">
              <div
                className="pointer-events-none absolute inset-0 opacity-60"
                style={{ background: "radial-gradient(ellipse at 50% 120%, rgba(25,242,138,0.2), transparent 65%)" }}
              />
              <div className="relative">
                <span className="panel-label">Solo</span>
                <h1 className="font-display mt-1.5 text-sm text-white sm:text-base">STACK THE MARKET</h1>
                <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--color-muted)]">
                  Clear lines, mine the tickers inside them, and build your stockpile.
                </p>
                <Link href="/play" className="btn btn-primary mt-6 px-12 py-4 text-base">
                  Play
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ModeCard
                title="DAILY RUN"
                body="Same seed, same market, one attempt. Everyone plays the identical board."
                href="/play?mode=daily"
                cta={dailyDone ? "Already played today" : profile ? "Take today's run" : "Sign in to play"}
                disabled={dailyDone || !profile}
                accent="var(--color-gold)"
              />
              <ModeCard
                title="1V1"
                body="Two boards, one seed. Clear big to send garbage across and outlast your opponent."
                href="#"
                cta="In development"
                disabled
                accent="var(--color-sky)"
              />
            </div>

            {recent.length > 0 && (
              <div className="block-surface p-4">
                <div className="panel-label mb-2.5">Recent games</div>
                <div className="flex flex-col gap-1.5">
                  {recent.map((g) => (
                    <div key={g.id} className="flex items-center gap-3 block-inset px-3 py-2">
                      <span
                        className=" px-1.5 py-0.5 text-[9px] font-extrabold tracking-widest"
                        style={{
                          color: g.mode === "daily" ? "var(--color-gold)" : "var(--color-muted)",
                          border: `1px solid ${g.mode === "daily" ? "var(--color-gold)" : "var(--color-line)"}44`,
                        }}
                      >
                        {g.mode.toUpperCase()}
                      </span>
                      <span className="tabular flex-1 text-xs font-extrabold text-white">{num(g.score)}</span>
                      <span className="tabular text-[10px] font-bold text-[var(--color-muted)]">{g.lines} lines</span>
                      <span className="text-[10px] font-semibold text-[var(--color-faint)]">{relativeTime(g.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Right: today's market and the board */}
          <aside className="flex flex-col gap-3">
            <MarketStrip />
            <div className="block-surface p-4">
              <div className="mb-2.5 flex items-baseline justify-between">
                <span className="panel-label">Today</span>
                <Link href="/leaderboard" className="text-[10px] font-extrabold tracking-widest text-[var(--color-faint)] hover:text-white">
                  ALL
                </Link>
              </div>
              {leaders.length === 0 ? (
                <p className="text-[11px] font-semibold text-[var(--color-faint)]">
                  No runs today yet. First score sets the bar.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {leaders.map((l, i) => (
                    <div key={l.username} className="flex items-center gap-2.5">
                      <span
                        className="tabular w-4 text-[10px] font-extrabold"
                        style={{ color: i === 0 ? "var(--color-gold)" : "var(--color-faint)" }}
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-[11px] font-bold text-white">@{l.username}</span>
                      <span className="tabular text-[11px] font-extrabold text-[var(--color-muted)]">{compact(l.score)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
      <MobileTabsSpacer />
    </div>
  );
}

function ModeCard({
  title,
  body,
  href,
  cta,
  disabled = false,
  accent,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  disabled?: boolean;
  accent: string;
}) {
  const inner = (
    <div
      className={`panel h-full p-5 transition-transform ${disabled ? "opacity-60" : "hover:-translate-y-0.5"}`}
      style={{ borderColor: `${accent}33` }}
    >
      <div className="font-display text-sm" style={{ color: accent }}>
        {title}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">{body}</p>
      <div className="mt-4 text-[10px] font-extrabold tracking-widest" style={{ color: disabled ? "var(--color-faint)" : accent }}>
        {cta.toUpperCase()} {!disabled && "→"}
      </div>
    </div>
  );
  return disabled ? <div>{inner}</div> : <Link href={href}>{inner}</Link>;
}
