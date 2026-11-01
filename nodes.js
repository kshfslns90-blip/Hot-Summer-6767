// The workflow node catalogue. Shared by the designer - palette, canvas, property grid - and by
// the engine on the server, so there is one definition of what a node is and what it carries.

const registry = new Map();

function register(def) {
  registry.set(def.type, {
    category: 'Action',
    inputs: true,
    outputs: [{ name: 'out' }],
    props: [],
    ...def
  });
}

export function nodeDef(type) {
  const def = registry.get(type);
  if (!def) throw new Error(`Unknown workflow node type "${type}".`);
  return def;
}

export function hasNode(type) {
  return registry.has(type);
}

export function nodeDefs() {
  return [...registry.values()];
}

export function paletteNodes() {
  return nodeDefs().filter((d) => d.palette !== false);
}

export function defaultPropsOf(type) {
  const out = {};
  for (const p of nodeDef(type).props) if (p.default !== undefined) out[p.name] = p.default;
  return out;
}

// Nodes that can fail get a second output, so the canvas shows the error path explicitly.
export function outputsOf(node) {
  const def = nodeDef(node.type);
  const outputs = typeof def.outputs === 'function' ? def.outputs(node) : def.outputs;
  return def.canFail ? [...outputs, { name: 'error', tone: 'error' }] : outputs;
}

// What the canvas prints under the node title, so the graph is readable without clicking.
export function subtitleOf(node) {
  const def = nodeDef(node.type);
  const text = def.subtitle ? def.subtitle(node.props || {}) : '';
  return text === undefined || text === null ? '' : String(text);
}

const DURATION = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/;
const UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };

// "30s", "5m", "2h", "3d", or a plain number of milliseconds.
export function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const match = DURATION.exec(String(value ?? ''));
  if (!match) return null;
  return Math.max(0, Number(match[1]) * UNITS[match[2] || 'ms']);
}

register({
  type: 'start',
  label: 'Start',
  description: 'Where every run begins; the instance args land in scope.',
  category: 'Flow',
  palette: false,
  inputs: false,
  outputs: [{ name: 'out' }],
  props: [],
  subtitle: () => 'the instance args land in scope'
});

register({
  type: 'end',
  label: 'End',
  description: 'Finish the run, completed or failed, with an optional result.',
  category: 'Flow',
  outputs: [],
  props: [
    { name: 'status', type: 'enum', values: ['completed', 'failed'], default: 'completed' },
    { name: 'result', type: 'expression', default: '' }
  ],
  subtitle: (p) => (p.result ? `${p.status || 'completed'}: ${p.result}` : p.status || 'completed')
});

register({
  type: 'script',
  label: 'Run Script',
  description: 'Call a function of a server script (Module.script.fn) and keep its result in a variable.',
  category: 'Action',
  canFail: true,
  props: [
    { name: 'target', type: 'function', default: '' },
    { name: 'args', type: 'expression', default: '[]' },
    { name: 'assign', type: 'string', default: '' },
    { name: 'retries', type: 'number', default: 0 },
    { name: 'retryDelay', type: 'string', default: '30s' },
    // Heavy computation: the script runs on a worker thread, so it does not block the server.
    { name: 'heavy', type: 'bool', default: false }
  ],
  subtitle: (p) => `${p.target || '(no target)'}${p.assign ? ` → ${p.assign}` : ''}${p.heavy ? ' (heavy)' : ''}`
});

register({
  type: 'setVar',
  label: 'Set Variable',
  description: 'Assign one or more variables from expressions.',
  category: 'Action',
  props: [{ name: 'assignments', type: 'assignments', default: [] }],
  subtitle: (p) => {
    const rows = Array.isArray(p.assignments) ? p.assignments : [];
    if (rows.length === 0) return '(nothing set)';
    return rows.map((r) => `${r.name} = ${r.expression}`).join(', ');
  }
});

