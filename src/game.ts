import {
  CELL,
  CLEAR_DUR,
  COLORS,
  COLS,
  LOCK_DELAY,
  ROWS,
  SHAPES,
  reduceMotion,
  rotate,
} from './constants.ts';
import { SevenBag } from './rng.ts';
import { cancelAntics, emptyAntics, updateAntics } from './antics.ts';
import type { AnticsState } from './antics.ts';
import { addBickerFx, addPopup, burstHearts, initAmbient, spawnClearFx, updateFx } from './fx.ts';
import type { AudioEngine } from './audio.ts';
import type { Ui } from './ui.ts';
import type {
  Ambient,
  BlinkState,
  Cell,
  ClearInfo,
  GameStatus,
  GlanceState,
  Grid,
  Matrix,
  Particle,
  Piece,
  PieceType,
  Popup,
} from './types.ts';

function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array<Cell | null>(COLS).fill(null));
}

/** Owns all mutable game state and the rules that mutate it. Rendering lives in `Renderer`. */
export class Game {
  grid: Grid = emptyGrid();
  current: Piece | null = null;
  nextQueue: PieceType[] = [];
  bag = new SevenBag();

  score = 0;
  lines = 0;
  level = 1;
  combo = 0;

  dropInterval = 800;
  dropCounter = 0;
  lastTime = 0;

  status: GameStatus = 'ready';
  softDrop = false;
  lockTimer: number | null = null;
  lockResets = 0;
  clearInfo: ClearInfo | null = null;

  particles: Particle[] = [];
  popups: Popup[] = [];
  ambient: Ambient[] = [];
  antics: AnticsState = emptyAntics();

  blink: BlinkState = { next: performance.now() + 2500, until: 0 };
  glance: GlanceState = { dir: 0, next: performance.now() + 3000, until: 0 };
  bounce = 0;
  cheerUntil = 0;
  dangerNow = false;
  nextBicker = 0;

  constructor(
    readonly audio: AudioEngine,
    readonly ui: Ui,
  ) {}

  private syncStats(): void {
    this.ui.updateStats(this.score, this.lines, this.level);
  }

  /** Set up the idle attract screen (empty board, ambient hearts, a queued preview). */
  initIdle(): void {
    this.grid = emptyGrid();
    cancelAntics(this);
    initAmbient(this);
    this.bag = new SevenBag();
    this.nextQueue = [this.bag.next(), this.bag.next(), this.bag.next()];
  }

  newGame(): void {
    this.grid = emptyGrid();
    cancelAntics(this);
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = 0;
    this.dropInterval = 800;
    this.dropCounter = 0;
    this.lastTime = performance.now();
    this.particles = [];
    this.popups = [];
    this.clearInfo = null;
    this.softDrop = false;
    this.cheerUntil = 0;
    this.nextBicker = performance.now() + 4000;
    initAmbient(this);
    this.bag = new SevenBag();
    this.nextQueue = [this.bag.next(), this.bag.next(), this.bag.next()];
    this.syncStats();
    this.status = 'playing';
    this.spawn();
    this.ui.hideOverlay();
  }

  private makePiece(type: PieceType): Piece {
    const matrix = SHAPES[type].map((r) => r.slice());
    return { type, matrix, x: ((COLS - matrix.length) / 2) | 0, y: 0, color: COLORS[type] };
  }

  private spawn(): void {
    const type = this.nextQueue.shift();
    if (!type) return;
    this.nextQueue.push(this.bag.next());
    const piece = this.makePiece(type);
    piece.y = type === 'I' ? -1 : 0;
    this.current = piece;
    this.lockResets = 0;
    this.clearLockTimer();
    if (this.collide(piece, piece.x, piece.y)) this.gameOver();
  }

