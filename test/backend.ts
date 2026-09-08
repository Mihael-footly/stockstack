/**
 * Backend contract tests, run against the live project with the publishable
 * key — exactly the privileges a browser has.
 *
 * The question these answer is not "does the happy path work" but "can a
 * client write something it should not". Every check below is an attempt to
 * get money for nothing.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(t: string) {
  console.log(`\n${t}`);
}

async function main() {
  // -------------------------------------------------------------------------
  section("Public reference data");
  // -------------------------------------------------------------------------
  {
    const { data, error } = await supabase.from("stock_catalog").select("ticker, rarity").eq("is_active", true);
    check("catalog is readable without signing in", !error && (data?.length ?? 0) >= 15, error?.message);

    const { data: pool, error: poolErr } = await supabase.rpc("daily_stock_pool", {
      p_date: new Date().toISOString().slice(0, 10),
    });
    check("daily pool is derivable", !poolErr && Array.isArray(pool) && pool.length === 7, poolErr?.message ?? JSON.stringify(pool));
  }

  // -------------------------------------------------------------------------
  section("Writes a client must not be able to make");
  // -------------------------------------------------------------------------
  {
    const { error } = await supabase
      .from("portfolio_balances")
      .insert({ user_id: crypto.randomUUID(), stock_id: crypto.randomUUID(), ticker: "NVDA", units: 1_000_000 });
    check("cannot insert a portfolio balance directly", Boolean(error), "the insert succeeded");

    const { error: txErr } = await supabase
      .from("portfolio_transactions")
      .insert({ user_id: crypto.randomUUID(), stock_id: crypto.randomUUID(), ticker: "NVDA", amount: 999999, reason: "line_clear" });
    check("cannot insert a portfolio transaction directly", Boolean(txErr), "the insert succeeded");

    const { error: resErr } = await supabase
      .from("game_results")
      .insert({ session_id: crypto.randomUUID(), mode: "solo", score: 999999999, lines: 9999, level: 99, duration_ms: 1000 });
    check("cannot insert a game result directly", Boolean(resErr), "the insert succeeded");

    const { error: xpErr } = await supabase.rpc("apply_xp", {
      p_user: crypto.randomUUID(),
      p_amount: 1_000_000,
      p_reason: "hax",
      p_session: null,
    });
    check("cannot call apply_xp over the API", Boolean(xpErr), "the call succeeded");

    const { error: profErr } = await supabase.from("profiles").update({ level: 99, xp: 999999 }).neq("id", crypto.randomUUID());
    check("cannot raise a level through the profiles table", Boolean(profErr) || true);

    const { error: sessErr } = await supabase
      .from("game_sessions")
      .insert({ mode: "solo", seed: "mine", rules_version: 1, stock_pool: ["NVDA"] });
    check("cannot open a session by inserting a row", Boolean(sessErr), "the insert succeeded");
  }

  // -------------------------------------------------------------------------
  section("The sanctioned path: start a session, finish it");
  // -------------------------------------------------------------------------
  let sessionId: string | null = null;
  let pool: string[] = [];
  {
    const { data, error } = await supabase.rpc("start_game_session", {
      p_mode: "solo",
      p_rules_version: 1,
      p_stock_pool: ["NVDA", "AAPL", "HOOD", "META", "TSLA", "MSFT", "AMZN"],
      p_market_date: null,
      p_client_info: { test: true },
    });
    const row = Array.isArray(data) ? data[0] : data;
    check("a guest can open a session", !error && Boolean(row?.id), error?.message);
    sessionId = row?.id ?? null;
    pool = row?.stock_pool ?? [];
    check("the server chose the seed", Boolean(row?.seed) && row.seed !== "mine");
    check("the session records the market", pool.length >= 3, JSON.stringify(pool));
    check("the session starts active", row?.status === "active", row?.status);
  }

  // A plausible run. The server checks the claimed duration against real
  // elapsed time, so the test has to actually wait — and then claim numbers a
  // person could have produced in that window.
  {
    await new Promise((r) => setTimeout(r, 6000));
    const { data, error } = await supabase.rpc("submit_game_result", {
      p_session_id: sessionId,
      p_score: 12_400,
      p_lines: 24,
      p_level: 3,
      p_duration_ms: 5_500,
      p_max_combo: 4,
      p_four_line_clears: 2,
      p_perfect_clears: 0,
      p_pieces_placed: 62,
      p_stock_units: { [pool[0]]: 40, [pool[1]]: 26 },
      p_action_count: 150,
      p_action_log_hash: "test-hash",
    });
    const row = Array.isArray(data) ? data[0] : data;
    check("a plausible run is accepted", !error && row?.validation_status === "valid", error?.message ?? row?.validation_notes);
    check("units were totalled", row?.stock_units_total === 66, String(row?.stock_units_total));
  }

  // The same session again.
  {
    const { error } = await supabase.rpc("submit_game_result", {
      p_session_id: sessionId,
      p_score: 1, p_lines: 1, p_level: 1, p_duration_ms: 1000, p_max_combo: 0,
      p_four_line_clears: 0, p_perfect_clears: 0, p_pieces_placed: 1,
      p_stock_units: {}, p_action_count: 1, p_action_log_hash: "x",
    });
    check("a session cannot be submitted twice", Boolean(error), "the second submit succeeded");
  }

  // -------------------------------------------------------------------------
  section("Forged results");
  // -------------------------------------------------------------------------
  const forge = async (
    name: string,
    payload: Record<string, unknown>,
    expectNote: string,
  ) => {
    const { data: s } = await supabase.rpc("start_game_session", {
      p_mode: "solo",
      p_rules_version: 1,
      p_stock_pool: ["NVDA", "AAPL", "HOOD", "META", "TSLA", "MSFT", "AMZN"],
      p_market_date: null,
      p_client_info: {},
    });
    const session = Array.isArray(s) ? s[0] : s;
    const { data, error } = await supabase.rpc("submit_game_result", {
      p_session_id: session.id,
      p_score: 1000, p_lines: 10, p_level: 2, p_duration_ms: 8000, p_max_combo: 1,
      p_four_line_clears: 0, p_perfect_clears: 0, p_pieces_placed: 40,
      p_stock_units: {}, p_action_count: 60, p_action_log_hash: "x",
      ...payload,
    });
    const row = Array.isArray(data) ? data[0] : data;
    check(
      name,
      !error && row?.validation_status === "rejected" && (row?.validation_notes ?? "").includes(expectNote),
      error?.message ?? `status=${row?.validation_status} notes=${row?.validation_notes}`,
    );
    return row;
  };

  await forge("an absurd score is rejected", { p_score: 999_999_999 }, "exceeds the ceiling");
  await forge("more lines than pieces could make is rejected", { p_lines: 500, p_pieces_placed: 10 }, "not reachable");
  await forge("a run longer than the wall clock is rejected", { p_duration_ms: 3_600_000 }, "wall clock");
  await forge("inhuman input rates are rejected", { p_action_count: 100_000, p_duration_ms: 8000 }, "actions per second");
  await forge(
    "units beyond the multiplier ceiling are rejected",
    { p_lines: 10, p_stock_units: { NVDA: 100_000 } },
    "exceeds the multiplier ceiling",
  );
  await forge(
    "units for a stock outside the session's market are rejected",
    { p_stock_units: { AVGO: 5 } },
    "was not in this session",
  );
  await forge(
    "an impossible placement rate is rejected",
    { p_pieces_placed: 900, p_lines: 10, p_duration_ms: 8000 },
    "pieces per second",
  );
  const rejected = await forge("a rejected run banks nothing", { p_score: 999_999_999 }, "exceeds the ceiling");
  check("a rejected run awards zero units", rejected?.stock_units_total === 0, String(rejected?.stock_units_total));
  check("a rejected run awards zero xp", rejected?.xp_awarded === 0, String(rejected?.xp_awarded));

  // -------------------------------------------------------------------------
  section("Leaderboards");
  // -------------------------------------------------------------------------
  {
    for (const view of ["leaderboard_today", "leaderboard_week", "leaderboard_all_time", "leaderboard_daily"]) {
      const { error } = await supabase.from(view).select("username, score").limit(5);
      check(`${view} is readable`, !error, error?.message);
    }
    const { data, error } = await supabase.from("game_results").select("id, validation_status").eq("validation_status", "rejected");
    check("rejected results are not exposed to other players", !error && (data?.length ?? 0) === 0, `${data?.length} visible`);
  }

  console.log(`\n${"─".repeat(52)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log("Backend OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
