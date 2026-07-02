# 08 — Effects & cuteness

The "juice" that makes Tetromochi cute is spread across `fx.ts` (particles, popups, ambient),
`Game` (expressions, moods, scheduling), and the `Renderer` (drawing them). This doc collects it in
one place.

## Three fx collections on `Game`

| Collection | What it is | Spawned by | Updated by |
| --- | --- | --- | --- |
| `particles` | stars / hearts / dots with velocity, gravity, spin, and life | clears, hard drop, game over, bicker, perfect clear, random twinkle | `updateFx` |
| `popups` | floating text that rises and fades | clears, combo, level, perfect, bicker `💢` | `updateFx` |
| `ambient` | slow background hearts that drift up and wrap around | `initAmbient` (idle & new game) | `updateFx` |

`updateFx(game)` runs every frame (from `tick`, regardless of status): it integrates each particle
(position, gravity, spin, life; culled at life ≤ 0), rises/fades popups, drifts ambient hearts and
wraps them at the top, and — unless reduced motion — occasionally spawns a white twinkle star.

## Particle spawners (`fx.ts`)

- **`spawnClearFx(rows)`** — the big one. Sets `cheerUntil` (mascot cheers ~1.2 s), plays the right
  chime (`tetris` for 4 lines, else `clear1/2/3`), adds a randomized encouraging popup ("nice! ♡",
  "double! 💕", "TETRIS!! ✦", …), and sprays a palette of stars/hearts/dots from each cleared row.
- **`burstHearts()`** — a radial heart explosion from board center, used on a perfect clear.
- **`addBickerFx(x, y)`** — a small `💢` popup plus a few red sparks between two squabbling cells.
- **`addPopup(text, color, scale?, y?)`** — the generic floating-text helper.
- **Hard-drop puff** — spawned inline in `Game.hardDrop`: small hearts at the piece's bottom edge
  where it lands.
- **Game-over rain** — hearts falling from the top, spawned in `Game.gameOver`.

## Block expressions

Each mochi block shows a `Face`: `calm | happy | blink | worried | bicker | celebrate | none`.
Most are chosen *at render time* by the `Renderer` (blink schedule, glance, danger → worried), but
two are **stateful**, stored on the cell as `expr` + `exprUntil` and honored until they expire:

- **`celebrate`** — set on all surviving cells for ~1.3 s after a line clear (in `resolveClear`);
  the survivors visibly cheer, and a `celebrate` voice clip plays.
- **`bicker`** — set on a random adjacent pair by the bicker scheduler.

### The bicker scheduler (`Game.updateBicker`)

Occasionally two horizontally-neighbouring settled blocks squabble: both get the `bicker` face for
~1.1 s, a `💢` popup and sparks appear, and a pitched-up `bicker` voice clip plays. The frequency
scales with how tall the stack is (`stackHeight`): roughly one spat every ~7 s on an empty-ish
board, down to sub-second when stacked high — so a dangerous board feels tense and chattery. The
renderer adds a horizontal jitter to bickering faces.

## Mascot moods

The rabbit's mood is derived every frame from game state (see [04 — Rendering](04-rendering.md)):
`sleep` (paused), `sad` (over), `cheer` (`now < cheerUntil`, i.e. just after a clear), `worried`
(playing + `dangerNow`), else `idle`. It has no state machine of its own — it's a pure function of
`status`, `dangerNow`, and `cheerUntil`.

## Danger

`dangerNow` (set by the renderer when any cell is in the top 4 rows during play) is the shared
"getting scary" signal: it turns upper blocks' faces `worried`, makes the mascot fret, and — via
taller `stackHeight` — makes the blocks bicker more.

## Reduced motion

`reduceMotion` (from `prefers-reduced-motion`, in `constants.ts`) is respected throughout: it
suppresses the random twinkle, the heart burst, and bicker sparks, and reduces particle counts for
clears, hard-drop puffs, and the game-over rain (and skips the hard-drop board bounce). The game
stays fully playable and cute, just calmer.
