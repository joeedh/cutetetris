import esbuild from 'esbuild';
import { buildOptions } from './esbuild.config.mjs';

await esbuild.build(buildOptions({ minify: true }));
console.log('Build complete → dist/');
