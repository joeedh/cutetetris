// esbuild resolves CSS side-effect imports at bundle time; this declaration satisfies the
// typechecker, which has no knowledge of the bundler's CSS loader.
declare module '*.css';
