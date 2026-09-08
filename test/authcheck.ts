/**
 * Probes what this project's auth actually allows, using the publishable key —
 * exactly the privileges a browser has. Answers three questions the UI has to
 * behave differently for: does sign-up validate the address, does it return a
 * session immediately, and is the Web3 provider switched on.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  const domains = ["stockstack.app", "mailinator.com", "proton.me"];
  let working: string | null = null;

  console.log("Email + password sign-up");
  for (const domain of domains) {
    const email = `stacktest.${Date.now()}@${domain}`;
    const password = `Pw-${Math.random().toString(36).slice(2)}-9aZ!`;
    const { data, error } = await sb.auth.signUp({ email, password });

    if (error) {
      console.log(`  ${domain.padEnd(18)} rejected: ${error.message}`);
      continue;
    }
    working = domain;
    console.log(`  ${domain.padEnd(18)} accepted`);
    console.log(`     user created:      ${Boolean(data.user)}`);
    console.log(`     session returned:  ${Boolean(data.session)}`);
    console.log(`     confirmation req'd: ${data.user && !data.session ? "YES" : "no"}`);

    if (data.session) {
      // The full loop: does a signed-in player get a profile and bank units?
      const { data: prof } = await sb.from("profiles").select("username, level, xp").eq("id", data.user!.id).maybeSingle();
      console.log(`     profile auto-made: ${prof ? `@${prof.username} (level ${prof.level})` : "NO"}`);

      const { data: s } = await sb.rpc("start_game_session", {
        p_mode: "solo", p_rules_version: 1,
        p_stock_pool: ["NVDA", "AAPL", "HOOD", "META", "TSLA", "MSFT", "AMZN"],
        p_market_date: null, p_client_info: {},
      });
      const session = Array.isArray(s) ? s[0] : s;
      console.log(`     can open a session: ${Boolean(session?.id)}`);
      await sb.auth.signOut();
    }
    break;
  }

  if (!working) console.log("  (no domain accepted — the project's email validator is strict)");

  console.log("\nWeb3 (Ethereum) provider");
  // A deliberately bogus signature: if the provider is off the server says so
  // before it ever looks at the signature, which is what we want to learn.
  const { error: w3 } = await sb.auth.signInWithWeb3({
    chain: "ethereum",
    message:
      "stockstack.local wants you to sign in with your Ethereum account:\n0x0000000000000000000000000000000000000000\n\nURI: http://localhost:3000\nVersion: 1\nChain ID: 1\nNonce: 00000000\nIssued At: " +
      new Date().toISOString(),
    signature: "0x" + "00".repeat(65),
  } as never);
  console.log(`  ${w3 ? `response: ${w3.message}` : "accepted (unexpected)"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
