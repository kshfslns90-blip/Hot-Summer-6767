// Entry point of /app: the application shell around the forms. Reads the project's settings,
// draws the shell the project chose (none, classic, office), and hosts the form runtime in the
// shell's content pane. Navigation - from the menu, form.navigate() or app.navigate() - keeps
// the URL at /app/<Form> and the browser's history in step (the runtime app does that), so a
// refresh or a shared link lands on the same form and Back is the app's back. The pages of
// authentication and the System pages (Users, API keys, Secrets) are routed from here as well.
import { RuntimeApp, formUrl as pageUrl } from './app.js';
import { onUnauthorized } from './endpoints.js';
import { mountShell as mountNone } from './shell-none.js';
import { mountShell as mountClassic } from './shell-classic.js';
import { mountShell as mountOffice } from './shell-office.js';
import { mountShell as mountNavbar } from './shell-navbar.js';
import { mountShell as mountActionbar } from './shell-actionbar.js';
import { mountShell as mountBottom } from './shell-bottom.js';
import { renderAuthPage } from './auth-pages.js';
import { mountUsersPage } from './users-page.js';
import { mountApiKeysPage } from './api-keys-page.js';
import { mountSecretsPage } from './secrets-page.js';

const root = document.getElementById('gd-shell');
const errorBar = document.getElementById('gd-error');

export const PAGES = new Set(['users', 'api-keys', 'secrets', 'login', 'register', 'reset', 'invite']);
// The pages an Administrator manages the app from: their title, and what draws them.
const SYSTEM_PAGES = {
  users: { title: 'Users', refuse: 'Only an Administrator can manage users.', mount: mountUsersPage },
  'api-keys': { title: 'API keys', refuse: 'Only an Administrator can manage API keys.', mount: mountApiKeysPage },
  secrets: { title: 'Secrets', refuse: 'Only an Administrator can manage secrets.', mount: mountSecretsPage }
};
const AUTH_PAGES = new Set(['login', 'register', 'reset', 'invite']);

function showError(err, where) {
  errorBar.hidden = false;
  errorBar.textContent = `${where}: ${err.message}`;
}

// /app -> start form; /app/<Form> -> that form; /app/<page> -> a shell page.
export function parseLocation(pathname = location.pathname, search = location.search) {
  const parts = pathname.split('/').filter(Boolean);
  const tail = parts.length > 1 ? decodeURIComponent(parts[1]) : '';
  const params = new URLSearchParams(search);
  let args;
  const raw = params.get('args');
  if (raw) {
    try {
      args = JSON.parse(raw);
    } catch {
      args = raw;
    }
  }
  if (!tail) return { kind: 'start', args };
  if (PAGES.has(tail)) return { kind: 'page', page: tail, token: params.get('token') || '', next: params.get('next') || '' };
  return { kind: 'form', name: tail, args };
}

export function formUrl(name, args) {
  return pageUrl('/app', name, args);
}

async function loadSettings() {
  const response = await fetch('/app/api/settings');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'The application settings could not be loaded.');
  return data;
}

// The first menu item that points at a form that exists.
export function firstMenuForm(menu) {
  for (const group of menu || []) for (const item of group.items || []) if (item.form && !item.missing) return item.form;
  return '';
}

const SHELLS = { none: mountNone, classic: mountClassic, office: mountOffice, navbar: mountNavbar, actionbar: mountActionbar, bottom: mountBottom };

function emptyState(host, settings) {
  const card = document.createElement('div');
  card.className = 'gd-shell-empty';
  const title = document.createElement('h2');
  title.textContent = settings.project.name;
  const text = document.createElement('p');
  text.textContent = 'No start form yet. Open Project settings in the designer, add a menu item that points at a form, or pick a start form.';
  card.append(title, text);
  host.replaceChildren(card);
}

