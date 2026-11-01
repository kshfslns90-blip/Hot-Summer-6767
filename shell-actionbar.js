// The actionbar shell: a narrow dark bar down the left with big icon buttons. With the group
// headings on, the buttons are the groups and choosing one opens a second, lighter palette
// with that group's forms, which goes away once a form is picked; with the headings off the
// buttons are the forms themselves.
import { el, iconFor, userMenu, brand as brandOf, keyOf, argsKey, activeTest } from './shell-common.js';

export function mountShell(root, ctx) {
  const { settings } = ctx;
  root.className = 'gd-shell-root gd-shell gd-shell-actionbar';
  root.style.setProperty('--gd-accent', settings.auth?.accent || getComputedStyle(root).getPropertyValue('--gd-accent'));

  const bar = el('aside', 'gd-shell-abar');
  const brand = el('div', 'gd-shell-abar-brand');
  brand.append(brandOf(settings, ctx, 'gd-shell-abar-brandname'));
  bar.append(brand);
  const rail = el('nav', 'gd-shell-abar-rail');
  bar.append(rail);

  const palette = el('aside', 'gd-shell-apalette');
  palette.hidden = true;
  const paletteTitle = el('div', 'gd-shell-apalette-title');
  const paletteList = el('div', 'gd-shell-apalette-list');
  palette.append(paletteTitle, paletteList);

  const groups = settings.menu || [];
  const grouped = settings.showGroups !== false;
  const groupButtons = []; // { button, group }
  const itemButtons = new Map(); // key -> [{ button, gi }]
  let openGroup = -1;
  // Which entries are the current form (form and arguments); see activeTest.
  let hit = () => false;

  const bigButton = (label, iconName, fallback, title) => {
    const button = el('button', 'gd-shell-abtn', { type: 'button', title });
    button.append(iconFor(iconName, fallback), el('span', 'gd-shell-abtn-label', { textContent: label }));
    return button;
  };

  const showPalette = (gi) => {
    openGroup = gi;
    groupButtons.forEach((g, i) => g.button.classList.toggle('gd-shell-abtn-open', i === gi));
    if (gi < 0) {
      palette.hidden = true;
      return;
    }
    const group = groups[gi];
    paletteTitle.textContent = group.label;
    paletteList.replaceChildren();
    for (const item of group.items || []) {
      const key = keyOf(item);
      const entry = el('button', 'gd-shell-aitem', { type: 'button', title: item.missing ? `${item.label} - the form "${item.form}" does not exist` : item.label });
      entry.append(iconFor(item.icon, 'circle-dot'), el('span', null, { textContent: item.label }));
      if (item.missing || !key) entry.disabled = true;
      entry.dataset.form = key;
      entry.dataset.args = argsKey(item.args);
      entry.classList.toggle('gd-shell-aitem-active', hit(key, entry.dataset.args));
      entry.addEventListener('click', () => {
        showPalette(-1);
        ctx.onSelect?.(item);
      });
      paletteList.append(entry);
    }
    if (!(group.items || []).length) paletteList.append(el('div', 'gd-shell-navempty', { textContent: 'Nothing here yet' }));
    palette.hidden = false;
  };

  if (grouped) {
    groups.forEach((group, gi) => {
      const button = bigButton(group.label, group.icon, 'folder', group.label);
      button.dataset.group = group.label;
      button.addEventListener('click', () => showPalette(openGroup === gi ? -1 : gi));
      rail.append(button);
      groupButtons.push({ button, group });
    });
  } else {
    for (const group of groups) {
      for (const item of group.items || []) {
        const key = keyOf(item);
        const button = bigButton(item.label, item.icon, 'circle-dot', item.missing ? `${item.label} - the form "${item.form}" does not exist` : item.label);
        if (item.missing || !key) button.disabled = true;
        button.dataset.form = key;
        button.dataset.args = argsKey(item.args);
        button.addEventListener('click', () => ctx.onSelect?.(item));
        rail.append(button);
        if (key) itemButtons.set(key, [...(itemButtons.get(key) || []), { button }]);
      }
    }
  }
  if (!rail.children.length) rail.append(el('div', 'gd-shell-navempty', { textContent: 'No menu yet' }));
  const userSlot = el('div', 'gd-shell-abar-user');
  bar.append(userSlot);

  const main = el('div', 'gd-shell-main');
  const top = el('header', 'gd-shell-top');
  const title = el('div', 'gd-shell-title');
  top.append(title);
  const content = el('div', 'gd-shell-content');
  const host = el('div', 'gd-app-host');
  content.append(host);
  main.append(top, content);
  root.replaceChildren(bar, palette, main);

  return {
    host,
    setActive(form, args) {
      hit = activeTest(groups, form, args);
      if (grouped) {
        // The bar lights the group that owns the form; the palette only opens on a click.
        const gi = groups.findIndex((g) => (g.items || []).some((item) => hit(keyOf(item), argsKey(item.args))));
        groupButtons.forEach((g, i) => g.button.classList.toggle('gd-shell-abtn-active', i === gi));
        for (const entry of paletteList.querySelectorAll('.gd-shell-aitem')) entry.classList.toggle('gd-shell-aitem-active', hit(entry.dataset.form, entry.dataset.args));
      } else {
        for (const list of itemButtons.values()) for (const { button } of list) button.classList.toggle('gd-shell-abtn-active', hit(button.dataset.form, button.dataset.args));
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
