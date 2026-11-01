// The pages of authentication: sign in, create an account, ask for a reset link, choose a new
// password, accept an invitation. Built-in, drawn in the template the project picked
// (classic: a card in the middle; split: words on the left, the card on the right; cover: the
// card over the accent colour), tinted with the project's accent.
import { lucideIcon } from './icons.js';

function el(tag, className, props = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.assign(node, props);
  return node;
}

async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Something went wrong.');
  return data;
}

function field(form, { name, label, type = 'text', value = '', autocomplete, autofocus = false, required = true }) {
  const wrap = el('label', 'gd-auth-field');
  wrap.append(el('span', null, { textContent: label }));
  const input = el('input', null, { name, type, value, required, autocomplete: autocomplete || 'off' });
  if (autofocus) input.autofocus = true;
  wrap.append(input);
  form.append(wrap);
  return input;
}

// A card with a title, fields and one primary button; `submit(values)` does the work and
// returns where to go, or a message to show instead.
function card(root, { title, intro, fields, button, links = [], submit, template, settings }) {
  root.className = `gd-auth gd-auth-${template}`;
  root.style.setProperty('--gd-accent', settings.auth?.accent || '#2f6fd0');
  const heroTitle = settings.auth?.title || settings.project.name;
  const tagline = settings.auth?.tagline || '';

  const hero = el('div', 'gd-auth-hero');
  hero.append(el('div', 'gd-auth-herotitle', { textContent: heroTitle }));
  if (tagline) hero.append(el('div', 'gd-auth-tagline', { textContent: tagline }));

  const panel = el('div', 'gd-auth-panel');
  const box = el('form', 'gd-auth-card');
  box.noValidate = true;
  const brand = el('div', 'gd-auth-brand');
  if (settings.project.logo) {
    brand.classList.add('gd-auth-brand-logo');
    brand.append(el('img', 'gd-shell-logo', { src: settings.project.logo, alt: settings.project.name, draggable: false }));
  } else brand.append(lucideIcon('lock-keyhole'), el('span', null, { textContent: settings.project.name }));
  box.append(brand, el('h1', 'gd-auth-title', { textContent: title }));
  if (intro) box.append(el('p', 'gd-auth-intro', { textContent: intro }));
  const inputs = {};
  for (const spec of fields) inputs[spec.name] = field(box, spec);
  const error = el('div', 'gd-auth-error');
  error.hidden = true;
  const notice = el('div', 'gd-auth-notice');
  notice.hidden = true;
  const primary = el('button', 'gd-auth-button', { type: 'submit', textContent: button });
  box.append(error, notice, primary);
  if (links.length) {
    const row = el('div', 'gd-auth-links');
    for (const { text, href } of links) row.append(el('a', null, { textContent: text, href }));
    box.append(row);
  }
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const values = Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value]));
    for (const spec of fields) {
      if (spec.required !== false && !values[spec.name].trim()) {
        error.textContent = `${spec.label} is required.`;
        error.hidden = false;
        inputs[spec.name].focus();
        return;
      }
    }
    primary.disabled = true;
    try {
      const outcome = await submit(values);
      if (outcome && outcome.go) location.assign(outcome.go);
      else if (outcome && outcome.message) {
        box.querySelectorAll('.gd-auth-field, .gd-auth-button, .gd-auth-links').forEach((n) => {
          n.hidden = true;
        });
        notice.textContent = outcome.message;
        notice.hidden = false;
        if (outcome.links) {
          const row = el('div', 'gd-auth-links');
          for (const { text, href } of outcome.links) row.append(el('a', null, { textContent: text, href }));
          box.append(row);
        }
      }
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      primary.disabled = false;
    }
  });
  panel.append(box);
  root.replaceChildren(hero, panel);
  const first = box.querySelector('input');
  first?.focus();
}

