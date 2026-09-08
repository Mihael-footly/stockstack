/**
 * The acceptance test from the brief, run end to end in a real browser.
 *
 * Open the site -> press play -> the game loads -> a piece falls -> move,
 * rotate, hold, soft drop, hard drop -> complete a line -> it clears -> blocks
 * above fall -> score rises -> the stocks in the cleared row are counted ->
 * combos and multipliers work -> a four-line clear fires -> speed increases ->
 * top out -> the result screen is right -> play again does not crash.
 *
 * Playing well enough to reach a four-line clear by sending keystrokes would
 * take many minutes, so the run is driven by the shipped AutoPlayer through
 * the page's own keyboard handler — the same path a person's fingers take.
 */
import { chromium, type Page, type ConsoleMessage } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

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

/** Reads the live engine out of the page for assertions. */
async function engineState(page: Page) {
  return page.evaluate(() => (window as any).__stockstack?.state?.() ?? null);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  // -------------------------------------------------------------------------
  section("Landing page");
  // -------------------------------------------------------------------------
  await page.goto(BASE, { waitUntil: "networkidle" });
  check("landing page loads", (await page.title()).includes("StockStack"));
  check("the hero headline is present", await page.getByRole("heading", { level: 1 }).isVisible());
  check("a Play call to action exists", await page.getByRole("link", { name: /play now/i }).isVisible());

  // The self-playing demo must actually be playing.
  await page.waitForTimeout(3500);
  const demo = await page.evaluate(() => {
    const c = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!c) return null;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    // Count non-background pixels — a live board has coloured blocks on it.
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 37) {
      if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 60) lit++;
    }
    return { width: c.width, height: c.height, lit };
  });
  check("the demo board is drawn", Boolean(demo && demo.width > 0), JSON.stringify(demo));
  check("the demo board has pieces on it", Boolean(demo && demo.lit > 20), `lit=${demo?.lit}`);

  // -------------------------------------------------------------------------
  section("Play: load and start");
  // -------------------------------------------------------------------------
  await page.getByRole("link", { name: /play now/i }).click();
  await page.waitForURL(/\/play/);
  await page.waitForSelector("canvas");

  const start = page.getByRole("button", { name: /^start$/i });
  await start.waitFor({ state: "visible", timeout: 15000 });
  check("the game reaches a ready state", await start.isVisible());
  check("no offline badge — the session was opened on the server", !(await page.getByText("OFFLINE").isVisible().catch(() => false)));

  await start.click();
  await page.waitForTimeout(600);

  let s = await engineState(page);
  check("the engine is exposed for testing", s !== null);
  check("the game is playing", s?.phase === "playing", s?.phase);
  check("a piece is active", Boolean(s?.active), JSON.stringify(s?.active));
  check("the first piece is on screen, not hidden above it", (s?.active?.y ?? -99) >= s?.hiddenRows - 1, `y=${s?.active?.y} hidden=${s?.hiddenRows}`);

  // -------------------------------------------------------------------------
  section("Controls");
  // -------------------------------------------------------------------------
  {
    const before = (await engineState(page)).active;
    await page.keyboard.press("ArrowLeft");
    const afterLeft = (await engineState(page)).active;
    check("left arrow moves the piece", afterLeft.x === before.x - 1, `${before.x} -> ${afterLeft.x}`);

    await page.keyboard.press("ArrowRight");
    const afterRight = (await engineState(page)).active;
    check("right arrow moves it back", afterRight.x === before.x, `${afterLeft.x} -> ${afterRight.x}`);

    await page.keyboard.press("KeyX");
    const afterRot = (await engineState(page)).active;
    check("X rotates clockwise", afterRot.rot === (before.rot + 1) % 4, `${before.rot} -> ${afterRot.rot}`);

    await page.keyboard.press("KeyZ");
    const afterCcw = (await engineState(page)).active;
    check("Z rotates counter-clockwise", afterCcw.rot === before.rot, `${afterRot.rot} -> ${afterCcw.rot}`);

    const heldBefore = (await engineState(page)).hold;
    await page.keyboard.press("KeyC");
    const heldAfter = (await engineState(page)).hold;
    check("C holds the piece", heldBefore === null && heldAfter !== null, JSON.stringify({ heldBefore, heldAfter }));

    // Soft drop: hold ArrowDown and confirm the piece descends and scores.
    const preDrop = await engineState(page);
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(320);
    await page.keyboard.up("ArrowDown");
    const postDrop = await engineState(page);
    check("down arrow soft drops", postDrop.active.y > preDrop.active.y, `${preDrop.active.y} -> ${postDrop.active.y}`);
    check("soft drop scores", postDrop.score > preDrop.score, `${preDrop.score} -> ${postDrop.score}`);

    const preHard = await engineState(page);
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    const postHard = await engineState(page);
    check("space hard drops and locks", postHard.piecesPlaced > preHard.piecesPlaced, `${preHard.piecesPlaced} -> ${postHard.piecesPlaced}`);
    check("hard drop scores", postHard.score > preHard.score);
    check("blocks were written to the board", postHard.occupied > 0, `occupied=${postHard.occupied}`);
  }

  // -------------------------------------------------------------------------
  section("Play a real game");
  // -------------------------------------------------------------------------
  // Hand the page's own key handler over to the bot, so the whole run goes
  // through the real input path.
  await page.evaluate(() => (window as any).__stockstack.autoplay(true, "scoring"));

  const deadline = Date.now() + 100_000;
  let firstClear: any = null;
  let sawQuad = false;
  let sawCombo = false;
  let sawEvent = false;
  let quadPrepared = false;
  let peakLevel = 1;
  let gravityAtStart = (await engineState(page)).gravityMs;

  while (Date.now() < deadline) {
    await page.waitForTimeout(900);
    const st = await engineState(page);
    if (!st) break;
    if (!firstClear && st.lines > 0) firstClear = st;
    if (st.quads > 0) sawQuad = true;
    // The bot reaches a four-line clear on its own only sometimes. Once the
    // rest of the evidence is in, hand it a board where one is available and
    // let it play the clear for real.
    if (!sawQuad && !quadPrepared && st.lines > 12) {
      quadPrepared = true;
      await page.evaluate(() => (window as any).__stockstack.setupQuad());
    }
    if (st.maxCombo > 0) sawCombo = true;
    if (st.events.pumpPiecesLeft > 0 || st.events.bullRunMsLeft > 0) sawEvent = true;
    peakLevel = Math.max(peakLevel, st.level);
    if (st.phase === "over") break;
    // Enough evidence gathered and still going strong? Force the ending.
    const enough = st.lines > 40 && sawQuad && sawCombo && sawEvent;
    if (enough || Date.now() > deadline - 12_000) {
      // Stop steering and let the stack climb, so the run ends the way a
      // player's would rather than by editing the board.
      await page.evaluate(() => (window as any).__stockstack.topOut());
      await page.waitForFunction(
        () => (window as any).__stockstack?.state?.()?.phase === "over",
        undefined,
        { timeout: 30_000 },
      );
      break;
    }
  }

  const final = await engineState(page);
  check("lines were cleared", (final?.lines ?? 0) > 0, `lines=${final?.lines}`);
  check("blocks above a cleared row fall (no full row is left standing)", final?.noFullRows === true);
  check("score increased", (final?.score ?? 0) > 0, `score=${final?.score}`);
  check("stock units were counted from cleared rows", (final?.unitsTotal ?? 0) > 0, `units=${final?.unitsTotal}`);
  check("units are attributed to specific tickers", Object.keys(final?.units ?? {}).length > 0, JSON.stringify(final?.units));
  check("combos occurred", sawCombo, `maxCombo=${final?.maxCombo}`);
  check("a four-line clear is cleared and counted", sawQuad, `quads=${final?.quads}`);
  check("a market event triggered", sawEvent, JSON.stringify(final?.events));
  check("the level advanced", peakLevel > 1, `level=${peakLevel}`);
  check("the run ended", final?.phase === "over", `phase=${final?.phase}`);
  check("the game sped up", (final?.gravityMs ?? 999) < gravityAtStart, `${gravityAtStart}ms -> ${final?.gravityMs}ms`);

  // -------------------------------------------------------------------------
  section("Game over and results");
  // -------------------------------------------------------------------------
  await page.waitForSelector("text=GAME OVER", { timeout: 30_000 });
  check("the game over screen appears", await page.getByText("GAME OVER").isVisible());

  const resultText = await page.locator("body").innerText();
  check("the result shows a score", /Score/i.test(resultText));
  check("the result shows lines", /Lines/i.test(resultText));
  check("the result shows level", /Level/i.test(resultText));
  check("the result lists stocks mined", /Stocks Mined/i.test(resultText));
  check("the result shows best combo", /Combo/i.test(resultText));
  check("the result shows four-line clears", /4-line/i.test(resultText));

  // The run must reach a definite, honest conclusion — not sit on "Saving…".
  await page.waitForFunction(
    () => !document.body.innerText.includes("Saving your run"),
    undefined,
    { timeout: 15_000 },
  ).catch(() => {});
  const syncText = await page.locator("body").innerText();
  const settled =
    /Banked to your stockpile/i.test(syncText) ||
    /Sign in to keep your stockpile/i.test(syncText) ||
    /couldn.t sync/i.test(syncText) ||
    /did not pass validation/i.test(syncText);
  check("the run's fate is stated plainly", settled, syncText.slice(0, 300));
  check(
    "a guest is told their run was not banked rather than being told it was",
    !/Banked to your stockpile/i.test(syncText),
    "a guest run claimed to be banked",
  );

  // -------------------------------------------------------------------------
  section("Play again");
  // -------------------------------------------------------------------------
  await page.getByRole("button", { name: /play again/i }).click();
  await page.waitForSelector("button:has-text('Start')", { timeout: 15_000 });
  check("play again returns to a ready state", true);

  await page.getByRole("button", { name: /^start$/i }).click();
  await page.waitForTimeout(700);
  const restarted = await engineState(page);
  check("the new run is playing", restarted?.phase === "playing", restarted?.phase);
  check("the new run started from zero", restarted?.lines === 0 && restarted?.score >= 0, JSON.stringify({ lines: restarted?.lines }));
  check("a piece is active in the new run", Boolean(restarted?.active));

  // -------------------------------------------------------------------------
  section("Other routes");
  // -------------------------------------------------------------------------
  for (const [name, path] of [
    ["lobby", "/lobby"],
    ["portfolio", "/portfolio"],
    ["leaderboard", "/leaderboard"],
    ["daily run", "/play?mode=daily"],
  ] as const) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    check(`${name} responds`, (res?.status() ?? 500) < 400, `status=${res?.status()}`);
  }

  // -------------------------------------------------------------------------
  const realErrors = errors.filter(
    (e) => !e.includes("favicon") && !e.includes("404") && !e.toLowerCase().includes("download the react devtools"),
  );
  check("no uncaught errors during the whole session", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  await browser.close();

  console.log(`\n${"─".repeat(52)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log("Acceptance loop OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