  collide(piece: { matrix: Matrix }, ox: number, oy: number): boolean {
    const m = piece.matrix;
    for (let y = 0; y < m.length; y++)
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const nx = ox + x;
        const ny = oy + y;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && this.grid[ny][nx]) return true;
      }
    return false;
  }

  move(dx: number): void {
    if (this.status !== 'playing' || !this.current) return;
    if (!this.collide(this.current, this.current.x + dx, this.current.y)) {
      this.current.x += dx;
      this.audio.sfx('move');
      this.onMoveResetLock();
    }
  }

  private softStep(): boolean {
    if (this.status !== 'playing' || !this.current) return false;
    if (!this.collide(this.current, this.current.x, this.current.y + 1)) {
      this.current.y++;
      return true;
    }
    return false;
  }

  doRotate(dir: number): void {
    if (this.status !== 'playing' || !this.current) return;
    const cur = this.current;
    const rm = dir > 0 ? rotate(cur.matrix) : rotate(rotate(rotate(cur.matrix)));
    for (const k of [0, -1, 1, -2, 2]) {
      if (!this.collide({ matrix: rm }, cur.x + k, cur.y)) {
        cur.matrix = rm;
        cur.x += k;
        this.audio.sfx('rotate');
        this.onMoveResetLock();
        return;
      }
    }
  }

  private onMoveResetLock(): void {
    if (!this.current) return;
    if (this.lockTimer !== null && !this.collide(this.current, this.current.x, this.current.y + 1))
      this.clearLockTimer();
    else if (this.lockTimer !== null && this.lockResets < 15) {
      this.clearLockTimer();
      this.lockResets++;
      this.startLockTimer();
    }
  }

  private startLockTimer(): void {
    if (this.lockTimer === null) this.lockTimer = performance.now();
  }

  private clearLockTimer(): void {
    this.lockTimer = null;
  }

  hardDrop(): void {
    if (this.status !== 'playing' || !this.current) return;
    const cur = this.current;
    let dist = 0;
    while (!this.collide(cur, cur.x, cur.y + 1)) {
      cur.y++;
      dist++;
    }
    this.score += dist * 2;
    this.syncStats();
    this.audio.sfx('drop');
    this.bounce = reduceMotion ? 0 : 1;
    // heart puff at landing
    const m = cur.matrix;
    for (let y = 0; y < m.length; y++)
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        if (y + 1 >= m.length || !m[y + 1][x]) {
          const cxp = (cur.x + x) * CELL + CELL / 2;
          const cyp = (cur.y + y) * CELL + CELL;
          for (let i = 0; i < (reduceMotion ? 1 : 3); i++)
            this.particles.push({
              x: cxp + (Math.random() - 0.5) * CELL,
              y: cyp,
              vx: (Math.random() - 0.5) * 1.6,
              vy: -(0.6 + Math.random() * 1.4),
              g: 0.06,
              life: 1,
              decay: 0.02,
              size: 5 + Math.random() * 5,
              rot: 0,
              vr: (Math.random() - 0.5) * 0.3,
              kind: 'heart',
              color: '#ffd0e0',
            });
        }
      }
    this.lockPiece();
  }

  private lockPiece(): void {
    if (!this.current) return;
    cancelAntics(this);
    const cur = this.current;
    const m = cur.matrix;
    const now = performance.now();
    for (let y = 0; y < m.length; y++)
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const ny = cur.y + y;
        const nx = cur.x + x;
        if (ny < 0) {
          this.gameOver();
          return;
        }
        this.grid[ny][nx] = { color: cur.color, settle: now };
      }
    this.clearLockTimer();
    const full: number[] = [];
    for (let y = 0; y < ROWS; y++) {
      if (this.grid[y].every((c) => c)) full.push(y);
    }
    if (full.length) {
      this.status = 'clearing';
      this.clearInfo = { rows: full, start: now, count: full.length };
      spawnClearFx(this, full);
    } else {
      this.combo = 0;
      this.audio.sfx('lock');
      this.spawn();
    }
  }

  private resolveClear(): void {
    if (!this.clearInfo) return;
    cancelAntics(this);
    const rows = this.clearInfo.rows;
    const set = new Set(rows);
    const ng = emptyGrid();
    let w = ROWS - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (set.has(y)) continue;
      ng[w--] = this.grid[y];
    }
    this.grid = ng;
    const n = rows.length;
    this.score += [0, 100, 300, 500, 800][n] * this.level;
    this.combo++;
    if (this.combo >= 2) {
      this.score += 50 * this.combo * this.level;
      addPopup(this, 'combo x' + this.combo + ' 💕', '#ff9ec2', 0.95, ROWS * CELL * 0.55);
    }
    const before = this.level;
    this.lines += n;
    this.level = 1 + Math.floor(this.lines / 10);
    if (this.level > before) {
      this.audio.sfx('levelup');
      addPopup(this, 'level ' + this.level + '! ✦', '#b89bff', 1.0, ROWS * CELL * 0.3);
    }
    // perfect clear
    let empty = true;
    for (let y = 0; y < ROWS && empty; y++)
      for (let x = 0; x < COLS; x++) {
        if (this.grid[y][x]) {
          empty = false;
          break;
        }
      }
    if (empty) {
      this.score += 1000 * this.level;
      this.audio.sfx('perfect');
      addPopup(this, 'perfect!! ✧✧', '#7ed9a8', 1.4, ROWS * CELL * 0.5);
      burstHearts(this);
    }
    this.dropInterval = Math.max(90, 800 - (this.level - 1) * 68);
    this.syncStats();
    // the surviving blocks cheer for their friends who just cleared
    const celebrateUntil = performance.now() + 1300;
    let survivors = 0;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const c = this.grid[y][x];
        if (c) {
          c.expr = 'celebrate';
          c.exprUntil = celebrateUntil;
          survivors++;
        }
      }
    if (survivors) this.audio.playClip('celebrate', 0.6);
    this.clearInfo = null;
    this.status = 'playing';
    this.spawn();
  }

  private gameOver(): void {
    this.status = 'over';
    this.audio.sfx('over');
    for (let i = 0; i < (reduceMotion ? 6 : 24); i++)
      this.particles.push({
        x: Math.random() * COLS * CELL,
        y: -10,
        vx: Math.random() - 0.5,
        vy: 0.6 + Math.random() * 1.4,
        g: 0.02,
        life: 1,
        decay: 0.006,
        size: 6 + Math.random() * 8,
        rot: 0,
        vr: (Math.random() - 0.5) * 0.2,
        kind: 'heart',
        color: '#ffc2d4',
      });
    this.ui.showOverlay(
      'aww, all snuggled up! ♡',
      'the mochi reached the top — they had lots of fun. play again?',
      'final score · ' + this.score,
      'play again ♪',
      'snug',
    );
  }

  togglePause(): void {
    if (this.status === 'playing') {
      this.status = 'paused';
      this.ui.showOverlay(
        'little nap 💤',
        'your buddy is resting. tap resume when you’re ready.',
        undefined,
        'resume ♪',
        'sleep',
      );
      this.ui.setPaused(true);
    } else if (this.status === 'paused') {
      this.status = 'playing';
      this.lastTime = performance.now();
      this.ui.hideOverlay();
      this.ui.setPaused(false);
    }
  }

  /** Fraction of the board height the stack reaches, 0..1. Drives how often blocks bicker. */
  private stackHeight(): number {
    for (let y = 0; y < ROWS; y++) {
      if (this.grid[y].some((c) => c)) return (ROWS - y) / ROWS;
    }
    return 0;
  }

  /** Occasionally make two neighbouring blocks bicker — more often as the stack grows taller. */
  private updateBicker(now: number): void {
    if (now < this.nextBicker) return;
    const fill = this.stackHeight();
    // ~7s between spats on an empty-ish board, down to ~0.7s when stacked high.
    const gap = (7000 - 6300 * fill) * (0.6 + Math.random() * 0.8);
    this.nextBicker = now + gap;

    const pairs: Array<[number, number]> = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS - 1; x++) {
        if (this.grid[y][x] && this.grid[y][x + 1]) pairs.push([x, y]);
      }
    if (!pairs.length) return;
    const [x, y] = pairs[(Math.random() * pairs.length) | 0];
    const until = now + 1100;
    const left = this.grid[y][x];
    const right = this.grid[y][x + 1];
    if (left) {
      left.expr = 'bicker';
      left.exprUntil = until;
    }
    if (right) {
      right.expr = 'bicker';
      right.exprUntil = until;
    }
    this.audio.playClip('bicker', 0.4);
    addBickerFx(this, x, y);
  }

  /** Advance the simulation by one animation frame. `time` is the rAF timestamp. */
  tick(time: number): void {
    const dt = time - (this.lastTime || time);
    this.lastTime = time;
    if (this.status === 'playing') {
      this.dropCounter += dt;
      const interval = this.softDrop ? Math.min(60, this.dropInterval) : this.dropInterval;
      if (this.dropCounter > interval) {
        this.dropCounter = 0;
        if (this.softStep()) {
          if (this.softDrop) {
            this.score += 1;
            this.syncStats();
          }
        } else this.startLockTimer();
      }
      if (this.lockTimer !== null && time - this.lockTimer >= LOCK_DELAY) {
        this.audio.sfx('lock');
        this.lockPiece();
      }
      this.updateBicker(time);
      updateAntics(this, dt, time);
    } else if (this.status === 'clearing') {
      if (this.clearInfo && performance.now() - this.clearInfo.start >= CLEAR_DUR)
        this.resolveClear();
    }
    updateFx(this);
  }
}
