import {
  ANTICS_DELAY,
  ANTICS_GAP_MAX,
  ANTICS_GAP_MIN,
  ANTICS_MAX_GROUP,
  ANTICS_SCURRY_RADIUS,
  ANTICS_SCURRY_SPEED,
  ANTICS_WALK_SPEED,
  CELL,
  COLS,
  ROWS,
  TYPE_BY_COLOR,
  reduceMotion,
} from './constants.ts';
import { drawBlock, rr } from './draw-helpers.ts';
import { propFrame } from './props.ts';
import { actionFrame } from './sprites.ts';
import type { Game } from './game.ts';
import type { ActionPose, BlockOpts, Cell, PieceType } from './types.ts';

// Idle antics: settled blocks that have sat around long enough sneak out of their cells to
// stroll, play cards, or play-fight — and scurry home when the falling piece gets close.
// Everything here is purely cosmetic: the grid never changes, only where blocks are DRAWN.
// The grid only mutates on lock/clear, and both cancel the antic, so geometry checked when an
// activity starts stays valid for its whole life.

/** `?antics=<ms>` shortens the idle delay (and the gaps between activities) for testing. */
const debugDelay = Number(new URLSearchParams(window.location.search).get('antics'));
const hasDebug = Number.isFinite(debugDelay) && debugDelay > 0;
const IDLE_DELAY = hasDebug ? debugDelay : ANTICS_DELAY;
const GAP_MIN = hasDebug ? Math.min(debugDelay, ANTICS_GAP_MIN) : ANTICS_GAP_MIN;
const GAP_MAX = hasDebug ? Math.min(debugDelay * 2, ANTICS_GAP_MAX) : ANTICS_GAP_MAX;

type AnticPose = ActionPose | 'idle';
type AnticActivity = 'stroll' | 'cards' | 'fight';
type AnticPhase = 'loop' | 'return' | 'scurry';

interface Waypoint {
  x: number;
  y: number;
  pause: number;
}

interface AnticParticipant {
  homeX: number;
  homeY: number;
  cell: Cell;
  type: PieceType;
  /** Current and target positions, in absolute board pixels (top-left, like `drawBlock`). */
  px: number;
  py: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
  pose: AnticPose;
  stepClock: number;
  waitClock: number;
  wpIndex: number;
  route: Waypoint[];
  seated: boolean;
  emoteClock: number;
  hopClock: number;
}

interface ActiveAntic {
  activity: AnticActivity;
  phase: AnticPhase;
  t: number;
  loopDur: number;
  parts: AnticParticipant[];
  /** Gathering anchor in pixels (cards prop position / fight arena reference). */
  cx: number;
  cy: number;
  // fight-only state
  chaser: number;
  mode: 'chase' | 'bump';
  modeClock: number;
  beats: number;
  maxBeats: number;
  arenaMinX: number;
  arenaMaxX: number;
  arenaY: number;
}

export interface AnticsState {
  active: ActiveAntic | null;
  /** ms (dt-accumulated) until the scheduler may start a new activity. */
  cooldown: number;
  /** Grid keys (`y*COLS+x`) the renderer should skip while their blocks are out and about. */
  hidden: Set<number> | null;
}

export function emptyAntics(): AnticsState {
  return { active: null, cooldown: 2500, hidden: null };
}

/** Instantly send everyone home and clear the activity (called on lock/clear/restart). */
export function cancelAntics(game: Game): void {
  const st = game.antics;
  if (!st.active) return;
  st.active = null;
  st.hidden = null;
  st.cooldown = randGap();
}

export function anticsHiddenKeys(game: Game): ReadonlySet<number> | null {
  return game.antics.hidden;
}

function randGap(): number {
  return GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function cellEmpty(game: Game, x: number, y: number): boolean {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS && !game.grid[y][x];
}

interface Candidate {
  x: number;
  y: number;
  cell: Cell;
  type: PieceType;
}

/** Surface cells (nothing above them) that have been settled long enough to get bored. */
function findCandidates(game: Game, now: number): Candidate[] {
  const out: Candidate[] = [];
  for (let y = 2; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const cell = game.grid[y][x];
      if (!cell || game.grid[y - 1][x]) continue;
      if (now - cell.settle < IDLE_DELAY) continue;
      const type = TYPE_BY_COLOR.get(cell.color);
      if (type) out.push({ x, y, cell, type });
    }
  return out;
}

/** Grid cells occupied by the falling piece plus its ghost landing footprint. */
function pieceFootprint(game: Game): Array<{ x: number; y: number }> {
  const cur = game.current;
  if (!cur) return [];
  let gy = cur.y;
  while (!game.collide(cur, cur.x, gy + 1)) gy++;
  const cells: Array<{ x: number; y: number }> = [];
  const m = cur.matrix;
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m[y].length; x++) {
      if (!m[y][x]) continue;
      cells.push({ x: cur.x + x, y: cur.y + y });
      cells.push({ x: cur.x + x, y: gy + y });
    }
  return cells;
}

