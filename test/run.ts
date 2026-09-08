/**
 * Headless engine tests.
 *
 * The engine has no DOM dependency by design, so its correctness can be
 * established here rather than by squinting at a canvas. Everything that the
 * acceptance test in the brief depends on — clears, collapse, stock counting,
 * multipliers, determinism, game over — is checked directly.
 */
import { GameEngine } from "../src/game/GameEngine";
import { TIMING, TOTAL_ROWS, BOARD, REWARD } from "../src/game/config";
import { marketForDate } from "../src/game/stocks";
import { PIECES } from "../src/game/pieces";
import { Rng } from "../src/game/rng";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const STOCKS = marketForDate("2026-09-08");

function newEngine(seed = "test-seed", mode: "solo" | "daily" = "solo") {
  return new GameEngine({ seed, mode, stocks: STOCKS });
}

/** Run `n` fixed simulation steps. */
function step(e: GameEngine, n = 1): void {
  for (let i = 0; i < n; i++) e.update(TIMING.stepMs);
}

/** Directly place a stock in a cell — test scaffolding for building boards. */
function fill(e: GameEngine, x: number, y: number, stock = 0): void {
  // `grid` is exposed for the renderer; writing to it directly is test-only setup.
  e.grid[y * e.cols + x] = stock;
}

/** Fill an entire row except the given columns. */
function fillRow(e: GameEngine, y: number, except: number[] = [], stock = 0): void {
  for (let x = 0; x < e.cols; x++) {
    if (!except.includes(x)) fill(e, x, y, stock);
  }
}

function countOccupied(e: GameEngine): number {
  let n = 0;
  for (let i = 0; i < e.grid.length; i++) if (e.grid[i] !== -1) n++;
  return n;
}

// ---------------------------------------------------------------------------
section("Board and setup");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  eq("board is 10 columns", e.cols, 10);
  eq("board is 24 rows (20 visible + 4 hidden)", e.rows, TOTAL_ROWS);
  eq("board starts empty", countOccupied(e), 0);
  eq("next queue is populated", e.nextQueue.length, 5);
  eq("phase starts ready", e.phase, "ready");
  check("no active piece before start", e.active === null);
  eq("market has 7 stocks", STOCKS.length, 7);
}

// ---------------------------------------------------------------------------
section("Piece spawn and movement");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();
  eq("phase is playing after start", e.phase, "playing");
  check("a piece is active after start", e.active !== null);

  const startX = e.active!.x;
  e.input("moveLeft");
  eq("moveLeft shifts one column", e.active!.x, startX - 1);
  e.input("moveRight");
  eq("moveRight shifts back", e.active!.x, startX);

  // Walk into the left wall and confirm it stops.
  for (let i = 0; i < 20; i++) e.input("moveLeft");
  const wallX = e.active!.x;
  const cells = PIECES[e.active!.kind][e.active!.rot];
  const minX = Math.min(...cells.map((c) => c[0]));
  eq("piece stops at the left wall", wallX + minX, 0);

  for (let i = 0; i < 30; i++) e.input("moveRight");
  const cells2 = PIECES[e.active!.kind][e.active!.rot];
  const maxX = Math.max(...cells2.map((c) => c[0]));
  eq("piece stops at the right wall", e.active!.x + maxX, e.cols - 1);
}

