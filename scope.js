// Compiles a form code behind. The user writes loose JavaScript with top level handlers, the
// way the mockup shows it, and gets the form services injected as ordinary identifiers.
import { scanTopLevelNames, scanTopLevelBindings, scanRequires } from './names.js';
import { preload, requireClientScript } from './client-modules.js';
import { lowerModules } from './esm-lite.js';
import { widgetConstructors } from './widgets.js';
import { qualify } from './modules.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const SERVICES = [
  'require',
  'server',
  'showMessage',
  'showConfirm',
  'showPrompt',
  'showToast',
  'form',
  'app',
  'context',
  '__ctl'
];

// Everything injected into a code behind: the services plus the widget constructors (Button,
// Label, ...). Computed on demand because the widget registry fills up as widget-defs loads.
export function reservedNames() {
  return [...SERVICES, ...widgetConstructors().map((w) => w.name)];
}

// `module` is the form's: a bare name in require() (or an import) means a client script of
// that module, 'Utils.format' one of another.
export async function compileCodeBehind(source, { formName, module, controlIds, services }) {
  // import syntax lowers to require() first, so the preload scan and the handler scan both see
  // plain declarations. A code behind exports nothing, so no export tail is emitted.
  // 'server:name' imports lower onto require('server:name'); they are for code behinds only.
  source = lowerModules(source || '', { exports: false, server: true }).code;
  // require('utils') is a client script of this module ('Utils.format' one of another);
  // require('server:customers') is the server script as an object, what server.require('customers') gives.
  const require = (name) => {
    const remote = /^server:(.*)$/.exec(String(name));
    return remote ? services.server.require(remote[1]) : requireClientScript(qualify(name, module));
  };
  await preload(scanRequires(source).map((name) => qualify(name, module)));

  const declared = scanTopLevelNames(source);
  // A control binding must not repeat a name the code declares - including one taken out of
  // an import, `const { add } = server.require('math')`, which the export scan does not list.
  const declaredSet = new Set(scanTopLevelBindings(source));
  const injected = reservedNames();

  // The control bindings sit after the user's code so that line numbers keep matching the
  // editor. They still work: the body runs once up front, handlers only fire later.
  const bindings = (controlIds || [])
    .filter((id) => !declaredSet.has(id) && /^[A-Za-z_$][\w$]*$/.test(id) && !injected.includes(id))
    .map((id) => `const ${id} = __ctl[${JSON.stringify(id)}];`)
    .join('\n');

  const exported = [...declared, ...(controlIds || []).filter((id) => !declaredSet.has(id))];
  const body = [
    source || '',
    '',
    bindings,
    `return { ${exported.map((n) => `${JSON.stringify(n)}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`,
    `//# sourceURL=forms/${formName}.js`
  ].join('\n');

  let factory;
  try {
    factory = new AsyncFunction(...injected, body);
  } catch (err) {
    throw new Error(`Code behind of form "${formName}" failed to compile: ${err.message}`);
  }

  const args = injected.map((name) => (name === 'require' ? require : services[name]));
  return factory(...args);
}
