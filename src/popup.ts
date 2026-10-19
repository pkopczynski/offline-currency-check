// Header popup behaviour shared by the theme and currencies popups: the toggle button opens and
// closes it with a glass tap, Escape, tapping outside and tabbing out close it, and only one
// popup is open at a time.
import type { GlassAudio } from './glass-audio.ts';

export interface PopupOptions {
  // Wraps the toggle and the popup; taps and focus inside it don't close the popup.
  menu: HTMLElement;
  toggle: HTMLButtonElement;
  popup: HTMLElement;
  audio: GlassAudio;
  // The control to focus when the popup opens.
  focusOnOpen: () => HTMLElement | null | undefined;
  // A pointerdown outside the menu that must not close the popup.
  ignorePointerDown?: (event: PointerEvent) => boolean;
}

export interface Popup {
  readonly open: boolean;
  setOpen(next: boolean, restoreFocus?: boolean): void;
}

// The popup that is open now, if any. Opening another one closes it.
let current: Popup | null = null;

export function initPopup({ menu, toggle, popup, audio, focusOnOpen, ignorePointerDown }: PopupOptions): Popup {
  let open = false;

  const self: Popup = {
    get open() { return open; },
    setOpen(next, restoreFocus = false) {
      if (open === next) return;
      if (next && current && current !== self) current.setOpen(false);
      open = next;
      if (next) current = self;
      else if (current === self) current = null;
      popup.dataset.open = String(next);
      toggle.setAttribute('aria-expanded', String(next));
      if (next) focusOnOpen()?.focus({ preventScroll: true });
      else if (restoreFocus) toggle.focus({ preventScroll: true });
    },
  };

  toggle.addEventListener('click', () => {
    audio.tap();
    self.setOpen(!open);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!open || ignorePointerDown?.(event)) return;
    if (event.target instanceof Node && !menu.contains(event.target)) self.setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (open && event.key === 'Escape') self.setOpen(false, true);
  });
  menu.addEventListener('focusout', (event) => {
    // Tabbing out of the popup closes it. (Focus moving to nowhere is covered by pointerdown.)
    if (open && event.relatedTarget instanceof Node && !menu.contains(event.relatedTarget)) self.setOpen(false);
  });

  return self;
}
