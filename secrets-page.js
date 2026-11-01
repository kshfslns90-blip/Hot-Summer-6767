// The Secrets page of the shell, for Administrators: the values of the secrets the app's design
// defines - the keys and tokens its server scripts read with getSecret(). A value is set or
// replaced here and never shown again; the list says only whether each secret is configured.
// Names and descriptions are the design's, changed in the designer, so there is no New, Rename
// or Delete here. Built like the API keys page; the server enforces every rule.
import { lucideIcon } from './icons.js';
import { showChoice, showToast } from './dialogs.js';
import { formDialog, ago } from './users-page.js';
import { STATE_TEXT, REASON_TEXT, summaryOf, keyNotice, resetLabel, resetQuestion, resetDone, edgeWhitespace, WHITESPACE_HINT } from './secrets-common.js';

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

// Whitespace at either end of a value: ask before saving it. null = cancelled.
export async function askAboutWhitespace(value) {
  const found = edgeWhitespace(value);
  if (!found) return value;
  const choice = await showChoice(`${found} ${WHITESPACE_HINT}`, 'Whitespace in the value', {
    tone: 'warning',
    buttons: [
      { label: 'Remove and save', value: 'trim', primary: true },
      { label: 'Keep exactly', value: 'keep' },
      { label: 'Cancel', value: null, cancel: true }
    ]
  });
  if (!choice) return null;
  return choice === 'trim' ? value.trim() : value;
}

export function mountSecretsPage(host) {
  const page = el('div', 'gd-users gd-secrets');
  const head = el('div', 'gd-users-head');
  const titles = el('div', 'gd-users-titles');
  titles.append(el('h2', null, { textContent: 'Secrets' }));
  const note = el('div', 'gd-users-note');
  titles.append(note);
  head.append(titles);
  const intro = el('p', 'gd-apikeys-intro', {
    textContent: 'The secrets this app needs - API keys, tokens, passwords - as its design defines them. A value set here is encrypted on this server and never shown again; server scripts read it with getSecret().'
  });
  const banner = el('div', 'gd-secrets-banner');
  banner.hidden = true;
  const table = el('table', 'gd-users-table gd-secrets-table');
  table.append(el('thead'), el('tbody'));
  table.querySelector('thead').innerHTML = '<tr><th>Name</th><th>Description</th><th>Status</th><th>Value set</th><th></th></tr>';
  const empty = el('div', 'gd-users-empty', { textContent: 'This app defines no secrets.' });
  empty.hidden = true;
  page.append(head, intro, banner, table, empty);
  host.replaceChildren(page);

  const body = table.querySelector('tbody');
  let listing = { secrets: [], key: { state: 'none', unreadable: 0 } };

  const setValue = async (entry) => {
    const values = await formDialog({
      title: `${entry.state === 'configured' ? 'Replace' : 'Set'} the value of ${entry.name}`,
      intro: `${entry.description ? `${entry.description} ` : ''}The value is encrypted on this server and never shown again.`,
      okText: 'Save',
      fields: [{ name: 'value', label: 'Value', type: 'secret', required: true, autofocus: true }]
    });
    if (!values) return;
    const value = await askAboutWhitespace(values.value);
    if (value === null) return;
    try {
      await api('PUT', `/app/api/secrets/${encodeURIComponent(entry.name)}/value`, { value });
      await refresh();
      showToast(`Value saved for ${entry.name}`, 'success');
    } catch (err) {
      showToast(err.message, 'danger', 6000);
    }
  };

  const renderBanner = (notice) => {
    banner.replaceChildren();
    banner.hidden = !notice;
    if (!notice) return;
    const text = el('div', 'gd-secrets-bannertext');
    text.append(lucideIcon('triangle-alert'), el('span', null, { textContent: notice.text }));
    const reset = el('button', 'gd-users-btn gd-secrets-reset', { type: 'button', textContent: resetLabel(notice) });
    reset.addEventListener('click', async () => {
      const question = resetQuestion(notice, listing);
      const sure = await showChoice(question.text, question.title, {
        tone: 'danger',
        buttons: [
          { label: question.button, value: true },
          { label: 'Cancel', value: false, primary: true, cancel: true }
        ]
      });
      if (!sure) return;
      try {
        const done = await api('POST', '/app/api/secrets/reset-unreadable', { expect: notice.count });
        await refresh();
        showToast(resetDone(done), 'success');
      } catch (err) {
        await refresh().catch(() => {});
        showToast(err.message, 'danger', 6000);
      }
    });
    banner.append(text, reset);
  };

  const render = () => {
    const { secrets, key } = listing;
    note.textContent = secrets.length ? summaryOf(secrets) : '';
    const notice = keyNotice(listing, "this app's secrets.key");
    renderBanner(notice);
    empty.hidden = secrets.length > 0;
    table.hidden = secrets.length === 0;
    const keyGone = key.state === 'missing' || key.state === 'invalid';
    body.replaceChildren();
    for (const entry of secrets) {
      const tr = el('tr', `gd-secrets-row gd-secrets-row-${entry.state}`);
      tr.dataset.name = entry.name;
      tr.append(el('td', 'gd-secrets-name', { textContent: entry.name }));
      const desc = el('td', 'gd-secrets-desc', { textContent: entry.description || 'No description' });
      if (!entry.description) desc.classList.add('gd-secrets-nodesc');
      tr.append(desc);
      const status = el('td');
      const pill = el('span', `gd-secrets-pill gd-secrets-pill-${entry.state === 'configured' ? 'ok' : entry.state === 'unavailable' ? 'bad' : 'missing'}`, { textContent: STATE_TEXT[entry.state] });
      if (entry.state === 'unavailable') pill.title = REASON_TEXT[entry.reason] || '';
      if (entry.state === 'configured' && entry.valueSetAt) pill.title = `Set ${ago(entry.valueSetAt)}`;
      status.append(pill);
      tr.append(status);
      tr.append(el('td', 'gd-users-when', { textContent: entry.valueSetAt ? ago(entry.valueSetAt) : '-', title: entry.valueSetAt ? new Date(entry.valueSetAt).toLocaleString() : 'No value yet' }));
      const actions = el('td', 'gd-users-rowactions');
      const set = el('button', 'gd-users-btn gd-secrets-set', { type: 'button', textContent: entry.state === 'not-configured' ? 'Set value' : 'Replace value' });
      set.dataset.action = 'set-value';
      set.disabled = keyGone;
      if (keyGone) set.title = 'The encryption key is missing or damaged - see the note above.';
      set.addEventListener('click', () => setValue(entry));
      actions.append(set);
      tr.append(actions);
      body.append(tr);
    }
  };

  const refresh = async () => {
    listing = await api('GET', '/app/api/secrets');
    render();
  };

  refresh().catch((err) => {
    note.textContent = err.message;
  });
  return { refresh };
}
