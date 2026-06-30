import type { PieceType } from './types.ts';

import blocksI from './assets/blocks/blocks/I.png';
import blocksO from './assets/blocks/blocks/O.png';
import blocksT from './assets/blocks/blocks/T.png';
import blocksS from './assets/blocks/blocks/S.png';
import blocksZ from './assets/blocks/blocks/Z.png';
import blocksJ from './assets/blocks/blocks/J.png';
import blocksL from './assets/blocks/blocks/L.png';

import animalsI from './assets/blocks/animals-3d/I.png';
import animalsO from './assets/blocks/animals-3d/O.png';
import animalsT from './assets/blocks/animals-3d/T.png';
import animalsS from './assets/blocks/animals-3d/S.png';
import animalsZ from './assets/blocks/animals-3d/Z.png';
import animalsJ from './assets/blocks/animals-3d/J.png';
import animalsL from './assets/blocks/animals-3d/L.png';

/** A selectable skin: a named set of per-piece sprite sheets. */
export interface SpriteSet {
  readonly id: string;
  readonly label: string;
  /**
   * Per-piece sheet URL. A set may be incomplete — any missing piece falls back to procedural
   * drawing (see `draw-helpers.ts`), so partially-finished sets still work.
   */
  readonly sheets: Partial<Record<PieceType, string>>;
}

/** All available skins. The first entry is the default. `id` matches the directory under `assets/blocks/`. */
export const SPRITE_SETS: readonly SpriteSet[] = [
  {
    id: 'blocks',
    label: 'Mochi',
    sheets: { I: blocksI, O: blocksO, T: blocksT, S: blocksS, Z: blocksZ, J: blocksJ, L: blocksL },
  },
  {
    id: 'animals-3d',
    label: 'Animals 3D',
    sheets: {
      I: animalsI,
      O: animalsO,
      T: animalsT,
      S: animalsS,
      Z: animalsZ,
      J: animalsJ,
      L: animalsL,
    },
  },
];

export const DEFAULT_SET_ID = SPRITE_SETS[0].id;

export function spriteSet(id: string): SpriteSet | undefined {
  return SPRITE_SETS.find((s) => s.id === id);
}
