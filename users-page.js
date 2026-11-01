// The Users page of the shell, for Administrators: who can sign in, add or invite someone,
// edit their name and email, activate, change the role, reset or set a password, delete.
// Plain DOM; the server enforces every rule, this page just shows what it says.
import { lucideIcon } from './icons.js';
import { showConfirm, showPrompt, showToast, showMessage } from './dialogs.js';

function el(tag, className, props = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node, props);
  return node;
}

async function api(method, url, body) {
  const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Something went wrong.');
  return data;
}

// One dialog for several fields, in the runtime's dialog style: resolves with the values, or
// null for Cancel or Escape. Enter submits; a required field that is empty keeps it open.
// Shared with the API keys page.
export function formDialog({ title, intro, fields, okText = 'OK' }) {
  return new Promise((resolve) => {
    const overlay = el('div', 'gd-modal-overlay gd-dialog-overlay');
    const frame = el('form', 'gd-modal-frame gd-dialog gd-users-form');
    frame.noValidate = true;
    const body = el('div', 'gd-dialog-body');
    if (intro) body.append(el('div', 'gd-dialog-text gd-users-formintro', { textContent: intro }));
    const grid = el('div', 'gd-users-fields');
    const controls = {};
    for (const spec of fields) {
      const label = el('label', 'gd-users-fieldlabel', { textContent: spec.label, htmlFor: `gd-users-field-${spec.name}` });
      let control;
      if (spec.type === 'select') {
        control = el('select', 'gd-users-fieldinput', { id: `gd-users-field-${spec.name}`, name: spec.name });
        for (const option of spec.options) control.append(el('option', null, { value: option, textContent: option }));
        control.value = spec.value ?? spec.options[0];
      } else if (spec.type === 'checkbox') {
        control = el('label', 'gd-users-fieldcheck');
        const box = el('input', null, { type: 'checkbox', id: `gd-users-field-${spec.name}`, name: spec.name, checked: spec.value !== false });
        control.append(box, el('span', null, { textContent: spec.text || '' }));
        controls[spec.name] = box;
      } else if (spec.type === 'secret') {
        const field = secretField(spec, () => frame.requestSubmit());
        control = field.node;
        controls[spec.name] = field;
      } else {
        control = el('input', 'gd-input gd-dialog-input gd-users-fieldinput', { type: spec.type || 'text', id: `gd-users-field-${spec.name}`, name: spec.name, value: spec.value ?? '', placeholder: spec.hint || '', autocomplete: spec.type === 'password' ? 'new-password' : 'off' });
      }
      if (!controls[spec.name]) controls[spec.name] = control;
      grid.append(label, control);
    }
    body.append(grid);
    const error = el('div', 'gd-users-formerror');
    error.hidden = true;
    body.append(error);
    const row = el('div', 'gd-dialog-buttons');
    const cancel = el('button', 'gd-button gd-dialog-secondary', { type: 'button' });
    cancel.dataset.variant = 'default';
    cancel.append(el('span', 'gd-button-text', { textContent: 'Cancel' }));
    const ok = el('button', 'gd-button', { type: 'submit' });
    ok.append(el('span', 'gd-button-text', { textContent: okText }));
    row.append(cancel, ok);
    frame.append(el('div', 'gd-modal-title', { textContent: title }), body, row);
    overlay.append(frame);
    document.body.append(overlay);

    const finish = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => finish(null));
    frame.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const spec of fields) {
        const control = controls[spec.name];
        // A secret's value is kept as typed: whitespace is the page's question, not a slip to fix here.
        values[spec.name] = spec.type === 'checkbox' ? control.checked : spec.type === 'secret' ? control.value : control.value.trim();
        if (spec.required && !(spec.type === 'secret' ? values[spec.name].trim() : values[spec.name])) {
          error.textContent = `${spec.label} is required.`;
          error.hidden = false;
          control.focus();
          return;
        }
      }
      finish(values);
    });
    const first = fields.find((f) => f.autofocus) || fields[0];
    controls[first.name]?.focus();
    if (first.type !== 'select' && first.type !== 'checkbox') controls[first.name]?.select();
  });
}

