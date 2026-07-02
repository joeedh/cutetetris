import cardsUrl from './assets/props/cards.png';

// Small skin-independent prop sprites used by the idle antics (see antics.ts). Generated
// offline by scripts/gen-prop.mjs; each prop file is a horizontal strip of square frames.

export type PropName = 'cardsFan' | 'cardsPile';

/** frame strip source + the index of each named frame within it */
const CARDS_FRAMES: Record<PropName, number> = { cardsFan: 0, cardsPile: 1 };
const CARDS_COUNT = 2;

let cardsFrames: HTMLCanvasElement[] | null = null;
let cardsRequested = false;

function loadCards(): void {
  if (cardsRequested) return;
  cardsRequested = true;
  const img = new Image();
  img.onload = () => {
    const fw = img.width / CARDS_COUNT;
    const arr: HTMLCanvasElement[] = [];
    for (let i = 0; i < CARDS_COUNT; i++) {
      const cv = document.createElement('canvas');
      cv.width = fw;
      cv.height = img.height;
      const cx = cv.getContext('2d');
      if (!cx) return;
      cx.drawImage(img, i * fw, 0, fw, img.height, 0, 0, fw, img.height);
      arr.push(cv);
    }
    cardsFrames = arr;
  };
  img.src = cardsUrl;
}

/** The frame canvas for a prop, or `null` until it loads — callers fall back to procedural drawing. */
export function propFrame(name: PropName): HTMLCanvasElement | null {
  loadCards();
  return cardsFrames?.[CARDS_FRAMES[name]] ?? null;
}