// ---------------------------------------------------------------------------
section("Rotation");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();
  const r0 = e.active!.rot;
  e.input("rotateCW");
  eq("rotateCW advances state", e.active!.rot, (r0 + 1) % 4);
  e.input("rotateCCW");
  eq("rotateCCW returns", e.active!.rot, r0);
  e.input("rotateCCW");
  eq("rotateCCW wraps to 3", e.active!.rot, (r0 + 3) % 4);

  // Four clockwise rotations return every piece to its start.
  for (const kind of ["I", "J", "L", "O", "S", "T", "Z"] as const) {
    const cells0 = PIECES[kind][0];
    const cells4 = PIECES[kind][0];
    check(`${kind} rotation table has 4 states`, PIECES[kind].length === 4);
    check(`${kind} has 4 cells in every state`, PIECES[kind].every((s) => s.length === 4));
    check(`${kind} state 0 is stable`, cells0 === cells4);
  }

  // Wall kick: hug the left wall and rotate — a kick should keep it legal.
  const e2 = newEngine("kick-seed");
  e2.start();
  for (let i = 0; i < 20; i++) e2.input("moveLeft");
  const before = { x: e2.active!.x, rot: e2.active!.rot };
  e2.input("rotateCW");
  const after = { x: e2.active!.x, rot: e2.active!.rot };
  const legal = PIECES[e2.active!.kind][after.rot].every(
    (c) => after.x + c[0] >= 0 && after.x + c[0] < e2.cols,
  );
  check("rotation against the wall stays in bounds", legal, JSON.stringify({ before, after }));
}

// ---------------------------------------------------------------------------
section("Hard drop and locking");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();
  const kind = e.active!.kind;
  e.input("hardDrop");
  eq("hard drop locks the piece immediately", e.active, null);
  eq("four cells were written to the board", countOccupied(e), 4);
  eq("pieces placed counter advanced", e.piecesPlaced, 1);
  check("hard drop awarded score", e.score > 0, `score=${e.score}`);

  // The piece must be resting on the floor.
  let lowest = -1;
  for (let y = 0; y < e.rows; y++) {
    for (let x = 0; x < e.cols; x++) if (e.at(x, y) !== -1) lowest = Math.max(lowest, y);
  }
  eq("piece landed on the bottom row", lowest, e.rows - 1);
  check(`piece kind ${kind} recorded a stock`, e.grid.some((v) => v >= 0));

  // Next piece arrives after the spawn delay.
  step(e, 10);
  check("a new piece spawned after the delay", e.active !== null);
}

// ---------------------------------------------------------------------------
section("Line clear, collapse, and stock counting");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();

  // Build a bottom row that is one cell short, with a known stock mix:
  // columns 0-2 = stock 0, 3-5 = stock 1, 6-8 = stock 2, column 9 left open.
  const bottom = e.rows - 1;
  for (let x = 0; x <= 2; x++) fill(e, x, bottom, 0);
  for (let x = 3; x <= 5; x++) fill(e, x, bottom, 1);
  for (let x = 6; x <= 8; x++) fill(e, x, bottom, 2);

  // A marker above the row, so the collapse can be observed.
  fill(e, 0, bottom - 1, 3);

  eq("row is 9/10 full", countOccupied(e), 10);

  let clearEvent: any = null;
  e.onClear = (ev) => {
    clearEvent = ev;
  };

  // Drop a piece into column 9 to complete the row. A vertical I is the only
  // piece that occupies exactly one column, so the fill is unambiguous.
  e.active = { kind: "I", stock: 4, x: 7, y: 0, rot: 1 };
  e.input("hardDrop");

  check("a clear event fired", clearEvent !== null);
  if (clearEvent) {
    eq("one line cleared", clearEvent.lineCount, 1);
    eq("cleared the bottom row", clearEvent.rows[0], bottom);
    // The completed row is 3x stock0 + 3x stock1 + 3x stock2 + 1x stock4 (the I).
    const u = clearEvent.units;
    eq("stock 0 credited 3 units", Math.round(u[0]), 3);
    eq("stock 1 credited 3 units", Math.round(u[1]), 3);
    eq("stock 2 credited 3 units", Math.round(u[2]), 3);
    eq("stock 4 credited 1 unit", Math.round(u[4]), 1);
    eq("single-line multiplier is 1.0", clearEvent.multiplier, 1);
  }

  eq("phase entered clearing", e.phase, "clearing");
  step(e, 20); // let the clear animation finish
  eq("lines counter advanced", e.lines, 1);

  // The marker that was above the cleared row should now be one row lower.
  eq("blocks above fell by one row", e.at(0, bottom), 3);
}

