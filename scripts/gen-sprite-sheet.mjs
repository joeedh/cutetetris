#!/usr/bin/env node
// Generate (or just re-process) one block sprite sheet for a skin set.
//
//   node scripts/gen-sprite-sheet.mjs <set> <piece> [options]
//
// A "sheet" is a horizontal strip of 6 frames. There are two kinds:
//   expression sheet  <piece>.png          [calm, blink, happy, worried, bicker, celebrate]
//   action sheet      <piece>.actions.png  [walk-a, walk-b, cards, punch-a, punch-b, scurry]
// matching the `Face` / `ActionPose` types the renderer slices on (see src/sprites.ts).
//
// The pipeline is: ask Gemini for a raw strip on a flat keyable background → key the
// background out → trim every frame to one shared square so they stay aligned → resize to
// 128px frames → assemble a 768x128 strip → quantize to a small palette PNG. The output is
// written to src/assets/blocks/<set>/<piece>[.actions].png.
//
// By default it uses a per-frame editing pipeline: generate one base "calm" subject, then
// image-to-image edit ONLY the face for each remaining expression. This guarantees exactly
// FRAME_COUNT frames with an identical body, in order — unlike the single-shot strip modes, which
// often yield 4-5 frames. Per-frame mode makes 6 Gemini calls per sheet (1 base + 5 edits).
//
// ACTION sheets (--actions) build on that: the base is the CALM FRAME of the piece's existing
// expression sheet (so the character is identical across both sheets), each pose is an
// image-to-image edit of it, every generated pose is cached individually under
// .sprite-cache/frames/<set>/<piece>.actions/, and after assembly the sheet is VALIDATED
// (geometric checks + a Gemini-vision judge, see scripts/validate-sprite-frames.mjs); failing
// poses are regenerated individually up to --max-retries times.
//
// Options:
//   --actions            Generate the action-pose sheet instead of the expression sheet.
//   --pose <name>        (--actions) Regenerate ONLY that pose (walk-a … scurry) into the cache,
//                        then re-assemble + re-validate. NOTE: --frame is the frame SIZE flag.
//   --no-validate        (--actions) Skip the judge/retry loop after assembly.
//   --max-retries <n>    (--actions) Regeneration attempts per failing pose (default 3).
//   --anchor center|bottom  Vertical alignment in the shared square (default: bottom for
//                        --actions so feet don't jitter, center otherwise).
//   --theme "<text>"     Theme/subject (default: set.json `themes.<piece>` → `theme` → the set id).
//   --strip              Single-shot strip generation (blank green-cell template) instead of
//                        per-frame; retries until the output is a ~6:1 strip with FRAME_COUNT subjects.
//   --prompt "<text>"    Full prompt override (single-shot strip modes only).
//   --ref <piece>        Single-shot strip conditioned on that piece's existing sheet (this set,
//                        else `blocks`) as an image-to-image reference. The reference subject can
//                        LEAK into a frame — preview and regenerate if so.
//   --no-ref             Single-shot pure text-to-image (usually returns one square).
//   --retries <n>        Strip-mode attempts to land FRAME_COUNT frames (default 5).
//   --no-generate        Skip Gemini; re-process the existing raw/output PNG only (background key + resize).
//   --key auto|alpha|chroma   Background removal mode (default: auto — detect from the image corners).
//   --threshold <0-255>  Alpha-key cutoff (alpha mode). Default: auto-detected from the alpha histogram.
//   --ramp "<lo,hi>"     Chroma soft-ramp distances (default "60,110"). Tighten (e.g. "35,70") for
//                        subjects whose palette drifts toward magenta — Z's pink lands inside the
//                        default ramp and the key erodes the body.
//   --frame <px>         Output frame size in px (default 128 → a 768x128 sheet).
//   --pad <0-1>          Fraction of padding around content in the shared square (default 0.06).
//   --model <id>         Gemini image model (default gemini-2.5-flash-image).
//   --keep-raw           Keep the raw Gemini PNG next to the output as <piece>[.actions].raw.png.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTION_ORDER,
  ACTION_PROMPTS,
  BLOCKS_DIR,
  FACE_ORDER,
  FACE_PROMPTS,
  ROOT,
  callImageModel,
  ensureSharp,
  frameBoxes,
  frameOverBoard,
  validateSheet,
} from './lib/sprite-lib.mjs';

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const positional = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opt[key] = true;
    else {
      opt[key] = next;
      i++;
    }
  } else positional.push(a);
}
const [set, piece] = positional;
if (!set || !piece) {
  console.error('usage: node scripts/gen-sprite-sheet.mjs <set> <piece> [options]');
  process.exit(1);
}
const isActions = Boolean(opt.actions);
const SHEET_ORDER = isActions ? ACTION_ORDER : FACE_ORDER;
const FRAME_COUNT = SHEET_ORDER.length;
const setDir = resolve(BLOCKS_DIR, set);
mkdirSync(setDir, { recursive: true });
const suffix = isActions ? '.actions' : '';
const outPath = resolve(setDir, `${piece}${suffix}.png`);
const rawPath = resolve(setDir, `${piece}${suffix}.raw.png`);
const exprSheetPath = resolve(setDir, `${piece}.png`);
const cacheDir = resolve(ROOT, `.sprite-cache/frames/${set}/${piece}.actions`);
const frameSize = Number(opt.frame ?? 128);
const pad = Number(opt.pad ?? 0.06);
const model = String(opt.model ?? 'gemini-2.5-flash-image');
const anchor = String(opt.anchor ?? (isActions ? 'bottom' : 'center'));
const maxPoseRetries = Math.max(0, Number(opt['max-retries'] ?? 3));

