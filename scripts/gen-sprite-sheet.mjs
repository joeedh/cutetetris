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
// By default it generates text-to-image with a blank 6-cell layout template (so the model emits a
// 6:1 strip with no subject to copy) and retries until the output really is a strip.
//
// Options:
//   --theme "<text>"     Theme/subject (default: set.json `themes.<piece>` → `theme` → the set id).
//   --prompt "<text>"    Full prompt override (skips the built-in prompt; --theme is ignored).
//   --ref <piece>        Use that piece's existing sheet (this set, else `blocks`) as an
//                        image-to-image reference. Forces the 6:1 layout reliably, but the
//                        reference subject can LEAK into a frame — preview and regenerate if so.
//   --no-ref             Pure text-to-image, no template/reference (usually returns a single square).
//   --retries <n>        Generation attempts to land a ~6:1 strip (default 5).
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
 * keyed out cleanly — unlike a cream cell, which would survive as an opaque square. Default when
 * no `--ref`.
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

async function generate() {
  const keyPath = resolve(ROOT, 'keys/gemini.txt');
  const apiKey = readFileSync(keyPath, 'utf8').trim();
  const parts = [{ text: buildPrompt() }];
  const ref = refSheetPath();
  let mode = 'text-to-image';
  if (ref) {
    mode = 'image-to-image';
    parts.unshift({
      text: 'Match the art style, framing and frame layout of the reference image that follows, but with the new theme/subject described above. Replace the subject in EVERY frame — do not copy the reference subject into any frame.',
    });
    parts.push({
      inline_data: { mime_type: 'image/png', data: readFileSync(ref).toString('base64') },
    });
  } else if (!opt['no-ref']) {
    mode = 'template';
    parts.unshift({
      text: 'The image that follows is a BLANK LAYOUT TEMPLATE: a magenta canvas with 6 empty bright-green cells in a row. Paint the new subject into each of the 6 cells (one expression per cell, left to right). Leave everything that is not the subject as FLAT solid colour — the area around each subject pure magenta and any leftover cell area pure bright green — with no shadows, gradients or props, so the background can be removed. Do not copy anything else from the template.',
    });
    parts.push({
      inline_data: { mime_type: 'image/png', data: (await buildTemplate()).toString('base64') },
    });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  // The model is stochastic about honoring the 6:1 strip layout; retry until it does.
  const maxAttempts = Math.max(1, Number(opt.retries ?? 5));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(
      `generating ${set}/${piece} with ${model} (${mode}, attempt ${attempt}/${maxAttempts})…`,
    );
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const cand = json.candidates?.[0];
    const img = cand?.content?.parts?.find((p) => p.inlineData || p.inline_data);
    const data = img?.inlineData?.data ?? img?.inline_data?.data;
    if (!data) throw new Error(`No image in response (finishReason=${cand?.finishReason}).`);
    const buf = Buffer.from(data, 'base64');
    const meta = await sharp(buf).metadata();
    const aspect = meta.width / meta.height;
    if (aspect >= FRAME_COUNT * 0.6 || attempt === maxAttempts) {
      writeFileSync(rawPath, buf);
      console.log(`raw → ${rawPath} (${meta.width}x${meta.height})`);
      if (aspect < FRAME_COUNT * 0.6)
        console.warn(`  warning: not a ${FRAME_COUNT}:1 strip; processing may fail.`);
      break;
    }
    console.log(`  got ${meta.width}x${meta.height} (not a strip) — retrying…`);
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

async function processSheet(srcPath) {
  const base = sharp(srcPath).ensureAlpha();
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  const aspect = W / H;
  if (aspect < FRAME_COUNT * 0.6) {
    throw new Error(
      `raw image is ${W}x${H} (aspect ${aspect.toFixed(2)}), not a ~${FRAME_COUNT}:1 strip — ` +
        `the model didn't emit a 6-frame row. Re-run with a layout reference (the default template, ` +
        `or --ref <piece>) rather than --no-ref.`,
    );
  }
  const fw = Math.floor(W / FRAME_COUNT);

  // Decide keying mode from the corners.
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
  const bg = [
    corners.reduce((s, c) => s + c[0], 0) / 4,
    corners.reduce((s, c) => s + c[1], 0) / 4,
    corners.reduce((s, c) => s + c[2], 0) / 4,
  ];
  console.log(
    `key mode=${mode}` +
      (mode === 'alpha'
        ? ` threshold=${threshold}`
        : ` chroma=rgb(${bg.map((v) => v | 0).join(',')})`),
  );

  // In chroma mode, key out the sampled corner colour AND the two flat template colours (magenta
  // background + green placeholder cells), so the template's cells don't survive as opaque squares.
  // Pastel subjects are far from pure magenta/green, so always including them is safe.
  const keyColors = [bg, [255, 0, 255], [0, 255, 0]];

  // Apply the key into the alpha channel, in place.
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

  // Per-frame content bbox, unioned into one shared rect (so frames stay aligned).
  let minX = fw,
    minY = H,
    maxX = 0,
    maxY = 0;
  for (let f = 0; f < FRAME_COUNT; f++) {
    const ox = f * fw;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < fw; x++) {
        const a = keyed[(y * W + ox + x) * ch + 3];
        if (a > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX < minX) {
    minX = 0;
    minY = 0;
    maxX = fw - 1;
    maxY = H - 1;
  }

  // Square + pad the shared crop, centered, clamped to a single frame.
  const cw = maxX - minX + 1;
  const cwH = maxY - minY + 1;
  let sq = Math.max(cw, cwH);
  sq = Math.min(Math.round(sq * (1 + pad * 2)), fw, H);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let left = Math.round(cx - sq / 2);
  let top = Math.round(cy - sq / 2);
  left = Math.max(0, Math.min(left, fw - sq));
  top = Math.max(0, Math.min(top, H - sq));

  // Crop each frame to the shared square, resize to frameSize, composite into the strip.
  const rawKeyedPng = await sharp(keyed, { raw: { width: W, height: H, channels: ch } })
    .png()
    .toBuffer();
  const tiles = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const exLeft = Math.min(f * fw + left, W - sq); // clamp so the last frame can't overrun width
    const tile = await sharp(rawKeyedPng)
      .extract({ left: exLeft, top, width: sq, height: sq })
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
  console.log(`sheet → ${outPath} (${frameSize * FRAME_COUNT}x${frameSize})`);
}

// ---- run -----------------------------------------------------------------
const srcPath = opt['no-generate'] ? (existsSync(rawPath) ? rawPath : outPath) : await generate();
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
