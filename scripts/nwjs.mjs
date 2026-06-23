import { buildApp, launchNw } from './lib/app.mjs';

// `pnpm nwjs` builds the app and opens it as a desktop window in NW.js.
// Set NWJS_CDP_PORT=<port> to also expose the DevTools / CDP endpoint (used by
// scripts/screenshot.mjs --attach to drive a long-lived instance).
await buildApp();

const envPort = process.env.NWJS_CDP_PORT;
const remoteDebuggingPort = envPort ? Number(envPort) : undefined;
if (remoteDebuggingPort) {
  console.log(`CDP endpoint: http://127.0.0.1:${remoteDebuggingPort}/json`);
}

const child = await launchNw({ remoteDebuggingPort });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Failed to launch NW.js:', err.message);
  process.exit(1);
});
