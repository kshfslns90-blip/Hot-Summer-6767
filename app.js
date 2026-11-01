// The running application: the shell page and the API the runtime talks to. Mounted at /app,
// apart from the designer's /designer/api, so that authentication - when the project turns it
// on - guards this surface alone while the designer stays a development tool. The project's
// own APIs are a router of their own, mounted at /api by the runner.
import express from 'express';
import path from 'node:path';
import { config } from '../config.js';
import * as store from '../store.js';
import { callServer, ScriptError } from '../runner.js';
import { publicSettings } from '../settings.js';
import { imageUrl } from '../images.js';
import * as auth from '../auth/service.js';
import { attachUser, requireUser, requireAdmin, startSession, endSession, authEnabled, safeNext } from '../auth/guard.js';
import * as mail from '../mail.js';
import * as uploads from '../uploads.js';
import { isFileSend, openReadStream, downloadHeaders } from '../files.js';
import { registry as apis } from '../apis.js';
import * as apiKeys from '../auth/api-keys.js';
import { secretsRouter } from './secrets.js';
import { previewVouched } from '../runner-trust.js';
import { restoreHoles } from '../../public/runtime/data-source.js';

export const app = express.Router();

// A page of the shell that is not a form; anything else after /app/ is a form name.
export const SHELL_PAGES = new Set(['users', 'api-keys', 'secrets', 'login', 'register', 'reset', 'invite']);

app.use(attachUser);

function send(res, promise) {
  Promise.resolve(promise).then(
    (value) => res.json(value),
    (err) => res.status(err.status || 500).json({ error: { message: err.message } })
  );
}

// The address links in mail point at: the project's canonical preview origin when the runner
// was given one, never an incoming Host header; standalone, the request's own address.
function origin(req) {
  if (config.publicOrigin) return config.publicOrigin;
  const proto = req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
  return `${proto}://${req.get('host')}`;
}

// What the shell needs to draw itself: name, shell kind, menu (with items whose form is gone
// flagged, and only the items the user's role may see), start form, the public part of the
// auth settings, and who is signed in. Without a session under authentication only the login
// page's needs are answered. `preview` says the page is served to a preview session (the
// designer's), which is what lets the shell answer the designer's frame; a deployed app never
// says it.
export async function shellSettings(user = null, { preview = false } = {}) {
  const settings = publicSettings(await store.readProject());
  const authInfo = { ...settings.auth, noAdmin: settings.auth.enabled && auth.adminCount() === 0 };
  const project = { name: settings.name, logo: imageUrl(settings.logo) };
  const served = preview ? { preview: true } : {};
  if (settings.auth.enabled && !user) return { project, shell: settings.shell, showGroups: settings.showGroups, startForm: '', menu: [], auth: authInfo, user: null, signedOut: true, ...served };
  const forms = new Set(await store.list('forms'));
  // An item with roles is for those roles alone; with sign-in off there are no roles and
  // everything shows. A group left with nothing is not drawn. This is what the menu shows,
  // not what a user may open: a form's URL still works for anyone signed in.
  const visible = (item) => !item.roles?.length || !settings.auth.enabled || (user && item.roles.includes(user.role));
  const menu = settings.menu
    .map((group) => ({
      ...group,
      items: group.items.filter(visible).map((item) => ({ ...item, missing: Boolean(item.form) && !forms.has(item.form) }))
    }))
    .filter((group) => group.items.length);
  const startForm = settings.startForm && forms.has(settings.startForm) ? settings.startForm : '';
  // Administrators get the Users, API keys and Secrets pages in the menu as well as in their
  // corner.
  if (user?.isAdmin) {
    menu.push({
      label: 'System',
      icon: 'settings',
      items: [
        { label: 'Users', icon: 'users', form: '', page: 'users', args: null, missing: false },
        { label: 'API keys', icon: 'key-round', form: '', page: 'api-keys', args: null, missing: false },
        { label: 'Secrets', icon: 'lock-keyhole', form: '', page: 'secrets', args: null, missing: false }
      ]
    });
  }
  return { project, shell: settings.shell, showGroups: settings.showGroups, startForm, menu, auth: authInfo, user, ...served };
}

