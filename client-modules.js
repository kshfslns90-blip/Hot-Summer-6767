// Client scripts behave like small CommonJS modules. A code behind pulls one in with
// require('name'), which has to answer synchronously, so every module a form can reach is
// fetched and evaluated before the code behind runs. A script may be written either way -
// module.exports/require or import/export - the modern syntax is lowered onto require at load.
// Scripts are keyed by their qualified name, "Module.script"; a bare name in a require() is
// completed with the module of the script (or form) that asks.
import { scanRequires, scanTopLevelNames } from './names.js';
import { lowerModules } from './esm-lite.js';
import { apiBase, reportUnauthorized } from './endpoints.js';
import { qualify, splitQualified, scriptContext } from './modules.js';

const modules = new Map();
const sources = new Map();

async function fetchSource(name) {
  if (sources.has(name)) return sources.get(name);
  const response = await fetch(`${apiBase()}/client-scripts/${encodeURIComponent(name)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) reportUnauthorized(body);
    throw new Error(body.error?.message || `Client script "${name}" could not be loaded.`);
  }
  const { code } = await response.json();
  const lowered = lowerModules(code).code;
  sources.set(name, lowered);
  return lowered;
}

// The names a script requires, each completed with that script's own module.
function requiresOf(name, source) {
  const { module } = splitQualified(name);
  return scanRequires(source).map((n) => qualify(n, module));
}

// Walks the require graph breadth first so that cycles do not turn into infinite fetching.
// The names are qualified; a code behind qualifies its own before calling.
export async function preload(names, seen = new Set()) {
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const source = await fetchSource(name);
    await preload(requiresOf(name, source), seen);
  }
  return seen;
}

export function requireClientScript(name) {
  if (modules.has(name)) return modules.get(name).exports;
  const source = sources.get(name);
  if (source === undefined) {
    throw new Error(
      `Client script "${name}" was not preloaded. require() only accepts a plain string literal.`
    );
  }
  const module = { exports: {} };
  modules.set(name, module);
  try {
    // Every top-level declaration is exported by itself, as in a server script; an explicit
    // export (the export keyword, or module.exports) says the same thing and wins on a clash.
    const tail = scanTopLevelNames(source)
      .map((n) => `try { if (!(${JSON.stringify(n)} in module.exports)) module.exports[${JSON.stringify(n)}] = ${n}; } catch (e) {}`)
      .join('\n');
    // `context` says where this script lives - its own module, whoever required it.
    const factory = new Function('module', 'exports', 'require', 'context', `${source}\n;{\n${tail}\n}\n//# sourceURL=client-scripts/${name}.js`);
    const own = splitQualified(name).module;
    // A client script reaches other client scripts only; 'server:name' belongs to a code behind.
    const require = (other) => {
      if (/^server:/.test(String(other))) throw new Error(`${JSON.stringify(other)}: server scripts can be required from a code behind only`);
      return requireClientScript(qualify(other, own));
    };
    factory(module, module.exports, require, scriptContext('client-script', name));
  } catch (err) {
    modules.delete(name);
    throw new Error(`Client script "${name}" failed: ${err.message}`);
  }
  return module.exports;
}

// The designer saves a script, the runtime must not keep the old copy.
export function invalidate(name) {
  if (name === undefined) {
    modules.clear();
    sources.clear();
  } else {
    modules.delete(name);
    sources.delete(name);
  }
}
