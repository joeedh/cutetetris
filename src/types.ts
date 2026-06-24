export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

/** A tetromino rotation matrix: 1 = filled cell, 0 = empty. */
export type Matrix = number[][];

export interface Piece {
  type: PieceType;
  matrix: Matrix;
  x: number;
  y: number;
  color: string;
}

/** A settled cell on the board. `settle` is the timestamp it landed (for the squish animation). */
export interface Cell {
  color: string;
  settle: number;
  /** A transient expression (e.g. bicker/celebrate) shown until `exprUntil`, overriding the default. */
  expr?: Face;
  exprUntil?: number;
}

export type Grid = (Cell | null)[][];

/** Expression drawn on a mochi block. */
export type Face = 'calm' | 'happy' | 'blink' | 'worried' | 'bicker' | 'celebrate' | 'none';

/** Expression drawn on the rabbit mascot. */
export type Mood = 'idle' | 'sleep' | 'sad' | 'cheer' | 'worried';

export type GameStatus = 'ready' | 'playing' | 'paused' | 'clearing' | 'over';

export type ParticleKind = 'star' | 'heart' | 'dot';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  decay: number;
  size: number;
  rot: number;
  vr: number;
  kind: ParticleKind;
  color: string;
}

export interface Popup {
  text: string;
  color: string;
  scale: number;
  x: number;
  y: number;
  life: number;
  t: number;
}

export interface Ambient {
  x: number;
  y: number;
  vy: number;
  size: number;
  sway: number;
  alpha: number;
}

export interface ClearInfo {
  rows: number[];
  start: number;
  count: number;
}

export interface BlinkState {
  next: number;
  until: number;
}

export interface GlanceState {
  dir: number;
  next: number;
  until: number;
}

export interface BlockOpts {
  face?: Face;
  alpha?: number;
  scaleX?: number;
  scaleY?: number;
  glance?: number;
}
