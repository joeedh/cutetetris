#!/usr/bin/env node
// Generate (or just re-process) one block sprite sheet for a skin set.
//
//   node scripts/gen-sprite-sheet.mjs <set> <piece> [options]
//
// A "sheet" is a horizontal strip of 6 expression frames in this exact order:
//   [calm, blink, happy, worried, bicker, celebrate]
// matching the `Face` type the renderer slices on (see src/sprites.ts).
//
// The pipeline is: ask Gemini for a raw strip on a flat keyable background → key the
// background out → trim every frame to one shared square so they stay aligned → resize to
// 128px frames → assemble a 768x128 strip → quantize to a small palette PNG. The output is
// written to src/assets/blocks/<set>/<piece>.png.
//
// By default it uses a per-frame editing pipeline: generate one base "calm" subject, then
// image-to-image edit ONLY the face for each remaining expression. This guarantees exactly
// FRAME_COUNT frames with an identical body, in order — unlike the single-shot strip modes, which
// often yield 4-5 frames. Per-frame mode makes 6 Gemini calls per sheet (1 base + 5 edits).
//
// Options:
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
//   --frame <px>         Output frame size in px (default 128 → a 768x128 sheet).
//   --pad <0-1>          Fraction of padding around content in the shared square (default 0.06).
//   --model <id>         Gemini image model (default gemini-2.5-flash-image).
//   --keep-raw           Keep the raw Gemini PNG next to the output as <piece>.raw.png.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKS_DIR = resolve(ROOT, 'src/assets/blocks');
const FACE_ORDER = ['calm', 'blink', 'happy', 'worried', 'bicker', 'celebrate'];
const FRAME_COUNT = FACE_ORDER.length;

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
const setDir = resolve(BLOCKS_DIR, set);
mkdirSync(setDir, { recursive: true });
const outPath = resolve(setDir, `${piece}.png`);
const rawPath = resolve(setDir, `${piece}.raw.png`);
const frameSize = Number(opt.frame ?? 128);
const pad = Number(opt.pad ?? 0.06);
const model = String(opt.model ?? 'gemini-2.5-flash-image');

// ---- sharp (self-bootstrapping; not a repo dependency) -------------------
function ensureSharp() {
  const cache = resolve(ROOT, '.sprite-cache');
  const require = createRequire(import.meta.url);
  try {
    return require('sharp');
  } catch {
    /* fall through to install into the cache dir */
  }
  if (!existsSync(resolve(cache, 'node_modules/sharp'))) {
    console.log('installing sharp into .sprite-cache (one-time)…');
    mkdirSync(cache, { recursive: true });
    writeFileSync(resolve(cache, 'package.json'), '{"private":true}');
    execFileSync('npm', ['install', '--no-save', 'sharp@0.33'], {
      cwd: cache,
      stdio: 'inherit',
      shell: true,
    });
  }
  return createRequire(resolve(cache, 'package.json'))('sharp');
}
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

/** Per-expression face descriptions, in `FACE_ORDER`. Used by the per-frame editing pipeline. */
const FACE_PROMPTS = {
  calm: 'a calm, neutral, gently content face',
  blink: 'eyes happily closed as if blinking, with a soft content smile',
  happy: 'a big joyful open smile, eyes shut in happiness',
  worried: 'a nervous, worried face: wide anxious eyes and a tiny blue sweat drop',
  bicker: 'a grumpy, annoyed pout: furrowed brow and a small red anger-vein mark',
  celebrate: 'an excited, celebrating face: star-shaped sparkly eyes and an open cheering mouth',
};

const BG_NOTE =
  'Render on a SOLID FLAT pure-magenta #FF00FF background — one uniform colour, with no shadow, ' +
  'gradient, props or extra objects — so the background can be cleanly removed.';

/** POST `parts` to the image model and return the PNG buffer, retrying transient no-image replies. */
async function callModel(parts, label) {
  const apiKey = readFileSync(resolve(ROOT, 'keys/gemini.txt'), 'utf8').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    if (!res.ok) {
      if (attempt < 4 && res.status >= 500) continue;
      throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    const cand = json.candidates?.[0];
    const img = cand?.content?.parts?.find((p) => p.inlineData || p.inline_data);
    const data = img?.inlineData?.data ?? img?.inline_data?.data;
    if (data) return Buffer.from(data, 'base64');
    console.log(`  ${label}: no image (finishReason=${cand?.finishReason}) — retrying…`);
  }
  throw new Error(`No image for ${label} after retries.`);
}

/**
 * Default pipeline: generate ONE base (calm) subject, then image-to-image edit ONLY its face for
 * each remaining expression. This guarantees exactly FRAME_COUNT frames with an identical body on a
 * clean magenta background — far more reliable than coaxing the model to draw a whole 6-frame strip
 * in one shot (which routinely yields 4-5 frames or leaves coloured layout cells behind). The 6
 * frames are laid out on a magenta strip so the existing key/detect/crop pipeline finishes the job.
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
  // Lay the frames out on a magenta strip (each contained in a square cell), so the key/detect/crop
  // pipeline sees FRAME_COUNT cleanly-separated subjects on a pure-magenta background.
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
      // soft ramp: <60 from a key colour → transparent, >110 → opaque
      const a = dist <= 60 ? 0 : dist >= 110 ? 255 : Math.round(((dist - 60) / 50) * 255);
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

  // Detect the actual subject frames; bail clearly if the model drew the wrong number.
  const segs = detectFrames(keyed, W, H, ch);
  if (segs.length !== FRAME_COUNT) {
    throw new Error(
      `detected ${segs.length} subject frames, expected ${FRAME_COUNT} — the model drew the wrong ` +
        `number. Regenerate (the generator retries until it gets ${FRAME_COUNT}).`,
    );
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
  const sq = Math.min(Math.round(maxDim * (1 + pad * 2)), H);

  // Crop each detected frame (centred on its subject) to the shared square, resize, assemble.
  const rawKeyedPng = await sharp(keyed, { raw: { width: W, height: H, channels: ch } })
    .png()
    .toBuffer();
  const tiles = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const b = boxes[f];
    const left = Math.max(0, Math.min(Math.round((b.minX + b.maxX) / 2 - sq / 2), W - sq));
    const top = Math.max(0, Math.min(Math.round((b.minY + b.maxY) / 2 - sq / 2), H - sq));
    const tile = await sharp(rawKeyedPng)
      .extract({ left, top, width: sq, height: sq })
      .resize(frameSize, frameSize, { fit: 'fill' })
      .png()
      .toBuffer();
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

// ---- run -----------------------------------------------------------------
// Default to the per-frame editing pipeline; the single-shot strip generator is opt-in via
// --strip, or implied by --ref / --no-ref.
const useStrip = opt.strip || typeof opt.ref === 'string' || opt['no-ref'];
let srcPath;
if (opt['no-generate']) srcPath = existsSync(rawPath) ? rawPath : outPath;
else srcPath = useStrip ? await generate() : await generateFrames();
await processSheet(srcPath);
if (!opt['keep-raw'] && !opt['no-generate'] && existsSync(rawPath)) {
  // raw is large; remove unless asked to keep it
  try {
    (await import('node:fs')).rmSync(rawPath);
  } catch {
    /* ignore */
  }
}
console.log('done.');