export function renderAuthPage(root, { page, settings, token = '', next = '' }) {
  const template = settings.auth?.template || 'classic';
  const to = next || '/app';
  const canRegister = settings.auth?.selfRegister === 'open';
  const registerLink = canRegister ? [{ text: 'Create an account', href: '/app/register' }] : [];
  document.title = `${settings.project.name} - sign in`;

  if (page === 'login') {
    const intro = settings.auth?.noAdmin ? 'Nobody can sign in yet: the developer has to create the first administrator in the designer.' : '';
    card(root, {
      title: 'Sign in',
      intro,
      template,
      settings,
      fields: [
        { name: 'email', label: 'Email', type: 'email', autocomplete: 'username', autofocus: true },
        { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' }
      ],
      button: 'Sign in',
      links: [{ text: 'Forgot your password?', href: '/app/reset' }, ...registerLink],
      submit: async ({ email, password }) => {
        await post('/app/api/auth/login', { email, password });
        return { go: to };
      }
    });
    return;
  }

  if (page === 'register') {
    if (!canRegister) {
      card(root, { title: 'By invitation only', intro: 'Ask an administrator to invite you.', template, settings, fields: [], button: 'Back to sign in', submit: async () => ({ go: '/app/login' }) });
      return;
    }
    document.title = `${settings.project.name} - create an account`;
    card(root, {
      title: 'Create an account',
      template,
      settings,
      fields: [
        { name: 'name', label: 'Your name', autocomplete: 'name', autofocus: true },
        { name: 'email', label: 'Email', type: 'email', autocomplete: 'username' },
        { name: 'password', label: 'Password (8 characters or more)', type: 'password', autocomplete: 'new-password' }
      ],
      button: 'Create account',
      links: [{ text: 'I already have an account', href: '/app/login' }],
      submit: async ({ name, email, password }) => {
        const { active } = await post('/app/api/auth/register', { name, email, password });
        if (active) return { go: to };
        return { message: 'Your account is created and waiting for an administrator to activate it. You will be able to sign in once that is done.', links: [{ text: 'Back to sign in', href: '/app/login' }] };
      }
    });
    return;
  }

  if (page === 'reset' && !token) {
    card(root, {
      title: 'Reset your password',
      intro: 'Type your email and, if it belongs to an account, a link to choose a new password is sent to it.',
      template,
      settings,
      fields: [{ name: 'email', label: 'Email', type: 'email', autocomplete: 'username', autofocus: true }],
      button: 'Send the link',
      links: [{ text: 'Back to sign in', href: '/app/login' }],
      submit: async ({ email }) => {
        await post('/app/api/auth/request-reset', { email });
        return { message: 'If that email belongs to an account, the link is on its way. It works for one hour.', links: [{ text: 'Back to sign in', href: '/app/login' }] };
      }
    });
    return;
  }

  if (page === 'reset') {
    card(root, {
      title: 'Choose a new password',
      template,
      settings,
      fields: [
        { name: 'password', label: 'New password (8 characters or more)', type: 'password', autocomplete: 'new-password', autofocus: true },
        { name: 'again', label: 'The same again', type: 'password', autocomplete: 'new-password' }
      ],
      button: 'Save the password',
      submit: async ({ password, again }) => {
        if (password !== again) throw new Error('The two passwords differ.');
        await post('/app/api/auth/reset', { token, password });
        return { message: 'Your password is changed. Sign in with it.', links: [{ text: 'Sign in', href: '/app/login' }] };
      }
    });
    return;
  }

  if (page === 'invite') {
    (async () => {
      const response = await fetch(`/app/api/auth/invite/${encodeURIComponent(token)}`);
      if (!response.ok) {
        card(root, { title: 'This invitation is no longer valid', intro: 'It may have expired or been used already. Ask for a new one.', template, settings, fields: [], button: 'Back to sign in', submit: async () => ({ go: '/app/login' }) });
        return;
      }
      const info = await response.json();
      card(root, {
        title: 'Welcome',
        intro: `You are invited as ${info.email}. Choose your name and a password to get started.`,
        template,
        settings,
        fields: [
          { name: 'name', label: 'Your name', value: info.name, autocomplete: 'name', autofocus: true },
          { name: 'password', label: 'Password (8 characters or more)', type: 'password', autocomplete: 'new-password' }
        ],
        button: 'Join',
        submit: async ({ name, password }) => {
          await post('/app/api/auth/accept-invite', { token, name, password });
          return { go: '/app' };
        }
      });
    })();
    return;
  }

  card(root, { title: 'Not found', template, settings, fields: [], button: 'Back to sign in', submit: async () => ({ go: '/app/login' }) });
}
