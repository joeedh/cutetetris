#!/usr/bin/env node
// Validate the frames of a generated sprite sheet: cheap geometric checks (frame count, subject
// coverage/size, magenta residue, edge clipping, walk/punch pair consistency) plus a Gemini
// vision judge (pose correctness, character consistency vs the calm frame, artifacts).
//
//   node scripts/validate-sprite-frames.mjs <set> <piece> [options]
//
//   --actions          Validate <piece>.actions.png (default: the expression sheet <piece>.png).
//   --no-judge         Geometric checks only — no Gemini calls.
//   --model <id>       Judge model (default gemini-2.5-flash).
//   --report <path>    Also write the full JSON report to a file.
//
// Prints a per-frame table and a JSON report to stdout; the exit code is the number of failing
// frames (0 = all good). gen-sprite-sheet.mjs --actions runs the same checks (from
// scripts/lib/sprite-lib.mjs) automatically and regenerates failing poses; this CLI is for
// re-checking without generating, and for calibrating the judge on known-good sheets.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  BLOCKS_DIR,
  FACE_ORDER,
  ensureSharp,
  frameOverBoard,
  validateSheet,
} from './lib/sprite-lib.mjs';

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
  console.error('usage: node scripts/validate-sprite-frames.mjs <set> <piece> [options]');
  process.exit(2);
}

const kind = opt.actions ? 'actions' : 'expressions';
const setDir = resolve(BLOCKS_DIR, set);
const sheetPath = resolve(setDir, `${piece}${kind === 'actions' ? '.actions' : ''}.png`);
const exprSheetPath = resolve(setDir, `${piece}.png`);
if (!existsSync(sheetPath)) {
  console.error(`sheet not found: ${sheetPath}`);
  process.exit(2);
}

const sharp = ensureSharp();
const judge = !opt['no-judge'];
// Character reference for the same-character check: the calm expression frame over board colour.
const basePng =
  judge && existsSync(exprSheetPath)
    ? await frameOverBoard(sharp, exprSheetPath, 0, FACE_ORDER.length)
    : null;

const result = await validateSheet(sharp, sheetPath, {
  kind,
  basePng,
  judge,
  judgeModel: String(opt.model ?? 'gemini-2.5-flash'),
});

for (const fr of result.frames) {
  const j = fr.judge;
  const bits = [];
  if (!fr.geometric.ok) bits.push(fr.geometric.problems.join('; '));
  if (j && !j.error)
    bits.push(
      `judge: pose=${j.pose_ok} char=${j.same_character} artifacts=${j.artifacts} conf=${j.confidence}` +
        (j.pose_ok ? '' : ` (${j.pose_reason})`),
    );
  if (j?.error) bits.push(`judge error: ${j.error}`);
  console.log(`  ${fr.pass ? '✓' : '✗'} ${fr.name} — ${bits.join(' | ') || 'ok'}`);
}
const failing = result.frames.filter((f) => !f.pass);
console.log(failing.length ? `${failing.length} frame(s) failing.` : 'all frames valid.');

const report = { set, piece, kind, sheet: sheetPath, ...result };
if (typeof opt.report === 'string') {
  const p = resolve(opt.report);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(report, null, 2));
  console.log(`report → ${p}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
process.exitCode = failing.length;
