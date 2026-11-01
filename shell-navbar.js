// The navbar shell: the project name and a row of links across the top, the form below. A group
// with several items is a link that drops a small menu; a group with a single item shows that
// item as a plain link. With the group headings switched off every item is a link.
import { lucideIcon } from './icons.js';
import { el, iconFor, userMenu, brand as brandOf, keyOf, argsKey, activeTest } from './shell-common.js';

export function mountShell(root, ctx) {
  const { settings } = ctx;
  root.className = 'gd-shell-root gd-shell gd-shell-navbar';
  root.style.setProperty('--gd-accent', settings.auth?.accent || getComputedStyle(root).getPropertyValue('--gd-accent'));

  const bar = el('header', 'gd-shell-navbar-bar');
  const brand = brandOf(settings, ctx);
  const links = el('nav', 'gd-shell-navlinks');
  const userSlot = el('div', 'gd-shell-userslot');
  bar.append(brand, links, userSlot);

  const buttons = new Map(); // key -> [{ button, owner }]
  const menus = [];
  const closeMenus = () => {
    for (const m of menus) {
      m.panel.hidden = true;
      m.trigger.classList.remove('gd-shell-navlink-open');
    }
  };

  const link = (item, owner = null) => {
    const key = keyOf(item);
    const button = el('button', 'gd-shell-navlink', { type: 'button', title: item.missing ? `${item.label} - the form "${item.form}" does not exist` : item.label });
    button.append(el('span', null, { textContent: item.label }));
    if (item.missing || !key) button.disabled = true;
    button.dataset.form = key;
    button.dataset.args = argsKey(item.args);
    button.addEventListener('click', () => {
      closeMenus();
      ctx.onSelect?.(item);
    });
    if (key) buttons.set(key, [...(buttons.get(key) || []), { button, owner }]);
    return button;
  };

  const groups = settings.menu || [];
  const flat = settings.showGroups === false;
  if (flat) {
    for (const group of groups) for (const item of group.items || []) links.append(link(item));
  } else {
    for (const group of groups) {
      const items = group.items || [];
      if (!items.length) continue;
      if (items.length === 1) {
        links.append(link(items[0]));
        continue;
      }
      const wrap = el('div', 'gd-shell-navdrop');
      const trigger = el('button', 'gd-shell-navlink gd-shell-navlink-group', { type: 'button', title: group.label });
      trigger.append(el('span', null, { textContent: group.label }), lucideIcon('chevron-down'));
      trigger.dataset.group = group.label;
      const panel = el('div', 'gd-shell-navmenu');
      panel.hidden = true;
      for (const item of items) {
        const entry = el('button', 'gd-shell-navitem', { type: 'button', title: item.missing ? `${item.label} - the form "${item.form}" does not exist` : item.label });
        entry.append(iconFor(item.icon, 'circle-dot'), el('span', null, { textContent: item.label }));
        const key = keyOf(item);
        if (item.missing || !key) entry.disabled = true;
        entry.dataset.form = key;
        entry.dataset.args = argsKey(item.args);
        entry.addEventListener('click', () => {
          closeMenus();
          ctx.onSelect?.(item);
        });
        panel.append(entry);
        if (key) buttons.set(key, [...(buttons.get(key) || []), { button: entry, owner: trigger }]);
      }
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = panel.hidden;
        closeMenus();
        if (open) {
          panel.hidden = false;
          trigger.classList.add('gd-shell-navlink-open');
        }
      });
      wrap.append(trigger, panel);
      links.append(wrap);
      menus.push({ trigger, panel });
    }
  }
  if (!links.children.length) links.append(el('span', 'gd-shell-navempty', { textContent: 'No menu yet' }));
  document.addEventListener('mousedown', (e) => {
    if (!links.contains(e.target)) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
  });

  const content = el('div', 'gd-shell-content');
  const host = el('div', 'gd-app-host');
  content.append(host);
  root.replaceChildren(bar, content);

  return {
    host,
    // The links that open this form with these arguments light up (see activeTest).
    setActive(form, args) {
      const hit = activeTest(settings.menu, form, args);
      for (const list of buttons.values()) {
        for (const { button, owner } of list) {
          button.classList.toggle(owner ? 'gd-shell-navitem-active' : 'gd-shell-navlink-active', hit(button.dataset.form, button.dataset.args));
        }
      }
      // The group link lights up when one of its items is the current form.
      for (const m of menus) {
        const owns = [...m.panel.querySelectorAll('.gd-shell-navitem')].some((b) => hit(b.dataset.form, b.dataset.args));
        m.trigger.classList.toggle('gd-shell-navlink-active', owns);
      }
    },
    setTitle(text) {
      document.title = text ? `${text} - ${settings.project.name}` : settings.project.name;
    },
    setUser(user) {
      userSlot.replaceChildren(userMenu(user, ctx));
    }
  };
}
