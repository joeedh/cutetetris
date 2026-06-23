// Minimal Chrome DevTools Protocol client built on the globals Node ≥22 ships
// (`fetch` + `WebSocket`) — no external CDP library needed. Enough to attach to an
// NW.js page target, evaluate expressions, dispatch input, and capture screenshots.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll the DevTools HTTP endpoint until a debuggable `page` target appears. */
async function waitForPageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (err) {
      lastErr = err;
    }
    await delay(200);
  }
  throw new Error(
    `No CDP page target on port ${port} after ${timeoutMs}ms` +
      (lastErr ? ` (last error: ${lastErr.message})` : ''),
  );
}

export class CDP {
  #ws;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (ev) => this.#onMessage(ev));
  }

  /**
   * Connect to the page target exposed on `port` (waiting for it to come up).
   * @param {number} port
   * @param {{ timeoutMs?: number }} [opts]
   */
  static async attach(port, { timeoutMs = 20000 } = {}) {
    const target = await waitForPageTarget(port, timeoutMs);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), {
        once: true,
      });
    });
    return new CDP(ws);
  }

  /**
   * Send a CDP command and resolve with its result.
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   */
  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Subscribe to a CDP event (e.g. 'Page.loadEventFired'). Returns an unsubscribe fn. */
  on(event, fn) {
    const set = this.#listeners.get(event) ?? new Set();
    set.add(fn);
    this.#listeners.set(event, set);
    return () => set.delete(fn);
  }

  /** Resolve once `event` fires (or reject after `timeoutMs`). */
  once(event, { timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for CDP event ${event}`));
      }, timeoutMs);
      const off = this.on(event, (params) => {
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  close() {
    this.#ws.close();
  }

  #onMessage(ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined && this.#pending.has(msg.id)) {
      const { resolve, reject } = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params);
    }
  }
}

export { delay };
