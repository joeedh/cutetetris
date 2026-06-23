import { TYPES } from './constants.ts';
import type { PieceType } from './types.ts';

/** Standard "7-bag" randomizer: deals all seven pieces in a shuffled order before reshuffling. */
export class SevenBag {
  private bag: PieceType[] = [];

  private refill(): void {
    this.bag = TYPES.slice();
    for (let i = this.bag.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
    }
  }

  next(): PieceType {
    if (!this.bag.length) this.refill();
    const piece = this.bag.pop();
    if (!piece) throw new Error('SevenBag exhausted unexpectedly');
    return piece;
  }
}
