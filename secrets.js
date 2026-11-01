// The secrets' routes, one router for both surfaces that manage them (see ../secrets.js): the
// designer's Secrets panel, behind the runner's token, with `definitions` - a secret's name and
// description are design, so only the designer adds, renames, describes or deletes one - and
// the app's Secrets page for Administrators, which sets values only. No answer carries a value.
import express from 'express';
import * as secrets from '../secrets.js';

function send(res, run) {
  Promise.resolve()
    .then(run)
    .then(
      (value) => res.json(value),
      (err) => {
        const error = { message: err.message };
        for (const key of ['field', 'code', 'unreadable']) if (err[key] !== undefined) error[key] = err[key];
        res.status(err.status || 500).json({ error });
      }
    );
}

export function secretsRouter({ definitions = false } = {}) {
  const router = express.Router();

  router.get('/', (req, res) => send(res, () => secrets.listSecrets()));

  router.put('/:name/value', (req, res) => send(res, () => secrets.setSecretValue(req.params.name, (req.body || {}).value)));

  // The way out when values can't be opened; `expect` is the count the person confirmed.
  router.post('/reset-unreadable', (req, res) => send(res, () => secrets.resetUnreadable({ expect: (req.body || {}).expect })));

  if (definitions) {
    router.post('/', (req, res) => {
      const { name, description, value } = req.body || {};
      send(res, () => secrets.defineSecret({ name, description, value }));
    });
    router.patch('/:name', (req, res) => {
      const { name, description } = req.body || {};
      send(res, () => secrets.updateSecret(req.params.name, { name, description }));
    });
    router.delete('/:name', (req, res) => send(res, () => secrets.deleteSecret(req.params.name)));
  }

  return router;
}
