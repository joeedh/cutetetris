import { el } from './dom.ts';
import { DEFAULT_SET_ID, SPRITE_SETS, spriteSet } from './sprite-sets.ts';
import { setActiveSpriteSet } from './sprites.ts';

const STORAGE_KEY = 'tetromochi.spriteSet';

function readSaved(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && spriteSet(saved)) return saved;
  } catch {
    // localStorage may be unavailable (e.g. file:// in some browsers) — fall back to the default.
  }
  return DEFAULT_SET_ID;
}

function save(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore persistence failures; the choice still applies for this session.
  }
}

/** Populate the skin dropdown, restore the saved choice, and wire changes to the sprite system. */
export function attachSpriteSelect(): void {
  const select = el('spriteSet');
  if (!(select instanceof HTMLSelectElement)) return;

  for (const set of SPRITE_SETS) {
    const opt = document.createElement('option');
    opt.value = set.id;
    opt.textContent = set.label;
    select.appendChild(opt);
  }

  const initial = readSaved();
  select.value = initial;
  setActiveSpriteSet(initial);

  select.addEventListener('change', () => {
    setActiveSpriteSet(select.value);
    save(select.value);
  });
}
