---
name: gen-sprite-sheet
description: Generate a Tetromochi block sprite sheet (expression or action-pose) for a skin set with Gemini, apply background removal, and validate the frames. Use when the user asks to "generate a sprite sheet", "make the <piece> for the <set> skin", "add a block skin", "fill in a sprite set", "generate action/animation frames", or similar art-asset requests for the tetromino block sheets under src/assets/blocks/ or props under src/assets/props/.
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

A set may also ship per-piece **action sheets** — `<PIECE>.actions.png`, same 768×128 six-frame
format — used by the idle antics (blocks strolling / playing cards / play-fighting; see
`src/antics.ts`). Their fixed pose order (matching `ActionPose` in `src/types.ts`):

```
[ walk-a, walk-b, cards, punch-a, punch-b, scurry ]
```

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

## Action sheets (`--actions`)

```bash
node scripts/gen-sprite-sheet.mjs blocks T --actions            # generate + validate + auto-retry
node scripts/gen-sprite-sheet.mjs blocks T --actions --pose punch-b   # regenerate ONE pose
node scripts/validate-sprite-frames.mjs blocks T --actions      # re-check without generating
node scripts/gen-prop.mjs cards                                 # skin-independent prop sprite
node scripts/preview-sheets.mjs blocks                          # contact sheet for eyeballing
```

How `--actions` differs from the expression pipeline:

- **The base is the piece's existing calm frame** (frame 0 of `<piece>.png`) — the expression sheet
  must exist first. Each pose is an image-to-image edit of it; `walk-b`/`punch-b` chain from their
  `-a` sibling so pairs read as one motion. The prompt injects the calm frame's measured average
  colour so the model doesn't drift the palette (it loves turning pale lavender into bold pink).
- **Poses render on GREEN (#00FF00), not magenta** — pastel pink/lavender subjects sit too close to
  magenta and get eaten by the chroma key. `keyImage` keys corner colour + magenta + green alike.
- **Per-pose cache** in `.sprite-cache/frames/<set>/<piece>.actions/` — single poses can be redone
  with `--pose <name>` without regenerating the rest. ⚠ `--frame <px>` is the frame SIZE flag; the
  single-pose flag is `--pose`.
- **Frame boundaries are exact** (we assemble the strip ourselves), so no column-profile detection.
- **Bottom-anchored + scale-anchored**: subjects are baseline-aligned (feet don't jitter between
  walk frames) and scale-normalized to the calm frame's subject height (no size pop when the
  runtime swaps sheets).
- **Validated automatically** (skip with `--no-validate`): geometric checks (coverage, bbox area vs
  median, walk/punch pair area match, magenta residue, edge clipping) plus a **Gemini-vision
  judge** per frame (pose correct? same character as the calm frame? artifacts?). Failing poses are
  regenerated individually up to `--max-retries` (default 3); on exhaustion it prints the exact
  `--pose` commands to retry manually.
- Pose prompts can be overridden per set via a `"poses"` object in `set.json` (the mochi blobs are
  limbless, so their walk is prompted as a squash-and-stretch hop).
- **Colour fidelity is enforced in post, not in the prompt** — the model drifts each pose's palette
  randomly (and asking for "exact colours" makes it worse). Each frame is re-tinted to the calm
  frame's measured average (HSL modulate + per-channel linear gains), and magenta-ish pixels at the
  alpha boundary are defringed. For subjects whose generations drift toward magenta (Z's pink),
  tighten the chroma ramp with `--ramp "35,70"` so the key doesn't erode the body.

The runtime falls back to expression frames + squash/flip transforms for any piece/skin without an
action sheet, so sets can gain action art incrementally.

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
