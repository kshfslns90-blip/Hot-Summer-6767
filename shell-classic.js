// The classic shell: a sidebar on the left with the project's menu, a bar across the top with
// the current form's title and the user's corner, and the form filling the rest. The sidebar
// folds to icons only; the choice is remembered in the browser.
import { lucideIcon } from './icons.js';
import { el, iconFor, userMenu, brand as brandOf, keyOf, argsKey, activeTest } from './shell-common.js';

const COLLAPSED_KEY = 'gd.shell.classic.collapsed';

function remembered() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(collapsed) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export function mountShell(root, ctx) {
  const { settings } = ctx;
  root.className = 'gd-shell-root gd-shell gd-shell-classic';
  root.style.setProperty('--gd-accent', settings.auth?.accent || getComputedStyle(root).getPropertyValue('--gd-accent'));

  const side = el('aside', 'gd-shell-side');
  const brand = el('div', 'gd-shell-brand');
  const toggle = el('button', 'gd-shell-toggle', { type: 'button', title: 'Collapse the menu' });
  toggle.append(lucideIcon('panel-left'));
  brand.append(toggle, brandOf(settings, ctx));
  const nav = el('nav', 'gd-shell-nav');
  const buttons = new Map(); // form -> [button]

  for (const group of settings.menu || []) {
    const section = el('div', 'gd-shell-group');
    // With the groups hidden the items run on as one list; the group still orders them.
    if (settings.showGroups !== false) {
      const head = el('div', 'gd-shell-grouphead');
      head.append(iconFor(group.icon, ''), el('span', null, { textContent: group.label }));
      head.title = group.label;
      section.append(head);
    } else section.classList.add('gd-shell-group-flat');
    for (const item of group.items || []) {
      const button = el('button', 'gd-shell-item', { type: 'button', title: item.missing ? `${item.label} - the form "${item.form}" does not exist` : item.label });
      button.append(iconFor(item.icon, 'circle-dot'), el('span', 'gd-shell-itemlabel', { textContent: item.label }));
      const key = keyOf(item);
      if (item.missing || !key) button.disabled = true;
      button.dataset.form = key;
      button.dataset.args = argsKey(item.args);
      button.addEventListener('click', () => ctx.onSelect?.(item));
      section.append(button);
      if (key) buttons.set(key, [...(buttons.get(key) || []), button]);
    }
    nav.append(section);
  }
  if (!(settings.menu || []).length) nav.append(el('div', 'gd-shell-navempty', { textContent: 'No menu yet' }));
  side.append(brand, nav);

  const main = el('div', 'gd-shell-main');
  const top = el('header', 'gd-shell-top');
  const title = el('div', 'gd-shell-title', { textContent: '' });
  const userSlot = el('div', 'gd-shell-userslot');
  top.append(title, userSlot);
  const content = el('div', 'gd-shell-content');
  const host = el('div', 'gd-app-host');
  content.append(host);
  main.append(top, content);
  root.replaceChildren(side, main);

  const setCollapsed = (collapsed) => {
    root.classList.toggle('gd-shell-side-collapsed', collapsed);
    toggle.title = collapsed ? 'Expand the menu' : 'Collapse the menu';
    remember(collapsed);
  };
  setCollapsed(remembered());
  toggle.addEventListener('click', () => setCollapsed(!root.classList.contains('gd-shell-side-collapsed')));

  return {
    host,
    // The entries that open this form with these arguments light up (see activeTest).
    setActive(form, args) {
      const hit = activeTest(settings.menu, form, args);
      for (const list of buttons.values()) for (const b of list) b.classList.toggle('gd-shell-item-active', hit(b.dataset.form, b.dataset.args));
    },
    setTitle(text) {
      title.textContent = text || '';
    },
    setUser(user) {
      userSlot.replaceChildren(userMenu(user, ctx));
    }
  };
}
