"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/site/SiteNav";
import { GameLoop } from "@/game/GameLoop";
import { AutoPlayer } from "@/game/AutoPlayer";
import type { GameMode, GameResultSummary, GameSnapshot, InputAction } from "@/game/types";
import type { StockDef } from "@/game/stocks";
import { startSession, submitResult, type StartedSession, type SubmitOutcome } from "@/lib/session";
import { track, trackOnce, resetOnceFlags } from "@/lib/analytics";
import {
  ComboPanel,
  EventPanel,
  HoldPanel,
  MinedPanel,
  NextPanel,
  StatsPanel,
} from "./HudPanels";
import { TouchControls } from "./TouchControls";
import { ResultCard } from "./ResultCard";
import { num } from "@/lib/format";

type Screen = "loading" | "ready" | "playing" | "over" | "failed";

/**
 * The play experience.
 *
 * This component owns lifecycle and layout and nothing else. The simulation
 * lives in GameLoop, outside React entirely, and reports back through a
 * throttled snapshot — so the HUD re-renders about fifteen times a second
 * while the board draws at the display's full rate.
 */
export function GameScreen({ mode }: { mode: GameMode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loopRef = useRef<GameLoop | null>(null);

  const [screen, setScreen] = useState<Screen>("loading");
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [session, setSession] = useState<StartedSession | null>(null);
  const [stocks, setStocks] = useState<readonly StockDef[]>([]);
  const [result, setResult] = useState<GameResultSummary | null>(null);
  const [sync, setSync] = useState<SubmitOutcome | null>(null);
  const [fps, setFps] = useState(60);
  const [initError, setInitError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [runKey, setRunKey] = useState(0);

  // --- session ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setScreen("loading");
    // Dropping the old session tears down the old loop before a new one is
    // built, so a restart can never leave two loops drawing to one canvas.
    setSession(null);
    startSession(mode).then((s) => {
      if (cancelled) return;
      setSession(s);
      setStocks(s.stocks);
      setScreen("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [mode, runKey]);

  // --- the loop -----------------------------------------------------------
  // Keyed to the session and nothing else. `screen` must stay out of this
  // dependency list: it changes the moment play begins, and tearing the loop
  // down on that change would dispose the game as it started.
  useEffect(() => {
    if (!session || !canvasRef.current) return;

    let loop: GameLoop;
    try {
      loop = new GameLoop(
        { seed: session.seed, mode, stocks: session.stocks },
        {
          onSnapshot: setSnapshot,
          onFps: (f) => {
            setFps(f);
            if (f < 40) trackOnce("low_fps", { fps: f });
          },
          onClear: (ev) => {
            trackOnce("first_line_clear");
            if (ev.lineCount >= 4) track("four_line_clear", { combo: ev.combo });
          },
          onGameOver: () => {
            const r = loop.engine.result();
            setResult(r);
            setScreen("over");
            track("game_over", { score: r.score, lines: r.lines, level: r.level });
            if (mode === "daily") track("daily_run_finished", { score: r.score });
            void submitResult(session.id, r).then(setSync);
          },
        },
      );
    } catch (err) {
      setInitError(err instanceof Error ? err.message : "The game could not start.");
      setScreen("failed");
      track("game_init_failed");
      return;
    }

    loopRef.current = loop;
    loop.attachCanvas(canvasRef.current);
    loop.attachInput(containerRef.current ?? undefined);
    setMuted(loop.audio.settings.muted);

    // Size the board to whatever room the layout gives it.
    const fit = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      loop.resize(rect.width, rect.height);
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (containerRef.current) observer.observe(containerRef.current);

    // A tab that loses focus mid-game should pause, not keep dropping pieces.
    const onVisibility = () => {
      if (document.hidden && loop.engine.phase === "playing") {
        loop.pause();
        setPaused(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    loop.pushSnapshot();
    // Paint one frame now so the empty board is visible behind the READY
    // overlay rather than appearing only once the first piece falls.
    loop.view?.draw();

    // A window onto the running simulation, for the end-to-end test.
    //
    // Development only. It reads state and can drive the bot; neither can
    // forge a result, because the server validates every submission
    // regardless — but a debug surface still has no business shipping.
    let botRaf = 0;
    if (process.env.NODE_ENV !== "production") {
      const engine = loop.engine;
      const countOccupied = () => {
        let n = 0;
        for (let i = 0; i < engine.grid.length; i++) if (engine.grid[i] !== -1) n++;
        return n;
      };
      const noFullRows = () => {
        for (let y = 0; y < engine.rows; y++) {
          let full = true;
          for (let x = 0; x < engine.cols; x++) if (engine.at(x, y) === -1) full = false;
          if (full) return false;
        }
        return true;
      };

      (window as unknown as Record<string, unknown>).__stockstack = {
        state: () => {
          const r = engine.result();
          return {
            phase: engine.phase,
            score: engine.score,
            lines: engine.lines,
            level: engine.level,
            maxCombo: engine.maxCombo,
            quads: engine.quads,
            perfectClears: engine.perfectClears,
            piecesPlaced: engine.piecesPlaced,
            active: engine.active ? { ...engine.active } : null,
            hold: engine.hold,
            hiddenRows: engine.hiddenRows,
            occupied: countOccupied(),
            noFullRows: noFullRows(),
            units: r.units,
            unitsTotal: r.unitsTotal,
            events: engine.events.snapshot(),
            gravityMs: engine.gravityIntervalMs(),
          };
        },
        autoplay: (on: boolean, style: "survival" | "scoring" = "survival") => {
          if (botRaf) {
            cancelAnimationFrame(botRaf);
            botRaf = 0;
          }
          if (!on) return;
          const bot = new AutoPlayer(engine, { moveIntervalMs: 22, thinkMs: 0, style });
          let last = performance.now();
          const tick = (now: number) => {
            botRaf = requestAnimationFrame(tick);
            const dt = now - last;
            last = now;
            bot.update(dt, (a) => loop.press(a));
          };
          botRaf = requestAnimationFrame(tick);
        },
        // Prepares the board for a four-line clear: four rows filled except
        // the last column. Nothing about the clear itself is faked — the
        // scoring bot keeps that well open, drops the next I-piece into it,
        // and the engine computes the quad through its ordinary path. This
        // exists so the browser test can check the *handling* of a quad
        // without waiting on the bot to happen upon one.
        setupQuad: () => {
          const top = engine.rows - 4;
          for (let y = top; y < engine.rows; y++) {
            for (let x = 0; x < engine.cols - 1; x++) {
              engine.grid[y * engine.cols + x] = y % engine.stocks.length;
            }
          }
        },

        // Ends the run the way a player would: stop steering and drop every
        // piece where it spawns until the stack reaches the top. Fabricating a
        // full grid instead would leave a one-wide well, which the bot simply
        // fills with an I-piece for a four-line clear — and a test that has to
        // cheat to reach game over is not testing game over.
        topOut: () => {
          if (botRaf) {
            cancelAnimationFrame(botRaf);
            botRaf = 0;
          }
          const id = window.setInterval(() => {
            if (engine.phase === "over") {
              clearInterval(id);
              return;
            }
            loop.press("hardDrop");
          }, 50);
        },
      };
    }

    return () => {
      if (botRaf) cancelAnimationFrame(botRaf);
      if (process.env.NODE_ENV !== "production") {
        delete (window as unknown as Record<string, unknown>).__stockstack;
      }
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      loop.dispose();
      loopRef.current = null;
    };
  }, [session, mode]);

  // --- controls -----------------------------------------------------------
  const begin = useCallback(() => {
    const loop = loopRef.current;
    if (!loop) return;
    resetOnceFlags();
    loop.start();
    setScreen("playing");
    setPaused(false);
    track("game_started", { mode });
    if (mode === "daily") track("daily_run_started");
  }, [mode]);

  const togglePause = useCallback(() => {
    const loop = loopRef.current;
    if (!loop) return;
    loop.togglePause();
    setPaused(loop.engine.phase === "paused");
  }, []);

  const playAgain = useCallback(() => {
    track("play_again");
    setResult(null);
    setSync(null);
    setSnapshot(null);
    setRunKey((k) => k + 1);
  }, []);

  const press = useCallback((a: InputAction) => loopRef.current?.press(a), []);
  const release = useCallback((d: -1 | 1) => loopRef.current?.release(d), []);

  const toggleMute = useCallback(() => {
    const loop = loopRef.current;
    if (!loop) return;
    const next = !loop.audio.settings.muted;
    loop.audio.setMuted(next);
    setMuted(next);
  }, []);

  // Pause with the keyboard even when the game has not started.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Enter" || e.code === "Space") && screen === "ready") {
        e.preventDefault();
        begin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, begin]);

  const live = snapshot;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-void)] bg-grid lg:h-auto lg:min-h-dvh lg:overflow-visible">
      <TopBar
        mode={mode}
        session={session}
        fps={fps}
        muted={muted}
        onToggleMute={toggleMute}
        onTogglePause={togglePause}
        canPause={screen === "playing"}
        paused={paused}
      />

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col items-center gap-2 px-3 pb-3 lg:flex-none lg:flex-row lg:items-start lg:justify-center lg:gap-5 lg:px-6 lg:pb-6">
        {/* Left column — desktop only */}
        <aside className="hidden w-[186px] shrink-0 flex-col gap-3 lg:flex">
          {live && <HoldPanel snapshot={live} stocks={stocks} />}
          {live && <EventPanel snapshot={live} />}
          {live && <ComboPanel snapshot={live} />}
        </aside>

        {/* Board */}
        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 lg:flex-none lg:gap-3 lg:w-auto">
          {/* Condensed HUD for narrow screens: two thin rows, not four panels. */}
          {live && (
            <div className="flex w-full max-w-md shrink-0 flex-col gap-1.5 lg:hidden">
              <div className="panel flex items-stretch divide-x divide-[var(--color-line)]">
                <div className="flex-1 px-3 py-1.5">
                  <div className="panel-label">Score</div>
                  <div className="tabular text-base leading-tight font-extrabold">{num(live.score)}</div>
                </div>
                <div className="px-3 py-1.5 text-center">
                  <div className="panel-label">Lines</div>
                  <div className="tabular text-base leading-tight font-extrabold">{live.lines}</div>
                </div>
                <div className="px-3 py-1.5 text-center">
                  <div className="panel-label">Lvl</div>
                  <div className="tabular text-base leading-tight font-extrabold">{live.level}</div>
                </div>
                <div className="px-3 py-1.5 text-center">
                  <div className="panel-label">Mined</div>
                  <div className="tabular text-base leading-tight font-extrabold text-[var(--color-gain)]">
                    {num(live.units.reduce((a, b) => a + b, 0))}
                  </div>
                </div>
              </div>

              <div className="panel flex items-center gap-3 px-3 py-1.5">
                <span className="panel-label shrink-0">Hold</span>
                <span className="w-9 shrink-0">
                  {live.hold ? (
                    <PieceMini kind={live.hold.kind} stock={stocks[live.hold.stock]} />
                  ) : (
                    <span className="text-[9px] font-bold text-[var(--color-faint)]">—</span>
                  )}
                </span>
                <span className="h-6 w-px shrink-0 bg-[var(--color-line)]" />
                <span className="panel-label shrink-0">Next</span>
                <span className="flex flex-1 items-center gap-2.5">
                  {live.next.slice(0, 4).map((p, i) => (
                    <PieceMini key={i} kind={p.kind} stock={stocks[p.stock]} />
                  ))}
                </span>
              </div>
            </div>
          )}

          {/*
            The board's size comes from the height the layout can spare, never
            from the width. A full-width box with a 1:2 ratio is 732px tall on
            a phone, which puts the touch controls below the fold — the one
            thing that makes the game unplayable there.
          */}
          <div
            ref={containerRef}
            className="relative flex min-h-0 w-full flex-1 items-center justify-center lg:h-[76dvh] lg:max-h-[860px] lg:min-h-[520px] lg:w-auto lg:flex-none lg:[aspect-ratio:1/2]"
          >
            <canvas
              ref={canvasRef}
              style={{
                boxShadow: "0 0 0 3px var(--color-line), 6px 6px 0 0 rgba(0,0,0,0.55)",
              }}
            />

            {screen === "loading" && <Overlay><Spinner /></Overlay>}

            {screen === "failed" && (
              <Overlay>
                <div className="max-w-xs text-center">
                  <div className="font-display text-sm leading-snug text-[var(--color-loss)]">
                    COULDN&apos;T START
                  </div>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">{initError}</p>
                  <button className="btn btn-ghost mt-4 px-5 py-2.5 text-xs" onClick={playAgain}>
                    Try again
                  </button>
                </div>
              </Overlay>
            )}

            {screen === "ready" && (
              <Overlay>
                <div className="text-center">
                  <div className="font-display text-sm text-white">READY</div>
                  {session?.warning && (
                    <p className="mx-auto mt-2 max-w-[15rem] text-[11px] font-semibold text-[var(--color-gold)]">
                      {session.warning}
                    </p>
                  )}
                  <button className="btn btn-primary mt-5 px-9 py-3.5 text-sm" onClick={begin}>
                    Start
                  </button>
                  <p className="mt-3 text-[11px] font-semibold text-[var(--color-faint)]">
                    or press Enter
                  </p>
                </div>
              </Overlay>
            )}

            {paused && screen === "playing" && (
              <Overlay>
                <div className="text-center">
                  <div className="font-display text-sm text-white">PAUSED</div>
                  <button className="btn btn-primary mt-5 px-8 py-3 text-sm" onClick={togglePause}>
                    Resume
                  </button>
                  <div className="mt-4">
                    <Link href="/lobby" className="text-[11px] font-bold tracking-wider text-[var(--color-faint)] hover:text-white">
                      QUIT TO LOBBY
                    </Link>
                  </div>
                </div>
              </Overlay>
            )}

            {screen === "over" && result && (
              <ResultCard
                result={result}
                stocks={stocks}
                sync={sync}
                mode={mode}
                onPlayAgain={playAgain}
                onRetrySync={async () => {
                  if (!session) return;
                  setSync(await submitResult(session.id, result));
                }}
              />
            )}
          </div>

          {/* Touch controls */}
          <div className="flex w-full shrink-0 justify-center lg:hidden">
            <TouchControls onPress={press} onRelease={release} disabled={screen !== "playing" || paused} />
          </div>

          <p className="hidden shrink-0 text-center text-[11px] font-semibold tracking-wide text-[var(--color-faint)] lg:block">
            <Key>←</Key> <Key>→</Key> move · <Key>↓</Key> soft drop · <Key>Space</Key> hard drop ·{" "}
            <Key>Z</Key> <Key>X</Key> rotate · <Key>C</Key> hold · <Key>P</Key> pause
          </p>
        </div>

        {/* Right column — desktop only */}
        <aside className="hidden w-[186px] shrink-0 flex-col gap-3 lg:flex">
          {live && <NextPanel snapshot={live} stocks={stocks} />}
          {live && <StatsPanel snapshot={live} />}
          {live && <MinedPanel snapshot={live} stocks={stocks} />}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TopBar({
  mode,
  session,
  fps,
  muted,
  onToggleMute,
  onTogglePause,
  canPause,
  paused,
}: {
  mode: GameMode;
  session: StartedSession | null;
  fps: number;
  muted: boolean;
  onToggleMute: () => void;
  onTogglePause: () => void;
  canPause: boolean;
  paused: boolean;
}) {
  return (
    <header className="mx-auto flex w-full max-w-7xl shrink-0 items-center justify-between px-4 py-2.5 lg:px-6 lg:py-3">
      <Link href="/lobby" className="flex items-center gap-2.5">
        <Logo />
        <span className="font-display text-base tracking-tight text-white">STOCKSTACK</span>
      </Link>

      <div className="flex items-center gap-2">
        <span
          className="font-display shrink-0 border-2 px-2 py-1.5 text-[7px] sm:px-2.5 sm:text-[8px]"
          style={
            mode === "daily"
              ? { borderColor: "#8A6E10", background: "var(--color-gold)", color: "#241B00" }
              : { borderColor: "var(--color-line)", background: "var(--color-slate)", color: "var(--color-muted)" }
          }
        >
          {mode === "daily" ? "DAILY" : "SOLO"}
        </span>
        {session?.offline && (
          <span
            className="font-display border-2 px-2.5 py-1.5 text-[8px]"
            style={{ borderColor: "#A62F2F", background: "var(--color-loss)", color: "#2B0707" }}
            title="This run is local only — nothing will be banked."
          >
            OFFLINE
          </span>
        )}
        <span className="tabular hidden text-[10px] font-bold text-[var(--color-faint)] sm:block">
          {fps} FPS
        </span>
        <button
          className="btn btn-ghost h-9 w-9 shrink-0 p-0"
          onClick={onToggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          <SpeakerIcon muted={muted} />
        </button>
        {canPause && (
          <button className="btn btn-ghost shrink-0 px-2.5 py-2 text-[8px] sm:px-3 sm:text-[9px]" onClick={onTogglePause}>
            {paused ? "Resume" : "Pause"}
          </button>
        )}
      </div>
    </header>
  );
}

function PieceMini({ kind, stock }: { kind: string; stock: StockDef | undefined }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="h-4 w-4"
        style={{
          background: stock?.color ?? "#456",
          boxShadow: `inset 2px 2px 0 ${stock?.light ?? "#678"}, inset -2px -2px 0 ${stock?.dark ?? "#234"}`,
        }}
      />
      <span className="font-display text-[6px] leading-none" style={{ color: stock?.color }}>
        {stock?.ticker}
      </span>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-[var(--color-line)] bg-[var(--color-void)]/94">
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-3 w-3 rounded-sm bg-[var(--color-gain)]"
            style={{ animation: `ss-float 1.1s ease-in-out ${i * 0.12}s infinite` }}
          />
        ))}
      </div>
      <span className="text-[11px] font-bold tracking-widest text-[var(--color-faint)]">
        OPENING THE MARKET
      </span>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="mx-0.5 inline-block border-2 border-[var(--color-line)] bg-[var(--color-slate)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
      style={{ boxShadow: "inset 2px 2px 0 rgba(120,175,235,0.16), inset -2px -2px 0 rgba(0,0,0,0.5)" }}
    >
      {children}
    </kbd>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 6h2.5L9 3v10L5.5 10H3V6Z" fill="currentColor" />
      {muted ? (
        <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
      ) : (
        <>
          <path d="M11 5.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
          <path d="M13 3.5a6.5 6.5 0 0 1 0 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" opacity="0.6" />
        </>
      )}
    </svg>
  );
}