register({
  type: 'condition',
  label: 'Condition',
  description: 'Branch on a true / false expression.',
  category: 'Flow',
  outputs: [{ name: 'true', tone: 'yes' }, { name: 'false', tone: 'no' }],
  props: [{ name: 'expression', type: 'expression', default: '' }],
  subtitle: (p) => p.expression || '(always false)'
});

register({
  type: 'delay',
  label: 'Delay',
  description: 'Pause for a duration or until a moment, then carry on.',
  category: 'Wait',
  props: [
    { name: 'duration', type: 'string', default: '5m' },
    { name: 'until', type: 'expression', default: '' }
  ],
  subtitle: (p) => (p.until ? `until ${p.until}` : `wait ${p.duration || '0'}`)
});

register({
  type: 'waitSignal',
  label: 'Wait For Signal',
  description: 'Park until a named signal arrives, or a timeout passes.',
  category: 'Wait',
  outputs: [{ name: 'out' }, { name: 'timeout', tone: 'warn' }],
  props: [
    { name: 'signal', type: 'string', default: 'approved' },
    { name: 'timeout', type: 'string', default: '' },
    { name: 'assign', type: 'string', default: 'signal' }
  ],
  subtitle: (p) => `"${p.signal || ''}"${p.timeout ? `, times out after ${p.timeout}` : ''}`
});

register({
  type: 'forEach',
  label: 'For Each',
  description: 'Run the body once per item of a list.',
  category: 'Loop',
  loop: true,
  outputs: [{ name: 'body', tone: 'loop' }, { name: 'done' }],
  props: [
    { name: 'items', type: 'expression', default: '[]' },
    { name: 'itemVar', type: 'string', default: 'item' },
    { name: 'indexVar', type: 'string', default: 'index' }
  ],
  subtitle: (p) => `${p.itemVar || 'item'} of ${p.items || '[]'}`
});

register({
  type: 'while',
  label: 'While',
  description: 'Repeat the body while an expression stays true.',
  category: 'Loop',
  loop: true,
  outputs: [{ name: 'body', tone: 'loop' }, { name: 'done' }],
  props: [
    { name: 'expression', type: 'expression', default: '' },
    { name: 'indexVar', type: 'string', default: 'index' },
    { name: 'maxIterations', type: 'number', default: 1000 }
  ],
  subtitle: (p) => p.expression || '(never runs)'
});

register({
  type: 'parallel',
  label: 'Parallel',
  description: 'Fan out into branches and join on all or any.',
  category: 'Flow',
  join: true,
  outputs: (node) => {
    const count = Math.max(2, Number(node?.props?.branches) || 2);
    return [
      ...Array.from({ length: count }, (unused, i) => ({ name: `branch${i + 1}`, tone: 'branch' })),
      { name: 'done' }
    ];
  },
  props: [
    { name: 'branches', type: 'number', default: 2 },
    { name: 'join', type: 'enum', values: ['all', 'any'], default: 'all' }
  ],
  subtitle: (p) => `${p.branches || 2} branches, join on ${p.join || 'all'}`
});

register({
  type: 'callWorkflow',
  label: 'Call Workflow',
  description: 'Start another workflow, optionally waiting for it.',
  category: 'Action',
  canFail: true,
  props: [
    { name: 'workflow', type: 'string', default: '' },
    { name: 'args', type: 'expression', default: '{}' },
    { name: 'wait', type: 'bool', default: true },
    { name: 'assign', type: 'string', default: '' },
    { name: 'retries', type: 'number', default: 0 },
    { name: 'retryDelay', type: 'string', default: '30s' }
  ],
  subtitle: (p) => `${p.workflow || '(no workflow)'}${p.wait === false ? ', do not wait' : ', wait for it'}`
});

register({
  type: 'log',
  label: 'Log',
  description: 'Write a message to the run log.',
  category: 'Action',
  props: [
    { name: 'message', type: 'expression', default: "''" },
    { name: 'level', type: 'enum', values: ['info', 'warn', 'error'], default: 'info' }
  ],
  subtitle: (p) => p.message || "''"
});

export const CATEGORY_ORDER = ['Flow', 'Action', 'Wait', 'Loop'];
