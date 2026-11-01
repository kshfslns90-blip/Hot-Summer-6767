// The API keys page of the shell, for Administrators: the keys that callers outside the app
// send to its APIs. A key is created here and shown once; the list only ever shows its
// prefix. Built like the Users page - the same table, dialogs and toasts - so the two System
// pages look like siblings. The server enforces every rule; this page shows what it says.
import { lucideIcon } from './icons.js';
import { showConfirm, showToast } from './dialogs.js';
import { formDialog, ago } from './users-page.js';

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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function mountApiKeysPage(host, { settings }) {
  const roles = settings.auth?.roles || ['Administrator', 'User'];
  const defaultRole = roles.includes('User') ? 'User' : roles[roles.length - 1];

  const page = el('div', 'gd-users gd-apikeys');
  const head = el('div', 'gd-users-head');
  const titles = el('div', 'gd-users-titles');
  titles.append(el('h2', null, { textContent: 'API keys' }));
  const note = el('div', 'gd-users-note');
  titles.append(note);
  const actions = el('div', 'gd-users-actions');
  const createBtn = el('button', 'gd-users-btn gd-users-btn-primary', { type: 'button' });
  createBtn.append(lucideIcon('key-round'), document.createTextNode('Create a key'));
  actions.append(createBtn);
  head.append(titles, actions);
  const intro = el('p', 'gd-apikeys-intro', {
    textContent: `A caller sends its key as "Authorization: Bearer <key>" (or "X-Api-Key") to the endpoints under ${location.origin}/api/. Each key acts with its role, the way a signed-in user does. Keys stay in this server's database: they are not part of the project.`
  });
  // Where a freshly created key shows, once.
  const fresh = el('div', 'gd-apikeys-fresh');
  fresh.hidden = true;
  const table = el('table', 'gd-users-table gd-apikeys-table');
  table.append(el('thead'), el('tbody'));
  table.querySelector('thead').innerHTML = '<tr><th>Name</th><th>Role</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr>';
  const empty = el('div', 'gd-users-empty');
  empty.hidden = true;
  page.append(head, intro, fresh, table, empty);
  host.replaceChildren(page);

  const body = table.querySelector('tbody');
  let keys = [];

  const showFresh = (key, entry) => {
    fresh.replaceChildren();
    fresh.hidden = false;
    const title = el('div', 'gd-apikeys-freshtitle');
    title.append(lucideIcon('key-round'), el('span', null, { textContent: `The key "${entry.name}" was created` }));
    const box = el('div', 'gd-apikeys-keybox');
    const value = el('input', null, { type: 'text', readOnly: true, value: key, spellcheck: false });
    value.addEventListener('focus', () => value.select());
    const copy = el('button', 'gd-users-btn gd-apikeys-copy', { type: 'button', title: 'Copy the key' });
    copy.append(lucideIcon('copy'), document.createTextNode('Copy'));
    copy.addEventListener('click', async () => {
      if (await copyText(key)) {
        copy.replaceChildren(lucideIcon('check'), document.createTextNode('Copied'));
        setTimeout(() => copy.replaceChildren(lucideIcon('copy'), document.createTextNode('Copy')), 1500);
      } else value.focus();
    });
    box.append(value, copy);
    const warn = el('div', 'gd-apikeys-freshnote');
    warn.append(lucideIcon('triangle-alert'), el('span', null, { textContent: 'Copy it now - it is not shown again. The list keeps only its first characters.' }));
    const done = el('button', 'gd-users-btn', { type: 'button', textContent: 'Done' });
    done.addEventListener('click', () => {
      fresh.hidden = true;
      fresh.replaceChildren();
    });
    const foot = el('div', 'gd-apikeys-freshfoot');
    foot.append(warn, done);
    fresh.append(title, box, foot);
    value.focus();
    value.select();
  };

  const render = () => {
    body.replaceChildren();
    note.textContent = keys.length ? `${keys.length} key${keys.length === 1 ? '' : 's'}` : '';
    empty.hidden = keys.length > 0;
    empty.textContent = 'No keys yet. Create one and hand it to the caller that needs it.';
    table.hidden = keys.length === 0;
    for (const entry of keys) {
      const tr = el('tr');
      tr.dataset.name = entry.name;
      tr.append(el('td', 'gd-apikeys-name', { textContent: entry.name }));
      tr.append(el('td', null, { textContent: entry.role }));
      tr.append(el('td', 'gd-apikeys-prefix', { textContent: `${entry.prefix}…`, title: 'Only the first characters are kept; the key itself was shown once' }));
      tr.append(el('td', 'gd-users-when', { textContent: entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : '', title: entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '' }));
      tr.append(el('td', 'gd-users-when', { textContent: ago(entry.lastUsedAt), title: entry.lastUsedAt ? new Date(entry.lastUsedAt).toLocaleString() : 'Never used' }));
      const menu = el('td', 'gd-users-rowactions');
      const remove = el('button', 'gd-users-iconbtn gd-users-iconbtn-danger', { type: 'button', title: 'Delete this key' });
      remove.dataset.action = 'delete';
      remove.append(lucideIcon('trash-2'));
      remove.addEventListener('click', async () => {
        if (!(await showConfirm(`Delete the key "${entry.name}"? Every caller using it stops working.`, 'Delete key', { tone: 'danger' }))) return;
        try {
          await api('DELETE', `/app/api/api-keys/${entry.id}`);
          await refresh();
          showToast(`Key "${entry.name}" deleted`, 'success');
        } catch (err) {
          showToast(err.message, 'danger', 5000);
        }
      });
      menu.append(remove);
      tr.append(menu);
      body.append(tr);
    }
  };

  const refresh = async () => {
    keys = await api('GET', '/app/api/api-keys');
    render();
  };

  createBtn.addEventListener('click', async () => {
    const values = await formDialog({
      title: 'Create an API key',
      okText: 'Create',
      intro: 'The key is shown once, right after this. Its role decides which APIs it may call.',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true, autofocus: true, hint: 'Who or what will use it, e.g. Reporting service' },
        { name: 'role', label: 'Role', type: 'select', options: roles, value: defaultRole }
      ]
    });
    if (!values) return;
    try {
      const { key, entry } = await api('POST', '/app/api/api-keys', values);
      await refresh();
      showFresh(key, entry);
    } catch (err) {
      showToast(err.message, 'danger', 5000);
    }
  });

  refresh().catch((err) => {
    note.textContent = err.message;
  });
  return { refresh };
}
