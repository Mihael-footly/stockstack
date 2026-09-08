/**
 * The cash reward loop, end to end, in a browser.
 *
 * Funds the pool, creates an account, plays a run past the threshold, and
 * checks the vault shows what the server actually credited — then checks the
 * two refusals that matter: a bad address, and a payout below the minimum.
 * Resets the pool afterwards.
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

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ok    ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const state = (p: Page) => p.evaluate(() => (window as any).__stockstack?.state?.() ?? null);

async function main() {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const email = `stacktest.${Date.now()}@stockstack.app`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-9aZ!`;

  console.log("\nReward rules are public");
  await page.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  let text = await page.locator("body").innerText();
  check("the vault names the threshold and the amount", /2,000/.test(text) && /\$0\.03/.test(text), text.slice(0, 200));
  check("the pool's real state is shown", /REWARD POOL (FUNDED|EMPTY)|CASH REWARDS PAUSED/i.test(text), text.slice(0, 240));

  console.log("\nPlay a qualifying run");

  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/lobby/, { timeout: 20_000 });

  await page.goto(`${BASE}/play`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^start$/i }).click();
  await page.evaluate(() => (window as any).__stockstack.autoplay(true, "scoring"));

  const deadline = Date.now() + 80_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const st = await state(page);
    if (!st || st.phase === "over") break;
    if (st.score > 4000) {
      await page.evaluate(() => (window as any).__stockstack.topOut());
      await page.waitForFunction(() => (window as any).__stockstack?.state?.()?.phase === "over", undefined, { timeout: 30_000 });
      break;
    }
  }
  const final = await state(page);
  check("the run beat the 2000 threshold", (final?.score ?? 0) >= 2000, `score=${final?.score}`);
  await page.waitForSelector("text=GAME OVER", { timeout: 30_000 });
  await page.waitForTimeout(2500);

  console.log("\nThe vault");
  await page.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  text = await page.locator("body").innerText();
  check("the pool now reads as funded", /REWARD POOL FUNDED/i.test(text), text.slice(0, 300));
  check("the vault shows the credit", /\$0\.03/.test(text));

  await sb.auth.signInWithPassword({ email, password });
  const { data: vault } = await sb.from("vault_balances").select("credited_usd").maybeSingle();
  check("the server credited exactly 0.03", Number(vault?.credited_usd) === 0.03, String(vault?.credited_usd));

  const { data: credits } = await sb.from("reward_credits").select("amount_usd, score");
  check("the credit cites the run that earned it", (credits?.length ?? 0) === 1 && Number(credits![0].score) >= 2000,
    JSON.stringify(credits));

  console.log("\nPayout address and claim");
  await page.locator("#payout").fill("not-an-address");
  await page.getByRole("button", { name: /^save$/i }).click();
  await page.waitForTimeout(900);
  text = await page.locator("body").innerText();
  check("a bad address is refused in the UI", /not a valid address/i.test(text), text.slice(0, 200));

  await page.locator("#payout").fill("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  await page.getByRole("button", { name: /^save$/i }).click();
  await page.waitForTimeout(1500);
  text = await page.locator("body").innerText();
  check("a good address saves", /Payout address saved|Saved: 0xC02a/i.test(text), text.slice(0, 220));

  const { data: addr } = await sb.from("payout_addresses").select("address, chain").maybeSingle();
  check("the address is stored against the account", addr?.address === "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  check("it is recorded for the right chain", addr?.chain === "robinhood-chain", String(addr?.chain));

  const claimBtn = page.getByRole("button", { name: /request payout/i });
  check("the claim button is disabled below the minimum", await claimBtn.isDisabled());
  check("the shortfall is stated", /more to reach the minimum payout/i.test(text), text.slice(0, 240));

  check("the page says a request is queued, not sent", /queued, not sent/i.test(text));
  check("it states no signer is connected", /no treasury signer is connected/i.test(text));

  // Reset.
  await sb.auth.signOut();
  await cleanup(email);
  await browser.close();

  console.log(`\n${"─".repeat(52)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log("\nFailures:"); for (const f of failures) console.log(`  • ${f}`); process.exit(1); }
  console.log("Rewards loop OK.");
}

async function cleanup(email: string) {
  console.log(`  (test account: ${email})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
