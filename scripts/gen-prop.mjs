#!/usr/bin/env node
// Generate a small skin-independent prop sprite used by the idle antics.
//
//   node scripts/gen-prop.mjs cards [--model <id>] [--no-judge]
//
// The `cards` prop is a 2-frame 256x128 strip [fanned hand, face-down pile] written to
// src/assets/props/cards.png. Same magenta-key pipeline as the block sheets, plus the geometric
// checks and a one-line vision-judge rubric per frame.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT,
  callImageModel,
  callJsonModel,
  ensureSharp,
  frameBoxes,
  frameOverBoard,
} from './lib/sprite-lib.mjs';

const PROPS = {
  cards: {
    out: 'src/assets/props/cards.png',
    frames: [
      {
        name: 'fan',
        prompt:
          'A small fanned hand of three playing cards, slightly overlapping in a fan shape. ' +
          'Crisp white card faces with BOLD dark-plum outlines and rich rose-red and deep-teal ' +
          'heart and star pips, cute storybook style with strong contrast (the cards must stand ' +
          'out clearly against a pale cream background). No characters, no hands, no table — ' +
          'just the fanned cards.',
        rubric: 'a small fan of overlapping playing cards with clear, high-contrast outlines',
      },
      {
        name: 'pile',
        prompt:
          'A small neat face-down pile of playing cards (a tiny tidy deck seen at a slight ' +
          'angle). Rich rose-red card backs with a cream border, a small dark heart motif, and ' +
          'BOLD dark-plum outlines, cute storybook style with strong contrast (must stand out ' +
          'clearly against a pale cream background). No characters, no hands, no table — just ' +
          'the little deck.',
        rubric:
          'a small face-down pile or deck of playing cards with clear, high-contrast outlines',
      },
    ],
  },
};

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
const name = positional[0];
const prop = PROPS[name];
if (!prop) {
  console.error(`usage: node scripts/gen-prop.mjs <${Object.keys(PROPS).join('|')}> [options]`);
  process.exit(2);
}
const model = String(opt.model ?? 'gemini-2.5-flash-image');
const FRAME = 128;
const sharp = ensureSharp();

const BG_NOTE =
  'Render on a SOLID FLAT pure-magenta #FF00FF background — one uniform colour, no shadow or ' +
  'gradient — so the background can be cleanly removed.';

/** Chroma-key magenta (and the sampled corner colour) out of an image buffer. */
async function keyMagenta(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  const ci = (x, y) => (y * W + x) * ch;
  const corner = [0, 1, 2].map(
    (k) =>
      (data[ci(2, 2) + k] +
        data[ci(W - 3, 2) + k] +
        data[ci(2, H - 3) + k] +
        data[ci(W - 3, H - 3) + k]) /
      4,
  );
  const keys = [corner, [255, 0, 255]];
  for (let i = 0; i < data.length; i += ch) {
    let dist = Infinity;
    for (const c of keys) {
      const d = Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]);
      if (d < dist) dist = d;
    }
    const a = dist <= 60 ? 0 : dist >= 110 ? 255 : Math.round(((dist - 60) / 50) * 255);
    data[i + 3] = Math.min(data[i + 3], a);
  }
  return { data, info };
}

/** Trim to the subject bbox (alpha > 24) and fit into a transparent FRAME x FRAME tile. */
async function toTile({ data, info }) {
  const { width: W, height: H, channels: ch } = info;
  let minX = W,
    maxX = -1,
    minY = H,
    maxY = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * ch + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) throw new Error('keyed frame is empty — regenerate.');
  return sharp(data, { raw: { width: W, height: H, channels: ch } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize(Math.round(FRAME * 0.88), Math.round(FRAME * 0.88), {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: Math.round(FRAME * 0.06),
      bottom: FRAME - Math.round(FRAME * 0.88) - Math.round(FRAME * 0.06),
      left: Math.round(FRAME * 0.06),
      right: FRAME - Math.round(FRAME * 0.88) - Math.round(FRAME * 0.06),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

const outPath = resolve(ROOT, prop.out);
mkdirSync(resolve(outPath, '..'), { recursive: true });

const tiles = [];
for (const f of prop.frames) {
  console.log(`generating ${name}/${f.name}…`);
  const raw = await callImageModel([{ text: `${f.prompt} ${BG_NOTE}` }], f.name, model);
  tiles.push(await toTile(await keyMagenta(raw)));
}
await sharp({
  create: {
    width: FRAME * prop.frames.length,
    height: FRAME,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(tiles.map((input, i) => ({ input, left: i * FRAME, top: 0 })))
  .png({ palette: true, quality: 90 })
  .toFile(outPath);
console.log(`prop → ${outPath} (${FRAME * prop.frames.length}x${FRAME})`);

// validation: geometric + one-line judge per frame
const boxes = await frameBoxes(sharp, outPath, prop.frames.length);
let failing = 0;
for (let i = 0; i < prop.frames.length; i++) {
  const f = prop.frames[i];
  const b = boxes[i];
  const problems = [];
  if (b.empty || b.coverage < 0.05) problems.push('frame (nearly) empty');
  if (b.magentaFrac > 0.005) problems.push('magenta residue');
  if (!opt['no-judge']) {
    const png = await frameOverBoard(sharp, outPath, i, prop.frames.length);
    const j = await callJsonModel([
      {
        text:
          `Does this image show ${f.rubric}, with no cartoon characters/mascots and no leftover ` +
          `flat magenta patches? (Card pips, suit symbols and rank letters are fine.) ` +
          `Answer ONLY JSON: {"ok": boolean, "reason": string}`,
      },
      { inline_data: { mime_type: 'image/png', data: png.toString('base64') } },
    ]);
    if (!j.ok) problems.push(`judge: ${j.reason}`);
  }
  console.log(
    `  ${problems.length ? '✗' : '✓'} ${f.name}${problems.length ? ' — ' + problems.join('; ') : ''}`,
  );
  if (problems.length) failing++;
}
if (failing) {
  console.error(`${failing} frame(s) failing — re-run to regenerate.`);
  process.exitCode = 1;
} else console.log('prop valid.');
