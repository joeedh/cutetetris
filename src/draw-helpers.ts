import type { BlockOpts } from './types.ts';

const WHITE: readonly [number, number, number] = [255, 255, 255];
const DARK: readonly [number, number, number] = [120, 70, 95];

export function hex2rgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** Blend hex color `h` toward rgb tuple `t` by amount `a` (0..1), returning an rgb() string. */
export function mix(h: string, t: readonly number[], a: number): string {
  const c = hex2rgb(h);
  return `rgb(${Math.round(c[0] + (t[0] - c[0]) * a)},${Math.round(
    c[1] + (t[1] - c[1]) * a,
  )},${Math.round(c[2] + (t[2] - c[2]) * a)})`;
}

/** Trace a rounded rectangle path (does not fill or stroke). */
export function rr(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function drawStar(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    const a2 = a + Math.PI / 5;
    c.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
  }
  c.closePath();
  c.fill();
  c.restore();
}

export function drawHeart(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot?: number,
): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot ?? 0);
  c.scale(r / 10, r / 10);
  c.beginPath();
  c.moveTo(0, 3);
  c.bezierCurveTo(-1, -2, -8, -2, -8, 3);
  c.bezierCurveTo(-8, 7, -1, 10, 0, 12);
  c.bezierCurveTo(1, 10, 8, 7, 8, 3);
  c.bezierCurveTo(8, -2, 1, -2, 0, 3);
  c.closePath();
  c.fill();
  c.restore();
}

/** Draw a single "mochi" block — rounded body, highlight, shadow, blush, and a face. */
export function drawBlock(
  c: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  color: string,
  opts: BlockOpts = {},
): void {
  const face = opts.face ?? 'calm';
  const alpha = opts.alpha ?? 1;
  const sx = opts.scaleX ?? 1;
  const sy = opts.scaleY ?? 1;
  const glance = opts.glance ?? 0;
  const m = size * 0.07;
  const bx = px + m;
  const by = py + m;
  const bs = size - m * 2;
  const cx = px + size / 2;
  const cy = py + size / 2;

  c.save();
  c.globalAlpha = alpha;
  c.translate(cx, cy);
  c.scale(sx, sy);
  c.translate(-cx, -cy);

  rr(c, bx, by, bs, bs, bs * 0.3);
  c.fillStyle = color;
  c.fill();
  c.save();
  c.clip();
  c.globalAlpha = alpha * 0.55;
  c.fillStyle = mix(color, WHITE, 0.65);
  c.beginPath();
  c.ellipse(cx, by + bs * 0.26, bs * 0.36, bs * 0.2, 0, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = alpha * 0.3;
  c.fillStyle = mix(color, DARK, 0.55);
  c.fillRect(bx, by + bs * 0.74, bs, bs * 0.3);
  c.restore();
  c.globalAlpha = alpha * 0.5;
  c.lineWidth = Math.max(1.2, size * 0.045);
  c.strokeStyle = mix(color, DARK, 0.35);
  rr(c, bx, by, bs, bs, bs * 0.3);
  c.stroke();
  c.globalAlpha = alpha;

  if (face !== 'none') {
    const eyeY = cy - bs * 0.04;
    const eyeDX = bs * 0.2;
    const eyeR = bs * 0.072;
    const ink = mix(color, DARK, 0.82);
    c.globalAlpha = alpha * 0.5;
    c.fillStyle = '#ff7d9e';
    c.beginPath();
    c.ellipse(cx - eyeDX * 1.35, eyeY + bs * 0.12, bs * 0.085, bs * 0.06, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(cx + eyeDX * 1.35, eyeY + bs * 0.12, bs * 0.085, bs * 0.06, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = alpha;
    c.fillStyle = ink;
    c.strokeStyle = ink;
    c.lineWidth = Math.max(1.4, bs * 0.05);
    c.lineCap = 'round';

    if (face === 'happy') {
      c.beginPath();
      c.arc(cx - eyeDX, eyeY + eyeR * 0.4, eyeR * 1.05, Math.PI * 1.15, Math.PI * 1.85);
      c.stroke();
      c.beginPath();
      c.arc(cx + eyeDX, eyeY + eyeR * 0.4, eyeR * 1.05, Math.PI * 1.15, Math.PI * 1.85);
      c.stroke();
      c.beginPath();
      c.arc(cx, eyeY + bs * 0.16, bs * 0.12, 0.12 * Math.PI, 0.88 * Math.PI);
      c.stroke();
    } else if (face === 'blink') {
      c.beginPath();
      c.moveTo(cx - eyeDX - eyeR, eyeY);
      c.lineTo(cx - eyeDX + eyeR, eyeY);
      c.stroke();
      c.beginPath();
      c.moveTo(cx + eyeDX - eyeR, eyeY);
      c.lineTo(cx + eyeDX + eyeR, eyeY);
      c.stroke();
      c.beginPath();
      c.arc(cx, eyeY + bs * 0.14, bs * 0.075, 0.15 * Math.PI, 0.85 * Math.PI);
      c.stroke();
    } else if (face === 'worried') {
      c.fillStyle = ink;
      c.beginPath();
      c.ellipse(cx - eyeDX, eyeY, eyeR * 0.85, eyeR * 1.25, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(cx + eyeDX, eyeY, eyeR * 0.85, eyeR * 1.25, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,.9)';
      c.beginPath();
      c.arc(cx - eyeDX - eyeR * 0.25, eyeY - eyeR * 0.45, eyeR * 0.3, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(cx + eyeDX - eyeR * 0.25, eyeY - eyeR * 0.45, eyeR * 0.3, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = ink;
      c.beginPath();
      c.arc(cx, eyeY + bs * 0.24, bs * 0.075, 1.12 * Math.PI, 1.88 * Math.PI);
      c.stroke();
    } else {
      const gx = glance * eyeR * 0.55;
      c.fillStyle = ink;
      c.beginPath();
      c.arc(cx - eyeDX + gx, eyeY, eyeR, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(cx + eyeDX + gx, eyeY, eyeR, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,.9)';
      c.beginPath();
      c.arc(cx - eyeDX + gx - eyeR * 0.3, eyeY - eyeR * 0.35, eyeR * 0.34, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(cx + eyeDX + gx - eyeR * 0.3, eyeY - eyeR * 0.35, eyeR * 0.34, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = ink;
      c.beginPath();
      c.arc(cx, eyeY + bs * 0.1, bs * 0.085, 0.18 * Math.PI, 0.82 * Math.PI);
      c.stroke();
    }
  }
  c.restore();
}