function loginUrl() {
  return `/app/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

async function signOut() {
  await fetch('/app/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.assign('/app/login');
}

async function main() {
  const where = parseLocation();
  const settings = await loadSettings();
  viewer.preview = Boolean(settings.preview);
  if (viewer.preview) report(viewer.view); // a hello that came before the settings is answered now
  const authOn = Boolean(settings.auth?.enabled);

  // The pages of authentication stand on their own, without the shell.
  if (where.kind === 'page' && AUTH_PAGES.has(where.page)) {
    if (!authOn || (settings.user && where.page === 'login')) {
      location.replace(where.next && /^\/(app|run)(\/|\?|$)/.test(where.next) ? where.next : '/app');
      return;
    }
    renderAuthPage(root, { page: where.page, settings, token: where.token, next: where.next });
    return;
  }
  if (settings.signedOut) {
    location.replace(loginUrl());
    return;
  }
  document.title = settings.project.name || 'AppMaker';

  const mount = SHELLS[settings.shell] || SHELLS.none;
  // The start form: where the brand goes, and where a main form's close() goes.
  const home = settings.startForm || firstMenuForm(settings.menu);
  let app = null;
  const shell = mount(root, {
    settings,
    onSelect: (item) => {
      if (item.page && SYSTEM_PAGES[item.page]) {
        openPage(item.page);
        return;
      }
      if (!item.form || item.missing) return;
      app?.navigate(item.form, item.args ?? undefined).catch((err) => showError(err, `form ${item.form}`));
    },
    onSignOut: signOut,
    onUsers: () => openPage('users'),
    onApiKeys: () => openPage('api-keys'),
    onSecrets: () => openPage('secrets'),
    // The brand (the logo, or the name) goes to the start form.
    onHome: () => {
      if (home) app?.navigate(home).catch((err) => showError(err, `form ${home}`));
    }
  });

  app = new RuntimeApp(shell.host, {
    onError: showError,
    user: settings.user || null,
    signOut,
    home: home ? { name: home } : null,
    urlFor: formUrl,
    onNavigate: ({ name, args, title }) => {
      document.title = `${title} - ${settings.project.name}`;
      shell.setTitle(title);
      shell.setActive(name, args);
      report({ form: name, args });
    },
    // A popped history entry that is not a form's: a System page, or an entry with no state
    // (then the URL says what to show).
    onRestore: (state) => {
      if (state?.page && SYSTEM_PAGES[state.page]) return openPage(state.page, false);
      const target = parseLocation();
      if (target.kind === 'form') return app.open(target.name, target.args, { record: false });
      return undefined;
    }
  });
  window.gdApp = app;
  shell.setUser(settings.user || null);

  const openPage = async (page, push = true) => {
    const spec = SYSTEM_PAGES[page];
    report(null); // a page is not a form: the designer's frame hears of no form
    if (!settings.user?.isAdmin) {
      const card = document.createElement('div');
      card.className = 'gd-shell-empty';
      // Nobody signed in means sign-in is off for the project: say what to turn on.
      card.textContent = settings.user ? spec.refuse : `${spec.refuse} Please make sure your project has "Require sign-in" enabled in Project settings.`;
      shell.host.replaceChildren(card);
      return;
    }
    // The form (or a dialog over it) may refuse to be left: then the page does not open.
    if (!(await app.leaveCurrent())) return;
    // The page is a screen of the app like a form: an entry of its own, so back() from a form
    // returns to it.
    app.remember({ page }, `/app/${page}`, { push });
    document.title = `${spec.title} - ${settings.project.name}`;
    shell.setTitle(spec.title);
    shell.setActive(`page:${page}`);
    spec.mount(shell.host, { settings });
  };

  if (where.kind === 'page') {
    openPage(where.page, false);
    return;
  }
  const start = where.kind === 'form' ? where.name : home;
  if (!start) {
    shell.setTitle('');
    emptyState(shell.host, settings);
    return;
  }
  await app.start(start, where.args).catch((err) => showError(err, `form ${start}`));
}

onUnauthorized(() => location.assign(loginUrl()));

// The designer's Build mode shows the app in a frame, and can neither reload a frame of another
// origin nor read where the app has got to. So it asks: the app answers with the request's id
// and reloads itself, which lands on the screen it shows (the URL follows the app). Only the page
// that frames the app is heard, and nothing but that id goes back. A reload is harmless: whoever
// frames the app could reload it anyway.
//
// It also asks which form is shown (`appmaker:hello`, with a number for this document), so that
// a message to the AI can say where the person was looking. That is answered only on a page
// served to a preview session - the settings say so, and a deployed app never is - and only to
// the asker's origin: from then on every form shown goes back as `appmaker:viewing` with that
// number, the form's name and its arguments when they are a plain object and short. Nothing is
// sent to a page that did not ask, and a page is not a form (null).
const viewer = { preview: false, asker: null, view: null };
function report(view) {
  viewer.view = view;
  const { asker } = viewer;
  // The asker is kept even before the settings are in (the designer asks as soon as the page
  // has loaded, which may be sooner): nothing goes out until they say this is a preview.
  if (!asker || !viewer.preview) return;
  let args = null;
  if (view && view.args && typeof view.args === 'object' && !Array.isArray(view.args)) {
    try {
      const text = JSON.stringify(view.args);
      if (typeof text === 'string' && text.length <= 400) args = text;
    } catch {
      /* not serialisable: the form alone */
    }
  }
  try {
    asker.source.postMessage({ type: 'appmaker:viewing', id: asker.id, form: view ? view.form : null, args }, asker.origin);
  } catch {
    /* a courtesy */
  }
}
if (window.parent !== window) {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    if (e.data?.type === 'appmaker:hello') {
      if (!e.origin || e.origin === 'null' || typeof e.data.id !== 'number') return;
      viewer.asker = { source: e.source, origin: e.origin, id: e.data.id };
      report(viewer.view);
      return;
    }
    if (e.data?.type !== 'appmaker:reload') return;
    try {
      if (e.origin && e.origin !== 'null') e.source.postMessage({ type: 'appmaker:reloading', id: typeof e.data.id === 'number' ? e.data.id : null }, e.origin);
    } catch {
      /* the answer is a courtesy; the reload is what was asked */
    }
    location.reload();
  });
}

main().catch((err) => showError(err, 'app'));
