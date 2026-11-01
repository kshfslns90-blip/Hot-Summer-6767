// server.require('customers') in a code behind (also require('server:customers') and a
// 'server:customers' import): a server script as an object whose members call its functions on
// the server. Nothing is fetched up front - the object is a proxy, and
// `await customers.list(filter)` becomes server.callFunction('customers.list', [filter]). The
// name is the script's, with its module in front when it is in another one ('Utils.customers');
// the caller completes a bare name with its own module.
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;

// Members that must not turn into server calls: a promise check (`then`), JSON.stringify's
// probe, and the constructor lookup some tools make.
const INERT = new Set(['then', 'toJSON', 'constructor']);

export function serverModule(name, call) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`server.require() needs a server script name, such as server.require('customers') or server.require('Utils.customers'); got ${JSON.stringify(name)}.`);
  }
  return new Proxy(Object.create(null), {
    get(_, member) {
      if (typeof member !== 'string' || INERT.has(member)) return undefined;
      return (...args) => call(`${name}.${member}`, args);
    },
    has(_, member) {
      return typeof member === 'string' && !INERT.has(member);
    }
  });
}
