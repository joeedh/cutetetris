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

It (1) asks Gemini for a raw 6-frame strip on a flat keyable background, (2) keys the background
out, (3) trims every frame to one **shared square** so the frames stay pixel-aligned, (4) resizes
to 128px frames, (5) assembles a `768x128` strip, and (6) quantizes it to a small palette PNG at
`src/assets/blocks/<set>/<piece>.png`.

It self-bootstraps `sharp` into `.sprite-cache/` on first run (sharp is **not** a repo dependency;
`.sprite-cache/` is gitignored). It reads the Gemini key from `keys/gemini.txt` and the per-piece
theme (`themes.<piece>`, else `theme`) from `src/assets/blocks/<set>/set.json`.

By default it generates **text-to-image with a blank 6-cell layout template** (a magenta canvas
with 6 cream placeholder cells) so the model emits a 6:1 strip without any subject to copy. The
model is stochastic about honoring the strip layout, so the script **auto-retries** (`--retries`,
default 5) until the output is a ~6:1 strip.

### Examples

```bash
# Generate the L piece for the animals-3d skin (theme comes from set.json's themes.L):
node scripts/gen-sprite-sheet.mjs animals-3d L

# Override the theme inline:
node scripts/gen-sprite-sheet.mjs animals-3d L --theme "a cute 3D claymation red panda"

# Some subjects (e.g. "frog") stubbornly render as a single square no matter how many template
# retries — force the strip layout with an existing clean sheet as the reference instead:
node scripts/gen-sprite-sheet.mjs animals-3d S --ref T --theme "a cute 3D claymation frog"

# Re-process an already-downloaded raw/output PNG (no Gemini call) — e.g. to retune keying:
node scripts/gen-sprite-sheet.mjs animals-3d Z --no-generate --threshold 80
```

### Useful options

- `--theme "<text>"` — subject/style (default: `set.json` `themes.<piece>` → `theme` → set id).
- `--prompt "<text>"` — full prompt override (skips the built-in prompt).
- `--ref <piece>` — use that piece's existing sheet (this set, else `blocks`) as an image-to-image
  reference. Reliably forces the 6:1 layout, but **the reference subject can leak into a frame**
  (usually the last) — preview and regenerate if so. Best when subjects are similar.
- `--no-ref` — pure text-to-image, no template/reference. The model usually returns a single
  square (not a strip), so this is rarely useful; prefer the default template.
- `--retries <n>` — generation attempts to land a strip (default 5).
- `--no-generate` — skip Gemini; re-process the existing PNG only.
- `--key auto|alpha|chroma` — background removal mode (default `auto`, detected from the corners).
- `--threshold <0-255>` — alpha-key cutoff for `alpha` mode (default: auto from the alpha histogram).
- `--frame <px>` / `--pad <0-1>` / `--model <id>` / `--keep-raw`.

### Picking the layout mode

- **Default (template)** — best for a set of *different* subjects (no leak). Retries handle the
  occasional square. A few subjects ("frog") never strip under the template; switch to `--ref`.
- **`--ref <piece>`** — guarantees the 6:1 layout; use for same-subject sets or stubborn subjects,
  and **always preview** for a leaked frame (vary `--ref` and regenerate until clean).

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
