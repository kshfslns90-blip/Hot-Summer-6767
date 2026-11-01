// The bottom shell, for phones: the form fills the screen under a slim title bar, and a bar
// along the bottom carries the menu as icon buttons. With the group headings on the buttons
// are the groups, and tapping one lifts a sheet with that group's forms; with the headings off
// the buttons are the forms themselves.
import { el, iconFor, userMenu, brand as brandOf, keyOf, argsKey, activeTest } from './shell-common.js';

export function mountShell(root, ctx) {
  const { settings } = ctx;
  root.className = 'gd-shell-root gd-shell gd-shell-bottom';
  root.style.setProperty('--gd-accent', settings.auth?.accent || getComputedStyle(root).getPropertyValue('--gd-accent'));

  const top = el('header', 'gd-shell-top gd-shell-bottom-top');
  const brand = brandOf(settings, ctx);
  const title = el('div', 'gd-shell-title');
  const userSlot = el('div', 'gd-shell-userslot');
  top.append(brand, title, userSlot);

  const content = el('div', 'gd-shell-content');
  const host = el('div', 'gd-app-host');
  content.append(host);

  const sheet = el('div', 'gd-shell-sheet');
  sheet.hidden = true;
  const sheetTitle = el('div', 'gd-shell-sheet-title');
  const sheetList = el('div', 'gd-shell-sheet-list');
  sheet.append(sheetTitle, sheetList);

  const bar = el('nav', 'gd-shell-bbar');
  const groups = settings.menu || [];
  const grouped = settings.showGroups !== false;
  const groupButtons = [];
  const itemButtons = new Map();
  let openGroup = -1;
  // Which entries are the current form (form and arguments); see activeTest.
  let hit = () => false;

  const tab = (label, iconName, fallback, title) => {
    const button = el('button', 'gd-shell-btab', { type: 'button', title });
    button.append(iconFor(iconName, fallback), el('span', 'gd-shell-btab-label', { textContent: label }));
    return button;
  };

  const closeSheet = () => {
    openGroup = -1;
    sheet.hidden = true;
    groupButtons.forEach((g) => g.button.classList.remove('gd-shell-btab-open'));
  };

  const openSheet = (gi) => {
    openGroup = gi;
    groupButtons.forEach((g, i) => g.button.classList.toggle('gd-shell-btab-open', i === gi));
    const group = groups[gi];
    sheetTitle.textContent = group.label;
    sheetList.replaceChildren();
    for (const item of group.items || []) {
      const key = keyOf(item);
      const entry = el('button', 'gd-shell-sheet-item', { type: 'button', title: item.missing ? `${item.label} - the form "${item.form}" does not exist` : item.label });
      entry.append(iconFor(item.icon, 'circle-dot'), el('span', null, { textContent: item.label }));
      if (item.missing || !key) entry.disabled = true;
      entry.dataset.form = key;
      entry.dataset.args = argsKey(item.args);
      entry.classList.toggle('gd-shell-sheet-item-active', hit(key, entry.dataset.args));
      entry.addEventListener('click', () => {
        closeSheet();
        ctx.onSelect?.(item);
      });
      sheetList.append(entry);
    }
    if (!(group.items || []).length) sheetList.append(el('div', 'gd-shell-navempty', { textContent: 'Nothing here yet' }));
    sheet.hidden = false;
  };

  if (grouped) {
    groups.forEach((group, gi) => {
      const button = tab(group.label, group.icon, 'folder', group.label);
      button.dataset.group = group.label;
      button.addEventListener('click', () => (openGroup === gi ? closeSheet() : openSheet(gi)));
      bar.append(button);
      groupButtons.push({ button, group });
    });
  } else {
    for (const group of groups) {
      for (const item of group.items || []) {
        const key = keyOf(item);
        const button = tab(item.label, item.icon, 'circle-dot', item.missing ? `${item.label} - the form "${item.form}" does not exist` : item.label);
        if (item.missing || !key) button.disabled = true;
        button.dataset.form = key;
        button.dataset.args = argsKey(item.args);
        button.addEventListener('click', () => ctx.onSelect?.(item));
        bar.append(button);
        if (key) itemButtons.set(key, [...(itemButtons.get(key) || []), { button }]);
      }
    }
  }
  if (!bar.children.length) bar.append(el('div', 'gd-shell-navempty', { textContent: 'No menu yet' }));
  content.addEventListener('mousedown', closeSheet);

  root.replaceChildren(top, content, sheet, bar);

  return {
    host,
    setActive(form, args) {
      hit = activeTest(groups, form, args);
      if (grouped) {
        const gi = groups.findIndex((g) => (g.items || []).some((item) => hit(keyOf(item), argsKey(item.args))));
        groupButtons.forEach((g, i) => g.button.classList.toggle('gd-shell-btab-active', i === gi));
      } else {
        for (const list of itemButtons.values()) for (const { button } of list) button.classList.toggle('gd-shell-btab-active', hit(button.dataset.form, button.dataset.args));
      }
    },
    setTitle(text) {
      title.textContent = text || '';
    },
    setUser(user) {
      userSlot.replaceChildren(userMenu(user, ctx));
    }
  };
}