app.get('/api/settings', (req, res) => send(res, shellSettings(req.user || null, { preview: previewVouched(req) })));

// The three calls a running form makes; the preview's /run/api mounts them too.
export const readFormHandler = (req, res) => send(res, store.read('forms', req.params.name));
export const readClientScriptHandler = (req, res) => send(res, store.read('client-scripts', req.params.name));

app.get('/api/forms/:name', requireUser(), readFormHandler);

app.get('/api/client-scripts/:name', requireUser(), readClientScriptHandler);

function sendExec(res, target, promise) {
  promise.then(
    (result) => res.json({ result: result === undefined ? null : result }),
    (err) => {
      const status = err instanceof ScriptError ? err.status : err.status || 500;
      res.status(status).json({ error: { message: err.message, stack: err.detail || err.stack, target } });
    }
  );
}

// callServer from a running form. The signed-in user, when there is one, reaches the script
// as its `user` global. `holes` are the positions the caller left undefined (JSON carries them
// as null): put back, so the function's own parameter defaults apply.
export const execHandler = (req, res) => {
  const { args, holes } = req.body || {};
  sendExec(res, req.params.target, callServer(req.params.target, restoreHoles(args, holes), { user: req.user || null }));
};
app.post('/api/exec/:target', requireUser(), execHandler);

// --- files: uploads in batches, downloads through a server function ----------------

// Who a batch belongs to: the signed-in user, or the address when there is no sign-in.
const uploadOwner = (req) => (req.user ? `user:${req.user.id}` : `addr:${req.ip}`);

// A chunk arrives as the raw request body, one chunk per request.
export const chunkBody = express.raw({ type: () => true, limit: config.uploadChunkBytes + 1024 });

export const uploadHandlers = {
  create: (req, res) => {
    const body = req.body || {};
    send(res, uploads.createBatch({ handler: body.handler, owner: uploadOwner(req), files: body.files }));
  },
  chunk: (req, res) => send(res, uploads.writeChunk(req.params.batchId, req.params.uploadId, Number(req.params.index), req.body, { owner: uploadOwner(req) })),
  state: (req, res) => send(res, uploads.batchState(req.params.batchId, { owner: uploadOwner(req) })),
  complete: (req, res) => {
    uploads.completeBatch(req.params.batchId, { owner: uploadOwner(req), user: req.user || null }).then(
      (value) => res.json(value),
      (err) => {
        const status = err instanceof ScriptError ? err.status : err.status || 500;
        res.status(status).json({ error: { message: err.message, stack: err.detail || undefined } });
      }
    );
  },
  abort: (req, res) => send(res, uploads.abortBatch(req.params.batchId, { owner: uploadOwner(req) }))
};

app.post('/api/uploads', requireUser(), uploadHandlers.create);
app.put('/api/uploads/:batchId/:uploadId/:index', requireUser(), chunkBody, uploadHandlers.chunk);
app.get('/api/uploads/:batchId', requireUser(), uploadHandlers.state);
app.post('/api/uploads/:batchId/complete', requireUser(), uploadHandlers.complete);
app.delete('/api/uploads/:batchId', requireUser(), uploadHandlers.abort);

