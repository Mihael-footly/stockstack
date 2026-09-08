import Link from "next/link";
import { AttractBoard } from "@/components/site/AttractBoard";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { MobileTabsSpacer } from "@/components/site/MobileTabs";
import { Ticker } from "@/components/site/Ticker";
import { HeroBackdrop } from "@/components/site/HeroBackdrop";
import { BlockWordmark } from "@/components/site/BlockWordmark";
import { MarketStrip } from "@/components/site/MarketStrip";
import { RARITY_LABEL, STOCK_CATALOG } from "@/game/stocks";
import { REWARD } from "@/game/config";

export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      <SiteNav />

      {/* ---------------------------------------------------------------- 1. Hero */}
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:pt-20 lg:pb-24">
          <div>
            <span className="block-surface inline-flex items-center gap-2 px-3 py-2">
              <span className="animate-pulse-glow h-2 w-2 bg-[var(--color-gain)]" />
              <span className="font-display text-[8px] text-[var(--color-muted)]">
                FREE TO PLAY · NO DOWNLOAD
              </span>
            </span>

            <h1 className="sr-only">StockStack — Stack the Market</h1>

            {/* The wordmark is built from the game's own blocks, not set in a font. */}
            <BlockWordmark
              lines={["STOCK", "STACK"]}
              cell={11}
              gap={2}
              className="mt-6 hidden lg:block"
            />
            <BlockWordmark
              lines={["STOCK", "STACK"]}
              cell={8}
              gap={2}
              className="mt-5 hidden sm:block lg:hidden"
            />
            <BlockWordmark
              lines={["STOCK", "STACK"]}
              cell={6}
              gap={2}
              className="mt-5 sm:hidden"
            />

            <p className="font-display mt-6 text-base text-[var(--color-gain)] sm:text-sm">
              STACK THE MARKET.
            </p>

            <p className="text-balance mt-5 max-w-md text-[15px] leading-relaxed text-[var(--color-muted)]">
              Every falling block is a stock. Stack them, clear the lines, and every ticker
              inside a cleared row goes into your stockpile. Bigger clears pay more.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/play" className="btn btn-primary px-8 py-4 text-xs sm:text-sm">
                Play now
              </Link>
              <a href="#how" className="btn btn-ghost px-6 py-4 text-[10px] sm:text-xs">
                How it works
              </a>
            </div>

            <p className="mt-5 font-display text-[8px] leading-relaxed text-[var(--color-faint)]">
              Plays instantly in your browser · no account needed
            </p>
          </div>

          <div className="lg:pl-4">
            <AttractBoard />
          </div>
        </div>
      </section>

      <Ticker />

      {/* ------------------------------------------------------- 2. How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <SectionHead
          eyebrow="How it works"
          title="FOUR STEPS."
          blurb="If you have played a block-stacker, you already know three of them."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Step n="01" title="STACK" body="Seven piece shapes fall. Move, rotate, and place them to build complete rows." />
          <Step n="02" title="CLEAR" body="Fill a row all the way across and it clears, exactly as you would expect." color="var(--color-sky)" />
          <Step n="03" title="COLLECT" body="Every block in that row is a stock. Clear it and those tickers go into your stockpile." color="var(--color-gain)" />
          <Step n="04" title="BUILD" body="Stack a portfolio across runs, climb the leaderboard, and take the Daily Run." color="var(--color-gold)" />
        </div>
      </section>

      {/* --------------------------------------------------------- 3. The blocks */}
      <section className="border-y border-[var(--color-line)] bg-[var(--color-deep)]/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHead
            eyebrow="Stock blocks"
            title="EVERY BLOCK IS PART OF THE MARKET."
            blurb="Each piece is dealt a ticker from the day's market. The ticker travels with the block: it is still there when the block is buried, and it is what pays out when the row finally clears."
          />

          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {STOCK_CATALOG.slice(0, 12).map((s) => (
              <div
                key={s.ticker}
                className="block-surface p-3 transition-transform hover:-translate-y-1"
                style={{ borderColor: s.color }}
              >
                {/* The block exactly as it appears on the board. */}
                <div
                  className="flex h-12 w-12 items-center justify-center text-[10px] font-extrabold"
                  style={{
                    background: s.color,
                    color: s.ink,
                    boxShadow: `inset 4px 4px 0 ${s.light}, inset -4px -4px 0 ${s.dark}`,
                  }}
                >
                  {s.ticker}
                </div>
                <div className="mt-3 text-xs font-bold text-white">{s.name}</div>
                <div className="font-display mt-1 text-[7px]" style={{ color: s.color }}>
                  {RARITY_LABEL[s.rarity]}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-5 text-[11px] font-semibold text-[var(--color-faint)]">
            Rarity is how often a ticker shows up in the piece stream. It is a game spawn rate — not
            an investment rating, and not a statement about any company.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- 4. Today's market */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <SectionHead
              eyebrow="Daily market"
              title="THE MARKET ROLLS OVER EVERY DAY."
              blurb="Seven tickers are in play at a time, chosen by the server from the date alone. Everyone plays the same market on the same day, so the Daily Run is a fair fight."
            />
            <Link href="/play?mode=daily" className="btn btn-ghost mt-7 px-6 py-3 text-xs">
              Take the Daily Run
            </Link>
          </div>
          <MarketStrip />
        </div>
      </section>

      {/* ------------------------------------------------------------ 5. Combos */}
      <section className="border-y border-[var(--color-line)] bg-[var(--color-deep)]/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHead
            eyebrow="Combos & events"
            title="CLEAR BIGGER. EARN MORE."
            blurb="A single line pays for itself. Everything past that multiplies."
          />

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MultCard label="Double" value={`${REWARD.linesMultiplier[2]}x`} body="Two rows at once." />
            <MultCard label="Triple" value={`${REWARD.linesMultiplier[3]}x`} body="Three rows at once." color="var(--color-sky)" />
            <MultCard label="Four-line" value={`${REWARD.linesMultiplier[4]}x`} body="The big one. Sets up back-to-back." color="var(--color-gain)" />
            <MultCard label="Perfect clear" value={`${REWARD.perfectClearMultiplier}x`} body="Empty the whole board. Market wipeout." color="var(--color-gold)" />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <EventCard
              title="MARKET PUMP"
              value="1.5x for 8 pieces"
              body="Chain clears to fill the momentum meter. Fill it and the next eight pieces pay half again as much."
              color="var(--color-gain)"
            />
            <EventCard
              title="BULL RUN"
              value="2x for 15 seconds"
              body="Reach a five-combo or three back-to-back four-line clears. Gravity tightens, rewards double."
              color="var(--color-gold)"
            />
          </div>

          <p className="mt-5 text-[11px] font-semibold text-[var(--color-faint)]">
            Both events are earned by playing. Nothing in StockStack is random-drop or purchasable.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------------- 6. Portfolio */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHead
              eyebrow="Portfolio"
              title="BUILD YOUR STOCKPILE."
              blurb="Units carry across every run. Your portfolio remembers which stocks you have mined, how many games each came from, and your best single run for each."
            />
            <Link href="/portfolio" className="btn btn-ghost mt-7 px-6 py-3 text-xs">
              View portfolio
            </Link>
          </div>

          <div className="block-surface p-5">
            <div className="flex items-baseline justify-between">
              <span className="panel-label">Your stockpile</span>
              <span className="text-[10px] font-extrabold tracking-widest text-[var(--color-faint)]">EXAMPLE</span>
            </div>
            <div className="mt-4 flex flex-col gap-2.5">
              {[
                { t: "NVDA", u: 2410, c: "#19F28A", pct: 100 },
                { t: "HOOD", u: 1820, c: "#C6F24E", pct: 75 },
                { t: "AAPL", u: 1440, c: "#E8EDF4", pct: 60 },
                { t: "META", u: 620, c: "#43A5FF", pct: 26 },
              ].map((r) => (
                <div key={r.t} className="flex items-center gap-3">
                  <span className="tabular w-14 text-xs" style={{ color: r.c }}>{r.t}</span>
                  <div className="flex flex-1 gap-[3px]">
                    {Array.from({ length: 14 }, (_, i) => (
                      <span
                        key={i}
                        className="h-3 flex-1"
                        style={{
                          background: i < Math.round((r.pct / 100) * 14) ? r.c : "var(--color-slate)",
                          boxShadow:
                            i < Math.round((r.pct / 100) * 14)
                              ? "inset 1px 1px 0 rgba(255,255,255,0.4), inset -1px -1px 0 rgba(0,0,0,0.35)"
                              : "inset 1px 1px 0 rgba(0,0,0,0.5)",
                        }}
                      />
                    ))}
                  </div>
                  <span className="tabular w-16 text-right text-xs text-white">{r.u.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-[10px] leading-relaxed font-semibold text-[var(--color-faint)]">
              Stock units are in-game collectibles. They are not shares and hold no monetary value.
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------- 7 & 8. Daily run and 1v1 */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="block-surface p-7">
            <span className="panel-label">Daily Run</span>
            <h3 className="font-display mt-3 text-sm leading-snug text-white">SAME BOARD.<br />ONE SHOT.</h3>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
              One seed, one market, one attempt per player per day. Every piece arrives in the same
              order for everyone, so the only variable left is how you play it.
            </p>
            <div className="mt-5 flex flex-col gap-1.5">
              {[
                { r: 1, n: "angel", s: "282,400" },
                { r: 2, n: "mihael", s: "268,100" },
                { r: 3, n: "alex", s: "241,200" },
              ].map((x) => (
                <div key={x.r} className="block-inset flex items-center gap-3 px-3 py-2">
                  <span
                    className="font-display flex h-5 w-5 items-center justify-center text-[8px]"
                    style={{
                      background: x.r === 1 ? "var(--color-gold)" : "var(--color-slate)",
                      color: x.r === 1 ? "#241B00" : "var(--color-muted)",
                    }}
                  >
                    {x.r}
                  </span>
                  <span className="flex-1 text-xs font-bold text-white">@{x.n}</span>
                  <span className="tabular text-xs text-[var(--color-muted)]">{x.s}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] font-semibold text-[var(--color-faint)]">
              Example board — today&apos;s standings are on the leaderboard.
            </p>
          </div>

          <div className="block-surface bg-grid-fine relative overflow-hidden p-7">
            <span className="panel-label">1v1</span>
            <h3 className="font-display mt-3 text-sm leading-snug text-white">OUT-STACK<br />THE MARKET.</h3>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
              Two players, one seed, simultaneous boards. Clear multiple rows and you send garbage
              across; outlast your opponent and take a bonus on everything you mined.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["Double → 1 line", "Triple → 2", "Four-line → 4", "Perfect → 8"].map((x) => (
                <span key={x} className="block-inset px-2.5 py-2 font-display text-[7px] text-[var(--color-muted)]">
                  {x}
                </span>
              ))}
            </div>
            <div
              className="font-display mt-6 inline-block px-3 py-2 text-[8px]"
              style={{
                background: "var(--color-gold)",
                color: "#241B00",
                boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.45), inset -2px -2px 0 rgba(0,0,0,0.3)",
              }}
            >
              IN DEVELOPMENT
            </div>
            <p className="mt-2 text-[11px] font-semibold text-[var(--color-faint)]">
              Solo and the Daily Run are live now. Versus arrives once they are perfect.
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- 9. Final CTA */}
      <section className="relative overflow-hidden border-t border-[var(--color-line)]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 120%, rgba(25,242,138,0.18), transparent 62%)" }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
          <h2 className="font-display text-base leading-tight text-white sm:text-sm">READY?</h2>
          <p className="mt-4 text-[15px] text-[var(--color-muted)]">
            Stack stock blocks, clear lines, and build your market.
          </p>
          <Link href="/play" className="btn btn-primary mt-8 px-10 py-4 text-xs sm:text-sm">
            Play StockStack
          </Link>
        </div>
      </section>

      <SiteFooter />
      <MobileTabsSpacer />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SectionHead({ eyebrow, title, blurb }: { eyebrow: string; title: string; blurb?: string }) {
  return (
    <div className="max-w-2xl">
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-3 bg-[var(--color-gain)]" />
        <span className="panel-label">{eyebrow}</span>
      </span>
      <h2 className="font-display mt-3 text-xs leading-snug text-white sm:text-base">{title}</h2>
      {blurb && <p className="text-balance mt-4 text-[15px] leading-relaxed text-[var(--color-muted)]">{blurb}</p>}
    </div>
  );
}

function Step({ n, title, body, color = "var(--color-muted)" }: { n: string; title: string; body: string; color?: string }) {
  return (
    <div className="block-surface p-5 transition-transform hover:-translate-y-1">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center font-display text-[9px]"
          style={{
            background: color,
            color: "#04121F",
            boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.45), inset -2px -2px 0 rgba(0,0,0,0.35)",
          }}
        >
          {n}
        </span>
        <h3 className="font-display text-xs text-white">{title}</h3>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">{body}</p>
    </div>
  );
}

function MultCard({ label, value, body, color = "var(--color-muted)" }: { label: string; value: string; body: string; color?: string }) {
  return (
    <div className="block-surface p-5">
      <span className="panel-label">{label}</span>
      <div
        className="font-display mt-2 inline-block px-2.5 py-1.5 text-sm"
        style={{
          background: color,
          color: "#04121F",
          boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.45), inset -2px -2px 0 rgba(0,0,0,0.35)",
        }}
      >
        {value}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-muted)]">{body}</p>
    </div>
  );
}

function EventCard({ title, value, body, color }: { title: string; value: string; body: string; color: string }) {
  return (
    <div className="block-surface bg-grid-fine relative overflow-hidden p-5" style={{ borderColor: color }}>
      <div className="relative">
        <div className="font-display text-sm" style={{ color }}>{title}</div>
        <div className="tabular mt-2 text-sm text-white">{value}</div>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">{body}</p>
      </div>
      {/* A row of the piece's colour along the foot, like a filled line. */}
      <div className="mt-4 flex gap-1">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="h-2 flex-1" style={{ background: color, opacity: i < 6 ? 0.9 : 0.22 }} />
        ))}
      </div>
    </div>
  );
}
