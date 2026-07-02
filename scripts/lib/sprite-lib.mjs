// Shared plumbing for the sprite generation/validation scripts (gen-sprite-sheet.mjs,
// validate-sprite-frames.mjs, gen-prop.mjs, preview-sheets.mjs).

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BLOCKS_DIR = resolve(ROOT, 'src/assets/blocks');
export const BOARD_BG = '#fff9fd';

/** Expression-sheet frame order (must match `FACE_ORDER` in src/sprites.ts). */
export const FACE_ORDER = ['calm', 'blink', 'happy', 'worried', 'bicker', 'celebrate'];
/** Action-sheet pose order (must match `ACTION_INDEX` in src/sprites.ts). */
export const ACTION_ORDER = ['walk-a', 'walk-b', 'cards', 'punch-a', 'punch-b', 'scurry'];

/** Per-expression face descriptions, used by the per-frame editing pipeline. */
export const FACE_PROMPTS = {
  calm: 'a calm, neutral, gently content face',
  blink: 'eyes happily closed as if blinking, with a soft content smile',
  happy: 'a big joyful open smile, eyes shut in happiness',
  worried: 'a nervous, worried face: wide anxious eyes and a tiny blue sweat drop',
  bicker: 'a grumpy, annoyed pout: furrowed brow and a small red anger-vein mark',
  celebrate: 'an excited, celebrating face: star-shaped sparkly eyes and an open cheering mouth',
};

/**
 * Default per-pose descriptions for `.actions.png` sheets. A set can override any of these via
 * a `"poses"` object in its set.json (keyed by the ACTION_ORDER names) — e.g. the limbless mochi
 * blobs read a walk better as a squash-and-stretch hop.
 */
export const ACTION_PROMPTS = {
  'walk-a':
    'a mid-stride walking pose: leaning slightly forward mid-step with its weight visibly on one ' +
    'side (if the character has no legs, show a squashed hop-anticipation lean instead), content face',
  'walk-b':
    'the alternating step of the SAME walk: the other side/foot forward now (if the character has ' +
    'no legs, show it stretched tall mid-hop, leaning into the motion), content face',
  cards:
    'holding a small fan of three playing cards up in front of its chest, peeking at them with a ' +
    'concentrating happy face',
  'punch-a':
    'a playful play-fight wind-up: leaning back with one arm/side pulled back, ready to throw a ' +
    'soft bop, puffed-cheek determined face (cartoonish and cute, not violent)',
  'punch-b':
    'the bop landing: that arm/side stretched forward, body leaning forward, everything else the ' +
    'same playful cartoon fight, cute determined face',
  scurry:
    'an alarmed scurrying dash: body tilted hard into a run, wide shocked eyes, a tiny sweat ' +
    'drop, edges/limbs mid-scramble',
};

/** What the vision judge should look for, per pose (phrased as a yes/no criterion). */
export const POSE_RUBRICS = {
  'walk-a':
    'the character clearly mid-step or mid-hop: leaning into motion with its weight visibly shifted to one side',
  'walk-b':
    'the character clearly mid-step or mid-hop: leaning into motion (an alternate phase of a walk or hop)',
  cards: 'the character holding a small fan or hand of playing cards in front of itself',
  'punch-a': 'the character in a playful cartoon fight pose, winding up or leaning back to strike',
  'punch-b':
    'the character in a playful cartoon fight pose with an arm or side extended forward as if landing a soft punch',
  scurry:
    'the character dashing or scurrying in alarm: leaning hard into a run with a shocked or panicked expression',
};

/** Self-bootstrap sharp into .sprite-cache/ (it is deliberately not a repo dependency). */
export function ensureSharp() {
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

export function readGeminiKey() {
  return readFileSync(resolve(ROOT, 'keys/gemini.txt'), 'utf8').trim();
}

/** POST `parts` to an image model and return the PNG buffer, retrying transient no-image replies. */
export async function callImageModel(parts, label, model = 'gemini-2.5-flash-image') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${readGeminiKey()}`;
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
 * POST `parts` to a text model in JSON mode and return the parsed object. Retries once with a
 * "reply with ONLY valid JSON" nudge if the reply doesn't parse.
 */
export async function callJsonModel(parts, model = 'gemini-2.5-flash') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${readGeminiKey()}`;
  let attemptParts = parts;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: attemptParts }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) {
      if (attempt < 3 && res.status >= 500) continue;
      throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    try {
      return JSON.parse(text);
    } catch {
      attemptParts = [{ text: 'Reply with ONLY valid JSON, nothing else.' }, ...parts];
    }
  }
  throw new Error('Judge model returned unparseable JSON after retries.');
}

