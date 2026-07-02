import type { Matrix, PieceType } from './types.ts';

export const COLS = 10;
export const ROWS = 20;
export const CELL = 30;

export const LOCK_DELAY = 480;
export const CLEAR_DUR = 460;

// idle antics — purely cosmetic block activities (see antics.ts)
export const ANTICS_DELAY = 5000; // ms settled before a block may join an antic
export const ANTICS_SCURRY_RADIUS = 2.5; // cells (Chebyshev) from the piece/ghost that spooks them
export const ANTICS_WALK_SPEED = 0.055; // px per ms (~1.8 cells/s)
export const ANTICS_SCURRY_SPEED = 0.28; // px per ms — home in ~250-400ms
export const ANTICS_GAP_MIN = 6000; // ms between activities
export const ANTICS_GAP_MAX = 14000;
export const ANTICS_MAX_GROUP = 3;

export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const COLORS: Record<PieceType, string> = {
  I: '#8fd9e8',
  O: '#ffd98a',
  T: '#c9a8f0',
  S: '#a3e3b8',
  Z: '#ff9fb0',
  J: '#9fb6f0',
  L: '#ffc08a',
};

export const SHAPES: Record<PieceType, Matrix> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

export const TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** Reverse lookup from a cell's color (hex) back to its piece type, for sprite selection. */
export const TYPE_BY_COLOR: ReadonlyMap<string, PieceType> = new Map(
  TYPES.map((t) => [COLORS[t], t]),
);

/** Rotate a square matrix 90° clockwise. */
export function rotate(m: Matrix): Matrix {
  const n = m.length;
  const r = m.map((row) => row.slice());
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) r[x][n - 1 - y] = m[y][x];
  return r;
}