/** Is a position (in fractional grid coords) within the scurry radius of the piece/ghost? */
function nearPiece(foot: Array<{ x: number; y: number }>, gx: number, gy: number): boolean {
  for (const f of foot) {
    if (Math.max(Math.abs(f.x - gx), Math.abs(f.y - gy)) < ANTICS_SCURRY_RADIUS) return true;
  }
  return false;
}

function makePart(c: Candidate): AnticParticipant {
  return {
    homeX: c.x,
    homeY: c.y,
    cell: c.cell,
    type: c.type,
    px: c.x * CELL,
    py: c.y * CELL,
    tx: c.x * CELL,
    ty: c.y * CELL,
    facing: 1,
    pose: 'idle',
    stepClock: 0,
    waitClock: 0,
    wpIndex: 0,
    route: [],
    seated: false,
    emoteClock: 1500 + Math.random() * 2500,
    hopClock: 0,
  };
}

function baseAntic(
  activity: AnticActivity,
  parts: AnticParticipant[],
  loopDur: number,
): ActiveAntic {
  return {
    activity,
    phase: 'loop',
    t: 0,
    loopDur,
    parts,
    cx: 0,
    cy: 0,
    chaser: 0,
    mode: 'chase',
    modeClock: 0,
    beats: 0,
    maxBeats: 2,
    arenaMinX: 0,
    arenaMaxX: 0,
    arenaY: 0,
  };
}

/** Move toward the target at `speed` px/ms; returns true once arrived (snapped exactly). */
function seek(p: AnticParticipant, speed: number, dt: number): boolean {
  const dx = p.tx - p.px;
  const dy = p.ty - p.py;
  const dist = Math.hypot(dx, dy);
  const step = speed * dt;
  if (dist <= step) {
    p.px = p.tx;
    p.py = p.ty;
    return true;
  }
  p.px += (dx / dist) * step;
  p.py += (dy / dist) * step;
  if (Math.abs(dx) > 1) p.facing = dx > 0 ? 1 : -1;
  return false;
}

/** Alternate the two walk-cycle poses while moving. */
function stepWalk(p: AnticParticipant, dt: number): void {
  p.stepClock += dt;
  p.pose = p.stepClock % 260 < 130 ? 'walkA' : 'walkB';
}

// ---------------------------------------------------------------------------
// activity setup

/** A lone block wanders 1-3 cells along a flat shelf beside its home, pauses, and ambles back. */
function tryStartStroll(
  game: Game,
  cands: Candidate[],
  foot: Array<{ x: number; y: number }>,
): ActiveAntic | null {
  for (const c of cands) {
    if (nearPiece(foot, c.x, c.y)) continue;
    for (const dir of shuffle([-1, 1])) {
      let len = 0;
      for (let i = 1; i <= 3; i++) {
        const nx = c.x + dir * i;
        // walkable shelf: the cell is empty and it stands on something (or the floor)
        if (!cellEmpty(game, nx, c.y)) break;
        if (c.y + 1 < ROWS && !game.grid[c.y + 1][nx]) break;
        if (nearPiece(foot, nx, c.y)) break;
        len = i;
      }
      if (len < 1) continue;
      const p = makePart(c);
      p.route = [
        { x: (c.x + dir * len) * CELL, y: c.y * CELL, pause: 900 + Math.random() * 800 },
        { x: (c.x + dir) * CELL, y: c.y * CELL, pause: 400 + Math.random() * 400 },
      ];
      return baseAntic('stroll', [p], 3500 + Math.random() * 3000);
    }
  }
  return null;
}

