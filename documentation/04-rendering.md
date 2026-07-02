# 04 — Rendering

The **`Renderer`** (`renderer.ts`) paints everything from `Game` state each frame and holds no
game logic. It owns three canvases and their 2D contexts:

- **`board`** — the play field (`COLS·CELL × ROWS·CELL` = 300 × 600 logical px).
- **`nextCanvas`** — the next-piece preview (84 × 60).
- **`mascot`** — the rabbit (84 × 84).

## High-DPI handling

`setupCanvas` sets the **backing store** size to the logical size × `devicePixelRatio` (capped at
2.5) and applies a matching `setTransform` scale, so all drawing code works in logical CSS-pixel
coordinates while staying crisp on retina/zoomed displays. The _display_ size is set in CSS so the
layout can scale the board down to fit short viewports.

## What `draw(game)` paints (board), in order

1. **Background** — rounded panel fill, a faint grid, and a dot texture.
2. **Ambient hearts** — the slow floating hearts behind the blocks (from `game.ambient`).
3. **Danger detection** — sets `game.dangerNow` if any cell sits in the top 4 rows while playing.
   This is the one bit of state the renderer writes; it drives worried faces and the mascot mood.
4. **Board bounce** — a short vertical squash after a hard drop (`game.bounce`).
5. **Settled cells** — every non-null grid cell as a mochi block (see below). Cells whose block is
   out on an idle antic (`anticsHiddenKeys`) are skipped here.
6. **Idle antics** — `drawAntics` draws any out-and-about blocks at their animated positions (plus
   the cards prop), over the settled stack but under the falling piece. See
   [08 — Effects & cuteness](08-effects-and-cuteness.md).
7. **Active piece** — a faint **ghost** at the landing position (computed with `game.collide`),
   then the piece itself. Its face is `worried` while the lock timer runs, else `blink`/`calm`.
8. **Particles** — stars, hearts, and dots from `game.particles`.
9. **Popups** — floating text ("nice! ♡", "TETRIS!!", combo/level/perfect) from `game.popups`.
10. **Mascot** and **next-piece preview**.

## Per-cell animation

The renderer computes several _cosmetic_ animations itself so the game state stays rules-only:

- **Settle squish** — `settleScale(now - cell.settle)` returns a damped sine wobble (wider-then-
  taller) for ~360 ms after a cell lands.
- **Idle breathing** — a tiny per-cell scale oscillation phased by `(x, y)` so the field gently
  pulses out of sync.
- **Blink** — a shared blink schedule (`game.blink`): every ~2.2–4.8 s, closed for ~140 ms.
- **Glance** — a shared glance schedule (`game.glance`): occasionally the eyes look left/right for
  ~700 ms; passed into `drawBlock` as a pupil offset.
- **Expression override** — if a cell has a live `expr`/`exprUntil` (bicker or celebrate), that
  face wins; `bicker` also adds a small horizontal jitter. Otherwise the face is `worried` (danger,
  upper rows), `blink`, or `calm`.

### Clearing rows

While `status === 'clearing'`, cells in the clearing rows are drawn hopping up and scaling with a
`happy` face, fading out over the clear progress `clearP` (0→1 across `CLEAR_DUR`). Non-clearing
cells draw normally. When the animation completes, `Game.resolveClear` actually removes the rows.

## Drawing a block (`draw-helpers.drawBlock`)

`drawBlock(ctx, px, py, size, color, opts)` is the shared block renderer used by the board, the
ghost, and the preview. It first tries the **sprite path**: it looks up the piece type via
`TYPE_BY_COLOR` and asks `sprites.blockFrame(type, face)` for a pre-sliced watercolor frame; if one
is loaded it's drawn (with the requested scale/alpha) and that's it.

If no sprite is available (sheet still loading, or the color has no matching type), it falls back to
**procedural drawing**: a rounded-rect body, a soft top highlight and bottom shadow (via color
`mix` toward white/dark), an outline, blush cheeks, and a face. Faces (`calm`, `happy`, `blink`,
`worried`, plus a default with pupils + glance offset, or `none` for the ghost) are drawn with arcs
and lines. See [07 — Sprites & skins](07-sprites-and-skins.md) for the sprite side.

`BlockOpts` = `{ face?, alpha?, scaleX?, scaleY?, glance?, flipX?, pose? }`. Scale is applied about
the block's center so squish/breathing don't shift its position; `flipX` mirrors the block in place
(used for walk direction in the antics), and `pose` asks for an action-sheet frame first, falling
back to `face` when the skin has none.

## Next-piece preview (`drawNext`)

Reads `nextQueue[0]`, computes the shape's tight bounding box, picks a cell size that fits the
84×60 canvas (capped at 20 px), centers it, and draws each filled cell as a `calm`-faced block.

## The mascot (`drawMascot`)

The rabbit is drawn entirely procedurally (no sprite). Its **mood** is derived from game state:

| Mood      | When                                                                            |
| --------- | ------------------------------------------------------------------------------- |
| `sleep`   | paused — closed eyes, drifting "z z"                                            |
| `sad`     | game over — teardrops, downturned mouth                                         |
| `cheer`   | shortly after a clear (`now < game.cheerUntil`) — arms up, hops, orbiting stars |
| `worried` | playing **and** `game.dangerNow` — shivers side to side, sweat drop             |
| `idle`    | otherwise — gentle bob, occasional blink                                        |

The body is a circle with triangular ears (inner pink + a little bow on one ear); the eyes, mouth,
and extras (tears, sweat, sparkles, "z"s) are swapped per mood. A vertical bob (`sin(now·0.003)`)
runs always; cheer adds hop offset and orbiting stars; worried adds a horizontal jitter.

Because mood is recomputed every frame from `status`, `dangerNow`, and `cheerUntil`, the mascot
tracks the game with no explicit state machine of its own.
