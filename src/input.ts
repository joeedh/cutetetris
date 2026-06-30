import { COLS } from './constants.ts';
import { el } from './dom.ts';
import type { AudioEngine } from './audio.ts';
import type { Game } from './game.ts';

const PREVENT = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'];

/** Wire keyboard and touch/pointer controls to the game. */
export function attachInput(game: Game, audio: AudioEngine): void {
  const playBtn = el('playBtn');
  const pauseBtn = el('pauseBtn');
  const muteBtn = el('muteBtn');

  function startGame(): void {
    audio.init();
    audio.resume();
    audio.initClips();
    game.newGame();
  }

  function toggleMute(): void {
    const muted = audio.toggleMute();
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.classList.toggle('off', muted);
  }

  playBtn.addEventListener('click', startGame);
  pauseBtn.addEventListener('click', () => {
    if (game.status === 'playing' || game.status === 'paused') game.togglePause();
  });
  muteBtn.addEventListener('click', toggleMute);

  document.addEventListener('keydown', (e) => {
    if (PREVENT.includes(e.code)) e.preventDefault();
    if (game.status === 'ready' || game.status === 'over') {
      if (e.code === 'Enter' || e.code === 'Space') startGame();
      return;
    }
    switch (e.code) {
      case 'ArrowLeft':
        game.move(-1);
        break;
      case 'ArrowRight':
        game.move(1);
        break;
      case 'ArrowDown':
        game.softDrop = true;
        break;
      case 'ArrowUp':
      case 'KeyX':
        game.doRotate(1);
        break;
      case 'KeyZ':
        game.doRotate(-1);
        break;
      case 'Space':
        game.hardDrop();
        break;
      case 'KeyP':
        game.togglePause();
        break;
      case 'KeyM':
        toggleMute();
        break;
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowDown') game.softDrop = false;
  });

  function holdBtn(elm: HTMLElement, action: () => void, repeat: boolean): void {
    let iv: number | null = null;
    let to: number | null = null;
    const start = (e: PointerEvent): void => {
      e.preventDefault();
      if (game.status === 'ready' || game.status === 'over') {
        startGame();
        return;
      }
      action();
      if (repeat) {
        to = window.setTimeout(() => {
          iv = window.setInterval(action, 90);
        }, 180);
      }
    };
    const end = (): void => {
      if (to !== null) clearTimeout(to);
      if (iv !== null) clearInterval(iv);
      iv = null;
    };
    elm.addEventListener('pointerdown', start);
    elm.addEventListener('pointerup', end);
    elm.addEventListener('pointerleave', end);
    elm.addEventListener('pointercancel', end);
  }

  holdBtn(el('bLeft'), () => game.move(-1), true);
  holdBtn(el('bRight'), () => game.move(1), true);
  holdBtn(el('bRotate'), () => game.doRotate(1), false);
  holdBtn(el('bDrop'), () => game.hardDrop(), false);

  attachBoardGestures(el('board'));

  /**
   * Touch/pointer gestures on the board: drag sideways to move (one cell per
   * cell-width travelled), tap to rotate, drag downward to soft-drop, and a quick
   * downward flick to hard-drop.
   */
  function attachBoardGestures(node: HTMLElement): void {
    let active = false;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let stepX = 0;
    let maxTravel = 0;
    let softing = false;

    const setSoft = (on: boolean): void => {
      if (softing === on) return;
      softing = on;
      game.softDrop = on;
    };

    node.addEventListener('pointerdown', (e: PointerEvent) => {
      if (game.status === 'ready' || game.status === 'over') {
        startGame();
        return;
      }
      if (game.status !== 'playing') return;
      active = true;
      startX = stepX = e.clientX;
      startY = e.clientY;
      startT = performance.now();
      maxTravel = 0;
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        // ignore: some pointer ids (or synthetic events) can't be captured
      }
      e.preventDefault();
    });

    node.addEventListener('pointermove', (e: PointerEvent) => {
      if (!active) return;
      const cell = node.clientWidth / COLS;
      while (e.clientX - stepX >= cell) {
        game.move(1);
        stepX += cell;
      }
      while (e.clientX - stepX <= -cell) {
        game.move(-1);
        stepX -= cell;
      }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      maxTravel = Math.max(maxTravel, Math.hypot(dx, dy));
      if (dy > cell * 0.6 && dy > Math.abs(dx)) setSoft(true);
      else if (dy < cell * 0.3) setSoft(false);
      e.preventDefault();
    });

    const finish = (e: PointerEvent): void => {
      if (!active) return;
      active = false;
      setSoft(false);
      const cell = node.clientWidth / COLS;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dt = performance.now() - startT;
      if (maxTravel < 10 && dt < 300) game.doRotate(1);
      else if (dt < 260 && dy > cell * 2 && dy > Math.abs(dx) * 1.5) game.hardDrop();
    };
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', () => {
      active = false;
      setSoft(false);
    });
  }
}
