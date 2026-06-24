import { el } from './dom.ts';

/** Owns the DOM that reflects game state: the stat readouts, the overlay, and the pause icon. */
export class Ui {
  private scoreEl = el('score');
  private linesEl = el('lines');
  private levelEl = el('level');
  private overlay = el('overlay');
  private ovMascot = el('ovMascot');
  private ovTitle = el('ovTitle');
  private ovText = el('ovText');
  private ovScore = el('ovScore');
  private pauseBtn = el('pauseBtn');
  private playBtn = el('playBtn');

  updateStats(score: number, lines: number, level: number): void {
    this.scoreEl.textContent = String(score);
    this.linesEl.textContent = String(lines);
    this.levelEl.textContent = String(level);
  }

  showOverlay(
    title: string,
    text: string,
    scoreLine?: string,
    playLabel?: string,
    mascot?: 'hello' | 'sleep' | 'snug',
  ): void {
    if (mascot) {
      this.ovMascot.classList.remove('hello', 'sleep', 'snug');
      this.ovMascot.classList.add(mascot);
    }
    this.ovTitle.textContent = title;
    this.ovText.textContent = text;
    if (scoreLine) {
      this.ovScore.style.display = 'block';
      this.ovScore.textContent = scoreLine;
    } else {
      this.ovScore.style.display = 'none';
    }
    if (playLabel) this.playBtn.textContent = playLabel;
    this.overlay.classList.add('show');
  }

  hideOverlay(): void {
    this.overlay.classList.remove('show');
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? '▶' : '⏸';
  }
}
