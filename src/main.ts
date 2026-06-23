import './styles.css';
import { AudioEngine } from './audio.ts';
import { el } from './dom.ts';
import { Game } from './game.ts';
import { attachInput } from './input.ts';
import { Renderer } from './renderer.ts';
import { Ui } from './ui.ts';

function makeClouds(): void {
  const sky = el('sky');
  for (let i = 0; i < 7; i++) {
    const c = document.createElement('div');
    c.className = 'cloud';
    const s = 60 + Math.random() * 120;
    c.style.width = s + 'px';
    c.style.height = s * 0.6 + 'px';
    c.style.top = Math.random() * 80 + '%';
    c.style.opacity = String(0.35 + Math.random() * 0.3);
    c.style.animationDuration = 40 + Math.random() * 45 + 's';
    c.style.animationDelay = -Math.random() * 60 + 's';
    sky.appendChild(c);
  }
}

makeClouds();

const audio = new AudioEngine();
const ui = new Ui();
const renderer = new Renderer();
const game = new Game(audio, ui);

attachInput(game, audio);
game.initIdle();

function frame(time: number): void {
  game.tick(time);
  renderer.draw(game);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
