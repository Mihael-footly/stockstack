"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteNav } from "./SiteNav";
import { MobileTabsSpacer } from "./MobileTabs";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { num, relativeTime } from "@/lib/format";
import { track } from "@/lib/analytics";

const TABS = [
  { id: "leaderboard_today", label: "TODAY" },
  { id: "leaderboard_week", label: "WEEK" },
  { id: "leaderboard_all_time", label: "ALL TIME" },
  { id: "leaderboard_daily", label: "DAILY RUN" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface Row {
  id: string;
  username: string;
  score: number;
  lines: number;
  level: number;
  player_level: number;
  max_combo: number;
  stock_units_total: number;
  created_at: string;
}

export function LeaderboardClient() {
  const [tab, setTab] = useState<TabId>("leaderboard_today");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    track("leaderboard_opened");
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Backend not configured.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from(tab)
      .select("id, username, score, lines, level, player_level, max_combo, stock_units_total, created_at")
      .order("score", { ascending: false })
      .limit(50)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
        else setRows((data as Row[]) ?? []);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab]);

  return (
    <div className="min-h-dvh">
      <SiteNav />

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <span className="panel-label">Leaderboard</span>
        <h1 className="font-display mt-1.5 text-sm text-white sm:text-base">THE BOARD</h1>
        <p className="mt-3 max-w-lg text-sm text-[var(--color-muted)]">
          Only runs that passed server validation appear here. Today and Week show each player&apos;s
          best single run.
        </p>

        <div className="mt-6 flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="shrink-0  border px-4 py-2 text-[10px] font-extrabold tracking-widest transition-colors"
              style={
                tab === t.id
                  ? { borderColor: "var(--color-gain)", color: "var(--color-gain)", background: "rgba(25,242,138,0.08)" }
                  : { borderColor: "var(--color-line)", color: "var(--color-muted)" }
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="block-surface mt-4 overflow-hidden">
          {loading ? (
            <div className="flex flex-col gap-px">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-14 animate-pulse bg-[var(--color-slate)]/40" />
              ))}
            </div>
          ) : error ? (
            <div className="p-10 text-center">
              <div className="font-display text-sm text-[var(--color-loss)]">COULDN&apos;T LOAD THE BOARD</div>
              <p className="mt-2 text-sm text-[var(--color-muted)]">{error}</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <div className="font-display text-sm text-white">NO RUNS YET</div>
              <p className="mx-auto mt-2 max-w-xs text-sm text-[var(--color-muted)]">
                This board is empty. The first validated run sets the bar.
              </p>
              <Link href="/play" className="btn btn-primary mt-5 px-7 py-2.5 text-xs">
                Play
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              <div className="hidden grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem] gap-2 px-4 py-2.5 sm:grid">
                {["#", "PLAYER", "SCORE", "LINES", "COMBO", "UNITS"].map((h) => (
                  <span key={h} className="panel-label">
                    {h}
                  </span>
                ))}
              </div>
              {rows.map((r, i) => (
                <Link
                  key={r.id}
                  href={`/player/${r.username}`}
                  className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 px-4 py-3 transition-colors hover:bg-[var(--color-slate)]/40 sm:grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem]"
                >
                  <span
                    className="tabular text-sm font-extrabold"
                    style={{ color: i === 0 ? "var(--color-gold)" : i < 3 ? "var(--color-sky)" : "var(--color-faint)" }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-white">@{r.username}</div>
                    <div className="text-[10px] font-semibold text-[var(--color-faint)]">
                      LVL {r.player_level} · {relativeTime(r.created_at)}
                    </div>
                  </div>
                  <span className="tabular text-right text-sm font-extrabold text-white sm:text-left">
                    {num(r.score)}
                  </span>
                  <span className="tabular hidden text-xs font-bold text-[var(--color-muted)] sm:block">{r.lines}</span>
                  <span className="tabular hidden text-xs font-bold text-[var(--color-muted)] sm:block">
                    {r.max_combo > 0 ? `x${r.max_combo}` : "—"}
                  </span>
                  <span className="tabular hidden text-xs font-bold text-[var(--color-gain)] sm:block">
                    {num(r.stock_units_total)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <MobileTabsSpacer />
    </div>
  );
}
