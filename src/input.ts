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
}
