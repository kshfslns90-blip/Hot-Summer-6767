// No shell: the form fills the page, as /run does. The contract is the same as the other
// shells so the entry point does not care which one it got. A small user pill appears when
// somebody is signed in, so sign-out is reachable.
import { lucideIcon } from './icons.js';

export function mountShell(root, ctx) {
  root.className = 'gd-shell-root gd-shell gd-shell-none';
  const host = document.createElement('div');
  host.className = 'gd-app-host';
  root.replaceChildren(host);

  let pill = null;
  return {
    host,
    setActive() {},
    setTitle() {},
    setUser(user) {
      pill?.remove();
      pill = null;
      if (!user) return;
      pill = document.createElement('div');
      pill.className = 'gd-shell-userpill';
      const name = document.createElement('span');
      name.textContent = user.name || user.email;
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'gd-shell-signout';
      out.title = 'Sign out';
      out.append(lucideIcon('log-out'));
      out.addEventListener('click', () => ctx.onSignOut?.());
      pill.append(name, out);
      root.append(pill);
    }
  };
}
