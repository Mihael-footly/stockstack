# StockStack

**Stack the market.** A browser block-stacker where every falling piece is a
stock. Clear a line and every ticker inside it goes into your stockpile.

Play at `/play` — no account, no download, no loading screen.

---

## What it is

Seven piece shapes fall into a ten-by-twenty well. Each piece is dealt a ticker
from the day's market, and that ticker stays with the block: it is still there
when the block is buried, and it is what pays out when the row finally clears.
Clearing four rows at once pays 1.75× per block; chaining clears fills a
momentum meter that triggers a **Market Pump**; a five-combo or three
back-to-back four-line clears sets off a **Bull Run**.

Two currencies, deliberately kept apart:

- **Score** measures skill. Classic line/combo/drop scoring.
- **Stock units** are the economy — in-game collectibles, counted per ticker.

They use different curves on purpose, so playing for points and playing for
units are not the same game.

> Stock units are collectibles. They are not shares, securities, or tokens,
> they cannot be bought, sold or redeemed, and they carry no monetary value.
> The on-chain tables exist but no settlement backend is configured, so nothing
> has been promised to anyone. See `supabase/migrations/*_versus_and_chain.sql`.

## Running it

```bash
npm install
cp .env.example .env.local   # fill in from the Supabase dashboard
npm run dev
```

The game itself has no backend dependency. With Supabase unreachable it still
plays — you get an `OFFLINE` badge and nothing is banked, which is the honest
trade rather than a blocked Play button.

## Architecture

The simulation is a plain TypeScript state machine with no DOM, no React and no
clock of its own. Time arrives as an argument, and it advances only in fixed
steps, so the same seed and the same inputs produce the same game on any
refresh rate — which is what makes the Daily Run fair and a replay checkable.

```
src/game/
  GameEngine.ts      board, movement, rotation, gravity, locking, clears
  PieceGenerator.ts  seven-bag shapes; stock drawn separately by rarity
  ScoringSystem.ts   score and reward multipliers
  EventSystem.ts     Market Pump and Bull Run — both earned, never random
  Renderer.ts        canvas drawing; block faces cached as sprites
  InputManager.ts    keyboard (with DAS/ARR) and touch gestures
  AudioManager.ts    original arcade audio, synthesised at runtime
  EffectsManager.ts  flashes, particles, floating labels
  GameLoop.ts        fixed-step simulation, decoupled rendering
  AutoPlayer.ts      placement search — drives the landing demo and the tests
  config.ts          every tunable number, in one file
```

React never sees a frame. The loop pushes a HUD snapshot about fifteen times a
second; the board draws at the display's rate. `setState` at 60fps is the usual
reason browser games built on React feel sluggish.

### Server authority

Every table that holds a score, a balance or XP has row-level security with no
insert or update policy. A client with a valid JWT cannot write one. The only
way in is two `SECURITY DEFINER` functions that check first:

- `start_game_session` chooses the seed and the market. The client does not.
- `submit_game_result` bounds the claim against the session — wall-clock
  elapsed, lines against pieces placed, score against a per-run ceiling, units
  against the multiplier cap, and input and placement rates against what a
  human can do. A run that fails is stored and marked, not silently dropped,
  and earns nothing.

`POST /portfolio/add {"NVDA": 1000000}` has nowhere to land.

## Testing

```bash
npm test              # 116 engine tests, headless, no browser
npx tsx test/backend.ts     # 30 RLS and anti-cheat checks against the live project
npx tsx test/acceptance.ts  # 50 checks: the full loop in a real browser
npx tsx test/mobile.ts      # 103 checks across four device sizes
```

Plus `supabase/tests/signed_in_path.sql` for the authenticated award path,
which the browser tests cannot reach because they play as a guest.

The engine tests drive a real placement bot for two thousand pieces and assert
the invariants after every frame and every input. The acceptance test plays a
genuine game through the page's own keyboard handler — clears, combos, a
four-line clear, a market event, a level-up, a top-out — and then checks the
result screen says something true about it.

## Not built yet

**1v1.** The schema, the attack table and the garbage mechanics are in place
and the engine emits attacks, but matchmaking and the realtime transport are
not wired up. Solo and the Daily Run are the finished game; versus arrives once
they are perfect, which is the order the work was asked for.

**On-chain settlement.** `wallet_connections`, `reward_pools` and
`onchain_reward_transactions` exist, with a constraint that an allocation can
never exceed what has actually been funded. Nothing is connected, the default
status is `unconfigured`, and the portfolio says so on its face.
