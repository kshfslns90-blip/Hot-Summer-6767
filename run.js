// The form preview: /run/<Module.Form> shows one form on its own, and /run/api is the surface
// that page talks to. It is a developer's tool: under the preview host every request here has
// already passed the project's preview session, which the host states in a header, and the
// app's own sign-in is not asked for - scripts see `user` as null. Standalone, with no host in
// front, the preview asks for the app's sign-in like the shell does.
import express from 'express';
import path from 'node:path';
import { config } from '../config.js';
import * as store from '../store.js';
import { attachUser, authEnabled } from '../auth/guard.js';
import { readFormHandler, readClientScriptHandler, execHandler, uploadHandlers, chunkBody, downloadHandler } from './app.js';
import { previewVouched } from '../runner-trust.js';

export const run = express.Router();

run.use(attachUser);

// Passes with sign-in off, an app user, or a preview session vouched for by the host - a mark
// that counts only when it comes with the runner's own secret. Without a secret there is no
// host to vouch for anything (a deployed app, a runner started by hand), so the mark is ignored
// and the preview asks for the app's sign-in like everything else.
function previewGuard({ page = false } = {}) {
  return (req, res, next) => {
    if (!authEnabled() || req.user || previewVouched(req)) {
      next();
      return;
    }
    if (page) res.redirect(`/app/login?next=${encodeURIComponent(req.originalUrl || '/app')}`);
    else res.status(401).json({ error: { message: 'Sign in to continue.', code: 'unauthenticated' } });
  };
}

run.get('/api/forms/:name', previewGuard(), readFormHandler);
run.get('/api/client-scripts/:name', previewGuard(), readClientScriptHandler);
run.post('/api/exec/:target', previewGuard(), execHandler);
run.post('/api/uploads', previewGuard(), uploadHandlers.create);
run.put('/api/uploads/:batchId/:uploadId/:index', previewGuard(), chunkBody, uploadHandlers.chunk);
run.get('/api/uploads/:batchId', previewGuard(), uploadHandlers.state);
run.post('/api/uploads/:batchId/complete', previewGuard(), uploadHandlers.complete);
run.delete('/api/uploads/:batchId', previewGuard(), uploadHandlers.abort);
run.get('/api/download/:target', previewGuard(), downloadHandler);

// The page; the form name in the URL tells it where to start.
run.get('/:name', previewGuard({ page: true }), async (req, res, next) => {
  try {
    store.assertQualified(req.params.name);
    if (!(await store.exists('forms', req.params.name))) {
      res.status(404).send(`Form "${req.params.name}" does not exist.`);
      return;
    }
    res.sendFile(path.join(config.rootDir, 'public', 'run.html'));
  } catch (err) {
    next(err);
  }
});