/** 2-3 neighbours hop up onto the stack and sit in a circle around a little hand of cards. */
function tryStartCards(
  cands: Candidate[],
  foot: Array<{ x: number; y: number }>,
): ActiveAntic | null {
  for (const base of cands) {
    const group = [base];
    const usedX = new Set([base.x]);
    for (const c of cands) {
      if (group.length >= ANTICS_MAX_GROUP) break;
      if (usedX.has(c.x)) continue;
      if (Math.abs(c.x - base.x) > 3 || Math.abs(c.y - base.y) > 1) continue;
      group.push(c);
      usedX.add(c.x);
    }
    if (group.length < 2) continue;
    // every seat is directly above its own home, which is empty by the surface-cell property
    if (group.some((c) => nearPiece(foot, c.x, c.y) || nearPiece(foot, c.x, c.y - 1))) continue;
    const parts = group.map((c) => {
      const p = makePart(c);
      p.tx = c.x * CELL;
      p.ty = (c.y - 1) * CELL;
      return p;
    });
    const act = baseAntic('cards', parts, 6000 + Math.random() * 4000);
    act.cx = parts.reduce((s, p) => s + p.tx, 0) / parts.length + CELL / 2;
    act.cy = parts.reduce((s, p) => s + p.ty, 0) / parts.length + CELL * 0.4;
    return act;
  }
  return null;
}

/** Two blocks climb into an empty row and chase/bop each other for a couple of beats. */
function tryStartFight(
  game: Game,
  cands: Candidate[],
  foot: Array<{ x: number; y: number }>,
): ActiveAntic | null {
  for (let i = 0; i < cands.length; i++)
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i].x < cands[j].x ? cands[i] : cands[j];
      const b = a === cands[i] ? cands[j] : cands[i];
      const dx = b.x - a.x;
      if (dx < 2 || dx > 4 || Math.abs(a.y - b.y) > 1) continue;
      const arenaY = Math.min(a.y, b.y) - 1;
      let ok = arenaY >= 0;
      for (let x = a.x; ok && x <= b.x; x++) {
        if (!cellEmpty(game, x, arenaY) || nearPiece(foot, x, arenaY)) ok = false;
      }
      if (!ok || nearPiece(foot, a.x, a.y) || nearPiece(foot, b.x, b.y)) continue;
      const pa = makePart(a);
      const pb = makePart(b);
      pa.tx = a.x * CELL;
      pa.ty = arenaY * CELL;
      pb.tx = b.x * CELL;
      pb.ty = arenaY * CELL;
      const act = baseAntic('fight', [pa, pb], 12000);
      act.chaser = Math.random() < 0.5 ? 0 : 1;
      act.mode = 'chase';
      act.modeClock = 1400;
      act.maxBeats = 2 + ((Math.random() * 2) | 0);
      act.arenaMinX = a.x * CELL;
      act.arenaMaxX = b.x * CELL;
      act.arenaY = arenaY * CELL;
      return act;
    }
  return null;
}

// ---------------------------------------------------------------------------
// per-frame update

/** Scheduler + simulation step. Called from `Game.tick` only while playing, so pause is free. */
export function updateAntics(game: Game, dt: number, now: number): void {
  const st = game.antics;
  if (st.active) {
    updateActive(game, st.active, dt);
    return;
  }
  st.cooldown -= dt;
  if (st.cooldown > 0 || reduceMotion || game.dangerNow) return;
  const cands = shuffle(findCandidates(game, now));
  if (!cands.length) {
    st.cooldown = 1500;
    return;
  }
  const foot = pieceFootprint(game);
  for (const activity of shuffle<AnticActivity>(['stroll', 'cards', 'fight'])) {
    const act =
      activity === 'stroll'
        ? tryStartStroll(game, cands, foot)
        : activity === 'cards'
          ? tryStartCards(cands, foot)
          : tryStartFight(game, cands, foot);
    if (act) {
      st.active = act;
      st.hidden = new Set(act.parts.map((p) => p.homeY * COLS + p.homeX));
      return;
    }
  }
  st.cooldown = 1500;
}

function startScurry(act: ActiveAntic): void {
  act.phase = 'scurry';
  for (const p of act.parts) {
    p.tx = p.homeX * CELL;
    p.ty = p.homeY * CELL;
    p.pose = 'scurry';
    if (Math.abs(p.tx - p.px) > 1) p.facing = p.tx > p.px ? 1 : -1;
  }
}

