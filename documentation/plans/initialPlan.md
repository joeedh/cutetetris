# Plan: Port Tetromochi to a TypeScript app

## Overview

`Tetromochi.html` is currently a single self-contained file: an HTML shell with an
inline `<style>` block and one ~590-line IIFE of JavaScript (canvas Tetris with a
"mochi" theme). This plan converts it into a proper TypeScript application with a
modern toolchain, refactoring the game into a `Game` class plus supporting modules.

## Target toolchain

| Concern         | Tool                                                              |
| --------------- | ----------------------------------------------------------------- |
| Package manager | **pnpm**                                                          |
| Typecheck       | **tsgo** (`@typescript/native-preview`), `tsgo --noEmit`          |
| Bundle          | **esbuild** (JS API via `scripts/build.mjs`) → `dist/`            |
| Dev server      | **esbuild** `context.serve()` + `context.watch()` serving `dist/` |
| Lint            | **ESLint** flat config + `typescript-eslint`                      |
| Format          | **`@pathtx/prettier`** (prettier fork) + `eslint-config-prettier` |

## Decisions (confirmed)

- **Core structure:** Refactor the single IIFE into a `Game` class holding all mutable
  state as fields, plus supporting modules (renderer, fx, input, audio). Cleaner
  app architecture; verify against baseline to catch any behavior drift.
- **Output mode:** `dist/` build + esbuild serving `dist/`. Build writes JS/CSS/HTML to
  `dist/`; the dev server watches and serves `dist/`. Matches a real deploy.

## Target layout (Game-class architecture)

```
cutetetris/
  package.json · pnpm-lock.yaml · tsconfig.json
  eslint.config.js · .prettierrc.json · .gitignore   # node_modules, dist, keys/
  scripts/
    build.mjs           # esbuild → dist/ (js, css, html)
    serve.mjs           # esbuild context.watch() + serve(servedir: dist)
  src/
    index.html          # shell; Google Fonts CDN link; refs main.js + styles.css
    styles.css          # extracted from <style>
    main.ts             # bootstrap: build Game, attach input, start RAF loop
    constants.ts        # COLS/ROWS/CELL, SHAPES, COLORS, TYPES, LOCK_DELAY, CLEAR_DUR
    types.ts            # PieceType, Piece, Cell, Particle, Popup, Ambient, Face, Mood, GameStatus
    rng.ts              # SevenBag (refill/next)
    draw-helpers.ts     # rr, drawStar, drawHeart, hex2rgb, mix, drawBlock  (pure, ctx-param)
    audio.ts            # AudioEngine: init/tone/sfx, muted state
    game.ts             # class Game — all mutable state as fields + step/move/rotate/drop/lock/clear
    renderer.ts         # class Renderer — draw(game), drawNext(game), drawMascot(game)
    fx.ts               # particles/popups/ambient update + spawn (operates on Game's fx arrays)
    input.ts            # keyboard + pointer-hold wiring → Game methods
  dist/                 # gitignored build output
```

## Class design (keeps behavior identical, just re-homed)

- **`Game`** owns every current module-level `let`: `grid, current, nextQueue, bag,
score, lines, level, combo, dropInterval, dropCounter, lastTime, status, softDrop,
lockTimer, lockResets, clearInfo, particles, popups, ambient, blink, glance, bounce,
cheerUntil, dangerNow`. Methods are the existing free functions (`spawn, collide,
move, doRotate, hardDrop, lockPiece, resolveClear, loop`/`tick`).
- **`Renderer`** holds the three canvas contexts + `setupCanvas`, and reads from a
  `Game` each frame. **`AudioEngine`** owns the Web Audio graph + `muted`. **`fx`/`input`**
  operate on the `Game` instance. `main.ts` constructs them and runs the RAF loop,
  calling `game.tick(dt)` then `renderer.draw(game)`.
- Risk this introduces: a "behavior-preserving" move can still drift. Mitigation =
  verify against the Phase-0 baseline by playing every mode.

## Tooling configs

