"use client";

import { useEffect, useRef, useState } from "react";
import { AutoPlayer } from "@/game/AutoPlayer";
import { EffectsManager } from "@/game/EffectsManager";
import { GameEngine } from "@/game/GameEngine";
import { Renderer } from "@/game/Renderer";
import { TIMING } from "@/game/config";
import { marketForDate, todayKey } from "@/game/stocks";
import type { ClearEvent } from "@/game/types";
import { num } from "@/lib/format";

/**
 * The board on the landing page, playing itself.
 *
 * This is the real engine and the real renderer — the same code the game runs
 * — driven by the bot. A visitor sees actual gameplay, including real line
 * clears and real stock rewards, before they click anything. No audio, no
 * input handling, and it stops itself when scrolled out of view.
 */
export function AttractBoard({ compact = false }: { compact?: boolean }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [line, setLine] = useState<{ text: string; color: string } | null>(null);
  const [mined, setMined] = useState<{ ticker: string; units: number; color: string }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const stocks = marketForDate(todayKey());
    let engine = new GameEngine({ seed: `attract-${Date.now()}`, mode: "solo", stocks });
    const effects = new EffectsManager();

    let renderer: Renderer;
    try {
      renderer = new Renderer(canvas, engine, effects);
    } catch {
      // No canvas support — the page simply shows the static frame instead.
      return;
    }

    let bot = new AutoPlayer(engine, { moveIntervalMs: compact ? 46 : 62, thinkMs: 70 });

    const onClear = (ev: ClearEvent) => {
      effects.flashRows(ev.rows, ev.lineCount >= 4 ? 1 : 0.7);
      effects.kick(1.5 + ev.lineCount * 1.6);
      effects.glow(0.18 + ev.lineCount * 0.12);
      for (const row of ev.rows) {
        for (let x = 0; x < engine.cols; x++) {
          const s = engine.at(x, row);
          const def = s >= 0 ? engine.stocks[s] : null;
          if (def && Math.random() < 0.4) effects.burst(x + 0.5, row + 0.5, def.color, 3);
        }
      }
      const label =
        ev.lineCount >= 4 ? "MARKET CLEAR" : ev.lineCount === 3 ? "TRIPLE" : ev.lineCount === 2 ? "DOUBLE" : "CLEAR";
      setLine({
        text: ev.combo > 0 ? `${label} · COMBO x${ev.combo}` : label,
        color: ev.lineCount >= 4 ? "#19F28A" : "#43A5FF",
      });
      setMined(
        engine.unitsExact
          .map((u, i) => ({ ticker: engine.stocks[i].ticker, units: Math.floor(u), color: engine.stocks[i].color }))
          .filter((m) => m.units > 0)
          .sort((a, b) => b.units - a.units)
          .slice(0, 4),
      );
    };

    engine.onClear = onClear;
    engine.start();

    const fit = () => {
      const r = wrap.getBoundingClientRect();
      renderer.resize(r.width, r.height);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    // Only run while on screen. A demo board burning a core behind the fold is
    // a real cost on a laptop and buys nothing.
    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !raf) loop(performance.now());
    }, { threshold: 0.05 });
    io.observe(wrap);

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const loop = (now: number) => {
      if (!visible) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(loop);
      let dt = now - last;
      last = now;
      if (dt > 100) dt = 100;

      acc += dt;
      let steps = 0;
      while (acc >= TIMING.stepMs && steps < 6) {
        engine.update(TIMING.stepMs);
        acc -= TIMING.stepMs;
        steps++;
      }
      bot.update(dt, (a) => engine.input(a));
      effects.update(dt);
      renderer.draw();

      // The demo never ends: top out and it quietly starts a fresh market.
      if (engine.phase === "over") {
        engine = new GameEngine({ seed: `attract-${Date.now()}`, mode: "solo", stocks });
        engine.onClear = onClear;
        engine.start();
        bot = new AutoPlayer(engine, { moveIntervalMs: compact ? 46 : 62, thinkMs: 70 });
        renderer = new Renderer(canvas, engine, effects);
        fit();
        setMined([]);
        setLine(null);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [compact]);

  useEffect(() => {
    if (!line) return;
    const t = setTimeout(() => setLine(null), 1400);
    return () => clearTimeout(t);
  }, [line]);

  return (
    <div className="relative">
      <div className="block-surface relative overflow-hidden p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="panel-label">Live demo · playing itself</span>
          <span className="flex items-center gap-1.5">
            <span className="animate-pulse-glow h-2 w-2 bg-[var(--color-gain)]" />
            <span className="font-display text-[7px] text-[var(--color-gain)]">LIVE</span>
          </span>
        </div>

        <div
          ref={wrapRef}
          className="relative mx-auto flex items-center justify-center"
          style={{ height: compact ? 340 : 420, aspectRatio: "1 / 2" }}
        >
          <canvas ref={canvasRef} style={{ boxShadow: "0 0 0 3px var(--color-line)" }} />
          {line && (
            <div className="pointer-events-none absolute inset-x-0 top-4 text-center">
              <span
                className="animate-rise font-display text-[10px]"
                style={{ color: line.color, textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}
              >
                {line.text}
              </span>
            </div>
          )}
        </div>

        <div className="mt-2.5 flex min-h-[26px] flex-wrap items-center justify-center gap-1.5">
          {mined.length === 0 ? (
            <span className="font-display text-[7px] text-[var(--color-faint)]">
              CLEAR A LINE TO MINE THE STOCKS IN IT
            </span>
          ) : (
            mined.map((m) => (
              <span
                key={m.ticker}
                className="tabular border-2 px-2 py-1.5 text-[10px]"
                style={{ borderColor: m.color, color: m.color, background: "var(--color-void)" }}
              >
                {m.ticker} +{num(m.units)}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
