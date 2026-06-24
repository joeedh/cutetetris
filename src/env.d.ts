// esbuild resolves CSS side-effect imports at bundle time; this declaration satisfies the
// typechecker, which has no knowledge of the bundler's CSS loader.
declare module '*.css';

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.ogg' {
  const src: string;
  export default src;
}
