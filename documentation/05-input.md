# 05 — Input

`attachInput(game, audio)` in `input.ts` wires every control to `Game` methods. It covers three
surfaces: the header buttons, the physical keyboard, and touch/pointer gestures (both the on-screen
D-pad and dragging directly on the board).

## Starting & the audio gesture

`startGame()` is the single entry point for beginning play. It **must** run from a user gesture
because browsers block audio autoplay, so it lives on the click/keydown handlers and does, in order:

```ts
audio.init(); // create the AudioContext + master gain (first time only)
audio.resume(); // resume if the context started suspended
audio.initClips(); // preload the sampled voice clips
game.newGame();
```

From the `ready` or `over` states, **any** start trigger (play button, Space/Enter, tapping a pad
button, or touching the board) calls `startGame()` rather than performing a move — so the same tap
that dismisses the overlay doesn't also rotate a piece.

## Header buttons

- **play** (`#playBtn`) → `startGame()`.
- **pause** (`#pauseBtn`) → `game.togglePause()` (only while playing/paused).
- **mute** (`#muteBtn`) → toggles `audio.muted`, swaps the 🔊/🔇 glyph and an `off` class.

## Keyboard

| Key                               | Action                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| ← / →                             | `move(-1)` / `move(1)`                                             |
| ↓                                 | hold to soft drop (`softDrop = true` on keydown, `false` on keyup) |
| ↑ or **X**                        | rotate clockwise (`doRotate(1)`)                                   |
| **Z**                             | rotate counter-clockwise (`doRotate(-1)`)                          |
| **Space**                         | hard drop                                                          |
| **P**                             | pause / resume                                                     |
| **M**                             | mute toggle                                                        |
| Enter / Space (on `ready`/`over`) | start game                                                         |

Arrow keys and Space are `preventDefault`ed so the page doesn't scroll. While in `ready`/`over`,
only the start keys are honored; everything else is ignored until play begins.

## On-screen D-pad

The four `.cbtn` buttons (left / spin / right / drop) are wired with a `holdBtn` helper that uses
**pointer events**:

- Left/right **repeat** while held: fire once immediately, then after a 180 ms delay begin
  auto-repeating every 90 ms until release. Spin and drop are single-shot (no repeat).
- Release/leave/cancel clears the repeat timers.

## Board gestures (`attachBoardGestures`)

Dragging on the board canvas itself is a full touch control scheme:

- **Drag sideways** → move one cell per cell-width travelled. It tracks a running `stepX` and emits
  a `move(±1)` each time the finger crosses another cell boundary, so fast drags move several cells.
- **Tap** (little travel, quick release: `maxTravel < 10 px` and `< 300 ms`) → rotate clockwise.
- **Drag down** past ~0.6 cell (and more vertical than horizontal) → engage soft drop; releasing or
  moving back up disengages it. `setSoft` de-dupes so it only flips `game.softDrop` on change.
- **Quick downward flick** (`< 260 ms`, `dy > 2 cells`, clearly vertical) → hard drop.

Pointer capture is taken on `pointerdown` (guarded in a try/catch since some synthetic pointer ids
can't be captured), and `preventDefault` keeps the gesture from scrolling the page or triggering
browser touch behaviours.

## Note on `e.code`

The keyboard layer reads `e.code` (physical key position), not `e.key`. This is why the CDP
screenshot/driving harness dispatches synthetic events like
`new KeyboardEvent('keydown', { code: 'ArrowLeft' })` — see `CLAUDE.md`.
