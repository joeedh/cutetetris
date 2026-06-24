import { TYPES } from './constants.ts';
import type { Face, PieceType } from './types.ts';
import iSheet from './assets/blocks/I.png';
import oSheet from './assets/blocks/O.png';
import tSheet from './assets/blocks/T.png';
import sSheet from './assets/blocks/S.png';
import zSheet from './assets/blocks/Z.png';
import jSheet from './assets/blocks/J.png';
import lSheet from './assets/blocks/L.png';

/** Each block sheet is a horizontal strip of these expression frames, in this order. */
const FACE_ORDER: Face[] = ['calm', 'blink', 'happy', 'worried', 'bicker', 'celebrate'];
const FRAME_COUNT = FACE_ORDER.length;

const SHEETS: Record<PieceType, string> = {
  I: iSheet,
  O: oSheet,
  T: tSheet,
  S: sSheet,
  Z: zSheet,
  J: jSheet,
  L: lSheet,
};

const FACE_INDEX: Record<Face, number> = {
  calm: 0,
  blink: 1,
  happy: 2,
  worried: 3,
  bicker: 4,
  celebrate: 5,
  none: 0,
};

const frames: Partial<Record<PieceType, HTMLCanvasElement[]>> = {};

/** Load every block sheet and slice it into per-expression frame canvases. */
export function loadSprites(): void {
  for (const type of TYPES) {
    const img = new Image();
    img.onload = () => {
      const fw = img.width / FRAME_COUNT;
      const fh = img.height;
      const arr: HTMLCanvasElement[] = [];
      for (let i = 0; i < FRAME_COUNT; i++) {
        const cv = document.createElement('canvas');
        cv.width = fw;
        cv.height = fh;
        const cx = cv.getContext('2d');
        if (!cx) return;
        cx.drawImage(img, i * fw, 0, fw, fh, 0, 0, fw, fh);
        arr.push(cv);
      }
      frames[type] = arr;
    };
    img.src = SHEETS[type];
  }
}

/** The frame canvas for a piece's expression, or `null` if its sheet hasn't loaded yet. */
export function blockFrame(type: PieceType, face: Face): HTMLCanvasElement | null {
  const arr = frames[type];
  if (!arr) return null;
  return arr[FACE_INDEX[face]] ?? arr[0] ?? null;
}
