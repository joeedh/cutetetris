import { CELL, COLS, ROWS, reduceMotion } from './constants.ts';
import type { Game } from './game.ts';

/** Map a 1–3 line clear to its ascending chime. */
function clearSfx(n: number): 'clear1' | 'clear2' | 'clear3' {
  return n >= 3 ? 'clear3' : n === 2 ? 'clear2' : 'clear1';
}

export function initAmbient(game: Game): void {
  game.ambient = [];
  for (let i = 0; i < 5; i++)
    game.ambient.push({
      x: Math.random() * COLS * CELL,
      y: Math.random() * ROWS * CELL,
      vy: 0.18 + Math.random() * 0.22,
      size: 8 + Math.random() * 8,
      sway: Math.random() * 6.28,
      alpha: 0.07 + Math.random() * 0.07,
    });
}

export function addPopup(
  game: Game,
  text: string,
  color: string,
  scale?: number,
  y?: number,
): void {
  game.popups.push({
    text,
    color,
    scale: scale ?? 1,
    x: (COLS * CELL) / 2,
    y: y ?? ROWS * CELL * 0.42,
    life: 1,
    t: 0,
  });
}

export function spawnClearFx(game: Game, rows: number[]): void {
  const now = performance.now();
  const n = rows.length;
  game.cheerUntil = now + 1200;
  if (n >= 4) {
    game.audio.sfx('tetris');
    addPopup(game, 'TETRIS!! ✦', '#ff6fa3', 1.35, ROWS * CELL * 0.42);
  } else {
    game.audio.sfx(clearSfx(n));
    const msgs: string[][] = [
      [],
      ['nice! ♡', 'yay! ♡', 'sweet~ ♡', 'good! ♡'],
      ['lovely~ ♡', 'double! 💕', 'so nice~', 'cozy! ♡'],
      ['wonderful! ✦', 'triple!! ✨', 'amazing~', 'yippee! ♡'],
    ];
    const set = msgs[n];
    addPopup(game, set[(Math.random() * set.length) | 0], '#ff85a2', 1.05, ROWS * CELL * 0.42);
  }
  const pal = ['#ffd1e0', '#fff0a8', '#c9f0d8', '#d6c2ff', '#ffd0a8', '#bfe0ff', '#ffffff'];
  const per = reduceMotion ? 2 : Math.min(22, 8 + n * 4);
  for (const ry of rows)
    for (let i = 0; i < per; i++) {
      game.particles.push({
        x: Math.random() * COLS * CELL,
        y: ry * CELL + CELL / 2 + (Math.random() - 0.5) * CELL,
        vx: (Math.random() - 0.5) * 2.6,
        vy: -(0.8 + Math.random() * 2.6),
        g: 0.07 + Math.random() * 0.05,
        life: 1,
        decay: 0.012 + Math.random() * 0.01,
        size: 5 + Math.random() * 8,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.3,
        kind: Math.random() < 0.5 ? 'star' : Math.random() < 0.5 ? 'heart' : 'dot',
        color: pal[(Math.random() * pal.length) | 0],
      });
    }
}

/** A little spat between the cells at (x,y) and (x+1,y): an anger mark plus a few red sparks. */
export function addBickerFx(game: Game, x: number, y: number): void {
  const px = (x + 1) * CELL;
  const py = y * CELL + CELL * 0.3;
  game.popups.push({ text: '💢', color: '#ff7a7a', scale: 0.55, x: px, y: py, life: 0.85, t: 0 });
  if (reduceMotion) return;
  for (let i = 0; i < 4; i++)
    game.particles.push({
      x: px,
      y: y * CELL + CELL / 2,
      vx: (Math.random() - 0.5) * 1.8,
      vy: -(0.3 + Math.random() * 0.9),
      g: 0.04,
      life: 1,
      decay: 0.03,
      size: 3 + Math.random() * 3,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.4,
      kind: 'star',
      color: '#ffb0b0',
    });
}

export function burstHearts(game: Game): void {
  if (reduceMotion) return;
  for (let i = 0; i < 26; i++)
    game.particles.push({
      x: (COLS * CELL) / 2,
      y: (ROWS * CELL) / 2,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6 - 1,
      g: 0.05,
      life: 1,
      decay: 0.01,
      size: 6 + Math.random() * 8,
      rot: 0,
      vr: (Math.random() - 0.5) * 0.3,
      kind: 'heart',
      color: ['#ffb6cd', '#ffd1e0', '#fff0a8', '#c9f0d8'][(Math.random() * 4) | 0],
    });
}

/** Advance every particle, popup, and ambient heart by one frame, and occasionally twinkle. */
export function updateFx(game: Game): void {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.g;
    p.rot += p.vr;
    p.life -= p.decay;
    if (p.life <= 0) game.particles.splice(i, 1);
  }
  for (let i = game.popups.length - 1; i >= 0; i--) {
    const p = game.popups[i];
    p.t += 0.016;
    p.y -= 0.35;
    p.life -= 0.011;
    if (p.life <= 0) game.popups.splice(i, 1);
  }
  for (const h of game.ambient) {
    h.y -= h.vy;
    h.sway += 0.02;
    if (h.y < -12) {
      h.y = ROWS * CELL + 12;
      h.x = Math.random() * COLS * CELL;
    }
  }
  if (!reduceMotion && Math.random() < 0.04) {
    game.particles.push({
      x: Math.random() * COLS * CELL,
      y: Math.random() * ROWS * CELL * 0.85,
      vx: 0,
      vy: 0,
      g: 0,
      life: 1,
      decay: 0.03,
      size: 4 + Math.random() * 4,
      rot: Math.random() * 6.28,
      vr: 0.05,
      kind: 'star',
      color: '#ffffff',
    });
  }
}
