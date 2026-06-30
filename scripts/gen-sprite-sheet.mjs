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
// Options:
//   --theme "<text>"     Theme/subject for the art (default: read from the set's set.json, else the set id).
//   --prompt "<text>"    Full prompt override (skips the built-in prompt; --theme is ignored).
//   --ref <piece>        Use this piece's existing sheet in the set as a style reference (image-to-image).
//                        Default: any existing sheet in the set, else the same piece in the `blocks` set.
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
const theme = String(opt.theme ?? meta.theme ?? set);

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

function refSheetPath() {
  if (typeof opt.ref === 'string') {
    const p = resolve(setDir, `${opt.ref}.png`);
    if (existsSync(p)) return p;
  }
  // any existing sheet in this set (style match), else the same piece from the default set
  for (const f of FACE_ORDER.length ? [piece, 'I', 'O', 'T', 'S', 'Z', 'J', 'L'] : []) {
    const p = resolve(setDir, `${f}.png`);
    if (existsSync(p) && p !== outPath) return p;
  }
  const fallback = resolve(BLOCKS_DIR, 'blocks', `${piece}.png`);
  return existsSync(fallback) ? fallback : null;
}

async function generate() {
  const keyPath = resolve(ROOT, 'keys/gemini.txt');
  const apiKey = readFileSync(keyPath, 'utf8').trim();
  const parts = [{ text: buildPrompt() }];
  const ref = refSheetPath();
  if (ref) {
    const b64 = readFileSync(ref).toString('base64');
    parts.push({ inline_data: { mime_type: 'image/png', data: b64 } });
    parts.unshift({
      text: 'Match the art style, framing and frame layout of the reference image that follows, but with the new theme/subject described above.',
    });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  console.log(`generating ${set}/${piece} with ${model}${ref ? ' (image-to-image)' : ''}…`);
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
  writeFileSync(rawPath, Buffer.from(data, 'base64'));
  console.log(`raw → ${rawPath}`);
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
  const fw = Math.round(W / FRAME_COUNT);

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

  // Apply the key into the alpha channel, in place.
  const keyed = Buffer.from(data);
  for (let i = 0; i < keyed.length; i += ch) {
    if (mode === 'alpha') {
      keyed[i + 3] = data[i + 3] < threshold ? 0 : data[i + 3];
    } else {
      const dist = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
      // soft ramp: <60 from bg → transparent, >110 → opaque
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
    const tile = await sharp(rawKeyedPng)
      .extract({ left: f * fw + left, top, width: sq, height: sq })
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
