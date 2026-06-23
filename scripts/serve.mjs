import esbuild from 'esbuild';
import { buildOptions, outdir } from './esbuild.config.mjs';

const ctx = await esbuild.context(buildOptions({ minify: false }));
await ctx.watch();
const { port } = await ctx.serve({ servedir: outdir, port: 8000 });
console.log(`Serving Tetromochi at http://localhost:${port}/  (watching for changes)`);
