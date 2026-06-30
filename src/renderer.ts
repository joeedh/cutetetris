import { CELL, CLEAR_DUR, COLORS, COLS, ROWS, SHAPES } from './constants.ts';
import { canvas, ctx2d } from './dom.ts';
import { drawBlock, drawHeart, drawStar, rr } from './draw-helpers.ts';
import type { Game } from './game.ts';
import type { Face, Mood } from './types.ts';

function setupCanvas(
  cv: HTMLCanvasElement,
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  // The display size is set in CSS so the layout can scale the board down to fit
  // short viewports (e.g. on a high-DPR / zoomed display). Here we only size the
  // backing store for the device pixel ratio and scale the context to match, so
  // the renderer keeps drawing in logical CSS-pixel coordinates.
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function settleScale(t: number): { sx: number; sy: number } {
  const d = 360;
  if (t > d) return { sx: 1, sy: 1 };
  const p = t / d;
  const s = Math.exp(-3.5 * p) * Math.sin(p * Math.PI * 3);
  return { sx: 1 + 0.18 * s, sy: 1 - 0.18 * s };
}

/** Renders the board, the next-piece preview, and the mascot from `Game` state each frame. */
export class Renderer {
  private board = canvas('board');
  private ctx = ctx2d(this.board);
  private nextC = canvas('nextCanvas');
  private nctx = ctx2d(this.nextC);
  private mascotC = canvas('mascot');
  private mctx = ctx2d(this.mascotC);

  constructor() {
    setupCanvas(this.board, this.ctx, COLS * CELL, ROWS * CELL);
    setupCanvas(this.nextC, this.nctx, 84, 60);
    setupCanvas(this.mascotC, this.mctx, 84, 84);
  }

  draw(game: Game): void {
    const ctx = this.ctx;
    const now = performance.now();
    ctx.clearRect(0, 0, COLS * CELL, ROWS * CELL);
    ctx.fillStyle = '#fff9fd';
    rr(ctx, 0, 0, COLS * CELL, ROWS * CELL, 16);
    ctx.fill();

    // faint grid + dot texture
    ctx.strokeStyle = 'rgba(255,200,222,.4)';
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 6);
      ctx.lineTo(x * CELL, ROWS * CELL - 6);
      ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(6, y * CELL);
      ctx.lineTo(COLS * CELL - 6, y * CELL);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,180,210,.07)';
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        ctx.beginPath();
        ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

    // ambient hearts behind blocks
    for (const h of game.ambient) {
      ctx.globalAlpha = h.alpha;
      ctx.fillStyle = '#ff9ec2';
      drawHeart(ctx, h.x + Math.sin(h.sway) * 6, h.y, h.size, 0);
    }
    ctx.globalAlpha = 1;

    // danger detection
    game.dangerNow = false;
    if (game.status === 'playing') {
      for (let y = 0; y < 4 && !game.dangerNow; y++)
        for (let x = 0; x < COLS; x++) {
          if (game.grid[y][x]) {
            game.dangerNow = true;
            break;
          }
        }
    }

    let by = 0;
    if (game.bounce > 0) {
      by = -Math.sin(game.bounce * Math.PI) * 4;
      game.bounce = Math.max(0, game.bounce - 0.1);
    }
    ctx.save();
    ctx.translate(0, by);

    const blink = game.blink;
    if (now > blink.next) {
      blink.until = now + 140;
      blink.next = now + 2200 + Math.random() * 2600;
    }
    const blinking = now < blink.until;
    const glanceState = game.glance;
    if (now > glanceState.next) {
      glanceState.dir = [-1, 1][(Math.random() * 2) | 0];
      glanceState.until = now + 700;
      glanceState.next = now + 3500 + Math.random() * 3500;
    }
    const glance = now < glanceState.until ? glanceState.dir : 0;

    const clearingSet = game.clearInfo ? new Set(game.clearInfo.rows) : null;
    const clearP = game.clearInfo ? Math.min(1, (now - game.clearInfo.start) / CLEAR_DUR) : 0;

    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const cell = game.grid[y][x];
        if (!cell) continue;
        if (clearingSet && clearingSet.has(y)) {
          const e = clearP;
          const hop = -Math.sin(Math.min(e * 1.6, 1) * Math.PI) * CELL * 0.5;
          const sc = 1 + 0.12 * Math.sin(Math.min(e * 1.6, 1) * Math.PI);
          const alpha = e < 0.6 ? 1 : 1 - (e - 0.6) / 0.4;
          drawBlock(ctx, x * CELL, y * CELL + hop, CELL, cell.color, {
            face: 'happy',
            alpha: Math.max(0, alpha),
            scaleX: sc,
            scaleY: sc,
          });
        } else {
          const s = settleScale(now - cell.settle);
          const br = 1 + Math.sin(now * 0.0022 + (x * 0.6 + y * 0.4)) * 0.016;
          let face: Face;
          let dx = 0;
          if (cell.expr && cell.exprUntil && now < cell.exprUntil) {
            face = cell.expr;
            if (face === 'bicker') dx = Math.sin(now * 0.045 + x * 1.7 + y) * 1.6;
          } else {
            face = game.dangerNow && y < 7 ? 'worried' : blinking ? 'blink' : 'calm';
          }
          drawBlock(ctx, x * CELL + dx, y * CELL, CELL, cell.color, {
            face,
            glance,
            scaleX: s.sx * br,
            scaleY: s.sy * br,
          });
        }
      }

    const cur = game.current;
    if (cur && (game.status === 'playing' || game.status === 'paused')) {
      let gy = cur.y;
      while (!game.collide(cur, cur.x, gy + 1)) gy++;
      const m = cur.matrix;
      for (let y = 0; y < m.length; y++)
        for (let x = 0; x < m[y].length; x++) {
          if (!m[y][x]) continue;
          const ny = gy + y;
          if (ny >= 0)
            drawBlock(ctx, (cur.x + x) * CELL, ny * CELL, CELL, cur.color, {
              face: 'none',
              alpha: 0.2,
            });
        }
      const aface: Face = game.lockTimer !== null ? 'worried' : blinking ? 'blink' : 'calm';
      for (let y = 0; y < m.length; y++)
        for (let x = 0; x < m[y].length; x++) {
          if (!m[y][x]) continue;
          const ny = cur.y + y;
          if (ny >= 0)
            drawBlock(ctx, (cur.x + x) * CELL, ny * CELL, CELL, cur.color, {
              face: aface,
              glance,
              alpha: game.status === 'paused' ? 0.5 : 1,
            });
        }
    }
    ctx.restore();

    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      if (p.kind === 'star') drawStar(ctx, p.x, p.y + by, p.size, p.rot);
      else if (p.kind === 'heart') drawHeart(ctx, p.x, p.y + by, p.size, p.rot);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y + by, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    for (const p of game.popups) {
      const grow = p.t < 0.2 ? p.t / 0.2 : 1;
      const sc = p.scale * (0.6 + 0.4 * grow) * (1 + 0.04 * Math.sin(p.t * 8));
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 1.4);
      ctx.translate(p.x, p.y);
      ctx.scale(sc, sc);
      ctx.font = '700 26px Fredoka, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }

    this.drawMascot(game);
    this.drawNext(game);
  }

  private drawNext(game: Game): void {
    const nctx = this.nctx;
    nctx.clearRect(0, 0, 84, 60);
    if (!game.nextQueue.length) return;
    const type = game.nextQueue[0];
    const m = SHAPES[type];
    let minx = 9;
    let maxx = -1;
    let miny = 9;
    let maxy = -1;
    for (let y = 0; y < m.length; y++)
      for (let x = 0; x < m[y].length; x++)
        if (m[y][x]) {
          minx = Math.min(minx, x);
          maxx = Math.max(maxx, x);
          miny = Math.min(miny, y);
          maxy = Math.max(maxy, y);
        }
    const w = maxx - minx + 1;
    const h = maxy - miny + 1;
    const cs = Math.min(84 / (w + 0.5), 60 / (h + 0.5), 20);
    const ox = (84 - w * cs) / 2;
    const oy = (60 - h * cs) / 2;
    for (let y = 0; y < m.length; y++)
      for (let x = 0; x < m[y].length; x++)
        if (m[y][x])
          drawBlock(nctx, ox + (x - minx) * cs, oy + (y - miny) * cs, cs, COLORS[type], {
            face: 'calm',
          });
  }

  private drawMascot(game: Game): void {
    const w = 84;
    const h = 84;
    const c = this.mctx;
    const now = performance.now();
    c.clearRect(0, 0, w, h);
    let mood: Mood = 'idle';
    if (game.status === 'paused') mood = 'sleep';
    else if (game.status === 'over') mood = 'sad';
    else if (now < game.cheerUntil) mood = 'cheer';
    else if (game.status === 'playing' && game.dangerNow) mood = 'worried';

    const cx = w / 2;
    const bob = Math.sin(now * 0.003) * 2;
    let cy = h * 0.56 + bob;
    if (mood === 'cheer') cy -= Math.abs(Math.sin(now * 0.018)) * 7;
    const R = 22;
    const ink = '#8a6076';

    c.save();
    if (mood === 'worried') c.translate(Math.sin(now * 0.045) * 1.3, 0);

    // ears
    const earY = cy - R * 0.72;
    const earDX = R * 0.6;
    const earH = R * 0.95;
    const earW = R * 0.62;
    c.fillStyle = '#fff3f8';
    c.strokeStyle = '#ffd0e1';
    c.lineWidth = 3;
    c.lineJoin = 'round';
    [-1, 1].forEach((s) => {
      c.beginPath();
      c.moveTo(cx + s * earDX - earW / 2, earY);
      c.lineTo(cx + s * earDX, earY - earH);
      c.lineTo(cx + s * earDX + earW / 2, earY);
      c.closePath();
      c.fill();
      c.stroke();
    });
    c.fillStyle = '#ffb6cd';
    [-1, 1].forEach((s) => {
      c.beginPath();
      c.moveTo(cx + s * earDX - earW * 0.22, earY - 2);
      c.lineTo(cx + s * earDX, earY - earH * 0.68);
      c.lineTo(cx + s * earDX + earW * 0.22, earY - 2);
      c.closePath();
      c.fill();
    });

    // arms up if cheering
    if (mood === 'cheer') {
      c.fillStyle = '#fff3f8';
      c.strokeStyle = '#ffd0e1';
      c.lineWidth = 3;
      [-1, 1].forEach((s) => {
        c.beginPath();
        c.ellipse(cx + s * (R + 1), cy - R * 0.7, 5, 7, s * 0.5, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      });
    }

    // body
    c.fillStyle = '#fff3f8';
    c.strokeStyle = '#ffd0e1';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fill();
    c.stroke();

    const eyeY = cy - 1;
    const eyeDX = 8;
    const eyeR = 3.4;
    c.fillStyle = 'rgba(255,140,170,.5)';
    c.beginPath();
    c.ellipse(cx - 13, eyeY + 5, 4, 2.6, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(cx + 13, eyeY + 5, 4, 2.6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = ink;
    c.strokeStyle = ink;
    c.lineWidth = 2;
    c.lineCap = 'round';

    if (mood === 'cheer') {
      c.beginPath();
      c.arc(cx - eyeDX, eyeY + 1, eyeR, Math.PI * 1.15, Math.PI * 1.85);
      c.stroke();
      c.beginPath();
      c.arc(cx + eyeDX, eyeY + 1, eyeR, Math.PI * 1.15, Math.PI * 1.85);
      c.stroke();
      c.beginPath();
      c.arc(cx, eyeY + 5, 3, 0.1 * Math.PI, 0.9 * Math.PI);
      c.stroke();
    } else if (mood === 'sleep') {
      c.beginPath();
      c.arc(cx - eyeDX, eyeY, eyeR, 0.15 * Math.PI, 0.85 * Math.PI);
      c.stroke();
      c.beginPath();
      c.arc(cx + eyeDX, eyeY, eyeR, 0.15 * Math.PI, 0.85 * Math.PI);
      c.stroke();
      const zb = Math.sin(now * 0.004) * 2;
      c.fillStyle = ink;
      c.textAlign = 'left';
      c.font = 'bold 11px Fredoka, sans-serif';
      c.fillText('z', cx + R - 3, cy - R + 2 + zb);
      c.font = 'bold 8px Fredoka, sans-serif';
      c.fillText('z', cx + R + 4, cy - R - 6 + zb);
    } else if (mood === 'sad') {
      c.fillStyle = ink;
      c.beginPath();
      c.arc(cx - eyeDX, eyeY, eyeR, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(cx + eyeDX, eyeY, eyeR, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,.9)';
      c.beginPath();
      c.arc(cx - eyeDX - 1, eyeY - 1, 1.2, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(cx + eyeDX - 1, eyeY - 1, 1.2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(120,200,255,.85)';
      const ty = (now * 0.05) % 10;
      c.beginPath();
      c.ellipse(cx - eyeDX, eyeY + 5 + ty, 1.6, 2.4, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(cx + eyeDX, eyeY + 5 + ((ty + 5) % 10), 1.6, 2.4, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = ink;
      c.beginPath();
      c.arc(cx, eyeY + 9, 3, 1.15 * Math.PI, 1.85 * Math.PI);
      c.stroke();
    } else if (mood === 'worried') {
      c.fillStyle = ink;
      c.beginPath();
      c.ellipse(cx - eyeDX, eyeY, eyeR * 0.9, eyeR * 1.25, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(cx + eyeDX, eyeY, eyeR * 0.9, eyeR * 1.25, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,.9)';
      c.beginPath();
      c.arc(cx - eyeDX - 0.8, eyeY - 1.5, 1.1, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(cx + eyeDX - 0.8, eyeY - 1.5, 1.1, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(120,200,255,.85)';
      c.beginPath();
      c.ellipse(cx + R * 0.78, cy - R * 0.45, 1.9, 2.7, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = ink;
      c.beginPath();
      c.arc(cx, eyeY + 8, 1.8, 0, Math.PI * 2);
      c.stroke();
    } else {
      const bm = Math.sin(now * 0.004) > 0.985;
      if (bm) {
        c.strokeStyle = ink;
        c.beginPath();
        c.moveTo(cx - eyeDX - eyeR, eyeY);
        c.lineTo(cx - eyeDX + eyeR, eyeY);
        c.stroke();
        c.beginPath();
        c.moveTo(cx + eyeDX - eyeR, eyeY);
        c.lineTo(cx + eyeDX + eyeR, eyeY);
        c.stroke();
      } else {
        c.fillStyle = ink;
        c.beginPath();
        c.arc(cx - eyeDX, eyeY, eyeR, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.arc(cx + eyeDX, eyeY, eyeR, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,.9)';
        c.beginPath();
        c.arc(cx - eyeDX - 1, eyeY - 1, 1.2, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.arc(cx + eyeDX - 1, eyeY - 1, 1.2, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = ink;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, eyeY + 5, 2.4, 0.1 * Math.PI, 0.9 * Math.PI);
      c.stroke();
    }

    // little bow on left ear
    const bx = cx - earDX;
    const byy = earY - earH * 0.5;
    c.fillStyle = '#ff9ec2';
    c.beginPath();
    c.moveTo(bx, byy);
    c.lineTo(bx - 5, byy - 3);
    c.lineTo(bx - 5, byy + 3);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(bx, byy);
    c.lineTo(bx + 5, byy - 3);
    c.lineTo(bx + 5, byy + 3);
    c.closePath();
    c.fill();
    c.beginPath();
    c.arc(bx, byy, 1.8, 0, Math.PI * 2);
    c.fill();

    c.restore();

    if (mood === 'cheer') {
      c.fillStyle = '#ffe08a';
      for (let i = 0; i < 3; i++) {
        const a = now * 0.006 + i * 2.1;
        const rad = R + 9 + Math.sin(now * 0.01 + i) * 3;
        drawStar(c, cx + Math.cos(a) * rad, cy - 4 + Math.sin(a) * rad * 0.7, 3, a);
      }
    }
  }
}