// A download: the function named in the URL runs like exec (its args from the query) and is
// expected to return files.send(...); that file is then streamed as an attachment (or inline,
// for a picture that asked for it), never sniffed and never allowed to run anything. It is a
// GET the session cookie rides along with, so a request another site made is refused before
// anything runs.
export const downloadHandler = async (req, res) => {
  const target = req.params.target;
  if (String(req.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') {
    res.status(403).json({ error: { message: 'A download cannot be requested from another site.' } });
    return;
  }
  let args;
  if (req.query.args !== undefined) {
    try {
      args = JSON.parse(String(req.query.args));
    } catch {
      res.status(400).json({ error: { message: 'The args of a download are JSON.' } });
      return;
    }
  }
  try {
    const sent = await callServer(target, args, { user: req.user || null });
    if (!isFileSend(sent)) {
      res.status(400).json({ error: { message: `"${target}" did not return a file: a download function returns files.send(path).`, target } });
      return;
    }
    const stream = await openReadStream(sent.path);
    res.set(downloadHeaders(sent));
    stream.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: { message: err.message } });
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    const status = err instanceof ScriptError ? err.status : err.status || 500;
    res.status(status).json({ error: { message: err.message, stack: err.detail || undefined, target } });
  }
};
app.get('/api/download/:target', requireUser(), downloadHandler);

// --- signing in and out, registration, reset, invitations --------------------

function requireAuthOn(req, res, next) {
  if (!authEnabled()) {
    res.status(404).json({ error: { message: 'Authentication is not enabled for this project.' } });
    return;
  }
  next();
}

app.post('/api/auth/login', requireAuthOn, (req, res) => {
  const { email, password } = req.body || {};
  send(res, (async () => {
    const user = auth.login(email, password);
    startSession(req, res, user.id);
    return { user };
  })());
});

