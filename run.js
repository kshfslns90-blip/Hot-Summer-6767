// Entry point for /run/<FormName>: one form on its own, the way the designer's Run button
// opens it. The URL follows navigation (/run/<Form>?args=), so Back, Forward and a reload land
// where the form was; there is no start form, so closing the form the tab was opened for shows
// a receipt in its place.
import { RuntimeApp, formUrl } from './app.js';
import { onUnauthorized, setApiBase } from './endpoints.js';

// The preview's own surface: under the preview host it needs no app sign-in.
setApiBase('/run/api');

// A preview under authentication whose session ended mid-way goes to the login page and back.
onUnauthorized(() => location.assign(`/app/login?next=${encodeURIComponent(location.pathname + location.search)}`));

const host = document.getElementById('gd-app');
const errorBar = document.getElementById('gd-error');

function showError(err, where) {
  errorBar.hidden = false;
  errorBar.textContent = `${where}: ${err.message}`;
}

const name = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
const args = readArgs();

function readArgs() {
  const raw = new URLSearchParams(location.search).get('args');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// The form the tab was opened for closed: a receipt in its place - which form, what it handed
// back - and a way to run it again with the same arguments.
function onClosed({ name: closedName, args: closedArgs, result }) {
  const card = document.createElement('div');
  card.className = 'gd-run-closed';
  const title = document.createElement('h2');
  title.textContent = `${closedName} closed`;
  const value = document.createElement('pre');
  value.textContent = result === undefined ? 'result: undefined' : `result: ${JSON.stringify(result, null, 2)}`;
  const reopen = document.createElement('button');
  reopen.type = 'button';
  reopen.className = 'gd-run-reopen';
  reopen.textContent = 'Reopen';
  reopen.addEventListener('click', () => app.start(closedName, closedArgs).catch((err) => showError(err, `form ${closedName}`)));
  card.append(title, value, reopen);
  host.replaceChildren(card);
}

const app = new RuntimeApp(host, { onError: showError, home: null, urlFor: (formName, formArgs) => formUrl('/run', formName, formArgs), onClosed });
window.gdApp = app;

app.start(name, args).catch((err) => showError(err, `form ${name}`));
