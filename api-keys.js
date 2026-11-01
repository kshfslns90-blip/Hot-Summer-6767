// API keys: the credentials a caller outside the app sends to an API. Deployment data, on the
// api_keys table of the project's runtime database - never in project.json, an export or a
// deployment zip - issued by the designer in development and by an Administrator on the API
// keys page of a deployed app. A key is shown once when created and kept as its sha256, like a
// session token; each key carries a role, so an API's roles mean the same for a key as for a
// user.
import { query, execute, reconcileApiKeys } from '../db.js';
import { readProject } from '../store.js';
import { randomToken, hashToken } from './passwords.js';
import { AuthError } from './service.js';

export const KEY_PREFIX = 'ak_';
const PREFIX_LENGTH = KEY_PREFIX.length + 8;
const NAME_MAX = 60;
const USE_BUMP_MS = 60_000;

let ready = false;
function ensureTable() {
  if (ready) return;
  reconcileApiKeys();
  ready = true;
}

// For tests that swap the database underneath.
export function resetApiKeys() {
  ready = false;
  lastBump.clear();
}

// What leaves the service: never the hash.
export function publicKey(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    prefix: row.prefix,
    role: row.role,
    createdAt: row.createdAt || null,
    createdBy: row.createdBy === null || row.createdBy === undefined ? null : Number(row.createdBy),
    lastUsedAt: row.lastUsedAt || null
  };
}

const iso = (ms) => new Date(ms).toISOString();

async function cleanRole(role) {
  const list = (await readProject()).auth.roles;
  const value = String(role ?? '').trim();
  if (!value) return list.includes('User') ? 'User' : list[list.length - 1];
  if (!list.includes(value)) throw new AuthError(`"${value}" is not one of the project's roles.`);
  return value;
}

function cleanName(name) {
  const value = String(name ?? '').trim();
  if (!value) throw new AuthError('A key needs a name.');
  if (value.length > NAME_MAX) throw new AuthError(`A key's name is at most ${NAME_MAX} characters.`);
  return value;
}

// The key itself comes back once, with its row; the caller shows it and forgets it.
export async function createKey({ name, role, createdBy = null } = {}) {
  ensureTable();
  const cleanedName = cleanName(name);
  const cleanedRole = await cleanRole(role);
  const key = `${KEY_PREFIX}${randomToken()}`;
  const result = execute(
    'INSERT INTO api_keys (name, prefix, keyHash, role, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?)',
    [cleanedName, key.slice(0, PREFIX_LENGTH), hashToken(key), cleanedRole, iso(Date.now()), createdBy === null || createdBy === undefined ? null : Number(createdBy)]
  );
  return { key, entry: keyById(result.lastInsertRowid) };
}

export function listKeys() {
  ensureTable();
  return query('SELECT * FROM api_keys ORDER BY createdAt, id').map(publicKey);
}

export function keyById(id) {
  ensureTable();
  return publicKey(query('SELECT * FROM api_keys WHERE id = ?', [Number(id)])[0] || null);
}

export function deleteKey(id) {
  ensureTable();
  const entry = keyById(id);
  if (!entry) throw new AuthError('That key does not exist.', 404);
  execute('DELETE FROM api_keys WHERE id = ?', [entry.id]);
  lastBump.delete(entry.id);
  return { id: entry.id, deleted: true };
}

// The key behind a token, or null. Its last use is written at most once a minute per key, so
// a busy caller does not turn every request into a write.
const lastBump = new Map();
export function verifyKey(token) {
  const value = String(token ?? '').trim();
  if (!value.startsWith(KEY_PREFIX)) return null;
  ensureTable();
  const row = query('SELECT * FROM api_keys WHERE keyHash = ?', [hashToken(value)])[0];
  if (!row) return null;
  const at = Date.now();
  if (at - (lastBump.get(Number(row.id)) || 0) > USE_BUMP_MS) {
    execute('UPDATE api_keys SET lastUsedAt = ? WHERE id = ?', [iso(at), Number(row.id)]);
    lastBump.set(Number(row.id), at);
    row.lastUsedAt = iso(at);
  }
  return publicKey(row);
}

// The key a request carries: "Authorization: Bearer <key>" or "X-Api-Key: <key>"; null when
// it carries none. A token that is present but unknown is reported apart from none at all, so
// the caller can say "invalid key" rather than "no key".
export function keyFromHeaders(headers) {
  const get = (name) => {
    const value = headers && (typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()]);
    return value === undefined || value === null ? '' : String(value);
  };
  const auth = get('authorization');
  const bearer = /^\s*bearer\s+(\S+)\s*$/i.exec(auth);
  const token = bearer ? bearer[1] : get('x-api-key').trim();
  if (!token) return { token: null, key: null };
  return { token, key: verifyKey(token) };
}
