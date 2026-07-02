# 07 — Sprites & skins

Blocks can be drawn either as **watercolor sprite frames** or, when no sprite is available, with the
**procedural** mochi drawing in `draw-helpers.ts`. The sprite side is a small subsystem across three
files, designed so a partially-finished skin still works.

## The pieces

- `sprite-sets.ts` — declares the selectable **skins**.
- `sprites.ts` — loads sheets, slices them into per-expression frames, and picks the active frame.
- `sprite-select.ts` — builds the skin dropdown and persists the choice.

## Skins (`sprite-sets.ts`)

A `SpriteSet` is `{ id, label, sheets }`, where `sheets` maps each `PieceType` to a sheet image URL
(imported as a bundled asset). `sheets` is a **partial** record: a set may omit pieces, and any
missing piece falls back to procedural drawing — so incomplete sets are fine.

Two skins ship today:

| id           | label               | source dir                  |
| ------------ | ------------------- | --------------------------- |
| `blocks`     | Mochi (**default**) | `assets/blocks/blocks/`     |
| `animals-3d` | Animals 3D          | `assets/blocks/animals-3d/` |

`id` matches the directory name under `assets/blocks/`. `DEFAULT_SET_ID` is the first entry.

## Sheets, frames, and expression order

Each per-piece sheet is a **horizontal strip of 6 expression frames**, in this fixed order:

```
calm · blink · happy · worried · bicker · celebrate    (FACE_ORDER in sprites.ts)
```

The `none` face (used for the ghost) maps to frame 0. On load, `sliceSheet` divides the sheet width
by 6 and copies each frame into its own `<canvas>` so later draws are a single `drawImage`.

### Action sheets (`<PIECE>.actions.png`)

A set may additionally ship a per-piece **action-pose sheet** — same 768×128 six-frame format, in
this fixed order (`ActionPose` in `types.ts`, `ACTION_INDEX` in `sprites.ts`):

```
walk-a · walk-b · cards · punch-a · punch-b · scurry
```

These are used by the idle antics (see [08 — Effects & cuteness](08-effects-and-cuteness.md)).
`SpriteSet.actions` is a partial record like `sheets`; `actionFrame(type, pose)` returns the frame
canvas or `null`, and the antics renderer falls back to expression frames + squash/flip transforms
— so skins without action art still get the full feature. Facing left is a runtime horizontal flip
(`flipX` in `BlockOpts`); the sheets only contain right-facing poses.

### Props (`props.ts`)

Skin-independent prop sprites under `src/assets/props/` (currently `cards.png`, a 2-frame
`[fan, pile]` strip). `propFrame(name)` returns the frame canvas or `null` while loading; the
antics code draws a procedural stand-in on `null`.

## Loading & lookup (`sprites.ts`)

- `loadSpriteSet(id)` — once per set, creates an `Image` for each piece's sheet and, on load,
  slices it into frame canvases stored under `frames[id][type]`. Loading is async and lazy.
- `setActiveSpriteSet(id)` / `getActiveSpriteSet()` — switch the active skin (loading its sheets if
  needed); an unknown id falls back to the default.
- `blockFrame(type, face)` — returns the frame canvas for a piece's expression in the active set,
  or **`null`** if it isn't loaded yet (or the set lacks that piece). Callers treat `null` as
  "draw procedurally instead".

## How a block chooses sprite vs. procedural

`draw-helpers.drawBlock` (see [04 — Rendering](04-rendering.md)) is the junction:

```ts
const type = TYPE_BY_COLOR.get(color); // color → piece type
const frame = type ? blockFrame(type, face) : null;
if (frame) {
  /* drawImage the watercolor frame, with scale/alpha */ return;
}
/* else: procedural rounded-mochi drawing with a hand-drawn face */
```

`TYPE_BY_COLOR` (in `constants.ts`) is the reverse map from a cell's hex color to its piece type,
which is how the renderer — which only knows a cell's color — recovers the type needed to index the
sheets. Because the check runs every draw, blocks seamlessly upgrade from procedural to sprite the
moment a sheet finishes loading.

## Selecting & persisting (`sprite-select.ts`)

At startup `attachSpriteSelect()` (called from `main.ts`) populates the `#spriteSet` `<select>` from
`SPRITE_SETS`, restores the saved choice, applies it, and listens for changes:

- The choice is stored in `localStorage` under `tetromochi.spriteSet`.
- Reads and writes are wrapped in try/catch — `localStorage` can be unavailable (e.g. some browsers
  over `file://`), in which case it silently falls back to the default and the choice simply applies
  for the current session.
- Changing the dropdown calls `setActiveSpriteSet(...)` (loading sheets on demand) and saves.

## Asset generation

Sprite sheets are produced offline (there's a `gen-sprite-sheet` skill and a `Gemini asset
pipeline` note in project memory). The image model has no real alpha, so sheets use tricks like
cream-background badges or chroma-keying. For the app's purposes the sheets are just static PNGs
under `src/assets/blocks/<set-id>/<PIECE>[.actions].png`, each a 6-frame horizontal strip.

Action sheets are generated by `scripts/gen-sprite-sheet.mjs --actions`: each pose is an
image-to-image edit of the piece's existing **calm** frame (so the character is identical across
both sheets), poses are cached individually under `.sprite-cache/frames/`, and the result is
**validated automatically** — geometric checks plus a Gemini-vision judge — with failing poses
regenerated individually (`scripts/validate-sprite-frames.mjs` re-checks without generating;
`scripts/preview-sheets.mjs` renders a human-eyeball contact sheet). Props come from
`scripts/gen-prop.mjs`. See the `gen-sprite-sheet` skill for the full workflow.