function startReturn(act: ActiveAntic): void {
  act.phase = 'return';
  for (const p of act.parts) {
    p.tx = p.homeX * CELL;
    p.ty = p.homeY * CELL;
  }
}

function finish(game: Game, phew: boolean): void {
  const st = game.antics;
  if (phew && st.active) {
    const until = performance.now() + 200;
    for (const p of st.active.parts) {
      p.cell.expr = 'blink';
      p.cell.exprUntil = until;
    }
  }
  st.active = null;
  st.hidden = null;
  st.cooldown = randGap();
}

function updateActive(game: Game, act: ActiveAntic, dt: number): void {
  // tripwire: if the grid mutated under us through any path that forgot to cancel, bail out
  for (const p of act.parts) {
    if (game.grid[p.homeY][p.homeX] !== p.cell) {
      cancelAntics(game);
      return;
    }
  }
  act.t += dt;
  if (act.phase !== 'scurry') {
    const foot = pieceFootprint(game);
    if (act.parts.some((p) => nearPiece(foot, p.px / CELL, p.py / CELL))) startScurry(act);
  }
  if (act.phase === 'scurry') {
    let done = true;
    for (const p of act.parts) {
      p.stepClock += dt;
      p.pose = 'scurry';
      if (!seek(p, ANTICS_SCURRY_SPEED, dt)) done = false;
    }
    if (done) finish(game, true);
  } else if (act.phase === 'return') {
    let done = true;
    for (const p of act.parts) {
      if (seek(p, ANTICS_WALK_SPEED, dt)) p.pose = 'idle';
      else {
        stepWalk(p, dt);
        done = false;
      }
    }
    if (done) finish(game, false);
  } else {
    if (act.t > act.loopDur) {
      startReturn(act);
      return;
    }
    if (act.activity === 'stroll') updateStroll(act, dt);
    else if (act.activity === 'cards') updateCards(game, act, dt);
    else updateFight(game, act, dt);
  }
}

function updateStroll(act: ActiveAntic, dt: number): void {
  const p = act.parts[0];
  if (p.waitClock > 0) {
    p.waitClock -= dt;
    p.pose = 'idle';
    return;
  }
  const wp = p.route[p.wpIndex % p.route.length];
  p.tx = wp.x;
  p.ty = wp.y;
  if (seek(p, ANTICS_WALK_SPEED, dt)) {
    p.waitClock = wp.pause;
    p.wpIndex++;
    p.pose = 'idle';
  } else stepWalk(p, dt);
}

function updateCards(game: Game, act: ActiveAntic, dt: number): void {
  for (const p of act.parts) {
    if (!p.seated) {
      if (seek(p, ANTICS_WALK_SPEED, dt)) {
        p.seated = true;
        p.pose = 'cards';
        p.facing = act.cx > p.px + CELL / 2 ? 1 : -1;
      } else stepWalk(p, dt);
      continue;
    }
    p.pose = 'cards';
    if (p.hopClock > 0) p.hopClock -= dt;
    p.emoteClock -= dt;
    if (p.emoteClock <= 0) {
      // "good hand!" — a little hop and a gold star
      p.emoteClock = 2000 + Math.random() * 2500;
      p.hopClock = 280;
      game.particles.push({
        x: p.px + CELL / 2,
        y: p.py,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -(0.6 + Math.random() * 0.6),
        g: 0.04,
        life: 1,
        decay: 0.025,
        size: 4 + Math.random() * 3,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.3,
        kind: 'star',
        color: '#ffd76a',
      });
    }
  }
}

