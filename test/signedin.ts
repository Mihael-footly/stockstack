/**
 * The signed-in loop, end to end, in a real browser.
 *
 * The main acceptance run plays as a guest and deliberately banks nothing, so
 * the half a player actually cares about — "I made an account, I played, and
 * my units are there" — is only proven here. Creates its own account, plays a
 * real game through the page's own keyboard handler, and reads the portfolio
 * back through the UI.
 */
import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

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

const state = (page: Page) => page.evaluate(() => (window as any).__stockstack?.state?.() ?? null);

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const email = `stacktest.${Date.now()}@stockstack.app`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-9aZ!`;

  // ---------------------------------------------------------------------------
  console.log("\nCreate an account");
  // ---------------------------------------------------------------------------
  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
  check("the sign-in page offers a wallet option", await page.getByText(/wallet/i).first().isVisible());
  check("magic links are gone", !(await page.getByText(/sign-in link|magic link/i).isVisible().catch(() => false)));

  await page.getByRole("button", { name: /^create$/i }).click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();

  await page.waitForURL(/\/lobby/, { timeout: 20_000 });
  check("creating an account signs you straight in", page.url().includes("/lobby"));

  // Wait for the identity panel to finish, not merely to start. "VIEW PROFILE"
  // renders only once a profile is in hand, so it is the settled signal;
  // matching on the username alone caught a half-rendered frame.
  await page.waitForFunction(
    () => /VIEW PROFILE/i.test(document.body.innerText) || /PLAYING AS GUEST/i.test(document.body.innerText),
    undefined,
    { timeout: 15_000 },
  );
  const lobbyText = await page.locator("body").innerText();
  check("the lobby greets the player by name", /@[a-z0-9_]+/i.test(lobbyText) && !/PLAYING AS GUEST/i.test(lobbyText), lobbyText.slice(0, 120));
  check("the lobby shows a level", /LEVEL\s*\d+/i.test(lobbyText));
  check("the Daily Run is now available", !/SIGN IN TO PLAY/i.test(lobbyText));

  // ---------------------------------------------------------------------------
  console.log("\nPlay a real game while signed in");
  // ---------------------------------------------------------------------------
  await page.goto(`${BASE}/play`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^start$/i }).click();
  await page.waitForTimeout(500);
  check("no offline badge — the session opened on the server", !(await page.getByText("OFFLINE").isVisible().catch(() => false)));

  await page.evaluate(() => (window as any).__stockstack.autoplay(true, "scoring"));

  const deadline = Date.now() + 70_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const st = await state(page);
    if (!st) break;
    if (st.phase === "over") break;
    if (st.lines > 25) {
      await page.evaluate(() => (window as any).__stockstack.topOut());
      await page.waitForFunction(() => (window as any).__stockstack?.state?.()?.phase === "over", undefined, { timeout: 30_000 });
      break;
    }
  }

  const final = await state(page);
  check("the run cleared lines", (final?.lines ?? 0) > 0, `lines=${final?.lines}`);
  check("the run mined units", (final?.unitsTotal ?? 0) > 0, `units=${final?.unitsTotal}`);
  const minedInGame: Record<string, number> = final?.units ?? {};

  await page.waitForSelector("text=GAME OVER", { timeout: 30_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Saving your run"), undefined, { timeout: 20_000 }).catch(() => {});

  const resultText = await page.locator("body").innerText();
  check("the run reports as banked", /Banked to your stockpile/i.test(resultText), resultText.slice(0, 260));
  check("XP was awarded and shown", /\+[\d,]+ XP/i.test(resultText), resultText.slice(0, 260));

  // ---------------------------------------------------------------------------
  console.log("\nThe portfolio reflects it");
  // ---------------------------------------------------------------------------
  await page.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const portfolioText = await page.locator("body").innerText();

  check("the portfolio is no longer the signed-out state", !/SIGN IN TO KEEP YOUR STOCKPILE/i.test(portfolioText));
  check("the portfolio is not empty", !/NOTHING MINED YET/i.test(portfolioText), portfolioText.slice(0, 200));

  const tickers = Object.keys(minedInGame);
  const missing = tickers.filter((t) => !portfolioText.includes(t));
  check("every ticker mined in the run is listed", missing.length === 0, `missing: ${missing.join(", ")}`);

  // The numbers on screen must equal what the server actually stored.
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  await sb.auth.signInWithPassword({ email, password });
  const { data: balances } = await sb.from("portfolio_balances").select("ticker, units");
  const stored: Record<string, number> = {};
  for (const b of balances ?? []) stored[b.ticker] = Number(b.units);

  const mismatches = tickers.filter((t) => stored[t] !== minedInGame[t]);
  check(
    "banked balances match what the game awarded",
    mismatches.length === 0,
    mismatches.map((t) => `${t}: game ${minedInGame[t]} vs stored ${stored[t]}`).join("; "),
  );

  const { data: txs } = await sb.from("portfolio_transactions").select("ticker, amount, reason");
  const ledgerTotal = (txs ?? []).reduce((s, t) => s + t.amount, 0);
  const balanceTotal = Object.values(stored).reduce((s, v) => s + v, 0);
  check("the ledger explains the balances exactly", ledgerTotal === balanceTotal, `${ledgerTotal} vs ${balanceTotal}`);

  const { data: me } = await sb.auth.getUser();
  const { data: prof } = await sb
    .from("profiles")
    .select("xp, level")
    .eq("id", me.user!.id)
    .maybeSingle();
  check("XP was persisted", (prof?.xp ?? 0) > 0, JSON.stringify(prof));

  // ---------------------------------------------------------------------------
  console.log("\nLeaderboard");
  // ---------------------------------------------------------------------------
  await page.goto(`${BASE}/leaderboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const boardText = await page.locator("body").innerText();
  check("the run appears on today's board", !/NO RUNS YET/i.test(boardText), boardText.slice(0, 200));

  // ---------------------------------------------------------------------------
  console.log("\nSign out and back in");
  // ---------------------------------------------------------------------------
  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForTimeout(1500);
  check("signing out returns to the signed-out state", await page.locator("#email").isVisible());

  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).last().click();
  await page.waitForURL(/\/lobby/, { timeout: 20_000 });
  check("signing back in works", page.url().includes("/lobby"));

  await page.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const again = await page.locator("body").innerText();
  check("the stockpile survived the round trip", !/NOTHING MINED YET/i.test(again));

  check("no uncaught errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  // Clean up after ourselves.
  await sb.auth.signOut();
  await browser.close();

  console.log(`\n${"─".repeat(52)}`);
  console.log(`${passed} passed, ${failed} failed`);
  console.log(`(test account: ${email})`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log("Signed-in loop OK.");
}

main().catch((e) => { console.error(e); process.exit(1); });
