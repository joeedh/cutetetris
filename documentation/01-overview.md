# 01 — Overview

## What it is

**Tetromochi** is a self-contained, single-player Tetris. The twist is entirely presentational:

- Each settled block is a rounded "mochi" with a face that blinks, glances, worries when the
  stack gets tall, and bickers with its neighbours.
- A rabbit **mascot** beside the board reacts to the game — idle bob, cheering on clears, worried
  when you're near the top, asleep when paused, sad on game over.
- Clears spray **particles** (stars, hearts, dots) and floating **popups** ("nice! ♡", "TETRIS!!",
  "perfect!!"), with synthesized chimes and little sampled voice clips.

Mechanically it's standard modern Tetris: a 10×20 board, seven tetrominoes, a 7-bag randomizer,
soft/hard drop, wall-kick rotation, lock delay, line-clear scoring, combos, levels that speed up
the drop, and a perfect-clear bonus.

## Tech stack

- **TypeScript**, `strict` mode, zero `any` / zero `as` casts in `src/` (see `CLAUDE.md`).
- **esbuild** bundles `src/main.ts` into a single **IIFE** `main.js` plus `main.css`.
- **HTML5 Canvas 2D** for all game graphics (three separate `<canvas>` elements).
- **Web Audio API** for sound effects (synthesized live — no sound files for SFX). A handful of
  `.ogg` voice clips are the only bundled audio assets.
- No framework, no runtime dependencies. The DOM chrome (header, stat bar, overlay, touch pad) is
  plain HTML in `src/index.html`.

## Why an IIFE bundle (not ES modules)

The build emits a classic `<script src="./main.js">` in the IIFE format on purpose: it lets the
built `dist/index.html` run when opened directly from disk (`file://`), where ES-module scripts are
CORS-blocked. This is also what makes the NW.js desktop build work with no separate entry point.
Don't switch the bundle back to `type="module"` without restoring `file://` support.

## Build & run

Commands (pnpm is the package manager; see `CLAUDE.md` for the full list):

```bash
pnpm dev      # esbuild watch + serve at http://localhost:8000/
pnpm build    # minified bundle → dist/ (main.js, main.css, index.html + assets)
pnpm nwjs     # build + launch as a desktop app via NW.js
pnpm check    # typecheck (tsgo) + eslint + prettier --check
```

The app boots when `main.js` runs (see [02 — Architecture](02-architecture.md)). Nothing drops
until the player starts: `index.html`'s overlay carries the `show` class initially so the
"ready? ♡ / play ♪" screen is visible on load. Play begins on click of **play**, or pressing
**Space** / **Enter**.

## The reference original

The repo still contains `Tetromochi.html`, the original single-file version this app was ported
from. It's kept as a baseline/reference and is not part of the build — leave it as is.
