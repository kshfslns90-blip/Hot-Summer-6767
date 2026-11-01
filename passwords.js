// Passwords and one-time tokens, on node:crypto alone. A stored password is
// "scrypt$<salt>$<hash>", both base64; a token travels in the clear once (in a link or a
// cookie) and is kept hashed with sha256, so the database never holds anything that signs in.
import crypto from 'node:crypto';

const KEY_LENGTH = 64;
const MIN_PASSWORD = 8;

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    const err = new Error(`A password is at least ${MIN_PASSWORD} characters.`);
    err.status = 400;
    throw err;
  }
  if (password.length > 200) {
    const err = new Error('A password is at most 200 characters.');
    err.status = 400;
    throw err;
  }
}

export function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  let expected;
  try {
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), KEY_LENGTH);
  return crypto.timingSafeEqual(actual, expected);
}

// 32 random bytes, URL-safe - fit for a cookie or a link.
export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
