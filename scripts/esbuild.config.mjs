import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const outdir = resolve(root, 'dist');
export const srcdir = resolve(root, 'src');

/** Copy the static HTML shell into dist on every (re)build. */
const copyStaticPlugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(() => {
      mkdirSync(outdir, { recursive: true });
      cpSync(resolve(srcdir, 'index.html'), resolve(outdir, 'index.html'));
    });
  },
};

/** Shared esbuild options for both the one-shot build and the dev server. */
export function buildOptions({ minify }) {
  return {
    entryPoints: [resolve(srcdir, 'main.ts')],
    bundle: true,
    // IIFE (not ESM) so the built page also runs when opened directly from disk (file://):
    // browsers block ES-module <script> over file:// for CORS reasons, but classic scripts load.
    format: 'iife',
    target: 'es2022',
    outdir,
    sourcemap: true,
    minify,
    logLevel: 'info',
    plugins: [copyStaticPlugin],
  };
}
