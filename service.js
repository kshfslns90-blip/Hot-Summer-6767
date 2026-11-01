// Users, sessions and the one-time links of authentication, on the users and sessions tables.
// Everything here is plain functions over db.js; the HTTP layer decides what to expose.
import { query, execute } from '../db.js';
import { readProject } from '../store.js';
import { ADMIN_ROLE } from '../system-tables.js';
import { hashPassword, verifyPassword, validatePassword, randomToken, hashToken } from './passwords.js';
import { AuthError } from './errors.js';

export { AuthError };

const SESSION_DAYS = 30;
const SESSION_BUMP_MS = 10 * 60 * 1000;
const RESET_HOURS = 1;
const INVITE_DAYS = 7;
const LOCK_AFTER = 5;
const LOCK_MS = 30 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let clock = () => Date.now();
export function setClock(fn) {
  clock = fn || (() => Date.now());
}
const now = () => clock();
const iso = (ms) => new Date(ms).toISOString();

function cleanEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(value) || value.length > 200) throw new AuthError('That is not a valid email address.');
  return value;
}

function cleanName(name) {
  return String(name ?? '').trim().slice(0, 80);
}

async function roles() {
  return (await readProject()).auth.roles;
}

async function cleanRole(role) {
  const list = await roles();
  const value = String(role ?? '').trim();
  if (!value) return list.includes('User') ? 'User' : list[list.length - 1];
  if (!list.includes(value)) throw new AuthError(`"${value}" is not one of the project's roles.`);
  return value;
}

// What leaves the service: never a hash, never a token.
export function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name || '',
    role: row.role,
    isAdmin: row.role === ADMIN_ROLE,
    active: Boolean(Number(row.active)),
    createdAt: row.createdAt || null,
    lastLoginAt: row.lastLoginAt || null,
    hasPassword: Boolean(row.passwordHash),
    invited: Boolean(row.inviteTokenHash) && !row.passwordHash
  };
}

function rowByEmail(email) {
  return query('SELECT * FROM users WHERE email = ?', [email])[0] || null;
}

function rowById(id) {
  return query('SELECT * FROM users WHERE id = ?', [Number(id)])[0] || null;
}

export function userById(id) {
  return publicUser(rowById(id));
}

export function userByEmail(email) {
  return publicUser(rowByEmail(String(email ?? '').trim().toLowerCase()));
}

export function listUsers() {
  return query('SELECT * FROM users ORDER BY createdAt, id').map((row) => ({ ...publicUser(row), pendingLink: pendingLinks.get(Number(row.id)) || null }));
}

export function adminCount() {
  const { n } = query('SELECT COUNT(*) AS n FROM users WHERE role = ? AND active = 1', [ADMIN_ROLE])[0];
  return Number(n);
}

// The rule the owner asked for: there is always an active Administrator. A change that would
// remove the last one - deleting, deactivating or demoting them - is refused.
function assertNotLastAdmin(row, change) {
  if (!row || row.role !== ADMIN_ROLE || !Number(row.active)) return;
  const { n } = query('SELECT COUNT(*) AS n FROM users WHERE role = ? AND active = 1 AND id <> ?', [ADMIN_ROLE, Number(row.id)])[0];
  if (Number(n) === 0) throw new AuthError(`${row.email} is the only active Administrator; ${change} would leave nobody to manage users.`, 409);
}

export async function createUser({ email, name, password, role, active = true } = {}) {
  const cleanedEmail = cleanEmail(email);
  if (rowByEmail(cleanedEmail)) throw new AuthError('A user with that email already exists.', 409);
  const passwordHash = password === undefined || password === null || password === '' ? null : hashPassword(password);
  const cleanedRole = await cleanRole(role);
  const result = execute(
    'INSERT INTO users (email, name, passwordHash, role, active, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    [cleanedEmail, cleanName(name), passwordHash, cleanedRole, active ? 1 : 0, iso(now())]
  );
  return publicUser(rowById(result.lastInsertRowid));
}

// --- signing in -----------------------------------------------------------

const lockouts = new Map(); // email -> { fails, until }

function checkLock(email) {
  const lock = lockouts.get(email);
  if (lock && lock.until > now()) throw new AuthError('Too many attempts; try again in half a minute.', 429);
}

function noteFailure(email) {
  const lock = lockouts.get(email) || { fails: 0, until: 0 };
  lock.fails += 1;
  if (lock.fails >= LOCK_AFTER) {
    lock.fails = 0;
    lock.until = now() + LOCK_MS;
  }
  lockouts.set(email, lock);
}

