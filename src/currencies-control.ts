// Manage currencies popup: lists My currencies with remove (×) buttons and a select for adding
// the rest. It only shows what it is given and reports picks; main.ts owns the state.
import type { GlassAudio } from './glass-audio.ts';
import type { CurrencyOptions } from './my-currencies.ts';
import { initPopup } from './popup.ts';

export interface CurrenciesMenuHandlers {
  // Both re-render the menu synchronously (through render) when the change goes through.
  add(code: string): void;
  remove(code: string): void;
}

export interface CurrenciesMenu {
  render(options: CurrencyOptions, canRemove: boolean): void;
}

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing #${id}`);
  return el;
}

export function initCurrenciesMenu(audio: GlassAudio, handlers: CurrenciesMenuHandlers): CurrenciesMenu {
  const menu = byId('currencies-menu', HTMLElement);
  const toggle = byId('currencies-toggle', HTMLButtonElement);
  const popup = byId('currencies-popup', HTMLElement);
  const list = byId('my-currencies-list', HTMLUListElement);
  const addSelect = byId('add-currency', HTMLSelectElement);

  const removeButtons = () => [...list.querySelectorAll<HTMLButtonElement>('button')];
  const firstEnabled = () => [...removeButtons(), addSelect].find((el) => !el.disabled);

  initPopup({ menu, toggle, popup, audio, focusOnOpen: firstEnabled });

  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-code]');
    if (!button || button.disabled) return;
    const index = removeButtons().indexOf(button);
    handlers.remove(button.dataset.code!);
    // The list was rebuilt: keep focus near where it was, so keyboard users stay in the popup.
    const enabled = removeButtons().filter((b) => !b.disabled);
    const next = enabled[Math.min(index, enabled.length - 1)] ?? (addSelect.disabled ? toggle : addSelect);
    next.focus({ preventScroll: true });
  });

  addSelect.addEventListener('change', () => {
    const code = addSelect.value;
    if (code) handlers.add(code);
    addSelect.value = ''; // back to the placeholder, even if nothing was added
  });

  return {
    render({ mine, addable }, canRemove) {
      list.replaceChildren(...mine.map(({ code, label }) => {
        const item = document.createElement('li');
        item.className = 'currency-item';
        const labelEl = document.createElement('span');
        labelEl.className = 'currency-label';
        labelEl.textContent = label;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'currency-remove';
        button.dataset.code = code;
        button.disabled = !canRemove;
        button.setAttribute('aria-label', `Remove ${code}`);
        button.textContent = '×';
        item.append(labelEl, button);
        return item;
      }));

      const placeholder = new Option(addable.length ? 'Add currency…' : 'All currencies added', '', true, true);
      placeholder.disabled = true;
      addSelect.replaceChildren(placeholder, ...addable.map(({ code, label }) => new Option(label, code)));
      addSelect.disabled = addable.length === 0;
    },
  };
}
