/** Look up a required element by id, throwing if the markup is missing it. */
export function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found;
}

/** Look up a required `<canvas>` by id. */
export function canvas(id: string): HTMLCanvasElement {
  const found = el(id);
  if (!(found instanceof HTMLCanvasElement)) throw new Error(`#${id} is not a <canvas>`);
  return found;
}

/** Get a 2D context, throwing if the browser can't provide one. */
export function ctx2d(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const c = cv.getContext('2d');
  if (!c) throw new Error('2D canvas context unavailable');
  return c;
}