export function login(email, password) {
  let cleaned;
  try {
    cleaned = cleanEmail(email);
  } catch {
    throw new AuthError('Email or password is not right.', 401);
  }
  checkLock(cleaned);
  const row = rowByEmail(cleaned);
  if (!row || !row.passwordHash || !verifyPassword(password, row.passwordHash)) {
    noteFailure(cleaned);
    throw new AuthError('Email or password is not right.', 401);
  }
  if (!Number(row.active)) throw new AuthError('Your account is not active yet. An administrator has to activate it.', 403);
  lockouts.delete(cleaned);
  execute('UPDATE users SET lastLoginAt = ? WHERE id = ?', [iso(now()), row.id]);
  return publicUser(rowById(row.id));
}

// --- sessions -------------------------------------------------------------

// Every sign-in (password, registration, invitation, reset) comes through here, so the expired
// rows are swept on each one; the server does the same at start.
export function createSession(userId) {
  purgeExpiredSessions();
  const token = randomToken();
  const at = now();
  const expiresAt = iso(at + SESSION_DAYS * 86400000);
  execute('INSERT INTO sessions (tokenHash, userId, createdAt, expiresAt, lastSeenAt) VALUES (?, ?, ?, ?, ?)', [hashToken(token), Number(userId), iso(at), expiresAt, iso(at)]);
  return { token, expiresAt, maxAge: SESSION_DAYS * 86400 };
}

// The user behind a cookie, or null. Expired sessions are dropped on sight; a live one slides
// forward, written at most every ten minutes so a busy page does not hammer the table.
export function sessionUser(token) {
  if (!token) return null;
  const row = query(
    'SELECT s.id AS sessionId, s.expiresAt, s.lastSeenAt, u.* FROM sessions s JOIN users u ON u.id = s.userId WHERE s.tokenHash = ?',
    [hashToken(token)]
  )[0];
  if (!row) return null;
  const at = now();
  if (new Date(row.expiresAt).getTime() <= at) {
    execute('DELETE FROM sessions WHERE id = ?', [row.sessionId]);
    return null;
  }
  if (!Number(row.active)) return null;
  const seen = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;
  if (at - seen > SESSION_BUMP_MS) {
    execute('UPDATE sessions SET lastSeenAt = ?, expiresAt = ? WHERE id = ?', [iso(at), iso(at + SESSION_DAYS * 86400000), row.sessionId]);
  }
  return publicUser(row);
}

export function deleteSession(token) {
  if (!token) return;
  execute('DELETE FROM sessions WHERE tokenHash = ?', [hashToken(token)]);
}

export function deleteUserSessions(userId) {
  execute('DELETE FROM sessions WHERE userId = ?', [Number(userId)]);
}

export function purgeExpiredSessions() {
  return execute('DELETE FROM sessions WHERE expiresAt <= ?', [iso(now())]).changes;
}

// --- self-registration, reset, invitations --------------------------------

// The links that could not be emailed, kept for the Users page to show an administrator.
const pendingLinks = new Map(); // userId -> { kind, link, at }

export function rememberLink(userId, kind, link) {
  pendingLinks.set(Number(userId), { kind, link, at: iso(now()) });
}

export function forgetLink(userId) {
  pendingLinks.delete(Number(userId));
}

export async function register({ email, name, password } = {}) {
  const settings = (await readProject()).auth;
  if (settings.selfRegister !== 'open') throw new AuthError('This application is by invitation only.', 403);
  validatePassword(password);
  const user = await createUser({ email, name, password, role: undefined, active: settings.newUsersActive });
  return { user, active: user.active };
}

// Quiet by design: whether or not the address is known, the caller learns nothing. The token
// comes back for the route to mail, and is null for an unknown or inactive address.
export function requestReset(email) {
  let cleaned;
  try {
    cleaned = cleanEmail(email);
  } catch {
    return null;
  }
  const row = rowByEmail(cleaned);
  if (!row || !Number(row.active)) return null;
  return issueReset(row);
}

function issueReset(row) {
  const token = randomToken();
  execute('UPDATE users SET resetTokenHash = ?, resetTokenExpires = ? WHERE id = ?', [hashToken(token), iso(now() + RESET_HOURS * 3600000), row.id]);
  return { user: publicUser(row), token };
}

export function resetForUser(userId) {
  const row = rowById(userId);
  if (!row) throw new AuthError('That user does not exist.', 404);
  return issueReset(row);
}