/**
 * Per-frame stats of a final (alpha-keyed) sheet: bounding box, opaque coverage, magenta residue,
 * and which frame edges the subject touches. Shared by the validator's geometric checks and the
 * generator's scale anchoring.
 */
export async function frameBoxes(sharp, sheetPath, frameCount = 6) {
  const { data, info } = await sharp(sheetPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  const fw = Math.floor(W / frameCount);
  const out = [];
  for (let f = 0; f < frameCount; f++) {
    const x0 = f * fw;
    let minX = fw,
      maxX = -1,
      minY = H,
      maxY = -1,
      opaque = 0,
      magenta = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < fw; x++) {
        const i = (y * W + x0 + x) * ch;
        if (data[i + 3] > 40) {
          opaque++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (data[i] > 200 && data[i + 2] > 200 && data[i + 1] < 100) magenta++;
        }
      }
    const empty = maxX < 0;
    out.push({
      frame: f,
      frameW: fw,
      frameH: H,
      empty,
      coverage: opaque / (fw * H),
      magentaFrac: opaque ? magenta / opaque : 0,
      box: empty ? null : { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
      touches: empty
        ? []
        : [
            ...(minX <= 0 ? ['left'] : []),
            ...(maxX >= fw - 1 ? ['right'] : []),
            ...(minY <= 0 ? ['top'] : []),
            ...(maxY >= H - 1 ? ['bottom'] : []),
          ],
    });
  }
  return out;
}

/** Composite one frame of a sheet over the board background and upscale it (for the judge). */
export async function frameOverBoard(sharp, sheetPath, frameIndex, frameCount = 6, size = 512) {
  const meta = await sharp(sheetPath).metadata();
  const fw = Math.floor(meta.width / frameCount);
  return sharp(sheetPath)
    .extract({ left: frameIndex * fw, top: 0, width: fw, height: meta.height })
    .resize(size, size, { fit: 'contain', background: BOARD_BG, kernel: 'lanczos3' })
    .flatten({ background: BOARD_BG })
    .png()
    .toBuffer();
}

/**
 * Geometric + (optionally) Gemini-vision validation of a sheet's frames.
 *
 * `kind` is 'actions' or 'expressions' — it selects the frame names and judge rubrics.
 * `basePng` (optional buffer) is the reference character image for the same-character check.
 * Returns `{ frames: [{name, geometric:{ok, problems}, judge, pass}], pass }`.
 */
export async function validateSheet(
  sharp,
  sheetPath,
  { kind = 'actions', basePng = null, judge = true, judgeModel = 'gemini-2.5-flash', only = null },
) {
  const names = kind === 'actions' ? ACTION_ORDER : FACE_ORDER;
  const boxes = await frameBoxes(sharp, sheetPath, names.length);
  const heights = boxes.filter((b) => b.box).map((b) => b.box.h);
  const median = heights.slice().sort((a, b) => a - b)[Math.floor(heights.length / 2)] ?? 0;
  const areas = boxes
    .filter((b) => b.box)
    .map((b) => b.box.w * b.box.h)
    .sort((a, b) => a - b);
  const medianArea = areas[Math.floor(areas.length / 2)] ?? 0;
  const coverages = boxes.map((b) => b.coverage).sort((a, b) => a - b);
  const medianCov = coverages[Math.floor(coverages.length / 2)] ?? 0;
  // Coverage floor is relative to the sheet's own median — absolute floors misfire on soft
  // watercolour alpha (the mochi T sheet sits far below the others) — plus a hard empty floor.
  const covFloor = Math.max(0.03, medianCov * 0.25);
  const pairs =
    kind === 'actions'
      ? [
          ['walk-a', 'walk-b'],
          ['punch-a', 'punch-b'],
        ]
      : [];

  const frames = names.map((name, i) => {
    const b = boxes[i];
    const problems = [];
    if (b.empty) problems.push('frame is empty');
    else {
      if (b.coverage < covFloor)
        problems.push(
          `coverage ${(b.coverage * 100).toFixed(1)}% < ${(covFloor * 100).toFixed(1)}% (sheet-relative floor)`,
        );
      if (b.coverage > 0.9) problems.push(`coverage ${(b.coverage * 100).toFixed(1)}% > 90%`);
      if (kind === 'actions') {
        // Squash-and-stretch poses legitimately trade height for width; compare bbox AREA, and
        // loosely — this is a backstop against eaten/blank frames, the judge handles nuance.
        const area = b.box.w * b.box.h;
        if (medianArea && Math.abs(area - medianArea) / medianArea > 0.65)
          problems.push(`subject area ${area}px² vs median ${medianArea}px² (>±65%)`);
      } else if (median && Math.abs(b.box.h - median) / median > 0.25)
        problems.push(`subject height ${b.box.h}px vs median ${median}px (>±25%)`);
      if (b.magentaFrac > 0.005)
        problems.push(`magenta residue ${(b.magentaFrac * 100).toFixed(2)}% of opaque pixels`);
      const badEdges = b.touches.filter((e) => e !== 'bottom');
      if (badEdges.length) problems.push(`subject clipped at ${badEdges.join('/')}`);
    }
    return { name, geometric: { ok: problems.length === 0, problems }, judge: null, pass: false };
  });

  for (const [a, b] of pairs) {
    const ia = names.indexOf(a);
    const ib = names.indexOf(b);
    const ba = boxes[ia].box;
    const bb = boxes[ib].box;
    // Compare bbox AREA, not height: squash-and-stretch pairs (a blob's hop) legitimately trade
    // height for width between phases, but the amount of character should stay similar.
    if (ba && bb) {
      const areaA = ba.w * ba.h;
      const areaB = bb.w * bb.h;
      if (Math.abs(areaA - areaB) / Math.max(areaA, areaB) > 0.5) {
        const msg = `pair ${a}/${b} subject areas ${areaA}px² vs ${areaB}px² differ >50% (will jitter)`;
        frames[ia].geometric.problems.push(msg);
        frames[ib].geometric.problems.push(msg);
        frames[ia].geometric.ok = false;
        frames[ib].geometric.ok = false;
      }
    }
  }

  for (let i = 0; i < names.length; i++) {
    const fr = frames[i];
    if (only && !only.includes(fr.name)) {
      fr.pass = fr.geometric.ok; // not re-judged this round
      continue;
    }
    if (!judge) {
      fr.pass = fr.geometric.ok;
      continue;
    }
    const rubric =
      kind === 'actions'
        ? POSE_RUBRICS[fr.name]
        : `the character with this facial expression: ${FACE_PROMPTS[fr.name]}`;
    const framePng = await frameOverBoard(sharp, sheetPath, i, names.length);
    const parts = [
      {
        text:
          `You are validating a game sprite frame. Image 1 is the frame to judge` +
          (basePng ? `; image 2 is the reference character it must match.` : `.`) +
          ` Answer ONLY JSON: {"single_subject": boolean, "pose_ok": boolean, "pose_reason": string, ` +
          `"same_character": boolean, "character_reason": string, "artifacts": boolean, "confidence": number}. ` +
          `pose_ok: does image 1 clearly show ${rubric}? ` +
          (basePng
            ? `same_character: is it recognisably the same character as image 2 — same creature/kind, ` +
              `same colour family, same facial features? Small rendering-style differences (bolder ` +
              `lines, slightly different shading) are ACCEPTABLE; a different creature, palette or ` +
              `added features are not. `
            : `same_character: set true. `) +
          `artifacts: any second subject, text, frame borders, or leftover flat magenta/green patches? ` +
          `confidence: 0-1 for your overall judgement.`,
      },
      { inline_data: { mime_type: 'image/png', data: framePng.toString('base64') } },
    ];
    if (basePng)
      parts.push({ inline_data: { mime_type: 'image/png', data: basePng.toString('base64') } });
    try {
      fr.judge = await callJsonModel(parts, judgeModel);
    } catch (err) {
      fr.judge = { error: String(err instanceof Error ? err.message : err) };
    }
    const j = fr.judge;
    const judgeOk = Boolean(
      j &&
        !j.error &&
        j.single_subject &&
        j.pose_ok &&
        j.same_character &&
        !j.artifacts &&
        Number(j.confidence ?? 0) >= 0.6,
    );
    fr.pass = fr.geometric.ok && judgeOk;
  }
  return { frames, pass: frames.every((f) => f.pass) };
}
