import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildApp, launchNw } from './lib/app.mjs';
import { CDP, delay } from './lib/cdp.mjs';

// Drive the NW.js app over CDP and save a PNG screenshot.
//
//   node scripts/screenshot.mjs [options]
//
//   --out <path>     output PNG path           (default: screenshots/tetromochi.png)
//   --port <n>       CDP port                  (default: 9333)
//   --wait <ms>      settle time before capture (default: 1200)
//   --eval <js>      run JS in the page first   (e.g. start the game / press keys)
//   --attach         connect to an already-running instance (don't build/launch/kill)
//   --keep           leave NW.js running after the screenshot
//
// One-shot (build → launch → capture → exit):
//   node scripts/screenshot.mjs --out shots/start.png
// Drive a live instance (start it once with `NWJS_CDP_PORT=9333 pnpm nwjs`):
//   node scripts/screenshot.mjs --attach --eval "document.getElementById('playBtn').click()"

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true; // boolean flag
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 9333);
const outPath = resolve(String(args.out ?? 'screenshots/tetromochi.png'));
const settleMs = Number(args.wait ?? 1200);
const attach = Boolean(args.attach);
const keep = Boolean(args.keep) || attach;

let child;
let cdp;
try {
  if (!attach) {
    await buildApp();
    child = await launchNw({ remoteDebuggingPort: port });
  }

  cdp = await CDP.attach(port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  if (args.eval) {
    const { exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression: String(args.eval),
      awaitPromise: true,
      userGesture: true,
    });
    if (exceptionDetails) {
      throw new Error(`--eval threw: ${exceptionDetails.text ?? 'unknown error'}`);
    }
  }

  await delay(settleMs);

  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log(`Screenshot → ${outPath}`);
} catch (err) {
  console.error('Screenshot failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (child && !keep) child.kill();
}
