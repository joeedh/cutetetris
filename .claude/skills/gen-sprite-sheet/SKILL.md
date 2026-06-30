---
name: gen-sprite-sheet
description: Generate a Tetromochi block sprite sheet for a skin set with Gemini and apply background removal. Use when the user asks to "generate a sprite sheet", "make the <piece> for the <set> skin", "add a block skin", "fill in a sprite set", or similar art-asset requests for the tetromino block sheets under src/assets/blocks/.
---

# Generate a block sprite sheet

Tetromochi blocks are skinnable. Each **skin set** is a directory under `src/assets/blocks/`
(e.g. `blocks` = the default "Mochi" watercolor set, `animals-3d` = claymation animals). A set
contains up to 7 **sheets**, one per tetromino piece: `I O T S Z J L`. Each sheet is a horizontal
strip of **6 square frames** in this exact order (matching the `Face` type sliced in
`src/sprites.ts`):

```
[ calm, blink, happy, worried, bicker, celebrate ]
```

The dropdown in the header (`#spriteSet`, wired in `src/sprite-select.ts`) lets the player switch
sets. A set may be **incomplete** — any missing piece falls back to procedural drawing, so you can
add sheets one at a time.

## The one command you need

```bash
node scripts/gen-sprite-sheet.mjs <set> <piece> [options]
```

By default it uses a **per-frame editing** pipeline: (1) generate ONE base "calm" subject, (2)
image-to-image edit ONLY its face for each of the other 5 expressions, (3) key the magenta
background out of each, (4) trim every frame to one **shared square** so they stay aligned, (5)
resize to 128px frames, (6) assemble a `768x128` strip, and (7) quantize to a small palette PNG at
`src/assets/blocks/<set>/<piece>.png`. This **guarantees exactly 6 frames with an identical body**
in the correct expression order — far more reliable than the single-shot strip modes below, which
routinely yield 4–5 frames or leave coloured layout cells behind.

It self-bootstraps `sharp` into `.sprite-cache/` on first run (sharp is **not** a repo dependency;
`.sprite-cache/` is gitignored). It reads the Gemini key from `keys/gemini.txt` and the per-piece
theme (`themes.<piece>`, else `theme`) from `src/assets/blocks/<set>/set.json`. Per-frame mode
makes 6 Gemini calls per sheet (1 base + 5 edits).

### Examples

```bash
# Generate the L piece for the animals-3d skin (per-frame; theme from set.json's themes.L):
node scripts/gen-sprite-sheet.mjs animals-3d L

# Override the theme inline:
node scripts/gen-sprite-sheet.mjs animals-3d L --theme "a cute 3D claymation red panda"

# Single-shot strip instead of per-frame (1 call, less reliable — retries until it gets 6 frames):
node scripts/gen-sprite-sheet.mjs animals-3d L --strip

# Re-process an already-downloaded raw/output PNG (no Gemini call) — e.g. to retune keying:
node scripts/gen-sprite-sheet.mjs animals-3d Z --no-generate --threshold 80
```

### Useful options

- `--theme "<text>"` — subject/style (default: `set.json` `themes.<piece>` → `theme` → set id).
- `--prompt "<text>"` — full prompt override (single-shot strip modes only).
- `--strip` — single-shot strip generation with the blank green-cell layout template, instead of
  per-frame. Retries until the model emits a ~6:1 strip with exactly 6 separable subjects.
- `--ref <piece>` — single-shot strip using that piece's existing sheet (this set, else `blocks`)
  as an image-to-image reference. **The reference subject can leak into a frame** — preview/redo.
- `--no-ref` — single-shot pure text-to-image (usually returns one square; rarely useful).
- `--retries <n>` — strip-mode attempts to land 6 frames (default 5).
- `--no-generate` — skip Gemini; re-process the existing PNG only.
- `--key auto|alpha|chroma` — background removal mode (default `auto`, detected from the corners).
- `--threshold <0-255>` — alpha-key cutoff for `alpha` mode (default: auto from the alpha histogram).
- `--frame <px>` / `--pad <0-1>` / `--model <id>` / `--keep-raw`.

### Picking the mode

- **Default (per-frame)** — use this. Exactly 6 frames, identical body, correct expression order.
- **`--strip`** — one call per sheet, but the model often draws 4–5 frames or leaves coloured cells;
  the generator retries on frame count, but you should still preview. Use only to save calls.
- **`--ref <piece>`** — single-shot conditioned on a reference; can leak the reference subject.

## Adding a brand-new set

1. `mkdir src/assets/blocks/<set>` and add a `set.json`:
   ```json
   { "label": "Animals 3D", "theme": "a cute glossy 3D claymation fox, soft studio lighting" }
   ```
2. Generate one or more sheets with the command above.
3. **Wire it into the bundle** (esbuild needs static imports — there is no dynamic dir loading):
   add the new piece imports + a `SpriteSet` entry to `src/sprite-sets.ts`. The `label` shown in
   the dropdown comes from that entry. The first entry in `SPRITE_SETS` is the default skin.

## Background removal — how it works (and the gotchas)

The Gemini image model does **not** emit real PNG alpha; asked for transparency it paints a faded
wash or a checkerboard. So the prompt requests a **solid flat magenta `#FF00FF`** background, and
the script keys it out:

- **`chroma` mode** — keys by color distance from the sampled corner color (soft ramp). Used when
  the corners are opaque.
- **`alpha` mode** — the model sometimes bakes the background as a low-alpha wash (the `animals-3d`
  fox came in this way). The script histograms alpha, finds the empty gap between the background
  lobe and the subject, and thresholds there. `auto` picks this when corner alpha is low.

Gotchas:

- **Foxes/animals are orange + cream**, which collides with cream/magenta backgrounds — prefer a
  background color absent from the subject palette, and check the result.
- Always **eyeball the output**. Composite the sheet over the board color `#fff9fd` and look at all
  6 frames (a quick sharp `composite` to a PNG, then open it). Re-run with `--no-generate
--threshold N` (alpha) or `--key chroma` to retune without spending another generation.
- The 6 frames must stay **body-identical**, only the face changing — that's what the prompt asks
  for and why image-to-image (`--ref`) against an existing sheet in the set helps consistency.

## After generating

- Verify with `pnpm build` then open `dist/index.html`, pick the set in the dropdown, and play.
- Run `pnpm check` (the new PNG is just an asset, but keep the tree clean).
- Commit the small quantized PNG; do **not** commit `.raw.png` or `.sprite-cache/`.

See the `gemini-asset-pipeline` memory for the broader asset/Gemini context.
