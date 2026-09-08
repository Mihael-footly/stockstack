/**
 * Analytics behind a provider-shaped seam.
 *
 * No vendor is wired up, so events go to the console in development and
 * nowhere in production. The point is that the call sites are already correct:
 * choosing a provider later is one function body, not a hunt through the app.
 *
 * Nothing here carries anything identifying — no email, no IP, no board state.
 */
export type AnalyticsEvent =
  | "game_started"
  | "first_piece_locked"
  | "first_line_clear"
  | "four_line_clear"
  | "market_pump_started"
  | "bull_run_started"
  | "game_over"
  | "play_again"
  | "portfolio_opened"
  | "daily_run_started"
  | "daily_run_finished"
  | "leaderboard_opened"
  | "result_sync_failed"
  | "result_sync_retried"
  | "game_init_failed"
  | "low_fps"
  | "signed_in"
  | "signed_out"
  | "wallet_connected"
  | "match_started"
  | "match_won";

type Props = Record<string, string | number | boolean | null>;

const isDev = process.env.NODE_ENV === "development";

export function track(event: AnalyticsEvent, props: Props = {}): void {
  if (isDev) {
    console.debug(`[analytics] ${event}`, props);
  }
  // A provider goes here. Deliberately a no-op until one is chosen, rather
  // than a fake network call that looks like it works.
}

/** Fires an event at most once per page load. */
const seen = new Set<string>();
export function trackOnce(event: AnalyticsEvent, props: Props = {}): void {
  if (seen.has(event)) return;
  seen.add(event);
  track(event, props);
}

export function resetOnceFlags(): void {
  seen.clear();
}
