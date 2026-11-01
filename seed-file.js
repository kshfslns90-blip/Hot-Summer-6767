// The users seed as it lives in a project's schema file: the entries, their summary, the rules
// an entry must meet, and the adding and removing of one. All of it by file, with no database
// in sight, so the preview host can keep any project's seed from the designer's settings page;
// applying the seed to a users table is the running project's (seed.js).
import { readSchemaFile, writeSchemaEntryIn } from '../schema-file.js';
import { ADMIN_ROLE } from '../system-tables.js';
import { DEFAULTS } from '../settings.js';
import { hashPassword, validatePassword } from './passwords.js';
import { AuthError } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// `options.root`, when given, is the project folder the schema file must really be inside.
export function readUsersSeedFrom(file, options = {}) {
  const entry = readSchemaFile(file, options).tables.find((t) => t.name === 'users');
  return Array.isArray(entry?.seed) ? entry.seed.map((row) => ({ ...row })) : [];
}

export function writeUsersSeedTo(file, rows, options = {}) {
  writeSchemaEntryIn(file, 'users', rows.length ? { name: 'users', seed: rows } : null, options);
}

// What the designer shows: everything but the hash.
export function seedSummaryOf(rows) {
  return rows.map(({ passwordHash, ...rest }) => ({ ...rest, hasPassword: Boolean(passwordHash) }));
}

// The rules a seed entry must meet, checked before anything is written: a real email, a
// password of the required length, and a role that is one of the project's (blank means
// Administrator). Returns { email, role } as they will be stored.
export function validateSeedUser({ email, password, role } = {}, roles = DEFAULTS.auth.roles) {
  const cleaned = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleaned)) throw new AuthError('That is not a valid email address.');
  validatePassword(password);
  const cleanedRole = String(role ?? '').trim() || ADMIN_ROLE;
  if (!roles.includes(cleanedRole)) throw new AuthError(`"${cleanedRole}" is not one of the project's roles.`);
  return { email: cleaned, role: cleanedRole };
}

// Writes an entry, replacing one of the same email.
export function addSeedUserTo(file, entry, roles, options = {}) {
  const { email, role } = validateSeedUser(entry, roles);
  const row = { email, name: String(entry.name ?? '').trim().slice(0, 80), role, active: 1, passwordHash: hashPassword(entry.password) };
  const rows = readUsersSeedFrom(file, options).filter((r) => r.email !== email);
  rows.push(row);
  writeUsersSeedTo(file, rows, options);
  return seedSummaryOf(rows);
}

export function removeSeedUserFrom(file, email, options = {}) {
  const cleaned = String(email ?? '').trim().toLowerCase();
  const rows = readUsersSeedFrom(file, options).filter((r) => r.email !== cleaned);
  writeUsersSeedTo(file, rows, options);
  return seedSummaryOf(rows);
}

// How many entries carry the Administrator role: what a save with sign-in on keeps above zero.
export function seedAdminCount(rows) {
  return rows.filter((r) => (r.role || ADMIN_ROLE) === ADMIN_ROLE).length;
}