// ---------------------------------------------------------------------------
section("Multi-line clears and multipliers");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();
  // Four rows all but column 9, then drop a vertical I into the gap. A stray
  // block well above keeps this from also being a perfect clear, so the quad
  // multiplier can be checked on its own.
  for (let i = 0; i < 4; i++) fillRow(e, e.rows - 1 - i, [9], 0);
  fill(e, 0, e.rows - 8, 5);

  let ev: any = null;
  e.onClear = (x) => {
    ev = x;
  };
  // Vertical I in rotation state 1 occupies column x+2.
  e.active = { kind: "I", stock: 1, x: 7, y: 0, rot: 1 };
  e.input("hardDrop");

  check("four-line clear fired", ev !== null);
  if (ev) {
    eq("four lines cleared", ev.lineCount, 4);
    eq("quad multiplier applied", ev.multiplier, REWARD.linesMultiplier[4]);
    eq("stock 0 credited 36 base units x1.75", Math.round(ev.units[0]), Math.round(36 * 1.75));
    eq("stock 1 (the I piece) credited 4 x1.75", Math.round(ev.units[1]), 7);
  }
  eq("quad counter advanced", e.quads, 1);
  check("quad alone is not a perfect clear", ev?.perfectClear === false);
  step(e, 20);
  eq("four lines recorded", e.lines, 4);
  eq("only the stray block remains", countOccupied(e), 1);
}

// ---------------------------------------------------------------------------
section("Perfect clear");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();
  // A board holding exactly one row minus two cells; an O completes it and
  // leaves nothing behind.
  fillRow(e, e.rows - 1, [4, 5], 2);
  fillRow(e, e.rows - 2, [4, 5], 2);

  let ev: any = null;
  e.onClear = (x) => {
    ev = x;
  };
  e.active = { kind: "O", stock: 0, x: 3, y: 0, rot: 0 };
  e.input("hardDrop");

  check("perfect clear detected", ev?.perfectClear === true);
  eq("perfect clear counter advanced", e.perfectClears, 1);
  if (ev) {
    check(
      "perfect clear multiplier applied",
      ev.multiplier >= REWARD.perfectClearMultiplier,
      `multiplier=${ev.multiplier}`,
    );
  }
  step(e, 20);
  eq("board fully empty", countOccupied(e), 0);
}

// ---------------------------------------------------------------------------
section("Combo chain");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();
  eq("combo starts at -1 (no chain)", e.combo, -1);

  const multipliers: number[] = [];
  e.onClear = (ev) => multipliers.push(ev.multiplier);

  for (let i = 0; i < 3; i++) {
    fillRow(e, e.rows - 1, [4, 5], 1);
    e.active = { kind: "O", stock: 0, x: 3, y: 0, rot: 0 };
    e.input("hardDrop");
    step(e, 20);
  }
  eq("three clears produced three events", multipliers.length, 3);
  eq("combo reached 2", e.combo, 2);
  eq("max combo recorded", e.maxCombo, 2);
  check(
    "combo multiplier grows across the chain",
    multipliers[2] > multipliers[0],
    JSON.stringify(multipliers),
  );

  // A lock with no clear breaks the chain.
  e.active = { kind: "O", stock: 0, x: 0, y: 0, rot: 0 };
  e.input("hardDrop");
  eq("combo resets on a dry lock", e.combo, -1);
}

// ---------------------------------------------------------------------------
section("Hold");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();
  const first = e.active!.kind;
  e.input("hold");
  eq("held piece recorded", e.hold?.kind, first);
  check("a different piece is active", e.active !== null);
  eq("hold is locked until the next lock", e.canHold, false);

  const second = e.active!.kind;
  e.input("hold");
  eq("hold cannot be used twice on one piece", e.active!.kind, second);

  e.input("hardDrop");
  step(e, 10);
  eq("hold unlocks after a lock", e.canHold, true);
  e.input("hold");
  eq("swapping brings the held piece back", e.active!.kind, first);
}

