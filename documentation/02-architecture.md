# 02 — Architecture

The guiding principle is a clean **state / rendering split**: one object owns the mutable game
state and the rules that change it, another reads that state and paints pixels. They're wired
together in `main.ts`, which also runs the animation loop.

## Module map (`src/`)

| Module | Role |
| --- | --- |
| `main.ts` | Thin bootstrap: build the objects, attach input, start the rAF loop. |
| `game.ts` | **`Game`** — owns all mutable state and the rules (spawn, move, rotate, drop, lock, clear, tick). |
| `renderer.ts` | **`Renderer`** — holds the 3 canvas contexts; reads a `Game` each frame to draw. Stateless w.r.t. game logic. |
| `fx.ts` | Particle / popup / ambient spawning and per-frame update; free functions operating on a `Game`. |
| `audio.ts` | **`AudioEngine`** — Web Audio synthesis (`sfx`) + sampled voice clips (`playClip`), mute. |
| `ui.ts` | **`Ui`** — the DOM that reflects state (stat readouts, overlay, pause icon). |
| `input.ts` | Keyboard + pointer/touch wiring → `Game` methods. |
| `constants.ts` | Board dims, `SHAPES`, `COLORS`, `TYPES`, timings, `rotate()`, `TYPE_BY_COLOR`. |
| `rng.ts` | **`SevenBag`** randomizer. |
| `draw-helpers.ts` | Pure canvas drawing helpers (`drawBlock`, `drawHeart`, `drawStar`, `rr`, color `mix`). |
| `sprites.ts` | Loads & slices sprite sheets into per-expression frames; picks the active frame. |
| `sprite-sets.ts` | Declares the selectable skins (id, label, per-piece sheet URLs). |
| `sprite-select.ts` | Builds the skin dropdown and persists the choice to `localStorage`. |
| `dom.ts` | `el` / `canvas` / `ctx2d` lookups that **throw** if missing (no casts). |
| `types.ts` | Shared type/interface definitions. `env.d.ts` — `declare module '*.css'`. |

## Ownership & dependencies

`Game` is the hub of mutable state. It depends on `AudioEngine` and `Ui` (injected via its
constructor) so it can make sounds and push numbers/overlays to the DOM as rules fire. `fx.ts`
functions take a `Game` and mutate its particle/popup/ambient arrays. `Renderer` depends only on
reading a `Game` — it never calls back into game logic except the pure `game.collide(...)` helper
(used to compute the hard-drop ghost outline).

```
main.ts
  ├── AudioEngine ◄──────────┐
  ├── Ui ◄───────────────┐   │
  ├── Renderer (reads) ──┼── Game ──► fx.ts (mutates Game)
  └── attachInput ───────┘   └──► SevenBag, constants, sprites/draw-helpers
```

Sprites are a mostly-independent subsystem: `sprite-select.ts` runs at startup to build the
dropdown and set the active skin; `draw-helpers.drawBlock` asks `sprites.blockFrame(...)` for a
frame and falls back to procedural drawing when none is loaded. See
[07 — Sprites & skins](07-sprites-and-skins.md).

## The bootstrap (`main.ts`)

```ts
makeClouds();            // decorative drifting clouds in the #sky div
attachSpriteSelect();    // build skin dropdown, restore saved choice, load active sheets

const audio = new AudioEngine();
const ui = new Ui();
const renderer = new Renderer();
const game = new Game(audio, ui);

attachInput(game, audio);
game.initIdle();         // empty board + ambient hearts + a queued preview (attract screen)

function frame(time) {
  game.tick(time);       // advance simulation by one frame
  renderer.draw(game);   // paint the current state
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

## The frame loop

Every animation frame does exactly two things, in order:

1. **`game.tick(time)`** — advance the simulation. Uses the rAF timestamp to compute `dt`,
   accumulates it into a drop counter, steps the piece down when the interval elapses, runs the
   lock-delay timer, drives the "bicker" scheduler, and updates all particles/popups. It only
   simulates while `status === 'playing'` (plus a `clearing` branch that waits out the clear
   animation). See [03 — Game logic](03-game-logic.md).
2. **`renderer.draw(game)`** — read the state and paint the three canvases. The renderer computes
   *presentation-only* animation itself (blink timers, glance direction, settle squish, danger
   detection, mascot mood) so the game state stays about rules, not cosmetics. See
   [04 — Rendering](04-rendering.md).

The loop runs continuously regardless of `status`, so the attract screen, pauses, and game-over
all keep animating (clouds drift, hearts float, the mascot bobs).

## Time & timestamps

Two clocks are in play, both in milliseconds:

- The **rAF timestamp** passed to `frame(time)` drives the drop cadence and lock delay in `tick`.
- **`performance.now()`** is read ad hoc for cosmetic timers (blink/glance schedules, cell
  `settle` and `expr` expiry, mascot `cheerUntil`, bicker scheduling). These are close enough to
  the rAF clock for the purpose and keep the render/fx code from having to thread `time` everywhere.

## Type safety & DOM access

`strict` is on and `src/` keeps **zero `any`, zero `as` casts**. Real guards (`if (!this.current)
return`) are preferred over non-null `!`. The `dom.ts` helpers (`el`, `canvas`, `ctx2d`) throw with
a clear message if the expected markup is missing, so the rest of the code can treat elements and
contexts as present without casting away `null`.
