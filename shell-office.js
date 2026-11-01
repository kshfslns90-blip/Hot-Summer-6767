// The office shell: a title bar with the project name, the form's title and the user's corner;
// a ribbon whose tabs are the menu's groups and whose big buttons are the items; the form
// below. The ribbon folds away to its tabs (the chevron, or a double-click on a tab), the way
// Office does, and the choice is remembered in the browser.
import { lucideIcon } from './icons.js';
import { el, iconFor, userMenu, brand as brandOf, menuItems, keyOf, argsKey, activeTest } from './shell-common.js';

const COLLAPSED_KEY = 'gd.shell.office.collapsed';

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
  root.className = 'gd-shell-root gd-shell gd-shell-office';
  root.style.setProperty('--gd-accent', settings.auth?.accent || getComputedStyle(root).getPropertyValue('--gd-accent'));

  const bar = el('header', 'gd-shell-titlebar');
  const brand = brandOf(settings, ctx);
  const title = el('div', 'gd-shell-title');
  const userSlot = el('div', 'gd-shell-userslot');
  bar.append(brand, title, userSlot);

  const ribbon = el('div', 'gd-shell-ribbon');
  const strip = el('div', 'gd-shell-ribbon-strip');
  const tabs = el('div', 'gd-shell-ribbon-tabs', { role: 'tablist' });
  const fold = el('button', 'gd-shell-ribbon-fold', { type: 'button' });
  strip.append(tabs, fold);
  const body = el('div', 'gd-shell-ribbon-body');
  ribbon.append(strip, body);

  // With the groups hidden the ribbon is one row of every item, and the tab strip keeps only
  // its fold button.
  const flat = settings.showGroups === false;
  const groups = flat ? [{ label: '', items: (settings.menu || []).flatMap((g) => g.items || []) }] : settings.menu || [];
  // Without groups there are no tabs and nothing to fold: the whole strip goes.
  if (flat) strip.hidden = true;
  const tabButtons = [];
  const panels = [];
  const itemButtons = new Map(); // key -> [{ button, gi }]
  let shown = -1;
  let collapsed = false;

  const showTab = (gi) => {
    shown = gi;
    tabButtons.forEach((t, i) => {
      t.classList.toggle('gd-shell-ribbon-tab-active', i === gi);
      t.setAttribute('aria-selected', i === gi ? 'true' : 'false');
      t.tabIndex = i === gi ? 0 : -1;
    });
    panels.forEach((p, i) => {
      p.hidden = i !== gi;
    });
  };

  const setCollapsed = (value) => {
    collapsed = value;
    root.classList.toggle('gd-shell-ribbon-collapsed', collapsed);
    body.hidden = collapsed;
    fold.title = collapsed ? 'Show the ribbon' : 'Hide the ribbon';
    fold.replaceChildren(lucideIcon(collapsed ? 'chevron-down' : 'chevron-up'));
    remember(collapsed);
  };

  groups.forEach((group, gi) => {
    const tab = el('button', 'gd-shell-ribbon-tab', { type: 'button', role: 'tab' });
    tab.append(iconFor(group.icon, ''), el('span', null, { textContent: group.label }));
    tab.addEventListener('click', () => {
      // A click on a tab of a folded ribbon opens it back up.
      if (collapsed) setCollapsed(false);
      showTab(gi);
    });
    tab.addEventListener('dblclick', () => setCollapsed(!collapsed));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = (gi + (e.key === 'ArrowRight' ? 1 : -1) + groups.length) % groups.length;
      showTab(next);
      tabButtons[next].focus();
    });
    tabs.append(tab);
    tabButtons.push(tab);

    const panel = el('div', 'gd-shell-ribbon-panel');
    panel.hidden = true;
    for (const item of group.items || []) {
      const button = el('button', 'gd-shell-ribbon-btn', { type: 'button', title: item.missing ? `${item.label} - the form "${item.form}" does not exist` : item.label });
      button.append(iconFor(item.icon, 'square'), el('span', 'gd-shell-ribbon-label', { textContent: item.label }));
      const key = keyOf(item);
      if (item.missing || !key) button.disabled = true;
      button.dataset.form = key;
      button.dataset.args = argsKey(item.args);
      button.addEventListener('click', () => ctx.onSelect?.(item));
      panel.append(button);
      if (key) itemButtons.set(key, [...(itemButtons.get(key) || []), { button, gi }]);
    }
    if (!(group.items || []).length) panel.append(el('div', 'gd-shell-ribbon-empty', { textContent: 'Nothing here yet' }));
    body.append(panel);
    panels.push(panel);
  });
  if (!groups.length || (flat && !groups[0].items.length)) body.append(el('div', 'gd-shell-navempty', { textContent: 'No menu yet' }));

  fold.addEventListener('click', () => setCollapsed(!collapsed));
  if (groups.length) showTab(0);
  setCollapsed(flat ? false : remembered());

  const content = el('div', 'gd-shell-content');
  const host = el('div', 'gd-app-host');
  content.append(host);
  root.replaceChildren(bar, ribbon, content);

  return {
    host,
    // The buttons that open this form with these arguments light up (see activeTest).
    setActive(form, args) {
      const hit = activeTest(groups, form, args);
      for (const list of itemButtons.values()) for (const { button } of list) button.classList.toggle('gd-shell-ribbon-btn-active', hit(button.dataset.form, button.dataset.args));
      // The ribbon follows the form to its group, so the highlighted button is in view.
      const owner = menuItems(groups).find((m) => hit(keyOf(m.item), argsKey(m.item.args)));
      if (owner && owner.gi !== shown) showTab(owner.gi);
    },
    setTitle(text) {
      title.textContent = text || '';
    },
    setUser(user) {
      userSlot.replaceChildren(userMenu(user, ctx));
    }
  };
}
