// Where the one line expressions in node properties are evaluated. A workflow carries no code of
// its own - anything beyond a one liner belongs in a server script, reached either through a Run
// Script node or by making the whole expression an callFunction(...) call, whose promise the
// evaluator awaits.
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { config } from '../config.js';

const nodeRequire = createRequire(import.meta.url);
const expressionCache = new Map();

export class ExpressionError extends Error {
  constructor(message, source) {
    super(message);
    this.name = 'ExpressionError';
    this.source = source;
  }
}

function sandboxRequire(id) {
  const bare = String(id).replace(/^node:/, '');
  if (!config.serverRequireAllow.includes(bare)) {
    throw new Error(`Module "${id}" is not allowed. Add it to serverRequireAllow in config.json.`);
  }
  return nodeRequire(bare);
}

// One scope per execution turn. `vars` is the instance state and is mutated in place, so an
// expression that writes to it is writing to the checkpoint that gets persisted.
export async function createScope(instance, services) {
  // vars and args are plain host objects; without a prototype an expression such as
  // vars.__proto__.x = 1 has nothing to pollute.
  if (instance.vars && typeof instance.vars === 'object') Object.setPrototypeOf(instance.vars, null);
  if (instance.args && typeof instance.args === 'object' && !Array.isArray(instance.args)) Object.setPrototypeOf(instance.args, null);
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    Promise,
    Error,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Map,
    Set,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Buffer,
    fetch,
    AbortController,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    structuredClone,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    require: sandboxRequire,
    vars: instance.vars,
    args: instance.args,
    workflow: instance.workflow,
    instanceId: instance.id,
    log: services.log,
    callFunction: services.callFunction,
    startWorkflow: services.startWorkflow,
    signalWorkflow: services.signalWorkflow
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox, { name: `workflow:${instance.workflow}` });
  return { context, sandbox };
}

function compile(source) {
  let script = expressionCache.get(source);
  if (script) return script;
  try {
    // Parenthesised so that an object literal reads as a value rather than a block.
    script = new vm.Script(`(${source}\n)`, { filename: 'workflow-expression' });
  } catch (err) {
    throw new ExpressionError(`${err.message} in expression: ${source}`, source);
  }
  expressionCache.set(source, script);
  return script;
}

// Locals are the values that only exist for this node - the loop item, an arriving signal, the
// result of the call that just returned. They are set on the context and cleared afterwards.
export async function evaluate(scope, source, locals = {}) {
  const text = String(source ?? '').trim();
  if (text === '') return undefined;

  const names = Object.keys(locals);
  const saved = names.map((n) => [n, n in scope.sandbox, scope.sandbox[n]]);
  for (const [name, value] of Object.entries(locals)) scope.sandbox[name] = value;
  try {
    return await compile(text).runInContext(scope.context);
  } catch (err) {
    if (err instanceof ExpressionError) throw err;
    throw new ExpressionError(`${err.message} in expression: ${text}`, text);
  } finally {
    for (const [name, had, value] of saved) {
      if (had) scope.sandbox[name] = value;
      else delete scope.sandbox[name];
    }
  }
}

export function clearCache() {
  expressionCache.clear();
}
