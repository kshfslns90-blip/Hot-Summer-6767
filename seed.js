// The users table's seed: the users a project carries with it - one Administrator at least,
// and any other role the project knows - in the schema file next to every other table's seed
// rows. A seed row holds the password's hash, never the password. It is applied wherever the
// users table has no active Administrator - a fresh server, an import, sign-in just switched
// on - and never touches accounts that exist. The one exception is the developer's own
// machine: an entry made in Project settings for an account that already exists there sets
// that account's password and role (syncSeedUserHere).
//
// The seed file itself - reading, checking, adding and removing entries - is seed-file.js, by
// file, which the preview host uses for any project; this module is this process's own
// project's view of it, plus what only a running project can do: apply the seed to its table.
import { config } from '../config.js';
import { query, execute } from '../db.js';
import { ADMIN_ROLE } from '../system-tables.js';
import { userByEmail, setPassword, adminCount } from './service.js';
import { readUsersSeedFrom, writeUsersSeedTo, seedSummaryOf, validateSeedUser, addSeedUserTo, removeSeedUserFrom, seedAdminCount as adminsIn } from './seed-file.js';

export { validateSeedUser };

export function readUsersSeed() {
  return readUsersSeedFrom(config.dbSchemaFile);
}

export function writeUsersSeed(rows) {
  writeUsersSeedTo(config.dbSchemaFile, rows);
}

// What the designer shows: everything but the hash.
export function seedSummary() {
  return seedSummaryOf(readUsersSeed());
}

// Is the users table there? It appears when sign-in is first saved on.
export function usersTableExists() {
  return query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").length > 0;
}

// Writes an entry, replacing one of the same email.
export function addSeedUser(entry, roles) {
  return addSeedUserTo(config.dbSchemaFile, entry, roles);
}

export function removeSeedUser(email) {
  return removeSeedUserFrom(config.dbSchemaFile, email);
}

// How many entries carry the Administrator role: what a save with sign-in on keeps above zero.
export function seedAdminCount(rows = readUsersSeed()) {
  return adminsIn(rows);
}

// A seed entry made on this machine for an account that already exists here: the account gets
// that password (its sessions end, pending links die), the entry's role and, when one was
// typed, the name. Returns the account, or null when there is none (or no table).
export function syncSeedUserHere(entry, roles) {
  const { email, role } = validateSeedUser(entry, roles);
  if (!usersTableExists()) return null;
  const existing = userByEmail(email);
  if (!existing) return null;
  setPassword(existing.id, entry.password);
  const cleanedName = String(entry.name ?? '').trim().slice(0, 80);
  if (cleanedName) execute('UPDATE users SET role = ?, name = ? WHERE id = ?', [role, cleanedName, existing.id]);
  else execute('UPDATE users SET role = ? WHERE id = ?', [role, existing.id]);
  return userByEmail(email);
}

// Inserts the seed rows whose email is absent, only while there is no active Administrator.
// Returns the emails inserted.
export function applyUsersSeed() {
  const rows = readUsersSeed();
  if (!rows.length) return [];
  if (!usersTableExists()) return [];
  if (adminCount() > 0) return [];
  const inserted = [];
  for (const row of rows) {
    if (!row.email || !row.passwordHash) continue;
    if (userByEmail(row.email)) continue;
    execute('INSERT INTO users (email, name, passwordHash, role, active, createdAt) VALUES (?, ?, ?, ?, 1, ?)', [
      row.email,
      row.name || '',
      row.passwordHash,
      row.role || ADMIN_ROLE,
      new Date().toISOString()
    ]);
    inserted.push(row.email);
  }
  return inserted;
}

// The apply, logged, for the boot, import and switch-on paths.
export function applyUsersSeedLogged() {
  try {
    for (const email of applyUsersSeed()) console.log(`[auth] seeded administrator ${email}`);
  } catch (err) {
    console.error(`[auth] the users seed could not be applied: ${err.message}`);
  }
}
