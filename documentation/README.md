# Tetromochi — Documentation

High-level documentation of how **Tetromochi** works: a cute, canvas-based Tetris where the
blocks are "mochi" with faces and a rabbit mascot reacts to your play.

This documentation describes the TypeScript app under `src/`. For day-to-day commands, toolchain
notes, and conventions, see the repo's [`CLAUDE.md`](../CLAUDE.md); this folder focuses on _how the
running app is put together_.

## Contents

| Doc                                                   | What it covers                                             |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| [01 — Overview](01-overview.md)                       | What the app is, the tech stack, and how it builds & runs. |
| [02 — Architecture](02-architecture.md)               | Module map, the state/render split, and the frame loop.    |
| [03 — Game logic](03-game-logic.md)                   | The `Game` class: rules, piece lifecycle, scoring, levels. |
| [04 — Rendering](04-rendering.md)                     | The `Renderer`: board, blocks, next-piece, and the mascot. |
| [05 — Input](05-input.md)                             | Keyboard, on-screen buttons, and board touch gestures.     |
| [06 — Audio](06-audio.md)                             | Synthesized SFX plus the sampled mochi "voice" clips.      |
| [07 — Sprites & skins](07-sprites-and-skins.md)       | The sprite-sheet skin system and procedural fallback.      |
| [08 — Effects & cuteness](08-effects-and-cuteness.md) | Particles, popups, expressions, and mascot moods.          |

## The one-paragraph version

`main.ts` builds four objects — `AudioEngine`, `Ui`, `Renderer`, `Game` — wires input to them,
and starts a `requestAnimationFrame` loop that calls `game.tick(time)` then `renderer.draw(game)`
every frame. `Game` owns all mutable state and the rules; `Renderer` reads that state and paints
three canvases (board, next-piece, mascot) but never mutates game logic. Everything is drawn from
code — sound is synthesized with the Web Audio API and blocks are either watercolor sprite sheets
or hand-drawn "mochi" shapes.