app.post('/api/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => res.json({ user: req.user || null }));

app.post('/api/auth/register', requireAuthOn, (req, res) => {
  const { email, name, password } = req.body || {};
  send(res, (async () => {
    const { user, active } = await auth.register({ email, name, password });
    if (active) startSession(req, res, user.id);
    return { user, active };
  })());
});

// One reset mail per address per minute: the endpoint is open to anyone, and a mail costs.
// A request inside the window answers exactly like one for an unknown address.
const RESET_WINDOW_MS = 60_000;
const recentResets = new Map();
function resetAllowed(email) {
  const key = String(email ?? '').trim().toLowerCase();
  const now = Date.now();
  if (recentResets.size > 1000) for (const [k, at] of recentResets) if (now - at > RESET_WINDOW_MS) recentResets.delete(k);
  const last = recentResets.get(key);
  if (last && now - last < RESET_WINDOW_MS) return false;
  recentResets.set(key, now);
  return true;
}

app.post('/api/auth/request-reset', requireAuthOn, (req, res) => {
  send(res, (async () => {
    const email = (req.body || {}).email;
    const issued = resetAllowed(email) ? auth.requestReset(email) : null;
    if (issued) {
      const settings = await store.readProject();
      const link = `${origin(req)}/app/reset?token=${issued.token}`;
      const outcome = await mail.send(mail.resetMessage({ to: issued.user.email, link, projectName: settings.name }), settings.mail);
      if (!outcome.delivered) auth.rememberLink(issued.user.id, 'reset', link);
    }
    return { ok: true };
  })());
});

app.post('/api/auth/reset', requireAuthOn, (req, res) => {
  const { token, password } = req.body || {};
  send(res, (async () => {
    auth.resetPassword(token, password);
    return { ok: true };
  })());
});

app.get('/api/auth/invite/:token', requireAuthOn, (req, res) => {
  const info = auth.inviteInfo(req.params.token);
  if (!info) res.status(404).json({ error: { message: 'This invitation has expired or was already used.' } });
  else res.json(info);
});

app.post('/api/auth/accept-invite', requireAuthOn, (req, res) => {
  const { token, name, password } = req.body || {};
  send(res, (async () => {
    const user = auth.acceptInvite(token, { name, password });
    startSession(req, res, user.id);
    return { user };
  })());
});

// --- user management, Administrators only -----------------------------------

app.get('/api/users', requireAdmin, (req, res) => send(res, auth.listUsers()));

app.post('/api/users', requireAdmin, (req, res) => {
  const { email, name, password, role, active } = req.body || {};
  send(res, auth.createUser({ email, name, password, role, active: active === undefined ? true : Boolean(active) }));
});

app.post('/api/users/invite', requireAdmin, (req, res) => {
  const { email, name, role } = req.body || {};
  send(res, (async () => {
    const { user, token } = await auth.invite({ email, name, role });
    const settings = await store.readProject();
    const link = `${origin(req)}/app/invite?token=${token}`;
    const outcome = await mail.send(mail.inviteMessage({ to: user.email, link, projectName: settings.name, invitedBy: req.user.name || req.user.email }), settings.mail);
    if (!outcome.delivered) auth.rememberLink(user.id, 'invite', link);
    return { user: auth.userById(user.id), sent: outcome.delivered, link: outcome.delivered ? undefined : link };
  })());
});

app.patch('/api/users/:id', requireAdmin, (req, res) => {
  const { email, name, role, active } = req.body || {};
  send(res, auth.updateUser(req.params.id, { email, name, role, active }));
});

app.post('/api/users/:id/reset', requireAdmin, (req, res) => {
  send(res, (async () => {
    const issued = auth.resetForUser(req.params.id);
    const settings = await store.readProject();
    const link = `${origin(req)}/app/reset?token=${issued.token}`;
    const outcome = await mail.send(mail.resetMessage({ to: issued.user.email, link, projectName: settings.name }), settings.mail);
    if (!outcome.delivered) auth.rememberLink(issued.user.id, 'reset', link);
    return { sent: outcome.delivered, link: outcome.delivered ? undefined : link };
  })());
});

app.post('/api/users/:id/password', requireAdmin, (req, res) => {
  send(res, (async () => {
    auth.setPassword(req.params.id, (req.body || {}).password);
    return { ok: true };
  })());
});

app.delete('/api/users/:id', requireAdmin, (req, res) => send(res, auth.deleteUser(req.params.id)));

// --- API keys, Administrators only: what a caller outside sends to an API ------------

app.get('/api/api-keys', requireAdmin, (req, res) => send(res, Promise.resolve().then(() => apiKeys.listKeys())));

// The key itself is in the answer once; it is not kept anywhere in the clear.
app.post('/api/api-keys', requireAdmin, (req, res) => {
  const { name, role } = req.body || {};
  send(res, apiKeys.createKey({ name, role, createdBy: req.user.id }));
});

app.delete('/api/api-keys/:id', requireAdmin, (req, res) => send(res, Promise.resolve().then(() => apiKeys.deleteKey(req.params.id))));

// --- Secrets, Administrators only: the values of the secrets the design defines ---------
// Values only - a secret's name and description are the design's, changed in the designer.

app.use('/api/secrets', requireAdmin, secretsRouter());

// --- the project's own APIs: server functions at /api/<route> ---------------------------
// A router of its own, mounted at /api by the runner: the registry decides who may call each
// one, and whatever no API answers is a JSON 404 here.

export const endpoints = express.Router();
endpoints.use(attachUser);
endpoints.use((req, res, next) => apis.router(req, res, next));
endpoints.use((req, res) => res.status(404).json({ error: { message: `No API answers ${req.method} ${req.path}.` } }));

// --- the pages ---------------------------------------------------------------

const page = path.join(config.rootDir, 'public', 'app.html');
const AUTH_PAGES = new Set(['login', 'register', 'reset', 'invite']);

app.get('/', requireUser({ page: true }), (req, res) => res.sendFile(page));

app.get('/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    if (AUTH_PAGES.has(name)) {
      // Nothing to sign into, or already signed in: straight to the app.
      if (!authEnabled() || (req.user && name === 'login')) {
        res.redirect(safeNext(req.query.next));
        return;
      }
      res.sendFile(page);
      return;
    }
    if (name === 'users' || name === 'api-keys' || name === 'secrets') {
      requireUser({ page: true })(req, res, () => res.sendFile(page));
      return;
    }
    store.assertQualified(name);
    if (!(await store.exists('forms', name))) {
      res.status(404).send(`Form "${name}" does not exist.`);
      return;
    }
    requireUser({ page: true })(req, res, () => res.sendFile(page));
  } catch (err) {
    next(err);
  }
});
