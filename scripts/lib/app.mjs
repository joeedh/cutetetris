import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import esbuild from 'esbuild';
import { findpath } from 'nw';
import { buildOptions, outdir } from '../esbuild.config.mjs';

/**
 * Bundle the app into dist/ (unminified, with sourcemaps — these scripts are dev
 * tooling) and drop the NW.js manifest beside it. NW.js launches an app from a
 * directory holding a package.json whose `main` points at the entry HTML.
 */
export async function buildApp() {
  await esbuild.build(buildOptions({ minify: false }));
  const manifest = {
    name: 'tetromochi',
    main: 'index.html',
    window: {
      title: 'Tetromochi ♡',
      width: 480,
      height: 920,
      min_width: 360,
      min_height: 640,
    },
  };
  writeFileSync(resolve(outdir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Spawn the NW.js runtime against dist/. Pass `remoteDebuggingPort` to expose the
 * Chrome DevTools Protocol endpoint (http://127.0.0.1:<port>/json) so the app can
 * be driven and screenshotted over CDP.
 *
 * @param {{ remoteDebuggingPort?: number }} [opts]
 * @returns {Promise<import('node:child_process').ChildProcess>}
 */
export async function launchNw({ remoteDebuggingPort } = {}) {
  const nwBin = await findpath();
  const args = [outdir];
  if (remoteDebuggingPort) {
    // `--remote-allow-origins=*` is required by modern Chromium to accept the CDP
    // WebSocket upgrade from a non-browser client.
    args.push(`--remote-debugging-port=${remoteDebuggingPort}`, '--remote-allow-origins=*');
  }
  return spawn(nwBin, args, { stdio: 'inherit' });
}