// A value that is never shown unless asked: a password input with an eye, and a Multi-line
// switch that swaps it for a masked textarea - a password input drops the line breaks of a
// pasted private key. Ctrl+Enter submits from the textarea, where Enter makes a new line.
function secretField(spec, submit) {
  const id = `gd-users-field-${spec.name}`;
  const node = el('div', 'gd-secret-field');
  const row = el('div', 'gd-secret-row');
  const input = el('input', 'gd-input gd-dialog-input gd-users-fieldinput', { type: 'password', id, name: spec.name, placeholder: spec.hint || '', autocomplete: 'new-password', spellcheck: false });
  const area = el('textarea', 'gd-input gd-dialog-input gd-users-fieldinput gd-secret-area gd-secret-masked', { id: `${id}-multi`, rows: 5, spellcheck: false, placeholder: '-----BEGIN PRIVATE KEY-----' });
  area.hidden = true;
  const eye = el('button', 'gd-users-iconbtn gd-secret-eye', { type: 'button' });
  const multi = el('label', 'gd-users-fieldcheck gd-secret-multi');
  const box = el('input', null, { type: 'checkbox' });
  multi.append(box, el('span', null, { textContent: 'Multi-line (keys, certificates)' }));
  row.append(input, area, eye);
  node.append(row, multi);
  let shown = false;
  const active = () => (box.checked ? area : input);
  const paint = () => {
    input.type = shown ? 'text' : 'password';
    area.classList.toggle('gd-secret-masked', !shown);
    eye.replaceChildren(lucideIcon(shown ? 'eye-off' : 'eye'));
    eye.title = shown ? 'Hide the value' : 'Show the value';
  };
  eye.addEventListener('click', () => {
    shown = !shown;
    paint();
    active().focus();
  });
  box.addEventListener('change', () => {
    if (box.checked) area.value = input.value;
    else input.value = area.value;
    input.hidden = box.checked;
    area.hidden = !box.checked;
    active().focus();
  });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });
  paint();
  return {
    node,
    get value() {
      return active().value;
    },
    focus: () => active().focus(),
    select: () => active().select()
  };
}