- **tsconfig.json**: `strict: true`, `target: "ES2022"`, `module: "ESNext"`,
  `moduleResolution: "bundler"`, `allowImportingTsExtensions: true`,
  `isolatedModules: true` (esbuild requirement), `verbatimModuleSyntax: true`,
  `noEmit: true`, `lib: ["DOM","DOM.Iterable","ES2022"]`, `types: []` (browser code —
  keep Node globals out), `include: ["src"]`.
- **Deps**: install both `typescript` and `@typescript/native-preview` — tsgo does the
  typecheck; `typescript-eslint` and the editor still need stock `typescript` (and it
  is the `tsc --noEmit` fallback since tsgo is preview). Plus `esbuild`, `eslint`,
  `typescript-eslint`, `eslint-config-prettier`, `@pathtx/prettier`.
- **esbuild build** (`build.mjs`): bundle `src/main.ts` → `dist/main.js`
  (`bundle:true`, `format:"esm"`, `target:"es2022"`, `sourcemap:true`, `minify` in
  prod); CSS via the CSS entry/loader; copy `src/index.html` → `dist/` referencing
  `main.js` / `styles.css`. (HTML isn't a native esbuild entry — copy it, or add a tiny
  HTML plugin.)
- **esbuild serve** (`serve.mjs`):
  `const ctx = await esbuild.context({...}); await ctx.watch(); await ctx.serve({ servedir: 'dist', port: 8000 })`.
  This app needs no custom response headers (no COOP/COEP), so esbuild serve's
  can't-set-headers limitation does not apply.
- **ESLint**: flat `eslint.config.js` with `typescript-eslint` recommended (type-aware)
  - `eslint-config-prettier` last to disable stylistic rules.
- **`@pathtx/prettier`**: add `.prettierrc.json`; confirm the fork's bin name on install
  (should ship a `prettier` bin; otherwise call its own bin).
- **package.json scripts**:
  ```
  dev:       node scripts/serve.mjs
  build:     node scripts/build.mjs
  typecheck: tsgo --noEmit
  lint:      eslint .
  format:    prettier --write .
  check:     pnpm typecheck && pnpm lint && prettier --check .
  ```

## Execution order

1. **Baseline**: confirm current `Tetromochi.html` plays all modes (move/rotate/soft+hard
   drop, line clears, combo, level-up, perfect-clear, pause, mute, game-over, mascot
   moods). This is the regression oracle.
2. **Scaffold** pnpm + all configs; prove `build` + `dev` serve the un-ported extracted
   JS first.
3. **Extract** `styles.css`, `index.html` shell (restore the live
   `https://fonts.googleapis.com/css2?...` Google Fonts link for Quicksand/Fredoka
   instead of the saved `Tetromochi_files/css2`), and the JS body into `src/`.
4. **Restructure** into the classes/modules above — still plain JS-in-TS, no types yet;
   confirm it builds and plays identically.
5. **Pass 1 — types, ignore the checker**: annotate params, class fields, the
   shape/color tables (`Record<PieceType,…>`), `Piece`/`Cell`/`Particle`/`Popup`
   shapes, `Face`/`Mood`/`GameStatus` as string-literal unions, canvas contexts. No
   `any`/`unknown`/casts.
6. **Pass 2 — drive tsgo to zero**: fix root-cause shared types first; real null-guards
   for `current`/`clearInfo` being possibly-null instead of `!`.
7. **Verify** (the step people skip): `pnpm check` clean (report the `any` count —
   target 0), `pnpm build` succeeds, `pnpm dev` runs, and **play the app side-by-side
   with the baseline** through every mode. tsgo will not catch a `getContext` returning
   null at runtime or a behavior-changing refactor.

## Notes / risks

- Biggest risk is the shared mutable state moving into the `Game` class — a clean
  typecheck does **not** prove the app still works. Always run and compare to baseline.
- `keys/` is untracked and looks like secrets — add it to `.gitignore`; do not touch or
  commit it.
- Fonts: switch from the saved `Tetromochi_files/css2` back to the Google Fonts CDN link
  (simplest, identical rendering); self-hosting is an option if offline support is
  wanted.
- Optional follow-ups not in scope: unit tests (vitest), Playwright e2e regression
  harness, CI wiring, deploy target.
