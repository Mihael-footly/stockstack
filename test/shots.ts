import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "/tmp/ss-shots";

async function main() {
  const browser = await chromium.launch();

  // --- desktop ---
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  await desktop.goto(BASE, { waitUntil: "networkidle" });
  await desktop.waitForTimeout(4000); // let the self-playing board build a stack
  await desktop.screenshot({ path: `${OUT}/01-landing-hero.png` });
  await desktop.screenshot({ path: `${OUT}/02-landing-full.png`, fullPage: true });

  await desktop.goto(`${BASE}/play`, { waitUntil: "networkidle" });
  await desktop.getByRole("button", { name: /^start$/i }).click();
  await desktop.evaluate(() => (window as any).__stockstack.autoplay(true));
  await desktop.waitForTimeout(14000);
  await desktop.screenshot({ path: `${OUT}/03-play-desktop.png` });

  // Let it run to a market event if we can catch one.
  await desktop.waitForTimeout(9000);
  await desktop.screenshot({ path: `${OUT}/04-play-later.png` });

  await desktop.evaluate(() => (window as any).__stockstack.topOut());
  await desktop.waitForSelector("text=GAME OVER", { timeout: 30000 });
  await desktop.waitForTimeout(2500);
  await desktop.screenshot({ path: `${OUT}/05-game-over.png` });

  for (const [name, path] of [
    ["06-lobby", "/lobby"],
    ["07-portfolio", "/portfolio"],
    ["08-leaderboard", "/leaderboard"],
    ["09-signin", "/signin"],
  ] as const) {
    await desktop.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await desktop.waitForTimeout(1200);
    await desktop.screenshot({ path: `${OUT}/${name}.png` });
  }

  // --- mobile ---
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  await mobile.goto(BASE, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(3500);
  await mobile.screenshot({ path: `${OUT}/10-mobile-landing.png` });

  await mobile.goto(`${BASE}/play`, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: /^start$/i }).click();
  await mobile.evaluate(() => (window as any).__stockstack.autoplay(true));
  await mobile.waitForTimeout(12000);
  await mobile.screenshot({ path: `${OUT}/11-mobile-play.png` });

  await mobile.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(1200);
  await mobile.screenshot({ path: `${OUT}/12-mobile-lobby.png` });

  await browser.close();
  console.log("shots written to " + OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