const sharp = ensureSharp();

// ---- set metadata --------------------------------------------------------
function readSetMeta() {
  const p = resolve(setDir, 'set.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}
const meta = readSetMeta();
const theme = String(opt.theme ?? meta.themes?.[piece] ?? meta.theme ?? set);
/** Per-pose prompt table: defaults merged with the set.json `poses` override. */
const posePrompts = { ...ACTION_PROMPTS, ...(meta.poses ?? {}) };

// ---- Gemini generation ---------------------------------------------------
function pieceShapeHint(p) {
  const shapes = {
    I: 'a straight line of 4',
    O: 'a 2x2 square of 4',
    T: 'a T-shape of 4',
    S: 'an S-shape of 4',
    Z: 'a Z-shape of 4',
    J: 'a J-shape of 4',
    L: 'an L-shape of 4',
  };
  return shapes[p] ?? `the ${p} tetromino`;
}

function buildPrompt() {
  if (typeof opt.prompt === 'string') return opt.prompt;
  return [
    `A horizontal sprite sheet of ${FRAME_COUNT} square frames in a single row, evenly spaced.`,
    `Theme: ${theme}.`,
    `Each frame shows the SAME cute character/object (the Tetris "${piece}" piece — think ${pieceShapeHint(piece)}),`,
    `identical in body, pose and size across all frames — ONLY the facial expression changes.`,
    `The ${FRAME_COUNT} expressions, left to right, are: ` +
      `1) calm/neutral, 2) blinking (eyes closed, content), 3) happy (big smile, eyes shut in joy), ` +
      `4) worried (nervous, wide eyes, small sweat drop), 5) grumpy/bickering (annoyed, furrowed brow, a red anger-vein), ` +
      `6) celebrating (star-shaped sparkly eyes, open cheering mouth).`,
    `Consistent lighting and scale. Centered subject. Generous even margins.`,
    `IMPORTANT: render on a SOLID FLAT pure-magenta (#FF00FF) background — a single uniform colour,`,
    `no checkerboard, no gradient, no shadow on the background — so it can be keyed out cleanly.`,
  ].join(' ');
}

/** An explicit `--ref <piece>` style-reference sheet, if any (else null). */
function refSheetPath() {
  if (opt['no-ref'] || typeof opt.ref !== 'string') return null;
  const p = resolve(setDir, `${opt.ref}.png`);
  if (existsSync(p)) return p;
  const fallback = resolve(BLOCKS_DIR, 'blocks', `${opt.ref}.png`);
  return existsSync(fallback) ? fallback : null;
}

/**
 * A blank layout template: magenta with `FRAME_COUNT` bright-green placeholder cells. Conditions
 * the model to emit a 6:1 strip of evenly-spaced frames WITHOUT giving it any subject to copy (a
 * real reference sheet tends to leak its subject into a frame). Both template colours (magenta +
 * green) are pure chroma absent from pastel subjects, so whatever the model leaves of them gets
 * keyed out cleanly — unlike a cream cell, which would survive as an opaque square. Used by the
 * single-shot `--strip` mode (the default is the per-frame pipeline, which needs no template).
 */
function buildTemplate() {
  const cell = 320;
  const W = cell * FRAME_COUNT;
  const H = cell;
  const cells = Array.from({ length: FRAME_COUNT }, (_, i) => {
    const pad = cell * 0.1;
    const w = cell - pad * 2;
    return `<rect x="${i * cell + pad}" y="${pad}" width="${w}" height="${w}" rx="${w * 0.18}" fill="#00FF00"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#FF00FF"/>${cells}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const BG_NOTE =
  'Render on a SOLID FLAT pure-magenta #FF00FF background — one uniform colour, with no shadow, ' +
  'gradient, props or extra objects — so the background can be cleanly removed.';

const callModel = (parts, label) => callImageModel(parts, label, model);

/** Lay per-frame buffers out on a magenta strip so the key/detect/crop pipeline can finish. */
async function assembleRawStrip(frames) {
  const cell = 512;
  const mag = { r: 255, g: 0, b: 255, alpha: 1 };
  const cells = await Promise.all(
    frames.map((b) =>
      sharp(b)
        .resize(cell, cell, { fit: 'contain', background: mag })
        .flatten({ background: mag })
        .png()
        .toBuffer(),
    ),
  );
  const strip = await sharp({
    create: { width: cell * FRAME_COUNT, height: cell, channels: 4, background: mag },
  })
    .composite(cells.map((b, i) => ({ input: b, left: i * cell, top: 0 })))
    .png()
    .toBuffer();
  writeFileSync(rawPath, strip);
  console.log(`raw → ${rawPath} (${cell * FRAME_COUNT}x${cell}, ${FRAME_COUNT} frames)`);
  return rawPath;
}

/**
 * Default pipeline: generate ONE base (calm) subject, then image-to-image edit ONLY its face for
 * each remaining expression. This guarantees exactly FRAME_COUNT frames with an identical body on a
 * clean magenta background — far more reliable than coaxing the model to draw a whole 6-frame strip
 * in one shot (which routinely yields 4-5 frames or leaves coloured layout cells behind).
 */
async function generateFrames() {
  console.log(`generating ${set}/${piece}: base (calm) frame…`);
  const base = await callModel(
    [
      {
        text: `${theme}. A single cute character, centred, facing forward, full body, ${FACE_PROMPTS.calm}. ${BG_NOTE} Square image.`,
      },
    ],
    'calm',
  );
  const frames = [base];
  for (const face of FACE_ORDER.slice(1)) {
    console.log(`  editing face → ${face}…`);
    const f = await callModel(
      [
        {
          text: `Edit the attached character image. Keep the SAME subject — identical body, pose, size, colours, position and framing — and change ONLY the facial expression to: ${FACE_PROMPTS[face]}. ${BG_NOTE}`,
        },
        { inline_data: { mime_type: 'image/png', data: base.toString('base64') } },
      ],
      face,
    );
    frames.push(f);
  }
  return assembleRawStrip(frames);
}

// ---- action-sheet generation (per-pose cache + individual retry) ----------

/** The calm frame of the piece's expression sheet, flattened onto magenta and upscaled to 512px. */
async function actionBasePng() {
  if (!existsSync(exprSheetPath)) {
    throw new Error(
      `expression sheet ${exprSheetPath} not found — generate it first; the action sheet edits ` +
        `its calm frame so both sheets show the identical character.`,
    );
  }
  const m = await sharp(exprSheetPath).metadata();
  const fw = Math.floor(m.width / FACE_ORDER.length);
  return sharp(exprSheetPath)
    .extract({ left: 0, top: 0, width: fw, height: m.height })
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 0, b: 255, alpha: 1 } })
    .flatten({ background: { r: 255, g: 0, b: 255 } })
    .png()
    .toBuffer();
}

const posePath = (pose) => resolve(cacheDir, `${pose}.png`);

/** Average opaque colour of a raw RGBA buffer (alpha > 128), or null if (nearly) empty. */
function avgOpaqueColor(data, channels) {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (data[i + 3] > 128) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n } : null;
}

function rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** Average opaque colour of the calm frame — the character's true tint. */
async function baseColor() {
  const m = await sharp(exprSheetPath).metadata();
  const fw = Math.floor(m.width / FACE_ORDER.length);
  const { data, info } = await sharp(exprSheetPath)
    .extract({ left: 0, top: 0, width: fw, height: m.height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return avgOpaqueColor(data, info.channels);
}

/**
 * Deterministically re-tint one keyed frame tile to the calm frame's palette. The image model
 * reliably produces good POSES but drifts the palette (pale lavender → bold pink, etc.) — and
 * drifts each frame DIFFERENTLY, so the correction is per-frame: shift hue/saturation/brightness
 * so the colours are correct by construction. The judge still polices shape/species/artifacts.
 */
async function tintTile(pngBuf, base, label) {
  const { data, info } = await sharp(pngBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gen = avgOpaqueColor(data, info.channels);
  if (!base || !gen) return pngBuf;
  const bh = rgbToHsl(base);
  const gh = rgbToHsl(gen);
  // shortest rotation, normalized to [-180, 180]
  const hue = Math.round(((((bh.h - gh.h) % 360) + 540) % 360) - 180);
  const saturation = Math.min(3, Math.max(0.2, gh.s > 0.01 ? bh.s / gh.s : 1));
  const brightness = Math.min(2, Math.max(0.5, gh.l > 0.01 ? bh.l / gh.l : 1));
  let out = pngBuf;
  if (Math.abs(hue) >= 4 || Math.abs(saturation - 1) >= 0.08 || Math.abs(brightness - 1) >= 0.05) {
    console.log(
      `  tint ${label} → hue ${hue}°, saturation ×${saturation.toFixed(2)}, brightness ×${brightness.toFixed(2)}`,
    );
    out = await sharp(pngBuf).modulate({ hue, saturation, brightness }).png().toBuffer();
  }
  // Second pass: HSL modulate can't separate "pale cream" from "bold orange" (same hue, same HSL
  // saturation, different lightness) — finish with per-channel linear gains that map the frame's
  // measured average exactly onto the character's average.
  const after = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const avg = avgOpaqueColor(after.data, after.info.channels);
  if (!avg) return out;
  const gains = ['r', 'g', 'b'].map((k) =>
    Math.min(1.6, Math.max(0.6, avg[k] > 1 ? base[k] / avg[k] : 1)),
  );
  if (gains.some((g) => Math.abs(g - 1) >= 0.06)) {
    console.log(`  gain ${label} → rgb ×(${gains.map((g) => g.toFixed(2)).join(', ')})`);
    out = await sharp(out)
      .linear([...gains, 1], [0, 0, 0, 0])
      .png()
      .toBuffer();
  }
  return out;
}

/**
 * Edit the base character into one pose. `walk-b`/`punch-b` chain from their cached `-a` sibling
 * so the pair reads as two phases of one motion; `cards` chains from `walk-a` because editing the
 * pale watercolour base into "holding cards" reliably produces a translucent body that the key
 * eats — a bold already-generated frame anchors an opaque one. Everything else edits the calm
 * base. Colour fidelity is NOT fought for here — `tintTile` corrects the palette in post.
 */
async function generatePose(pose, base) {
  const chainFrom =
    pose === 'walk-b'
      ? 'walk-a'
      : pose === 'punch-b'
        ? 'punch-a'
        : pose === 'cards'
          ? 'walk-a'
          : null;
  let src = base;
  // "fully opaque" matters: soft translucent watercolour washes let the magenta background bleed
  // through the body, and those blended pixels then get eaten by the chroma key.
  const solid =
    'The character must be FULLY OPAQUE with a solid colour fill — no translucency, no soft washes ' +
    'that let the background show through the body.';
  let intro = `Edit the attached character image. Keep the SAME subject — identical body shape, features, art style, size and framing — and change ONLY its body pose to: ${posePrompts[pose]}. ${solid}`;
  if (chainFrom && existsSync(posePath(chainFrom))) {
    src = readFileSync(posePath(chainFrom));
    if (pose !== 'cards')
      intro = `The attached image shows a character mid-motion. Produce the ALTERNATING phase of the SAME motion: ${posePrompts[pose]}. Keep the character, art style, size and framing identical. ${solid}`;
  }
  console.log(`  posing → ${pose}${src === base ? '' : ` (chained from ${chainFrom})`}…`);
  const buf = await callModel(
    [
      { text: `${intro} ${BG_NOTE}` },
      { inline_data: { mime_type: 'image/png', data: src.toString('base64') } },
    ],
    pose,
  );
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(posePath(pose), buf);
  return buf;
}

/** Generate poses into the cache (all, or just `only`), then assemble the raw strip from it. */
async function generateActions(only = null) {
  const base = await actionBasePng();
  const wanted = only ?? ACTION_ORDER;
  console.log(`generating ${set}/${piece} actions: [${wanted.join(', ')}]…`);
  for (const pose of ACTION_ORDER) {
    if (wanted.includes(pose)) await generatePose(pose, base);
    else if (!existsSync(posePath(pose)))
      throw new Error(
        `cached pose ${posePath(pose)} missing — run without --pose to generate the full sheet first.`,
      );
  }
  return assembleRawStrip(ACTION_ORDER.map((pose) => readFileSync(posePath(pose))));
}

/**
 * Single-shot strip generation (`--strip`, or implied by `--ref`/`--no-ref`): asks the model for
 * the whole 6-frame row at once, conditioned by a layout template or a reference sheet, retrying
 * until the output is a ~6:1 strip containing FRAME_COUNT separate subjects. Less reliable than the
 * per-frame default, but one call per accepted result.
 */
async function generate() {
  const baseParts = [{ text: buildPrompt() }];
  const ref = refSheetPath();
  let mode = 'text-to-image';
  if (ref) {
    mode = 'image-to-image';
    baseParts.unshift({
      text: 'Match the art style, framing and frame layout of the reference image that follows, but with the new theme/subject described above. Replace the subject in EVERY frame — do not copy the reference subject into any frame.',
    });
    baseParts.push({
      inline_data: { mime_type: 'image/png', data: readFileSync(ref).toString('base64') },
    });
  } else if (!opt['no-ref']) {
    mode = 'template';
    baseParts.unshift({
      text: 'The image that follows is a BLANK LAYOUT TEMPLATE: a magenta canvas with 6 empty bright-green cells in a row. Paint the new subject into each of the 6 cells (one expression per cell, left to right). Leave everything that is not the subject as FLAT solid colour — the area around each subject pure magenta and any leftover cell area pure bright green — with no shadows, gradients or props, so the background can be removed. Do not copy anything else from the template.',
    });
    baseParts.push({
      inline_data: { mime_type: 'image/png', data: (await buildTemplate()).toString('base64') },
    });
  }
  // The model is stochastic about the strip layout / frame count; retry until it lands.
  const maxAttempts = Math.max(1, Number(opt.retries ?? 5));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(
      `generating ${set}/${piece} with ${model} (${mode}, attempt ${attempt}/${maxAttempts})…`,
    );
    const buf = await callModel(baseParts, `${mode} strip`);
    const raw = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels } = raw.info;
    const aspect = w / h;
    let frames = 0;
    if (aspect >= FRAME_COUNT * 0.6) {
      const { keyed } = keyImage(raw.data, raw.info);
      frames = detectFrames(keyed, w, h, channels).length;
    }
    const ok = aspect >= FRAME_COUNT * 0.6 && frames === FRAME_COUNT;
    if (ok || attempt === maxAttempts) {
      writeFileSync(rawPath, buf);
      console.log(`raw → ${rawPath} (${w}x${h}, ${frames} frames)`);
      if (!ok)
        console.warn(`  warning: wanted ${FRAME_COUNT} frames in a strip; processing may fail.`);
      break;
    }
    const why =
      aspect < FRAME_COUNT * 0.6
        ? `${w}x${h} not a strip`
        : `found ${frames}/${FRAME_COUNT} frames`;
    console.log(`  ${why} — retrying…`);
  }
  return rawPath;
}

// ---- background removal + framing ---------------------------------------
function pickAlphaThreshold(data, ch) {
  // Histogram alpha; find the widest empty/low gap between the background lobe and the subject.
  const hist = new Array(256).fill(0);
  for (let i = 3; i < data.length; i += ch) hist[data[i]]++;
  let best = 96;
  let bestRun = -1;
  let run = 0;
  for (let a = 8; a < 248; a++) {
    if (hist[a] === 0) {
      run++;
      if (run > bestRun) {
        bestRun = run;
        best = a - (run >> 1);
      }
    } else run = 0;
  }
  return best;
}

/**
 * Key the background into the alpha channel. Auto-picks `alpha` (threshold a bimodal alpha
 * histogram) or `chroma` (distance from the sampled corner colour) from the corners. In chroma
 * mode it also keys the two flat template colours (magenta bg + green cells) so they never survive
 * as opaque squares — pastel subjects are far from pure magenta/green, so this is always safe.
 */
function keyImage(data, info) {
  const { width: W, height: H, channels: ch } = info;
  const corner = (x, y) => {
    const i = (y * W + x) * ch;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const corners = [corner(2, 2), corner(W - 3, 2), corner(2, H - 3), corner(W - 3, H - 3)];
  const meanCornerA = corners.reduce((s, c) => s + c[3], 0) / corners.length;
  let mode = String(opt.key ?? 'auto');
  if (mode === 'auto') mode = meanCornerA < 200 ? 'alpha' : 'chroma';
  const threshold =
    opt.threshold !== undefined ? Number(opt.threshold) : pickAlphaThreshold(data, ch);
  const bg = [0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4);
  const keyColors = [bg, [255, 0, 255], [0, 255, 0]];
  const [rampLo, rampHi] =
    typeof opt.ramp === 'string' ? opt.ramp.split(',').map(Number) : [60, 110];

  const keyed = Buffer.from(data);
  for (let i = 0; i < keyed.length; i += ch) {
    if (mode === 'alpha') {
      keyed[i + 3] = data[i + 3] < threshold ? 0 : data[i + 3];
    } else {
      let dist = Infinity;
      for (const c of keyColors) {
        const d = Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]);
        if (d < dist) dist = d;
      }
      // soft ramp: below rampLo from a key colour → transparent, above rampHi → opaque.
      // Tighten with --ramp "lo,hi" for subjects whose palette drifts toward magenta (Z's pink
      // lands inside the default ramp and erodes); the boundary defringe cleans the wider halo.
      const a =
        dist <= rampLo
          ? 0
          : dist >= rampHi
            ? 255
            : Math.round(((dist - rampLo) / (rampHi - rampLo)) * 255);
      keyed[i + 3] = Math.min(data[i + 3], a);
    }
  }
  return { keyed, mode, bg, threshold };
}

/**
 * Find the subject frames by their column profile: runs of columns that contain opaque pixels,
 * separated by transparent gaps. Returns `[x0, x1]` ranges. Used both to crop (so frames stay
 * aligned even when the model spaces them unevenly) and to count frames (reject ≠ FRAME_COUNT).
 */
function detectFrames(keyed, W, H, ch) {
  const need = H * 0.04; // a column counts as "content" if >4% of it is opaque
  const has = new Array(W);
  for (let x = 0; x < W; x++) {
    let c = 0;
    for (let y = 0; y < H; y++) if (keyed[(y * W + x) * ch + 3] > 40) c++;
    has[x] = c > need;
  }
  const runs = [];
  let s = -1;
  for (let x = 0; x < W; x++) {
    if (has[x]) {
      if (s < 0) s = x;
    } else if (s >= 0) {
      runs.push([s, x - 1]);
      s = -1;
    }
  }
  if (s >= 0) runs.push([s, W - 1]);
  // bridge tiny gaps (a subject whose limbs briefly thin out) and drop specks
  const minGap = Math.round(W * 0.012);
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= minGap) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  const minW = Math.round((W / FRAME_COUNT) * 0.25);
  return merged.filter((r) => r[1] - r[0] + 1 >= minW);
}

/**
 * The calm frame's proportions in the finished expression sheet — used to scale-anchor action
 * frames so the character doesn't pop bigger/smaller when it starts moving, and to baseline-align
 * action frames to the same footing.
 */
async function expressionAnchor() {
  if (!existsSync(exprSheetPath)) return null;
  const boxes = await frameBoxes(sharp, exprSheetPath, FACE_ORDER.length);
  const calm = boxes[0];
  if (!calm.box) return null;
  return {
    heightRatio: calm.box.h / calm.frameH,
    bottomRatio: (calm.frameH - calm.box.maxY - 1) / calm.frameH,
  };
}

async function processSheet(srcPath) {
  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  if (W / H < FRAME_COUNT * 0.6) {
    throw new Error(
      `raw image is ${W}x${H}, not a ~${FRAME_COUNT}:1 strip — the model didn't emit a frame row. ` +
        `Regenerate (the default template, or --ref <piece>).`,
    );
  }
  const { keyed, mode, bg, threshold } = keyImage(data, info);
  console.log(
    `key mode=${mode}` +
      (mode === 'alpha'
        ? ` threshold=${threshold}`
        : ` chroma=rgb(${bg.map((v) => v | 0).join(',')})`),
  );

  // Defringe (actions): anti-aliased subject/magenta boundary pixels blend to magenta-ish colours
  // that sit just outside the chroma ramp and survive as a halo. Only touch pixels at the ALPHA
  // BOUNDARY (partial alpha, or bordering transparency) — a legitimately hot-pink subject (the Z
  // blob pre-tint) must not be eaten from the inside. Fully-opaque magenta patches are left for
  // the validator's residue check to flag.
  if (isActions) {
    let killed = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * ch;
        const a = keyed[i + 3];
        if (a === 0 || !(keyed[i] > 185 && keyed[i + 2] > 185 && keyed[i + 1] < 115)) continue;
        const edge =
          a < 250 ||
          (x > 0 && keyed[i - ch + 3] < 40) ||
          (x < W - 1 && keyed[i + ch + 3] < 40) ||
          (y > 0 && keyed[i - W * ch + 3] < 40) ||
          (y < H - 1 && keyed[i + W * ch + 3] < 40);
        if (edge) {
          keyed[i + 3] = 0;
          killed++;
        }
      }
    if (killed) console.log(`  defringe → removed ${killed} magenta-ish boundary pixels`);
  }

  // Frame segmentation. Action strips are assembled by US from per-pose cells, so the frame
  // boundaries are exact — no column-profile detection needed (wide poses can touch their cell
  // edge, which would merge detected runs). Model-drawn strips still need detection + the count
  // assertion.
  let segs;
  if (isActions) {
    segs = Array.from({ length: FRAME_COUNT }, (_, i) => [
      Math.round((i * W) / FRAME_COUNT),
      Math.round(((i + 1) * W) / FRAME_COUNT) - 1,
    ]);
  } else {
    segs = detectFrames(keyed, W, H, ch);
    if (segs.length !== FRAME_COUNT) {
      throw new Error(
        `detected ${segs.length} subject frames, expected ${FRAME_COUNT} — the model drew the wrong ` +
          `number. Regenerate (the generator retries until it gets ${FRAME_COUNT}).`,
      );
    }
  }

  // Per-frame content bbox (y bounds + tightened x bounds within each detected segment).
  const boxes = segs.map(([x0, x1]) => {
    let minX = x1,
      maxX = x0,
      minY = H,
      maxY = 0;
    for (let y = 0; y < H; y++)
      for (let x = x0; x <= x1; x++)
        if (keyed[(y * W + x) * ch + 3] > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    if (maxX < minX) return { minX: x0, maxX: x1, minY: 0, maxY: H - 1 };
    return { minX, maxX, minY, maxY };
  });

  // One shared square sized to the largest subject, so every frame is cropped at the same scale.
  let maxDim = 0;
  for (const b of boxes) maxDim = Math.max(maxDim, b.maxX - b.minX + 1, b.maxY - b.minY + 1);
  let sq = Math.min(Math.round(maxDim * (1 + pad * 2)), H);

  // Scale anchor (actions): match the finished character height to the expression sheet's calm
  // frame so the sprite doesn't pop in size when the runtime swaps between the two sheets.
  const exprAnchor = isActions ? await expressionAnchor() : null;
  if (exprAnchor) {
    const heights = boxes.map((b) => b.maxY - b.minY + 1).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)];
    const want = Math.round(medianH / exprAnchor.heightRatio);
    const clamped = Math.min(Math.max(want, Math.round(maxDim * (1 + pad))), H);
    if (clamped !== want)
      console.warn(`  scale anchor clamped: wanted square ${want}px, using ${clamped}px`);
    sq = clamped;
  }

  // Crop each detected frame to the shared square (centred on its subject horizontally; bottom-
  // aligned vertically for action sheets so walk frames share a baseline), resize, assemble.
  const bottomInset = Math.round(sq * (exprAnchor?.bottomRatio ?? pad));
  const rawKeyedPng = await sharp(keyed, { raw: { width: W, height: H, channels: ch } })
    .png()
    .toBuffer();
  const charColor = isActions ? await baseColor() : null;
  const tiles = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const b = boxes[f];
    let left = Math.max(0, Math.min(Math.round((b.minX + b.maxX) / 2 - sq / 2), W - sq));
    // Keep action crops inside their own cell so a wide neighbouring pose can't leak in.
    if (isActions) {
      const [x0, x1] = segs[f];
      left = Math.max(x0, Math.min(left, x1 + 1 - sq));
    }
    const centerTop = Math.round((b.minY + b.maxY) / 2 - sq / 2);
    const bottomTop = b.maxY + 1 + bottomInset - sq;
    const top = Math.max(0, Math.min(anchor === 'bottom' ? bottomTop : centerTop, H - sq));
    let tile = await sharp(rawKeyedPng)
      .extract({ left, top, width: sq, height: sq })
      .resize(frameSize, frameSize, { fit: 'fill' })
      .png()
      .toBuffer();
    if (charColor) tile = await tintTile(tile, charColor, SHEET_ORDER[f]);
    tiles.push({ input: tile, left: f * frameSize, top: 0 });
  }
  await sharp({
    create: {
      width: frameSize * FRAME_COUNT,
      height: frameSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(tiles)
    .png({ palette: true, quality: 90 })
    .toFile(outPath);
  console.log(
    `sheet → ${outPath} (${frameSize * FRAME_COUNT}x${frameSize}, ${FRAME_COUNT} frames)`,
  );
}

// ---- validation loop (actions) --------------------------------------------

async function validateAndRetry() {
  // The judge's character reference: the calm frame over the board colour (not magenta).
  const basePng = await frameOverBoard(sharp, exprSheetPath, 0, FACE_ORDER.length);
  const retries = Object.fromEntries(ACTION_ORDER.map((p) => [p, 0]));
  // First round judges every pose on a full run, or just the regenerated one under --pose.
  let only = typeof opt.pose === 'string' ? [opt.pose] : null;
  for (;;) {
    console.log(`validating ${outPath}${only ? ` (poses: ${only.join(', ')})` : ''}…`);
    const result = await validateSheet(sharp, outPath, { kind: 'actions', basePng, only });
    for (const fr of result.frames) {
      const j = fr.judge;
      const detail = fr.geometric.ok
        ? j && !j.error
          ? `judge: pose=${j.pose_ok} char=${j.same_character} single=${j.single_subject} ` +
            `artifacts=${j.artifacts} conf=${j.confidence}` +
            (fr.pass ? '' : ` (${j.pose_ok ? j.character_reason ?? '' : j.pose_reason ?? ''})`)
          : j?.error ?? 'not re-judged'
        : fr.geometric.problems.join('; ');
      console.log(`  ${fr.pass ? '✓' : '✗'} ${fr.name} — ${detail}`);
    }
    const failing = result.frames.filter((f) => !f.pass).map((f) => f.name);
    if (!failing.length) {
      console.log('all frames valid.');
      return;
    }
    const retryable = failing.filter((p) => retries[p] < maxPoseRetries);
    if (!retryable.length) {
      console.error(
        `poses still failing after ${maxPoseRetries} retries: ${failing.join(', ')}.\n` +
          `Retry one manually with:\n` +
          failing
            .map((p) => `  node scripts/gen-sprite-sheet.mjs ${set} ${piece} --actions --pose ${p}`)
            .join('\n'),
      );
      process.exitCode = 1;
      return;
    }
    for (const p of retryable) retries[p]++;
    console.log(`regenerating failing poses: ${retryable.join(', ')}…`);
    await generateActions(retryable);
    await processSheet(rawPath);
    only = failing;
  }
}

// ---- run -----------------------------------------------------------------
// Default to the per-frame editing pipeline; the single-shot strip generator is opt-in via
// --strip, or implied by --ref / --no-ref.
const useStrip = opt.strip || typeof opt.ref === 'string' || opt['no-ref'];
let srcPath;
if (opt['no-generate']) srcPath = existsSync(rawPath) ? rawPath : outPath;
else if (isActions)
  srcPath = await generateActions(typeof opt.pose === 'string' ? [opt.pose] : null);
else srcPath = useStrip ? await generate() : await generateFrames();
await processSheet(srcPath);
if (isActions && !opt['no-validate'] && !opt['no-generate']) await validateAndRetry();
if (!opt['keep-raw'] && !opt['no-generate'] && existsSync(rawPath)) {
  // raw is large; remove unless asked to keep it
  try {
    rmSync(rawPath);
  } catch {
    /* ignore */
  }
}
console.log('done.');