export function resetPassword(token, password) {
  validatePassword(password);
  const row = query('SELECT * FROM users WHERE resetTokenHash = ?', [hashToken(String(token ?? ''))])[0];
  if (!row || !row.resetTokenExpires || new Date(row.resetTokenExpires).getTime() <= now()) {
    throw new AuthError('This link has expired or was already used - ask for a new one.', 400);
  }
  execute('UPDATE users SET passwordHash = ?, resetTokenHash = NULL, resetTokenExpires = NULL WHERE id = ?', [hashPassword(password), row.id]);
  deleteUserSessions(row.id);
  forgetLink(row.id);
  return publicUser(rowById(row.id));
}

export async function invite({ email, name, role } = {}) {
  const cleanedEmail = cleanEmail(email);
  let row = rowByEmail(cleanedEmail);
  if (row && row.passwordHash) throw new AuthError('A user with that email already exists.', 409);
  if (!row) {
    await createUser({ email: cleanedEmail, name, role, active: true });
    row = rowByEmail(cleanedEmail);
  }
  const token = randomToken();
  execute('UPDATE users SET inviteTokenHash = ?, inviteTokenExpires = ? WHERE id = ?', [hashToken(token), iso(now() + INVITE_DAYS * 86400000), row.id]);
  return { user: publicUser(rowById(row.id)), token };
}

function inviteRow(token) {
  const row = query('SELECT * FROM users WHERE inviteTokenHash = ?', [hashToken(String(token ?? ''))])[0];
  if (!row || !row.inviteTokenExpires || new Date(row.inviteTokenExpires).getTime() <= now()) return null;
  return row;
}

export function inviteInfo(token) {
  const row = inviteRow(token);
  return row ? { email: row.email, name: row.name || '' } : null;
}

export function acceptInvite(token, { name, password } = {}) {
  const row = inviteRow(token);
  if (!row) throw new AuthError('This invitation has expired or was already used - ask for a new one.', 400);
  validatePassword(password);
  execute(
    'UPDATE users SET passwordHash = ?, name = ?, active = 1, inviteTokenHash = NULL, inviteTokenExpires = NULL, lastLoginAt = ? WHERE id = ?',
    [hashPassword(password), cleanName(name) || row.name || '', iso(now()), row.id]
  );
  forgetLink(row.id);
  return publicUser(rowById(row.id));
}

// --- administration -------------------------------------------------------

export async function updateUser(userId, { email, name, role, active } = {}) {
  const row = rowById(userId);
  if (!row) throw new AuthError('That user does not exist.', 404);
  const next = { email: row.email, name: row.name, role: row.role, active: Number(row.active) };
  if (email !== undefined) {
    next.email = cleanEmail(email);
    const taken = rowByEmail(next.email);
    if (taken && Number(taken.id) !== Number(row.id)) throw new AuthError('Another user already has that email.', 409);
  }
  if (name !== undefined) next.name = cleanName(name);
  if (role !== undefined) {
    next.role = await cleanRole(role);
    if (next.role !== ADMIN_ROLE) assertNotLastAdmin(row, 'changing their role');
  }
  if (active !== undefined) {
    next.active = active ? 1 : 0;
    if (!next.active) assertNotLastAdmin(row, 'deactivating them');
  }
  execute('UPDATE users SET email = ?, name = ?, role = ?, active = ? WHERE id = ?', [next.email, next.name, next.role, next.active, row.id]);
  if (!next.active) deleteUserSessions(row.id);
  return publicUser(rowById(row.id));
}

export function setPassword(userId, password) {
  const row = rowById(userId);
  if (!row) throw new AuthError('That user does not exist.', 404);
  execute('UPDATE users SET passwordHash = ?, resetTokenHash = NULL, resetTokenExpires = NULL, inviteTokenHash = NULL, inviteTokenExpires = NULL, active = 1 WHERE id = ?', [hashPassword(password), row.id]);
  deleteUserSessions(row.id);
  forgetLink(row.id);
  return publicUser(rowById(row.id));
}

// `force` skips the last-Administrator rule: the designer's settings page may delete any
// account, since the project's seed is applied again right after.
export function deleteUser(userId, { force = false } = {}) {
  const row = rowById(userId);
  if (!row) throw new AuthError('That user does not exist.', 404);
  if (!force) assertNotLastAdmin(row, 'deleting them');
  deleteUserSessions(row.id);
  execute('DELETE FROM users WHERE id = ?', [row.id]);
  forgetLink(row.id);
  return publicUser(row);
}
