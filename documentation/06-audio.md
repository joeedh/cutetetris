# 06 — Audio

`AudioEngine` (`audio.ts`) provides all sound. There are two distinct paths:

1. **Synthesized SFX** — game sounds built live with the Web Audio API. No sound files.
2. **Sampled voice clips** — a few short `.ogg` files that give the mochi a tiny "voice" for
   bickering and celebrating.

## Lifecycle

Browsers block audio until a user gesture, so nothing is created at construction. On the first
start (see [05 — Input](05-input.md)) the engine is initialized:

- **`init()`** — create the `AudioContext` and a master `GainNode` (gain 0.5) wired to the
  destination. Wrapped in try/catch so a failure just disables audio rather than crashing. Idempotent.
- **`resume()`** — resume the context if it started `suspended`.
- **`initClips()`** — preload the voice clips as `HTMLAudioElement`s. `HTMLAudio` is used
  deliberately: it works over `file://`, where `fetch` + `decodeAudioData` don't.

`muted` gates all output; `toggleMute()` flips it and returns the new value (the mute button reads
that to swap its icon).

## Synthesized SFX (`sfx(name)`)

The private `tone(freq, dur, type, vol, delay)` helper is the primitive: it creates an oscillator +
gain, ramps the gain up over 12 ms and exponentially back down over `dur` (a soft pluck envelope),
and connects through the master gain. Each named SFX is a short arpeggio or chord built from one or
more `tone` calls at staggered delays.

| Name                           | Feel                                       |
| ------------------------------ | ------------------------------------------ |
| `move`                         | tiny triangle blip                         |
| `rotate`                       | two rising triangle blips                  |
| `lock`                         | low sine thud                              |
| `drop`                         | blip + low thump                           |
| `clear1` / `clear2` / `clear3` | ascending sine runs, longer per line count |
| `tetris`                       | a bright 7-note triangle fanfare           |
| `levelup`                      | rising three-note sine                     |
| `perfect`                      | a brighter four-note sine flourish         |
| `over`                         | a descending four-note "aww"               |

`sfx` is a no-op if the context isn't initialized or audio is muted.

## Sampled voice clips (`playClip(name, volume)`)

Two clip families, each with four variants (`bicker1..4`, `celebrate1..4`), imported as bundled
asset URLs. `playClip`:

- picks a random variant,
- clones the `HTMLAudioElement` so overlapping plays don't cut each other off,
- disables `preservesPitch` and sets `playbackRate` to ~1.28–1.46, pitching the sample **up** so
  the mochi sound small and cute,
- plays at the given volume (errors swallowed).

`Game` calls `playClip('bicker', 0.4)` when two neighbouring blocks squabble and
`playClip('celebrate', 0.6)` when survivors cheer after a line clear.

## Where sounds fire

| Trigger          | Sound                           |
| ---------------- | ------------------------------- | -------- | ---------- |
| move / rotate    | `sfx('move')` / `sfx('rotate')` |
| hard drop        | `sfx('drop')`                   |
| lock (no clear)  | `sfx('lock')`                   |
| 1–3 line clear   | `sfx('clear1'                   | 'clear2' | 'clear3')` |
| 4-line clear     | `sfx('tetris')`                 |
| level up         | `sfx('levelup')`                |
| perfect clear    | `sfx('perfect')`                |
| game over        | `sfx('over')`                   |
| neighbour bicker | `playClip('bicker')`            |
| post-clear cheer | `playClip('celebrate')`         |

These are the only bundled audio assets in the project; everything else is generated at runtime.
