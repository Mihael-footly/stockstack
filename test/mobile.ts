/**
 * Mobile playability.
 *
 * "It renders on a phone" is not the bar. The bar is: the board and every
 * control are on screen at once, nothing overflows sideways, the buttons are
 * big enough to hit, and pressing them actually moves the piece. Each of those
 * is checked on four real device sizes.
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const DEVICES = [
  { name: "iPhone SE", width: 375, height: 667, scale: 2 },
  { name: "iPhone 14", width: 390, height: 844, scale: 3 },
  { name: "Pixel 7", width: 412, height: 915, scale: 2.6 },
  { name: "iPad mini", width: 768, height: 1024, scale: 2 },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`    ok    ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`    FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const state = (page: Page) => page.evaluate(() => (window as any).__stockstack?.state?.() ?? null);

async function main() {
  const browser = await chromium.launch();

  for (const device of DEVICES) {
    console.log(`\n${device.name} (${device.width}x${device.height})`);
    const page = await browser.newPage({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.scale,
      isMobile: true,
      hasTouch: true,
    });

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // --- landing ----------------------------------------------------------
    await page.goto(BASE, { waitUntil: "networkidle" });
    const landingOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("landing does not scroll sideways", landingOverflow <= 1, `${landingOverflow}px of overflow`);

    const cta = page.getByRole("link", { name: /play now/i }).first();
    const ctaBox = await cta.boundingBox();
    check("the Play button is a comfortable tap target", (ctaBox?.height ?? 0) >= 40, `${ctaBox?.height}px tall`);

    // --- play -------------------------------------------------------------
    await page.goto(`${BASE}/play`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^start$/i }).click();
    await page.waitForTimeout(700);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("the game does not scroll sideways", overflow <= 1, `${overflow}px of overflow`);

    // Nothing in the game header may sit on top of anything else in it.
    const headerCollisions = await page.evaluate(() => {
      const header = document.querySelector("header");
      if (!header) return ["no header"];
      const items = [...header.querySelectorAll(":scope > a, :scope > div > *")].map((el) => ({
        text: (el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 14),
        r: el.getBoundingClientRect(),
      }));
      const bad: string[] = [];
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i].r;
          const b = items[j].r;
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 2 && overlapY > 2) bad.push(`${items[i].text} over ${items[j].text}`);
        }
      }
      return bad;
    });
    check("the game header does not overlap itself", headerCollisions.length === 0, headerCollisions.join("; "));

    // The board and every control must share the screen.
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const buttons = [...document.querySelectorAll("button[aria-label]")]
        .map((b) => {
          const r = b.getBoundingClientRect();
          return { label: b.getAttribute("aria-label"), top: r.top, bottom: r.bottom, w: r.width, h: r.height };
        })
        .filter((b) => b.w > 0);
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        board: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, w: rect.width, h: rect.height },
        buttons,
        docHeight: document.documentElement.scrollHeight,
      };
    });

    check("the board is on screen", layout.board.top >= 0 && layout.board.bottom <= layout.viewport.h + 1,
      `board ${Math.round(layout.board.top)}..${Math.round(layout.board.bottom)} in ${layout.viewport.h}`);
    check("the board is a usable size", layout.board.w >= 150 && layout.board.h >= 300,
      `${Math.round(layout.board.w)}x${Math.round(layout.board.h)}`);
    check("the board keeps its 1:2 proportions",
      Math.abs(layout.board.h / layout.board.w - 2) < 0.08,
      `ratio ${(layout.board.h / layout.board.w).toFixed(2)}`);

    const controls = layout.buttons.filter((b) =>
      ["Move left", "Move right", "Rotate", "Rotate left", "Hold piece", "Hard drop", "Soft drop"].includes(b.label ?? ""),
    );
    check("all six touch controls are present", controls.length >= 6, `${controls.length} found: ${controls.map((c) => c.label).join(", ")}`);

    const offscreen = controls.filter((c) => c.bottom > layout.viewport.h + 1);
    check("every control is above the fold", offscreen.length === 0,
      offscreen.map((c) => `${c.label} ends at ${Math.round(c.bottom)}`).join("; "));

    const small = controls.filter((c) => c.h < 44 || c.w < 44);
    check("controls meet the 44px touch target guidance", small.length === 0,
      small.map((c) => `${c.label} ${Math.round(c.w)}x${Math.round(c.h)}`).join("; "));

    check("the page itself does not scroll during play", layout.docHeight <= layout.viewport.h + 2,
      `content ${layout.docHeight} vs viewport ${layout.viewport.h}`);

    // --- the controls must actually do something --------------------------
    const before = await state(page);

    await page.getByLabel("Move left").tap();
    await page.waitForTimeout(120);
    const afterLeft = await state(page);
    check("tapping left moves the piece", afterLeft.active.x < before.active.x,
      `${before.active.x} -> ${afterLeft.active.x}`);

    await page.getByLabel("Move right").tap();
    await page.waitForTimeout(120);
    const afterRight = await state(page);
    check("tapping right moves the piece", afterRight.active.x > afterLeft.active.x,
      `${afterLeft.active.x} -> ${afterRight.active.x}`);

    await page.getByLabel("Rotate", { exact: true }).tap();
    await page.waitForTimeout(120);
    const afterRot = await state(page);
    check("tapping rotate turns the piece", afterRot.active.rot !== afterRight.active.rot,
      `${afterRight.active.rot} -> ${afterRot.active.rot}`);

    await page.getByLabel("Hold piece").tap();
    await page.waitForTimeout(150);
    const afterHold = await state(page);
    check("tapping hold stores a piece", afterHold.hold !== null);

    const beforeDrop = await state(page);
    await page.getByLabel("Hard drop").tap();
    await page.waitForTimeout(250);
    const afterDrop = await state(page);
    check("tapping drop locks a piece", afterDrop.piecesPlaced > beforeDrop.piecesPlaced,
      `${beforeDrop.piecesPlaced} -> ${afterDrop.piecesPlaced}`);
    check("dropping puts blocks on the board", afterDrop.occupied > 0, `occupied=${afterDrop.occupied}`);

    // --- gestures ---------------------------------------------------------
    const box = layout.board;
    const cx = box.left + box.w / 2;
    const cy = box.top + box.h / 2;

    const preTap = await state(page);
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(150);
    const postTap = await state(page);
    check("tapping the board rotates", postTap.active && preTap.active && postTap.active.rot !== preTap.active.rot,
      `${preTap.active?.rot} -> ${postTap.active?.rot}`);

    // A swipe left should shift the piece across.
    const preSwipe = await state(page);
    await page.evaluate(
      ({ x, y }) => {
        const el = document.querySelector("canvas")!.parentElement!;
        const started = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent("touchstart", { touches: [started], bubbles: true, cancelable: true }));
        for (let i = 1; i <= 5; i++) {
          const moved = new Touch({ identifier: 1, target: el, clientX: x - i * 30, clientY: y });
          el.dispatchEvent(new TouchEvent("touchmove", { touches: [moved], bubbles: true, cancelable: true }));
        }
        const ended = new Touch({ identifier: 1, target: el, clientX: x - 150, clientY: y });
        el.dispatchEvent(
          new TouchEvent("touchend", { changedTouches: [ended], touches: [], bubbles: true, cancelable: true }),
        );
      },
      { x: cx, y: cy },
    );
    await page.waitForTimeout(200);
    const postSwipe = await state(page);
    check("swiping moves the piece sideways",
      Boolean(postSwipe.active) && Boolean(preSwipe.active) && postSwipe.active.x < preSwipe.active.x,
      `${preSwipe.active?.x} -> ${postSwipe.active?.x}`);

    // --- navigation -------------------------------------------------------
    // The header links are hidden below `sm`, so the tab bar is the only way
    // around on a phone. It must exist everywhere except the game itself,
    // where it would sit on top of the controls.
    const tabsOnPlay = await page.locator('nav[aria-label="Main"]').count();
    const smallScreen = device.width < 640;
    check("the tab bar stays off the game screen", tabsOnPlay === 0, `${tabsOnPlay} found`);

    await page.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
    const tabs = page.locator('nav[aria-label="Main"]');
    if (smallScreen) {
      check("the tab bar is present on site pages", await tabs.isVisible());

      for (const label of ["Lobby", "Portfolio", "Ranks"]) {
        const tab = tabs.getByRole("link", { name: new RegExp(label, "i") });
        const box = await tab.boundingBox();
        check(`the ${label} tab is a usable target`, (box?.height ?? 0) >= 36 && (box?.width ?? 0) >= 56,
          `${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`);
      }

      await tabs.getByRole("link", { name: /ranks/i }).tap();
      await page.waitForURL(/leaderboard/, { timeout: 8000 });
      check("the tab bar navigates", page.url().includes("/leaderboard"));

      // The bar must not cover the last row of content.
      const covered = await page.evaluate(() => {
        const bar = document.querySelector('nav[aria-label="Main"]') as HTMLElement | null;
        if (!bar) return false;
        const barTop = bar.getBoundingClientRect().top;
        const main = document.querySelector("main");
        if (!main) return false;
        // Scroll to the very bottom and check the last content still clears it.
        window.scrollTo(0, document.body.scrollHeight);
        return main.getBoundingClientRect().bottom > barTop;
      });
      check("content is not hidden behind the tab bar", !covered);
    } else {
      check("the tab bar is hidden on wide screens", !(await tabs.isVisible().catch(() => false)));
    }

    check("no uncaught errors on this device", errors.length === 0, errors.slice(0, 2).join(" | "));

    await page.close();
  }

  await browser.close();

  console.log(`\n${"─".repeat(52)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log("Mobile OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
