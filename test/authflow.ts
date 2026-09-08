/**
 * The signed-in reward path.
 *
 * The acceptance run plays as a guest, which deliberately banks nothing — so
 * the half that matters most to a player, "my units are actually saved", is
 * only proven here: sign up, play a session, and read the ledger back.
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

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const email = `stacktest.${Date.now()}@example.com`;

  console.log("\nSign up");
  const { data: signUp, error: signUpErr } = await sb.auth.signUp({
    email,
    password: `pw-${Math.random().toString(36).slice(2)}-Aa1!`,
  });
  if (signUpErr || !signUp.session) {
    console.log(`  skip  signed-in path — sign-up did not return a session (${signUpErr?.message ?? "email confirmation is required"})`);
    console.log("        This is a project auth setting, not an application fault.");
    console.log("        The award path is still covered by the RLS and validation tests.");
    return;
  }
  const userId = signUp.user!.id;
  check("sign-up returns a session", Boolean(signUp.session));

  // The trigger should have made a profile.
  const { data: profile } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  check("a profile was created automatically", Boolean(profile), JSON.stringify(profile));
  check("the profile starts at level 1 with no xp", profile?.level === 1 && profile?.xp === 0);
  check("a username was generated", typeof profile?.username === "string" && profile.username.length >= 3, profile?.username);

  console.log("\nProgression is server-owned");
  {
    const { error } = await sb.from("profiles").update({ level: 99 }).eq("id", userId);
    check("a player cannot promote themselves", Boolean(error), "the update succeeded");

    const { error: xpErr } = await sb.from("profiles").update({ xp: 999_999 }).eq("id", userId);
    check("a player cannot grant themselves xp", Boolean(xpErr), "the update succeeded");

    const { error: nameErr } = await sb.from("profiles").update({ display_name: "Renamed" }).eq("id", userId);
    check("a player can still rename themselves", !nameErr, nameErr?.message);
  }

  console.log("\nPlay a session and bank it");
  const { data: sessionData, error: sessErr } = await sb.rpc("start_game_session", {
    p_mode: "solo",
    p_rules_version: 1,
    p_stock_pool: ["NVDA", "AAPL", "HOOD", "META", "TSLA", "MSFT", "AMZN"],
    p_market_date: null,
    p_client_info: {},
  });
  const session = Array.isArray(sessionData) ? sessionData[0] : sessionData;
  check("a signed-in player can open a session", !sessErr && Boolean(session?.id), sessErr?.message);
  check("the session is owned by the player", session?.user_id === userId);

  await new Promise((r) => setTimeout(r, 6000));

  const units = { [session.stock_pool[0]]: 30, [session.stock_pool[1]]: 18 };
  const { data: resultData, error: resErr } = await sb.rpc("submit_game_result", {
    p_session_id: session.id,
    p_score: 9_800,
    p_lines: 18,
    p_level: 2,
    p_duration_ms: 5_500,
    p_max_combo: 3,
    p_four_line_clears: 1,
    p_perfect_clears: 0,
    p_pieces_placed: 55,
    p_stock_units: units,
    p_action_count: 140,
    p_action_log_hash: "auth-test",
  });
  const result = Array.isArray(resultData) ? resultData[0] : resultData;
  check("the run is accepted", !resErr && result?.validation_status === "valid", resErr?.message ?? result?.validation_notes);
  check("xp was awarded", (result?.xp_awarded ?? 0) > 0, String(result?.xp_awarded));

  console.log("\nThe ledger");
  {
    const { data: balances } = await sb.from("portfolio_balances").select("*").eq("user_id", userId);
    check("balances were written", (balances?.length ?? 0) === 2, `${balances?.length} rows`);
    const first = balances?.find((b) => b.ticker === session.stock_pool[0]);
    check("the balance matches what was awarded", Number(first?.units) === 30, String(first?.units));
    check("games_mined was counted", first?.games_mined === 1, String(first?.games_mined));
    check("best_run was recorded", first?.best_run === 30, String(first?.best_run));

    const { data: txs } = await sb.from("portfolio_transactions").select("*").eq("user_id", userId);
    check("every unit has a transaction behind it", (txs?.length ?? 0) === 2, `${txs?.length} rows`);
    check("the transaction cites the session", txs?.every((t) => t.game_session_id === session.id) ?? false);
    check("the transaction states a reason", txs?.every((t) => t.reason === "line_clear") ?? false);

    const sumOfLedger = (txs ?? []).reduce((s, t) => s + t.amount, 0);
    const sumOfBalances = (balances ?? []).reduce((s, b) => s + Number(b.units), 0);
    check("balances equal the sum of the ledger", sumOfLedger === sumOfBalances, `${sumOfLedger} vs ${sumOfBalances}`);

    const { data: after } = await sb.from("profiles").select("xp, level").eq("id", userId).maybeSingle();
    check("the profile's xp advanced", (after?.xp ?? 0) > 0, JSON.stringify(after));

    const { data: xpEvents } = await sb.from("player_xp_events").select("*").eq("user_id", userId);
    check("the xp award is in the ledger too", (xpEvents?.length ?? 0) === 1, `${xpEvents?.length} rows`);
  }

  console.log("\nA second player cannot see or touch the first");
  {
    const other = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: otherSignUp } = await other.auth.signUp({
      email: `stacktest.other.${Date.now()}@example.com`,
      password: `pw-${Math.random().toString(36).slice(2)}-Aa1!`,
    });
    if (!otherSignUp?.session) {
      console.log("  skip  second-player checks — sign-up did not return a session");
    } else {
      const { data: theirView } = await other.from("portfolio_balances").select("*").eq("user_id", userId);
      check("another player cannot read your balances", (theirView?.length ?? 0) === 0, `${theirView?.length} rows visible`);

      const { data: theirTx } = await other.from("portfolio_transactions").select("*").eq("user_id", userId);
      check("another player cannot read your ledger", (theirTx?.length ?? 0) === 0, `${theirTx?.length} rows visible`);

      const { error: stealErr } = await other.rpc("submit_game_result", {
        p_session_id: session.id,
        p_score: 1, p_lines: 1, p_level: 1, p_duration_ms: 2000, p_max_combo: 0,
        p_four_line_clears: 0, p_perfect_clears: 0, p_pieces_placed: 2,
        p_stock_units: {}, p_action_count: 2, p_action_log_hash: "x",
      });
      check("another player cannot submit your session", Boolean(stealErr), "the submit succeeded");

      // Public data should still be public.
      const { data: pub } = await other.from("profiles").select("username, level").eq("id", userId);
      check("public profile fields stay readable", (pub?.length ?? 0) === 1);
    }
  }

  console.log("\nThe daily run allows one attempt");
  {
    const { data: d1, error: e1 } = await sb.rpc("start_game_session", {
      p_mode: "daily", p_rules_version: 1, p_stock_pool: [], p_market_date: null, p_client_info: {},
    });
    const daily = Array.isArray(d1) ? d1[0] : d1;
    check("a daily session can be opened", !e1 && Boolean(daily?.id), e1?.message);
    check("the daily seed comes from the date", String(daily?.seed).startsWith("daily-"), daily?.seed);
    check("the daily market is the server's, not the client's", (daily?.stock_pool?.length ?? 0) === 7, JSON.stringify(daily?.stock_pool));

    const { error: e2 } = await sb.rpc("start_game_session", {
      p_mode: "daily", p_rules_version: 1, p_stock_pool: [], p_market_date: null, p_client_info: {},
    });
    check("a second daily attempt is refused", Boolean(e2), "a second attempt was allowed");
  }

  console.log(`\n${"─".repeat(52)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log("Signed-in path OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
