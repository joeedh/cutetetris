import { TYPES } from './constants.ts';
import { DEFAULT_SET_ID, spriteSet } from './sprite-sets.ts';
import type { Face, PieceType } from './types.ts';

/** Each block sheet is a horizontal strip of these expression frames, in this order. */
const FACE_ORDER: Face[] = ['calm', 'blink', 'happy', 'worried', 'bicker', 'celebrate'];
const FRAME_COUNT = FACE_ORDER.length;

const FACE_INDEX: Record<Face, number> = {
  calm: 0,
  blink: 1,
  happy: 2,
  worried: 3,
  bicker: 4,
  celebrate: 5,
  none: 0,
};

/** Sliced frame canvases, keyed by set id then piece type. Populated lazily as sets load. */
const frames: Record<string, Partial<Record<PieceType, HTMLCanvasElement[]>>> = {};
const loaded = new Set<string>();
let activeSetId = DEFAULT_SET_ID;

/** Slice a loaded sheet image into `FRAME_COUNT` per-expression frame canvases. */
function sliceSheet(img: HTMLImageElement): HTMLCanvasElement[] | null {
  const fw = img.width / FRAME_COUNT;
  const fh = img.height;
  const arr: HTMLCanvasElement[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const cv = document.createElement('canvas');
    cv.width = fw;
    cv.height = fh;
    const cx = cv.getContext('2d');
    if (!cx) return null;
    cx.drawImage(img, i * fw, 0, fw, fh, 0, 0, fw, fh);
    arr.push(cv);
  }
  return arr;
}

/** Load (once) every sheet in a sprite set and slice it into per-expression frame canvases. */
export function loadSpriteSet(id: string): void {
  if (loaded.has(id)) return;
  const set = spriteSet(id);
  if (!set) return;
  loaded.add(id);
  const store: Partial<Record<PieceType, HTMLCanvasElement[]>> = (frames[id] ??= {});
  for (const type of TYPES) {
    const src = set.sheets[type];
    if (!src) continue;
    const img = new Image();
    img.onload = () => {
      const sliced = sliceSheet(img);
      if (sliced) store[type] = sliced;
    };
    img.src = src;
  }
}

/** Switch the active skin, loading its sheets if they haven't been loaded yet. */
export function setActiveSpriteSet(id: string): void {
  activeSetId = spriteSet(id) ? id : DEFAULT_SET_ID;
  loadSpriteSet(activeSetId);
}

export function getActiveSpriteSet(): string {
  return activeSetId;
}

/**
 * The frame canvas for a piece's expression in the active set, or `null` if it hasn't loaded
 * (or the active set has no sheet for this piece) — callers then fall back to procedural drawing.
 */
export function blockFrame(type: PieceType, face: Face): HTMLCanvasElement | null {
  const arr = frames[activeSetId]?.[type];
  if (!arr) return null;
  return arr[FACE_INDEX[face]] ?? arr[0] ?? null;
}
