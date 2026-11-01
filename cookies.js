// Just enough cookie handling for one session cookie: parse the header, build a Set-Cookie
// value. No dependency for two functions.

// The running app's own session cookie (auth/guard.js); named here, with no store behind it, so
// the platform can recognise it in a runner's response without loading the runtime's auth.
export const SESSION_COOKIE = 'gd_session';

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (!name) continue;
    let value = part.slice(at + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

// { maxAge } in seconds; 0 or a negative value clears the cookie. `partitioned` files the cookie
// under the site of the top-level page (CHIPS): it is only ever sent in frames under that site.
export function serializeCookie(name, value, { maxAge, secure = false, path = '/', sameSite = 'Lax', httpOnly = true, partitioned = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value ?? '')}`];
  parts.push(`Path=${path}`);
  if (httpOnly) parts.push('HttpOnly');
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push('Secure');
  if (partitioned) parts.push('Partitioned');
  if (typeof maxAge === 'number') {
    if (maxAge <= 0) {
      parts.push('Max-Age=0');
      parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    } else parts.push(`Max-Age=${Math.floor(maxAge)}`);
  }
  return parts.join('; ');
}
