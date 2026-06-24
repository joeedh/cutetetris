import bicker1 from './assets/sfx/bicker1.ogg';
import bicker2 from './assets/sfx/bicker2.ogg';
import bicker3 from './assets/sfx/bicker3.ogg';
import bicker4 from './assets/sfx/bicker4.ogg';
import celebrate1 from './assets/sfx/celebrate1.ogg';
import celebrate2 from './assets/sfx/celebrate2.ogg';
import celebrate3 from './assets/sfx/celebrate3.ogg';
import celebrate4 from './assets/sfx/celebrate4.ogg';

export type ClipName = 'bicker' | 'celebrate';

const CLIP_URLS: Record<ClipName, string[]> = {
  bicker: [bicker1, bicker2, bicker3, bicker4],
  celebrate: [celebrate1, celebrate2, celebrate3, celebrate4],
};

export type SfxName =
  | 'move'
  | 'rotate'
  | 'lock'
  | 'drop'
  | 'clear1'
  | 'clear2'
  | 'clear3'
  | 'tetris'
  | 'levelup'
  | 'perfect'
  | 'over';

/** Synthesizes all sound effects live with the Web Audio API — no audio files. */
export class AudioEngine {
  private actx: AudioContext | null = null;
  private master: GainNode | null = null;
  private clips: Partial<Record<ClipName, HTMLAudioElement[]>> = {};
  muted = false;

  /** Create the audio graph. Must be called from a user gesture (browsers block autoplay). */
  init(): void {
    if (this.actx) return;
    try {
      this.actx = new AudioContext();
      this.master = this.actx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.actx.destination);
    } catch {
      this.actx = null;
    }
  }

  resume(): void {
    if (this.actx && this.actx.state === 'suspended') void this.actx.resume();
  }

  /** Preload the voice clips (HTMLAudio works over file:// where fetch/decodeAudioData don't). */
  initClips(): void {
    if (Object.keys(this.clips).length) return;
    for (const name of Object.keys(CLIP_URLS) as ClipName[]) {
      this.clips[name] = CLIP_URLS[name].map((url) => {
        const a = new Audio(url);
        a.preload = 'auto';
        return a;
      });
    }
  }

  /** Play a random variant of a voice clip, pitched up so the mochi sound tiny and cute. */
  playClip(name: ClipName, volume = 0.5): void {
    if (this.muted) return;
    const variants = this.clips[name];
    if (!variants || !variants.length) return;
    const base = variants[(Math.random() * variants.length) | 0];
    const a = base.cloneNode() as HTMLAudioElement;
    a.preservesPitch = false;
    a.playbackRate = 1.28 + Math.random() * 0.18;
    a.volume = volume;
    void a.play().catch(() => {});
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    if (!this.actx || !this.master || this.muted) return;
    const t = this.actx.currentTime + delay;
    const o = this.actx.createOscillator();
    const g = this.actx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  sfx(name: SfxName): void {
    if (!this.actx || this.muted) return;
    switch (name) {
      case 'move':
        this.tone(520, 0.05, 'triangle', 0.1);
        break;
      case 'rotate':
        this.tone(620, 0.05, 'triangle', 0.12);
        this.tone(820, 0.06, 'triangle', 0.1, 0.04);
        break;
      case 'lock':
        this.tone(240, 0.1, 'sine', 0.16);
        this.tone(180, 0.12, 'sine', 0.1, 0.01);
        break;
      case 'drop':
        this.tone(440, 0.07, 'triangle', 0.12);
        this.tone(200, 0.12, 'sine', 0.16, 0.05);
        break;
      case 'clear1':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.16, i * 0.06));
        break;
      case 'clear2':
        [523, 659, 784, 880].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.17, i * 0.06));
        break;
      case 'clear3':
        [523, 659, 784, 988, 1047].forEach((f, i) => this.tone(f, 0.2, 'sine', 0.17, i * 0.055));
        break;
      case 'tetris':
        [523, 659, 784, 1047, 1319, 1047, 1319].forEach((f, i) =>
          this.tone(f, 0.22, 'triangle', 0.16, i * 0.07),
        );
        break;
      case 'levelup':
        [659, 880, 1175].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.16, i * 0.07));
        break;
      case 'perfect':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.26, 'sine', 0.17, i * 0.08));
        break;
      case 'over':
        [440, 392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.16, i * 0.12));
        break;
    }
  }
}
