// Where the runtime talks to the server. The running app - the shell and the form preview
// alike - uses /app/api, the surface the project's authentication guards; the designer keeps
// its own /api. A request refused for want of a session is reported through one hook, so the
// page can send the user to the login screen wherever the call came from.
let base = '/app/api';
let unauthorized = null;

export function apiBase() {
  return base;
}

export function setApiBase(next) {
  base = next;
}

export function onUnauthorized(fn) {
  unauthorized = fn;
}

// Called with the failed response's body when the server answered 401 for a missing session.
export function reportUnauthorized(body) {
  if (body?.error?.code === 'unauthenticated' && unauthorized) unauthorized(body);
}

// A form's layout and code behind, as the server stores them: what the shell opens, a modal
// shows, a popup floats and a Frame embeds.
//
// In the application (/app/api) each form is fetched once per page and kept: forms do not
// change while the app runs, and the map goes with the tab. Every hit hands out a copy of the
// layout, since a running form writes into its tree. The form preview at /run keeps fetching,
// so the designer always shows the latest save.
const forms = new Map();

async function fetchForm(name) {
  const response = await fetch(`${apiBase()}/forms/${encodeURIComponent(name)}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) reportUnauthorized(data);
    throw new Error(data.error?.message || `Form "${name}" could not be loaded.`);
  }
  return response.json();
}

export async function loadForm(name) {
  if (apiBase() !== '/app/api') return fetchForm(name);
  // The pending fetch is what is kept, so two opens in flight share one request; a failure
  // is forgotten, so the next open tries again.
  if (!forms.has(name)) {
    forms.set(name, fetchForm(name).catch((err) => {
      forms.delete(name);
      throw err;
    }));
  }
  const doc = await forms.get(name);
  return { ...doc, layout: structuredClone(doc.layout) };
}
