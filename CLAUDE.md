# CLAUDE.md

Guidance for working in this repo.

## What this is

**Tetromochi** — a cute canvas Tetris ("mochi" blocks with faces + a reactive rabbit mascot),
written in TypeScript and bundled with esbuild. It started life as a single self-contained
`Tetromochi.html` (still in the repo as the reference/baseline) and was ported to a proper
TypeScript app under `src/`.

## Commands

```bash
pnpm install        # install deps (pnpm is the package manager)
pnpm dev            # esbuild watch + serve at http://localhost:8000/
pnpm build          # minified bundle → dist/ (js, css, copied index.html)
pnpm typecheck      # tsgo --noEmit  (native TS compiler, @typescript/native-preview)
pnpm lint           # eslint .
pnpm format         # prettier --write .   (uses the @pathtx/prettier fork)
pnpm check          # typecheck + lint + prettier --check   (run this before finishing)
```

Toolchain is deliberate: **pnpm**, **tsgo** (not `tsc`) for typecheck, **esbuild** for
bundling+serving, **ESLint** flat config with `typescript-eslint`, and the **`@pathtx/prettier`**
fork (it ships the `prettier` bin, so `node_modules/.bin/prettier` is the fork).

## Architecture (`src/`)

State and rendering are separated; everything is wired together in `main.ts`.

- `main.ts` — thin bootstrap: makes clouds, constructs `AudioEngine`/`Ui`/`Renderer`/`Game`,
  attaches input, runs the `requestAnimationFrame` loop (`game.tick(time)` then `renderer.draw(game)`).
- `game.ts` — **`Game`** class owns all mutable state (grid, current piece, score, timers,
  particles, etc.) and the rules: `spawn/collide/move/doRotate/hardDrop/lockPiece/resolveClear/tick`.
- `renderer.ts` — **`Renderer`** class holds the 3 canvas contexts; reads a `Game` each frame to
  draw the board, next-piece preview, and mascot. Stateless w.r.t. game logic.
- `fx.ts` — particle/popup/ambient spawning + per-frame update; functions that operate on a `Game`.
- `audio.ts` — **`AudioEngine`**: Web Audio synthesis (no audio files), `sfx(name)`, mute.
- `ui.ts` — **`Ui`**: the DOM that reflects state (stat readouts, overlay, pause icon).
- `input.ts` — keyboard + pointer/touch wiring → `Game` methods.
- `constants.ts` — board dims, `SHAPES`, `COLORS`, `TYPES`, timings, `rotate()`.
- `rng.ts` — **`SevenBag`** randomizer. `draw-helpers.ts` — pure canvas drawing helpers.
- `dom.ts` — `el`/`canvas`/`ctx2d` lookups that **throw** if missing (no casts).
- `types.ts` — shared types. `env.d.ts` — `declare module '*.css'` for the side-effect import.

## Conventions & gotchas

- **Type safety:** `strict` is on; keep `src/` at **zero `any`, zero `as` casts**. Prefer real
  guards (`if (!this.current) return`) over `!`. `dom.ts` helpers throw instead of casting nulls.
- **Import extensions:** intra-`src` imports use explicit `.ts` (e.g. `'./game.ts'`), enabled by
  `allowImportingTsExtensions`. Don't rewrite them to `.js`. `verbatimModuleSyntax` is on, so
  type-only imports must use `import type`.
- **Bundle is IIFE, not ESM, on purpose.** `scripts/esbuild.config.mjs` sets `format: 'iife'` and
  `index.html` uses a classic `<script src="./main.js">` (no `type="module"`). This lets the built
  `dist/index.html` run when opened directly from disk (`file://`) — ES-module scripts are
  CORS-blocked over `file://`. Don't switch it back to ESM/module without restoring that.
- **Start overlay shows on load.** `index.html`'s overlay has the `show` class initially so the
  "ready? / play ♪" screen is visible; otherwise the game looks idle/broken (it only starts on
  click or Space/Enter, and the idle board doesn't drop pieces).
- **Fonts** load from the Google Fonts CDN (Fredoka + Quicksand); the saved `Tetromochi_files/`
  snapshot is unused.
- `keys/` and `dist/` are gitignored. `Tetromochi.html` is the original reference — leave it as is.
- `tsgo` is preview software; stock `tsc --noEmit` is the fallback if it misbehaves.

## Verifying changes

A clean `pnpm check` does **not** prove the game works — always run it and watch behavior. The
fastest loop: `pnpm build` then open `dist/index.html`, or `pnpm dev` and visit localhost. When
checking gameplay, exercise: move/rotate/soft+hard drop, line clears, combo, level-up, perfect
clear, pause, mute, game-over, and the mascot moods.