// "3 minutes ago", "yesterday", "12 Mar" - close by in words, further off as a date.
export function ago(value) {
  if (!value) return 'never';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return String(value);
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 172800) return 'yesterday';
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: then.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function initials(user) {
  const source = (user.name || user.email || '?').trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

// A stable pastel per user, from the email, so the same person keeps the same colour.
function hue(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function mountUsersPage(host, { settings }) {
  const roles = settings.auth?.roles || ['Administrator', 'User'];
  const defaultRole = roles.includes('User') ? 'User' : roles[roles.length - 1];
  const me = settings.user || null;

  const page = el('div', 'gd-users');
  const head = el('div', 'gd-users-head');
  const titles = el('div', 'gd-users-titles');
  titles.append(el('h2', null, { textContent: 'Users' }));
  const note = el('div', 'gd-users-note');
  titles.append(note);
  const actions = el('div', 'gd-users-actions');
  const search = el('label', 'gd-users-search');
  search.append(lucideIcon('search'));
  const searchInput = el('input', null, { type: 'search', placeholder: 'Find by name or email', spellcheck: false });
  search.append(searchInput);
  const addBtn = el('button', 'gd-users-btn gd-users-btn-primary', { type: 'button' });
  addBtn.append(lucideIcon('user-plus'), document.createTextNode('Add'));
  const inviteBtn = el('button', 'gd-users-btn', { type: 'button' });
  inviteBtn.append(lucideIcon('mail'), document.createTextNode('Invite'));
  actions.append(search, addBtn, inviteBtn);
  head.append(titles, actions);
  const table = el('table', 'gd-users-table');
  table.append(el('thead'), el('tbody'));
  table.querySelector('thead').innerHTML = '<tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr>';
  const empty = el('div', 'gd-users-empty');
  empty.hidden = true;
  page.append(head, table, empty);
  host.replaceChildren(page);

  const body = table.querySelector('tbody');
  let users = [];
  let filter = '';

  const act = async (label, fn) => {
    try {
      await fn();
      await refresh();
      if (label) showToast(label, 'success');
    } catch (err) {
      showToast(err.message, 'danger', 5000);
    }
  };

  const editUser = async (user) => {
    const values = await formDialog({
      title: `Edit ${user.name || user.email}`,
      okText: 'Save',
      fields: [
        { name: 'email', label: 'Email', type: 'email', value: user.email, required: true, autofocus: true },
        { name: 'name', label: 'Name', type: 'text', value: user.name },
        { name: 'role', label: 'Role', type: 'select', options: roles.includes(user.role) ? roles : [...roles, user.role], value: user.role },
        ...(user.invited ? [] : [{ name: 'active', label: 'Active', type: 'checkbox', value: user.active, text: 'Can sign in' }])
      ]
    });
    if (!values) return;
    await act(`${values.email} saved`, () => api('PATCH', `/app/api/users/${user.id}`, values));
  };

  const linkRow = (user) => {
    if (!user.pendingLink) return null;
    const wrap = el('div', 'gd-users-link');
    wrap.append(lucideIcon('link'), el('span', null, { textContent: user.pendingLink.kind === 'invite' ? 'Invitation link - mail is not configured, so pass it on yourself:' : 'Reset link - mail is not configured, so pass it on yourself:' }));
    const link = el('input', null, { type: 'text', readOnly: true, value: user.pendingLink.link });
    link.addEventListener('focus', () => link.select());
    const copy = el('button', 'gd-users-iconbtn', { type: 'button', title: 'Copy the link' });
    copy.append(lucideIcon('copy'));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(user.pendingLink.link);
        showToast('Link copied', 'success');
      } catch {
        link.focus();
      }
    });
    wrap.append(link, copy);
    return wrap;
  };

  const matches = (user) => {
    if (!filter) return true;
    return `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(filter);
  };

  const render = () => {
    body.replaceChildren();
    const admins = users.filter((u) => u.isAdmin && u.active).length;
    note.textContent = users.length ? `${users.length} user${users.length === 1 ? '' : 's'} · ${admins} active administrator${admins === 1 ? '' : 's'}` : '';
    const shown = users.filter(matches);
    empty.hidden = shown.length > 0;
    empty.textContent = users.length ? 'Nobody matches that.' : 'No users yet. Add one, or invite someone by email.';
    table.hidden = shown.length === 0;

    for (const user of shown) {
      const tr = el('tr');
      tr.dataset.email = user.email;
      if (me && me.id === user.id) tr.classList.add('gd-users-row-me');

      const who = el('td', 'gd-users-who');
      const avatar = el('span', 'gd-users-avatar', { textContent: initials(user) });
      avatar.style.setProperty('--gd-avatar-hue', String(hue(user.email)));
      const names = el('div', 'gd-users-names');
      const nameLine = el('div', 'gd-users-name', { textContent: user.name || user.email });
      if (me && me.id === user.id) nameLine.append(el('span', 'gd-users-you', { textContent: 'you' }));
      names.append(nameLine, el('div', 'gd-users-email', { textContent: user.email }));
      who.append(avatar, names);
      tr.append(who);

      const roleCell = el('td', 'gd-users-rolecell');
      const role = el('select', 'gd-users-role', { title: 'Role' });
      for (const r of roles) role.append(el('option', null, { value: r, textContent: r }));
      if (!roles.includes(user.role)) role.append(el('option', null, { value: user.role, textContent: user.role }));
      role.value = user.role;
      role.addEventListener('change', () => act(`${user.email} is now ${role.value}`, () => api('PATCH', `/app/api/users/${user.id}`, { role: role.value })));
      roleCell.append(role);
      tr.append(roleCell);

      const status = user.invited ? 'invited' : user.active ? 'active' : 'inactive';
      const statusCell = el('td', 'gd-users-statuscell');
      statusCell.append(el('span', `gd-users-status gd-users-status-${status}`, { textContent: status, title: user.invited ? 'Invited; has not chosen a password yet' : user.active ? 'Can sign in' : 'Cannot sign in until activated' }));
      tr.append(statusCell);
      tr.append(el('td', 'gd-users-when', { textContent: ago(user.lastLoginAt), title: user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Has never signed in' }));

      const menu = el('td', 'gd-users-rowactions');
      const button = (action, iconName, title, handler, danger = false) => {
        const b = el('button', `gd-users-iconbtn${danger ? ' gd-users-iconbtn-danger' : ''}`, { type: 'button', title });
        b.append(lucideIcon(iconName));
        b.dataset.action = action;
        b.addEventListener('click', handler);
        menu.append(b);
        return b;
      };
      button('edit', 'pencil', 'Edit name, email and role', () => editUser(user));
      if (!user.invited) {
        button(user.active ? 'deactivate' : 'activate', user.active ? 'user-x' : 'user-check', user.active ? 'Deactivate: they can no longer sign in' : 'Activate: they can sign in', () =>
          act(`${user.email} ${user.active ? 'deactivated' : 'activated'}`, () => api('PATCH', `/app/api/users/${user.id}`, { active: !user.active }))
        );
      }
      button('reset', 'key-round', 'Send a password reset link', async () => {
        try {
          const result = await api('POST', `/app/api/users/${user.id}/reset`);
          await refresh();
          if (result.sent) showToast(`A reset link was emailed to ${user.email}`, 'success');
          else showToast('Mail is not configured; the link is shown under the user.', 'warning', 5000);
        } catch (err) {
          showToast(err.message, 'danger', 5000);
        }
      });
      button('password', 'lock', 'Set a password now', async () => {
        const password = await showPrompt(`New password for ${user.email} (8 characters or more)`, '', 'Set password');
        if (password === null) return;
        await act(`Password set for ${user.email}`, () => api('POST', `/app/api/users/${user.id}/password`, { password }));
      });
      button('delete', 'trash-2', 'Delete this user', async () => {
        if (!(await showConfirm(`Delete ${user.email}? This cannot be undone.`, 'Delete user', { tone: 'danger' }))) return;
        await act(`${user.email} deleted`, () => api('DELETE', `/app/api/users/${user.id}`));
      }, true);
      tr.append(menu);
      body.append(tr);
      const link = linkRow(user);
      if (link) {
        const extra = el('tr', 'gd-users-linkrow');
        const cell = el('td');
        cell.colSpan = 5;
        cell.append(link);
        extra.append(cell);
        body.append(extra);
      }
    }
  };

  const refresh = async () => {
    users = await api('GET', '/app/api/users');
    render();
  };

  searchInput.addEventListener('input', () => {
    filter = searchInput.value.trim().toLowerCase();
    render();
  });

  addBtn.addEventListener('click', async () => {
    const values = await formDialog({
      title: 'Add a user',
      okText: 'Add',
      fields: [
        { name: 'email', label: 'Email', type: 'email', required: true, autofocus: true },
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'password', label: 'Password', type: 'password', required: true, hint: '8 characters or more' },
        { name: 'role', label: 'Role', type: 'select', options: roles, value: defaultRole },
        { name: 'active', label: 'Active', type: 'checkbox', value: true, text: 'Can sign in right away' }
      ]
    });
    if (!values) return;
    await act(`${values.email} added`, () => api('POST', '/app/api/users', values));
  });

  inviteBtn.addEventListener('click', async () => {
    const values = await formDialog({
      title: 'Invite a user',
      okText: 'Invite',
      intro: 'They get a link to choose their password; it works for seven days.',
      fields: [
        { name: 'email', label: 'Email', type: 'email', required: true, autofocus: true },
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'role', label: 'Role', type: 'select', options: roles, value: defaultRole }
      ]
    });
    if (!values) return;
    const { email, name, role } = values;
    try {
      const result = await api('POST', '/app/api/users/invite', { email, name, role });
      await refresh();
      if (result.sent) showToast(`An invitation was emailed to ${email}`, 'success');
      else await showMessage(`Mail is not configured, so the invitation was not sent. Pass this link on yourself:\n\n${result.link}`, 'Invitation link', { tone: 'info' });
    } catch (err) {
      showToast(err.message, 'danger', 5000);
    }
  });

  refresh().catch((err) => {
    note.textContent = err.message;
  });
  return { refresh };
}