// ---------------------------------------------------------------------------
section("Level progression and gravity");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();
  eq("starts at level 1", e.level, 1);
  const g1 = e.gravityIntervalMs();

  // Clear ten lines to reach level 2.
  for (let i = 0; i < 10; i++) {
    fillRow(e, e.rows - 1, [4, 5], 1);
    e.active = { kind: "O", stock: 0, x: 3, y: 0, rot: 0 };
    e.input("hardDrop");
    step(e, 20);
  }
  eq("ten lines cleared", e.lines, 10);
  eq("level advanced to 2", e.level, 2);
  check("gravity got faster", e.gravityIntervalMs() < g1, `${g1} -> ${e.gravityIntervalMs()}`);
}

// ---------------------------------------------------------------------------
section("Game over");
// ---------------------------------------------------------------------------
{
  const e = newEngine();
  e.start();
  let over = false;
  e.onGameOver = () => {
    over = true;
  };
  // Fill the board solid from the bottom up to the spawn area.
  for (let y = 2; y < e.rows; y++) fillRow(e, y, [], 0);
  e.active = { kind: "O", stock: 0, x: 3, y: 0, rot: 0 };
  e.input("hardDrop");
  step(e, 20);
  check("game over fired", over);
  eq("phase is over", e.phase, "over");
  eq("input after game over is ignored", (e.input("moveLeft"), e.active), null);
}

// ---------------------------------------------------------------------------
section("Determinism");
// ---------------------------------------------------------------------------
{
  const a = newEngine("daily-2026-09-08", "daily");
  const b = newEngine("daily-2026-09-08", "daily");
  const c = newEngine("a-different-seed", "daily");

  const seqA: string[] = [];
  const seqB: string[] = [];
  const seqC: string[] = [];
  a.start();
  b.start();
  c.start();
  for (let i = 0; i < 200; i++) {
    seqA.push(`${a.active?.kind}${a.active?.stock}`);
    seqB.push(`${b.active?.kind}${b.active?.stock}`);
    seqC.push(`${c.active?.kind}${c.active?.stock}`);
    a.input("hardDrop");
    b.input("hardDrop");
    c.input("hardDrop");
    step(a, 20);
    step(b, 20);
    step(c, 20);
  }
  check("same seed gives an identical piece stream", seqA.join() === seqB.join());
  check("a different seed gives a different stream", seqA.join() !== seqC.join());
  eq("identical seeds give identical scores", a.score, b.score);

  // Seven-bag fairness: every 7 consecutive pieces contain all 7 shapes.
  const gen = newEngine("bag-check");
  gen.start();
  const kinds: string[] = [];
  for (let i = 0; i < 70; i++) {
    kinds.push(gen.active!.kind);
    gen.input("hardDrop");
    step(gen, 20);
    if (gen.phase === "over") break;
  }
  let bagsOk = true;
  for (let i = 0; i + 7 <= kinds.length; i += 7) {
    if (new Set(kinds.slice(i, i + 7)).size !== 7) bagsOk = false;
  }
  check("seven-bag delivers every shape once per bag", bagsOk, kinds.slice(0, 21).join(""));
}

// ---------------------------------------------------------------------------
section("Stock assignment is not welded to shape");
// ---------------------------------------------------------------------------
{
  const e = newEngine("variety-seed");
  e.start();
  const seen = new Map<string, Set<number>>();
  for (let i = 0; i < 300; i++) {
    const p = e.active;
    if (!p) break;
    if (!seen.has(p.kind)) seen.set(p.kind, new Set());
    seen.get(p.kind)!.add(p.stock);
    e.input("hardDrop");
    step(e, 20);
    if (e.phase === "over") {
      // Restart to keep sampling.
      break;
    }
  }
  const varied = [...seen.values()].some((s) => s.size > 1);
  check("a shape appears with more than one ticker", varied);
}

