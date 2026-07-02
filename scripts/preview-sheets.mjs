#!/usr/bin/env node
// Render a human-eyeball contact sheet of every sprite sheet in a skin set (expression + action
// rows, labelled), composited over the board colour at 2x, to screenshots/sheets-<set>.png.
//
//   node scripts/preview-sheets.mjs <set>

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLOCKS_DIR, BOARD_BG, ROOT, ensureSharp } from './lib/sprite-lib.mjs';

const set = process.argv[2];
if (!set) {
  console.error('usage: node scripts/preview-sheets.mjs <set>');
  process.exit(2);
}
const setDir = resolve(BLOCKS_DIR, set);
if (!existsSync(setDir)) {
  console.error(`no such set dir: ${setDir}`);
  process.exit(2);
}

const sharp = ensureSharp();
const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const SCALE = 2;
const FRAME = 128 * SCALE;
const LABEL_W = 120;
const ROW_H = FRAME + 8;

const rows = [];
for (const piece of PIECES) {
  for (const suffix of ['', '.actions']) {
    const p = resolve(setDir, `${piece}${suffix}.png`);
    if (existsSync(p)) rows.push({ label: `${piece}${suffix}`, path: p });
  }
}
if (!rows.length) {
  console.error(`no sheets found in ${setDir}`);
  process.exit(1);
}

const meta = await sharp(rows[0].path).metadata();
const frames = Math.round(meta.width / meta.height);
const W = LABEL_W + frames * FRAME;
const H = rows.length * ROW_H;

const composites = [];
for (let r = 0; r < rows.length; r++) {
  composites.push({
    input: await sharp(rows[r].path)
      .resize(frames * FRAME, FRAME, { kernel: 'nearest' })
      .png()
      .toBuffer(),
    left: LABEL_W,
    top: r * ROW_H,
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_W}" height="${FRAME}"><text x="8" y="${FRAME / 2}" font-family="sans-serif" font-size="22" fill="#a06080" dominant-baseline="middle">${rows[r].label}</text></svg>`;
  composites.push({ input: Buffer.from(svg), left: 0, top: r * ROW_H });
}

const outPath = resolve(ROOT, `screenshots/sheets-${set}.png`);
mkdirSync(resolve(ROOT, 'screenshots'), { recursive: true });
await sharp({
  create: { width: W, height: H, channels: 4, background: BOARD_BG },
})
  .composite(composites)
  .flatten({ background: BOARD_BG })
  .png()
  .toFile(outPath);
console.log(`contact sheet → ${outPath} (${rows.length} sheets)`);
