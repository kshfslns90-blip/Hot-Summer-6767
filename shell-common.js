// What the classic and office shells share: DOM helpers, the user menu, and the walk over the
// project's menu with its "form is gone" flag.
import { lucideIcon, isIconName } from './icons.js';

export function el(tag, className, props = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node, props);
  return node;
}

export function iconFor(name, fallback) {
  const value = isIconName(name) ? name : fallback;
  return value ? lucideIcon(value) : el('span', 'gd-icon gd-shell-noicon');
}

// The brand spot of a shell: the project's logo when one is set, its name otherwise. A click
// goes to the start form. `className` names the text span, so each shell keeps its own look.
export function brand(settings, ctx, className = 'gd-shell-brandname') {
  const button = el('button', 'gd-shell-brand-btn', { type: 'button', title: `${settings.project.name} - go to the start form` });
  if (settings.project.logo) {
    button.classList.add('gd-shell-brand-logo');
    button.append(el('img', 'gd-shell-logo', { src: settings.project.logo, alt: settings.project.name, draggable: false }));
  } else button.append(el('span', className, { textContent: settings.project.name }));
  button.addEventListener('click', () => ctx.onHome?.());
  return button;
}

// The signed-in user's corner: name, the Users, API keys and Secrets entries for
// administrators, and sign out. Empty when nobody is signed in (no authentication, or a public page).
export function userMenu(user, ctx) {
  const box = el('div', 'gd-shell-user');
  if (!user) return box;
  const button = el('button', 'gd-shell-userbtn', { type: 'button' });
  button.append(lucideIcon('circle-user-round'), el('span', 'gd-shell-username', { textContent: user.name || user.email }));
  const menu = el('div', 'gd-shell-usermenu');
  menu.hidden = true;
  const who = el('div', 'gd-shell-userwho');
  who.append(el('strong', null, { textContent: user.name || user.email }), el('span', null, { textContent: user.email }), el('em', null, { textContent: user.role }));
  menu.append(who);
  if (user.isAdmin) {
    const users = el('button', 'gd-shell-useritem', { type: 'button' });
    users.append(lucideIcon('users'), document.createTextNode('Users'));
    users.addEventListener('click', () => {
      menu.hidden = true;
      ctx.onUsers?.();
    });
    menu.append(users);
    const keys = el('button', 'gd-shell-useritem', { type: 'button' });
    keys.append(lucideIcon('key-round'), document.createTextNode('API keys'));
    keys.addEventListener('click', () => {
      menu.hidden = true;
      ctx.onApiKeys?.();
    });
    menu.append(keys);
    const secrets = el('button', 'gd-shell-useritem', { type: 'button' });
    secrets.append(lucideIcon('lock-keyhole'), document.createTextNode('Secrets'));
    secrets.addEventListener('click', () => {
      menu.hidden = true;
      ctx.onSecrets?.();
    });
    menu.append(secrets);
  }
  const out = el('button', 'gd-shell-useritem', { type: 'button' });
  out.append(lucideIcon('log-out'), document.createTextNode('Sign out'));
  out.addEventListener('click', () => {
    menu.hidden = true;
    ctx.onSignOut?.();
  });
  menu.append(out);
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('mousedown', (e) => {
    if (!box.contains(e.target)) menu.hidden = true;
  });
  box.append(button, menu);
  return box;
}

// Every item of the menu with its group, so a shell can find the active one.
export function menuItems(menu) {
  const out = [];
  (menu || []).forEach((group, gi) => {
    (group.items || []).forEach((item, ii) => out.push({ group, gi, item, ii }));
  });
  return out;
}

// What an item opens: a shell page, or a form by its qualified name.
export const keyOf = (item) => (item.page ? `page:${item.page}` : item.form || '');

// A form's arguments as one comparable string: the same data in any key order gives the same
// key, and no arguments at all (null, undefined) give ''.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

export function argsKey(args) {
  return args === undefined || args === null ? '' : JSON.stringify(canonical(args));
}

// Which menu entries are "the current form": those that open it with the same arguments. When
// no entry has those arguments - the form was opened from code, or from a URL - every entry of
// the form counts, so the user still sees where they are. Returns a test over an entry's
// dataset keys (form, args).
export function activeTest(menu, form, args) {
  const wanted = argsKey(args);
  const exact = menuItems(menu).some(({ item }) => keyOf(item) === form && argsKey(item.args) === wanted);
  return (formKey, argsKeyOfEntry) => formKey === form && (!exact || (argsKeyOfEntry || '') === wanted);
}