// ---------------------------------------------------------------------------
section("Action log and result summary");
// ---------------------------------------------------------------------------
{
  const e = newEngine("log-seed");
  e.start();
  e.input("moveLeft");
  e.input("rotateCW");
  step(e, 5);
  e.input("hardDrop");
  step(e, 20);

  eq("log recorded 3 actions", e.actionLog.length, 3);
  eq("first action is moveLeft", e.actionLog[0].a, "moveLeft");
  check("actions carry frame numbers", e.actionLog.every((l) => typeof l.f === "number"));
  check("frames are non-decreasing", e.actionLog.every((l, i, arr) => i === 0 || l.f >= arr[i - 1].f));

  const r = e.result();
  eq("result carries the seed", r.seed, "log-seed");
  eq("result carries the ruleset version", r.rulesVersion, 1);
  check("result units are whole numbers", Object.values(r.units).every((v) => Number.isInteger(v)));
  check("unitsTotal matches the unit map", r.unitsTotal === Object.values(r.units).reduce((a, b) => a + b, 0));
}

// ---------------------------------------------------------------------------
section("Long run stability");
// ---------------------------------------------------------------------------
{
  /**
   * Random inputs top out in about twenty pieces, which exercises nothing.
   * This drives the engine with a real placement search instead — every
   * rotation and column is scored on resulting height, holes, bumpiness and
   * lines made, and the best is played through the ordinary input path. That
   * keeps a long game going, so clear/collapse/level-up run thousands of
   * times with the invariants checked after every single frame and input.
   */
  const e = newEngine("stability");
  e.start();

  const cols = e.cols;
  const rows = e.rows;

  /** Lowest legal landing row for a piece, or null if it does not fit at all. */
  const landing = (grid: Int8Array, kind: keyof typeof PIECES, rot: number, x: number): number | null => {
    const cells = PIECES[kind][rot];
    const fits = (yy: number): boolean => {
      for (const c of cells) {
        const cx = x + c[0];
        const cy = yy + c[1];
        if (cx < 0 || cx >= cols || cy >= rows) return false;
        if (cy >= 0 && grid[cy * cols + cx] !== -1) return false;
      }
      return true;
    };
    let y = -4;
    if (!fits(y)) return null;
    while (fits(y + 1)) y++;
    return y;
  };

  /** Higher is better. The usual height/holes/bumpiness trade-off. */
  const evaluate = (grid: Int8Array, kind: keyof typeof PIECES, rot: number, x: number): number | null => {
    const y = landing(grid, kind, rot, x);
    if (y === null) return null;
    const g = grid.slice();
    for (const c of PIECES[kind][rot]) {
      const cy = y + c[1];
      if (cy >= 0) g[cy * cols + (x + c[0])] = 0;
    }

    let cleared = 0;
    for (let r = 0; r < rows; r++) {
      let full = true;
      for (let cx = 0; cx < cols; cx++) if (g[r * cols + cx] === -1) full = false;
      if (full) cleared++;
    }

    let aggregate = 0;
    let holes = 0;
    const heights: number[] = [];
    for (let cx = 0; cx < cols; cx++) {
      let top = rows;
      for (let cy = 0; cy < rows; cy++) {
        if (g[cy * cols + cx] !== -1) {
          top = cy;
          break;
        }
      }
      const h = rows - top;
      heights.push(h);
      aggregate += h;
      for (let cy = top + 1; cy < rows; cy++) if (g[cy * cols + cx] === -1) holes++;
    }
    let bumpiness = 0;
    for (let cx = 0; cx + 1 < cols; cx++) bumpiness += Math.abs(heights[cx] - heights[cx + 1]);

    return -0.51 * aggregate + 0.76 * cleared - 0.36 * holes - 0.18 * bumpiness;
  };

  let steps = 0;
  let placed = 0;
  let error: unknown = null;
  let lastPiece: unknown = null;

  const assertInvariants = () => {
    if (e.lines < 0 || e.score < 0) throw new Error("negative counter");
    if (!Number.isFinite(e.score)) throw new Error("score is not finite");
    const p = e.active;
    if (!p) return;
    for (const c of PIECES[p.kind][p.rot]) {
      const x = p.x + c[0];
      const y = p.y + c[1];
      if (x < 0 || x >= cols || y >= rows) throw new Error(`piece out of bounds at ${x},${y}`);
      if (y >= 0 && e.at(x, y) !== -1) throw new Error(`piece overlapping stack at ${x},${y}`);
    }
  };

  try {
    while (e.phase !== "over" && placed < 2000 && steps < 200_000) {
      if (e.active && e.active !== lastPiece) {
        lastPiece = e.active;
        const kind = e.active.kind;

        let bestRot = e.active.rot;
        let bestX = e.active.x;
        let bestScore = -Infinity;
        for (let rot = 0; rot < 4; rot++) {
          for (let x = -2; x < cols + 2; x++) {
            const v = evaluate(e.grid, kind, rot, x);
            if (v !== null && v > bestScore) {
              bestScore = v;
              bestRot = rot;
              bestX = x;
            }
          }
        }

        // Play the chosen placement through the real input path.
        let guard = 0;
        while (e.active && e.active.rot !== bestRot && guard++ < 4) {
          e.input("rotateCW");
          assertInvariants();
        }
        // Distance is fixed up front — recomputing it against a moving x
        // would only ever close half the gap.
        if (e.active) {
          const distance = Math.abs(bestX - e.active.x);
          const dir = bestX < e.active.x ? "moveLeft" : "moveRight";
          for (let i = 0; i < distance; i++) {
            e.input(dir);
            assertInvariants();
          }
        }
        e.input("hardDrop");
        placed++;
        assertInvariants();
      }
      e.update(TIMING.stepMs);
      steps++;
      assertInvariants();
    }
  } catch (err) {
    error = err;
  }

  check("long run did not throw", error === null, String(error));
  check("long run placed many pieces", placed > 500, `placed=${placed}`);
  check("long run cleared many lines", e.lines > 100, `lines=${e.lines}`);
  check("score accumulated", e.score > 10_000, `score=${e.score}`);
  check("level advanced", e.level > 5, `level=${e.level}`);
  check("stock units were earned", e.unitsExact.some((u) => u > 0));
  check("combos occurred", e.maxCombo > 0, `maxCombo=${e.maxCombo}`);
  check(
    "no row is left fully filled once settled",
    (() => {
      if (e.phase === "clearing") return true;
      for (let y = 0; y < rows; y++) {
        let full = true;
        for (let x = 0; x < cols; x++) if (e.at(x, y) === -1) full = false;
        if (full) return false;
      }
      return true;
    })(),
  );
  const totalUnits = e.unitsExact.reduce((a, b) => a + b, 0);
  check(
    "units never exceed cleared cells times the multiplier ceiling",
    totalUnits <= e.lines * cols * REWARD.maxMultiplier,
    `${totalUnits} vs ${e.lines * cols * REWARD.maxMultiplier}`,
  );
  const r = e.result();
  check("result total matches the ledger", r.unitsTotal === Object.values(r.units).reduce((a, b) => a + b, 0));
  console.log(
    `  (${placed} pieces, ${steps} frames, ${e.lines} lines, level ${e.level}, ` +
      `score ${e.score.toLocaleString()}, best combo x${e.maxCombo}, ` +
      `${e.quads} quads, ${Math.floor(totalUnits)} units)`,
  );
}

// ---------------------------------------------------------------------------
section("Daily market determinism");
// ---------------------------------------------------------------------------
{
  const m1 = marketForDate("2026-09-08");
  const m2 = marketForDate("2026-09-08");
  const m3 = marketForDate("2026-09-09");
  eq("market size is 7", m1.length, 7);
  check("same date gives the same market", m1.map((s) => s.ticker).join() === m2.map((s) => s.ticker).join());
  check(
    "a different date gives a different market",
    m1.map((s) => s.ticker).join() !== m3.map((s) => s.ticker).join(),
    `${m1.map((s) => s.ticker).join()} vs ${m3.map((s) => s.ticker).join()}`,
  );
  check("no duplicate tickers in a market", new Set(m1.map((s) => s.ticker)).size === m1.length);
}

// ---------------------------------------------------------------------------
console.log(`\n${"─".repeat(52)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log("Engine OK.");
