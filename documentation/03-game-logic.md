# 03 — Game logic

All rules and mutable state live in the **`Game`** class (`game.ts`). Rendering never mutates it;
input and the frame loop drive it. Constants (board size, shapes, colors, timings) come from
`constants.ts`.

## Board & pieces

- The board is `COLS × ROWS` = **10 × 20**, each cell `CELL` = **30** logical px.
- The grid is `(Cell | null)[][]`. A settled `Cell` stores its `color`, the `settle` timestamp
  (for the landing squish), and an optional transient `expr` / `exprUntil` (bicker/celebrate).
- The seven tetrominoes are defined as `SHAPES` matrices (`1` = filled) and each has a fixed pastel
  `COLORS` entry. `TYPE_BY_COLOR` reverse-maps a cell's hex color back to its piece type, which the
  sprite system uses to pick the right sheet.

`rotate(m)` returns a 90°-clockwise copy of a square matrix. Counter-clockwise is done by rotating
three times.

## State

`Game` holds, among others:

- **Board / piece:** `grid`, `current` (the active `Piece`), `nextQueue`, `bag` (`SevenBag`).
- **Progress:** `score`, `lines`, `level`, `combo`.
- **Timing:** `dropInterval`, `dropCounter`, `lastTime`, `lockTimer`, `lockResets`, `softDrop`.
- **Status:** `status` — one of `ready | playing | paused | clearing | over`.
- **Clear animation:** `clearInfo` (`{ rows, start, count }`) while rows are animating out.
- **Cosmetic/fx state:** `particles`, `popups`, `ambient`, plus `blink`, `glance`, `bounce`,
  `cheerUntil`, `dangerNow`, `nextBicker` (mostly read/advanced by the renderer and `fx.ts`).

## Randomizer — 7-bag (`rng.ts`)

`SevenBag` deals all seven piece types in a shuffled order, then reshuffles — the standard modern
guarantee that you never go too long without a given piece and never get long same-piece streaks.
`Game` keeps a 3-deep `nextQueue`; `spawn()` shifts the front and pushes one fresh draw, so the
"Next" preview always shows the upcoming piece.

## Lifecycle of a piece

1. **spawn** — pop the next type, build its `Piece` centered at the top (the `I` piece starts at
   `y = -1`). Reset lock state. If the fresh piece already collides, it's **game over**.
2. **move / rotate** — `move(dx)` and `doRotate(dir)` only apply if the result doesn't `collide`.
   Rotation tries wall kicks by testing horizontal offsets `[0, -1, +1, -2, +2]` and taking the
   first that fits. Successful moves play a sound and may reset the lock timer.
3. **fall** — `tick` accumulates `dt` into `dropCounter`; when it exceeds the drop interval the
   piece steps down one cell (`softStep`). Soft drop clamps the interval to ≤ 60 ms and awards
   +1 per cell.
4. **lock** — when the piece can't step down, a **lock timer** starts; once `LOCK_DELAY` (480 ms)
   elapses the piece locks. A **hard drop** (`hardDrop`) skips the wait: it drops to the bottom,
   awards +2 per cell, puffs hearts at the landing, and locks immediately.
5. **lockPiece** — stamps the piece's cells into `grid` (with `settle` timestamps). If any cell
   would sit above the top (`ny < 0`), it's game over. Then it scans for full rows.

### Lock delay & resets

`onMoveResetLock` implements the "infinity-lite" behaviour: while the lock timer is running, a move
or rotation that leaves the piece still grounded restarts the timer — but only up to **15 resets**,
so you can nudge a piece into place without stalling forever.

## Line clears

If `lockPiece` finds full rows it switches `status` to `clearing`, records `clearInfo`, and spawns
the clear effects (`spawnClearFx`). The renderer animates those rows hopping and fading for
`CLEAR_DUR` (460 ms); when that elapses `tick` calls `resolveClear`:

- Rebuild the grid without the cleared rows (surviving rows fall down).
- Add the line-clear score, bump combo/level, check for a perfect clear.
- Mark the surviving cells with a short **`celebrate`** expression and play a celebration voice
  clip — the blocks cheer for the friends who just cleared.
- Spawn the next piece and return to `playing`.

## Scoring

| Event | Points |
| --- | --- |
| Soft drop | +1 per cell |
| Hard drop | +2 per cell |
| 1 / 2 / 3 / 4 lines | 100 / 300 / 500 / 800 × level |
| Combo (2+ consecutive clears) | +50 × combo × level, with a "combo x N 💕" popup |
| Level up | chime + "level N! ✦" popup |
| Perfect clear (board empty after a clear) | +1000 × level, "perfect!! ✧✧", heart burst |

`combo` increments on each clearing lock and resets to 0 whenever a piece locks with no lines
cleared.

## Levels & speed

`level = 1 + floor(lines / 10)` — every 10 lines. The drop interval starts at **800 ms** and
tightens with level: `dropInterval = max(90, 800 − (level − 1) × 68)`, so higher levels fall much
faster (floored at 90 ms).

## Status flow

```
ready ──play──► playing ──lock w/ full rows──► clearing ──(CLEAR_DUR)──► playing
  ▲               │  ▲                                                      │
  │            pause│ │resume                                              │
  │               paused                                                   │
  └──────────── over ◄──────────── piece spawns/locks above the top ◄──────┘
                 (play again resets to a new game)
```

- `initIdle()` sets up the **attract** state (empty board, ambient hearts, a queued preview) shown
  under the start overlay before the first game.
- `newGame()` resets everything, hides the overlay, and spawns the first piece.
- `togglePause()` flips between `playing` and `paused`, showing/hiding the nap overlay and swapping
  the pause-button icon.
- `gameOver()` sets `over`, rains hearts, and shows the "all snuggled up!" overlay with the final
  score.

## `tick(time)` in one place

```ts
tick(time) {
  dt = time - lastTime; lastTime = time;
  if (playing) {
    dropCounter += dt;
    interval = softDrop ? min(60, dropInterval) : dropInterval;
    if (dropCounter > interval) { dropCounter = 0; softStep() ? maybe+score : startLockTimer(); }
    if (lockTimer set && time - lockTimer >= LOCK_DELAY) lockPiece();
    updateBicker(time);          // occasional neighbour spats, more often when stacked high
  } else if (clearing) {
    if (now - clearInfo.start >= CLEAR_DUR) resolveClear();
  }
  updateFx(this);                // advance particles, popups, ambient hearts (always)
}
```