/** An anger mark plus red sparks at a bump, like `addBickerFx` but at a pixel position. */
function bumpFx(game: Game, px: number, py: number): void {
  game.popups.push({ text: '💢', color: '#ff7a7a', scale: 0.55, x: px, y: py, life: 0.85, t: 0 });
  for (let i = 0; i < 4; i++)
    game.particles.push({
      x: px,
      y: py + CELL * 0.3,
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

function updateFight(game: Game, act: ActiveAntic, dt: number): void {
  const ch = act.parts[act.chaser];
  const ru = act.parts[1 - act.chaser];
  act.modeClock -= dt;
  if (act.mode === 'chase') {
    ch.tx = clamp(ru.px, act.arenaMinX, act.arenaMaxX);
    ch.ty = act.arenaY;
    ru.tx = ru.px >= ch.px ? act.arenaMaxX : act.arenaMinX;
    ru.ty = act.arenaY;
    seek(ch, ANTICS_WALK_SPEED * 1.5, dt);
    stepWalk(ch, dt);
    seek(ru, ANTICS_WALK_SPEED * 1.15, dt);
    stepWalk(ru, dt);
    const caught = Math.abs(ch.px - ru.px) < CELL * 0.7 && Math.abs(ch.py - ru.py) < CELL * 0.5;
    if (caught) {
      act.mode = 'bump';
      act.modeClock = 650 + Math.random() * 250;
      bumpFx(game, (ch.px + ru.px) / 2 + CELL / 2, Math.min(ch.py, ru.py));
      game.audio.playClip('bicker', 0.35);
    } else if (act.modeClock <= 0) {
      act.beats++;
      if (act.beats >= act.maxBeats) startReturn(act);
      else {
        act.chaser = 1 - act.chaser;
        act.modeClock = 1000 + Math.random() * 500;
      }
    }
  } else {
    ch.facing = ru.px > ch.px ? 1 : -1;
    ru.facing = ch.facing === 1 ? -1 : 1;
    ch.stepClock += dt;
    ru.stepClock += dt;
    const swing = ch.stepClock % 250 < 125;
    ch.pose = swing ? 'punchA' : 'punchB';
    ru.pose = swing ? 'punchB' : 'punchA';
    if (act.modeClock <= 0) {
      act.beats++;
      if (act.beats >= act.maxBeats) startReturn(act);
      else {
        act.mode = 'chase';
        act.chaser = 1 - act.chaser;
        act.modeClock = 1100 + Math.random() * 500;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// drawing

/** Squash/flip/face fallbacks that sell each pose when the skin ships no action sheet. */
function poseOpts(p: AnticParticipant): BlockOpts {
  const flipX = p.facing < 0;
  if (p.pose === 'idle') return { face: 'calm', flipX, glance: 0 };
  if (actionFrame(p.type, p.pose)) return { pose: p.pose, flipX, glance: 0 };
  switch (p.pose) {
    case 'walkA':
      return { face: 'calm', flipX, glance: 0, scaleX: 1.08, scaleY: 0.9 };
    case 'walkB':
      return { face: 'calm', flipX, glance: 0, scaleX: 0.94, scaleY: 1.08 };
    case 'cards':
      return { face: 'happy', flipX, glance: 0 };
    case 'punchA':
    case 'punchB': {
      const j = Math.sin(p.stepClock * 0.05) * 0.06;
      return { face: 'bicker', flipX, glance: 0, scaleX: 1 + j, scaleY: 1 - j };
    }
    case 'scurry': {
      const s = Math.sin(p.stepClock * 0.04) * 0.1;
      return { face: 'worried', flipX, glance: 0, scaleX: 1 + s, scaleY: 1 - s };
    }
  }
}

/** The fanned-cards prop at the gathering anchor (sprite if loaded, else a drawn stand-in). */
function drawCardsProp(ctx: CanvasRenderingContext2D, act: ActiveAntic): void {
  const sprite = propFrame('cardsFan');
  if (sprite) {
    const s = CELL * 0.9;
    ctx.drawImage(sprite, act.cx - s / 2, act.cy - s / 2, s, s);
    return;
  }
  const w = CELL * 0.32;
  const h = CELL * 0.44;
  const pips = ['#ff9ec2', '#8fd9e8', '#ffd98a'];
  ctx.save();
  ctx.translate(act.cx, act.cy);
  for (let i = -1; i <= 1; i++) {
    ctx.save();
    ctx.rotate(i * 0.28);
    ctx.translate(0, -h * 0.15);
    rr(ctx, -w / 2, -h / 2, w, h, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,95,.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = pips[i + 1];
    ctx.beginPath();
    ctx.arc(0, -h * 0.1, w * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Draw the out-and-about blocks at their animated positions (their grid cells are skipped). */
export function drawAntics(ctx: CanvasRenderingContext2D, game: Game): void {
  const act = game.antics.active;
  if (!act) return;
  if (act.activity === 'cards') drawCardsProp(ctx, act);
  for (const p of act.parts) {
    let py = p.py;
    if (p.hopClock > 0) py -= Math.sin((1 - p.hopClock / 280) * Math.PI) * CELL * 0.28;
    drawBlock(ctx, p.px, py, CELL, p.cell.color, poseOpts(p));
  }
}
