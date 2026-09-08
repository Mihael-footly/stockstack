import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site/SiteNav";
import { MobileTabsSpacer } from "@/components/site/MobileTabs";
import { getSupabaseServer } from "@/lib/supabase/server";
import { num, relativeTime } from "@/lib/format";
import { stockByTicker } from "@/game/stocks";

export const dynamic = "force-dynamic";

interface Stats {
  user_id: string;
  username: string;
  display_name: string | null;
  level: number;
  xp: number;
  created_at: string;
  total_games: number;
  best_score: number;
  total_lines: number;
  best_combo: number;
  total_quads: number;
  total_perfect_clears: number;
  total_units_mined: number;
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await getSupabaseServer();

  if (!supabase) {
    return <Unavailable message="The backend is not configured, so profiles cannot be loaded." />;
  }

  const { data: stats } = await supabase
    .from("player_stats")
    .select("*")
    .eq("username", username)
    .maybeSingle<Stats>();

  if (!stats) notFound();

  const { data: recent } = await supabase
    .from("game_results")
    .select("id, score, lines, level, mode, max_combo, stock_units, created_at")
    .eq("user_id", stats.user_id)
    .eq("validation_status", "valid")
    .order("created_at", { ascending: false })
    .limit(8);

  // Favourite stocks are derived from the player's own public results, since
  // balances are private to their owner.
  const tally = new Map<string, number>();
  for (const g of recent ?? []) {
    for (const [ticker, units] of Object.entries((g.stock_units ?? {}) as Record<string, number>)) {
      tally.set(ticker, (tally.get(ticker) ?? 0) + units);
    }
  }
  const favourites = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="min-h-dvh">
      <SiteNav />

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex items-center gap-4">
          <div
            className="font-display flex h-16 w-16 items-center justify-center  text-sm"
            style={{ background: "linear-gradient(150deg, var(--color-gain), var(--color-sky))", color: "#04140C" }}
          >
            {stats.username.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="font-display text-xs text-white sm:text-sm">@{stats.username}</h1>
            <div className="mt-1 text-[11px] font-extrabold tracking-widest text-[var(--color-faint)]">
              LEVEL {stats.level} · JOINED {new Date(stats.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
            </div>
          </div>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Games" value={num(stats.total_games)} />
          <Stat label="Best score" value={num(stats.best_score)} accent="var(--color-gain)" />
          <Stat label="Total lines" value={num(stats.total_lines)} />
          <Stat label="Best combo" value={stats.best_combo > 0 ? `x${stats.best_combo}` : "—"} accent="var(--color-gold)" />
          <Stat label="4-line clears" value={num(stats.total_quads)} />
          <Stat label="Units mined" value={num(stats.total_units_mined)} accent="var(--color-gain)" />
        </div>

        {favourites.length > 0 && (
          <div className="block-surface mt-4 p-5">
            <div className="panel-label">Most mined recently</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {favourites.map(([ticker, units]) => {
                const def = stockByTicker(ticker);
                const color = def?.color ?? "#8AA0BC";
                return (
                  <span
                    key={ticker}
                    className="tabular  border px-3 py-1.5 text-xs font-extrabold"
                    style={{ borderColor: `${color}44`, color, background: `${color}12` }}
                  >
                    {ticker} · {num(units)}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="block-surface mt-4 overflow-hidden">
          <div className="border-b border-[var(--color-line)] px-5 py-3">
            <span className="panel-label">Recent games</span>
          </div>
          {(recent?.length ?? 0) === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-[var(--color-muted)]">
              No validated runs yet.
            </p>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {recent!.map((g) => (
                <div key={g.id} className="flex items-center gap-3 px-5 py-3">
                  <span
                    className=" px-1.5 py-0.5 text-[9px] font-extrabold tracking-widest"
                    style={{
                      color: g.mode === "daily" ? "var(--color-gold)" : "var(--color-muted)",
                      border: `1px solid ${g.mode === "daily" ? "var(--color-gold)" : "var(--color-line)"}44`,
                    }}
                  >
                    {String(g.mode).toUpperCase()}
                  </span>
                  <span className="tabular flex-1 text-sm font-extrabold text-white">{num(g.score)}</span>
                  <span className="tabular text-xs font-bold text-[var(--color-muted)]">{g.lines} lines</span>
                  <span className="tabular hidden text-xs font-bold text-[var(--color-muted)] sm:block">
                    lvl {g.level}
                  </span>
                  <span className="text-[10px] font-semibold text-[var(--color-faint)]">
                    {relativeTime(g.created_at as string)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Link href="/leaderboard" className="btn btn-ghost mt-6 px-6 py-3 text-xs">
          Back to the leaderboard
        </Link>
      </main>
      <MobileTabsSpacer />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="block-surface px-4 py-3">
      <div className="panel-label">{label}</div>
      <div className="tabular mt-0.5 text-xl font-extrabold" style={{ color: accent ?? "#fff" }}>
        {value}
      </div>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="min-h-dvh">
      <SiteNav />
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="font-display text-base text-white">PROFILE UNAVAILABLE</div>
        <p className="mt-3 text-sm text-[var(--color-muted)]">{message}</p>
      </main>
    </div>
  );
}
