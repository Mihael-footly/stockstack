"use client";

import { getSupabaseBrowser } from "./supabase/client";
import { RULES_VERSION } from "@/game/config";
import { STOCK_CATALOG, marketForDate, todayKey, type StockDef, stockByTicker } from "@/game/stocks";
import type { GameMode, GameResultSummary } from "@/game/types";

export interface StartedSession {
  id: string | null;
  seed: string;
  stocks: StockDef[];
  mode: GameMode;
  marketDate: string | null;
  /** True when the run is only local — offline, or a backend that is down. */
  offline: boolean;
  /** Set when we wanted a session and could not get one. */
  warning?: string;
}

export interface SubmitOutcome {
  status: "saved" | "guest" | "offline" | "rejected" | "error";
  message?: string;
  validation?: string;
  xpAwarded?: number;
}

const PENDING_KEY = "stockstack.pendingResult";

/**
 * Opens a session on the server, which is what makes the seed and the start
 * time facts rather than claims.
 *
 * If the backend is unreachable the game still starts — with a local seed and
 * a flag that says nothing will be banked. Refusing to let someone play
 * because a leaderboard is down would be the wrong trade.
 */
export async function startSession(mode: GameMode): Promise<StartedSession> {
  const fallback = (warning?: string): StartedSession => ({
    id: null,
    seed: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    stocks: marketForDate(todayKey()),
    mode,
    marketDate: todayKey(),
    offline: true,
    warning,
  });

  const supabase = getSupabaseBrowser();
  if (!supabase) return fallback("Backend not configured — this run is local only.");

  try {
    const { data, error } = await supabase.rpc("start_game_session", {
      p_mode: mode,
      p_rules_version: RULES_VERSION,
      p_stock_pool: marketForDate(todayKey()).map((s) => s.ticker),
      p_market_date: mode === "daily" ? todayKey() : null,
      p_client_info: {
        ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 180) : "",
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });

    if (error) {
      // A duplicate daily attempt is a rule, not a failure — surface it plainly.
      if (error.message.includes("game_sessions_one_daily_per_user")) {
        return { ...fallback(), warning: "You have already taken today's Daily Run." };
      }
      return fallback(error.message);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fallback("The server did not return a session.");

    // The pool comes back from the server; the client never decides it.
    const stocks = (row.stock_pool as string[])
      .map((t) => stockByTicker(t))
      .filter((s): s is StockDef => Boolean(s));

    return {
      id: row.id as string,
      seed: row.seed as string,
      stocks: stocks.length >= 3 ? stocks : marketForDate(todayKey()),
      mode,
      marketDate: (row.market_date as string | null) ?? null,
      offline: false,
    };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : "Could not reach the server.");
  }
}

/**
 * Sends a finished run to the server for validation and reward.
 *
 * A failure here never loses the result: it is kept in localStorage and can be
 * retried from the game-over screen.
 */
export async function submitResult(
  sessionId: string | null,
  result: GameResultSummary,
): Promise<SubmitOutcome> {
  if (!sessionId) {
    return { status: "offline", message: "This run was played offline, so nothing was banked." };
  }

  const supabase = getSupabaseBrowser();
  if (!supabase) return { status: "offline", message: "Backend not configured." };

  const payload = {
    p_session_id: sessionId,
    p_score: result.score,
    p_lines: result.lines,
    p_level: result.level,
    p_duration_ms: result.durationMs,
    p_max_combo: result.maxCombo,
    p_four_line_clears: result.quads,
    p_perfect_clears: result.perfectClears,
    p_pieces_placed: result.piecesPlaced,
    p_stock_units: result.units,
    p_action_count: result.actionLog.length,
    p_action_log_hash: await hashActionLog(result),
  };

  try {
    const { data: user } = await supabase.auth.getUser();
    const { data, error } = await supabase.rpc("submit_game_result", payload);

    if (error) {
      stashPending(sessionId, payload);
      return { status: "error", message: error.message };
    }

    clearPending();
    const row = Array.isArray(data) ? data[0] : data;

    if (row?.validation_status === "rejected") {
      return {
        status: "rejected",
        message: "This run did not pass validation, so no units were awarded.",
        validation: row.validation_notes ?? undefined,
      };
    }
    if (!user?.user) {
      return { status: "guest", message: "You played as a guest, so nothing was banked." };
    }
    return { status: "saved", xpAwarded: row?.xp_awarded ?? 0 };
  } catch (err) {
    stashPending(sessionId, payload);
    return { status: "error", message: err instanceof Error ? err.message : "Network error." };
  }
}

/** Retries whatever failed to sync last time. */
export async function retryPending(): Promise<SubmitOutcome | null> {
  const pending = readPending();
  if (!pending) return null;

  const supabase = getSupabaseBrowser();
  if (!supabase) return { status: "offline", message: "Backend not configured." };

  try {
    const { error, data } = await supabase.rpc("submit_game_result", pending.payload);
    if (error) return { status: "error", message: error.message };
    clearPending();
    const row = Array.isArray(data) ? data[0] : data;
    return row?.validation_status === "rejected"
      ? { status: "rejected", message: "This run did not pass validation." }
      : { status: "saved", xpAwarded: row?.xp_awarded ?? 0 };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Network error." };
  }
}

export function hasPendingResult(): boolean {
  return readPending() !== null;
}

type PendingPayload = Record<string, unknown>;

function stashPending(sessionId: string, payload: PendingPayload): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ sessionId, payload, at: Date.now() }));
  } catch {
    // Storage can be unavailable in private mode; the in-page retry still works.
  }
}

function readPending(): { sessionId: string; payload: PendingPayload } | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Drop anything older than a day — a stale session will be rejected anyway.
    if (Date.now() - (parsed.at ?? 0) > 86_400_000) {
      clearPending();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * A hash of the run's inputs, stored with the result.
 *
 * On its own it proves nothing — the client computed it. Its value is that a
 * server-side replay can later be checked against it, so the log a player
 * submitted is the log that gets replayed.
 */
async function hashActionLog(result: GameResultSummary): Promise<string> {
  const encoded = `${result.seed}|${result.frames}|${result.actionLog.map((a) => `${a.f}${a.a}`).join(",")}`;
  try {
    const bytes = new TextEncoder().encode(encoded);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Non-secure contexts have no SubtleCrypto. A weaker fingerprint still
    // detects an edited log; it just is not collision-resistant.
    let h = 0x811c9dc5;
    for (let i = 0; i < encoded.length; i++) {
      h ^= encoded.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `fnv:${(h >>> 0).toString(16)}`;
  }
}

export { STOCK_CATALOG };
