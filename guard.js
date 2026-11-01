// The request side of authentication: who is behind the cookie, and what a route requires.
// With authentication off every guard is a pass-through, so the running app behaves exactly
// as it did before the feature existed.
import * as store from '../store.js';
import { sessionUser, createSession, deleteSession } from './service.js';
import { parseCookies, serializeCookie, SESSION_COOKIE } from './cookies.js';

export const COOKIE = SESSION_COOKIE;

export function authEnabled() {
  return Boolean(store.currentSettings()?.auth?.enabled);
}

function secure(req) {
  return req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';
}

export function attachUser(req, res, next) {
  req.user = null;
  req.sessionToken = null;
  if (!authEnabled()) {
    next();
    return;
  }
  try {
    const token = parseCookies(req.get('cookie'))[COOKIE] || null;
    const user = token ? sessionUser(token) : null;
    req.sessionToken = user ? token : null;
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// A safe place to send someone after signing in: only inside the app or the preview.
export function safeNext(value) {
  const next = String(value || '');
  return /^\/(app|run)(\/|\?|$)/.test(next) && !next.startsWith('//') ? next : '/app';
}

export function requireUser({ page = false } = {}) {
  return (req, res, next) => {
    if (!authEnabled() || req.user) {
      next();
      return;
    }
    if (page) {
      res.redirect(`/app/login?next=${encodeURIComponent(req.originalUrl || '/app')}`);
      return;
    }
    res.status(401).json({ error: { message: 'Sign in to continue.', code: 'unauthenticated' } });
  };
}

export function requireAdmin(req, res, next) {
  if (!authEnabled()) {
    res.status(404).json({ error: { message: 'Authentication is not enabled for this project.' } });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: { message: 'Sign in to continue.', code: 'unauthenticated' } });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: { message: 'Only an Administrator can do that.' } });
    return;
  }
  next();
}

export function startSession(req, res, userId) {
  const session = createSession(userId);
  res.setHeader('Set-Cookie', serializeCookie(COOKIE, session.token, { maxAge: session.maxAge, secure: secure(req) }));
  return session;
}

export function endSession(req, res) {
  if (req.sessionToken) deleteSession(req.sessionToken);
  res.setHeader('Set-Cookie', serializeCookie(COOKIE, '', { maxAge: 0, secure: secure(req) }));
}
