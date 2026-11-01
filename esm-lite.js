// Lowers modern import/export syntax onto the runtime's CommonJS-style machinery, so a client
// script or code behind can be written either way. `import { money } from 'utils'` becomes
// `const { money } = require('utils')` before the source is wrapped in its function - real ESM
// cannot run there, because import statements are illegal inside a function body.
//
// Accepted limits, by design:
//   - no live bindings: an imported value is copied when the import line runs;
//   - module names are bare identifiers ('utils'), with the module in front for a script of
//     another module ('Utils.format'), never URLs or paths; in a code behind a 'server:name'
//     specifier imports a server script through require('server:name') instead - the object
//     server.require('name') gives;
//   - Node-style default interop: a default import takes the module's .default when one was
//     exported, otherwise the whole exports object;
//   - a statement is recognised only when its line STARTS with import/export, so the word
//     inside a string or comment is left alone (a template-literal line that itself starts
//     with "import " is the one false positive we accept);
//   - `export const` takes plain names, not destructuring patterns.
//
// The transform never changes the number of lines, so error positions and sourceURL line
// numbers stay honest.

const MODULE_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;
const OPEN_RE = /^\s*(import|export)\b/;
const MAX_JOIN = 40;

// Node-style default pick, inlined so the lowered code needs no helper in scope.
const PICK = '((m) => m && m.default !== undefined ? m.default : m)';

function fail(what, lineNo) {
  throw new Error(`${what} (line ${lineNo}). Module names are plain identifiers, e.g. import { x } from 'utils' (or from 'Utils.format' in another module).`);
}

function assertModule(name, lineNo) {
  if (!MODULE_RE.test(name)) fail(`"${name}" is not a script name`, lineNo);
  return name;
}

// '{ a, b as c }' -> '{ a, b: c }' for a destructuring require.
function namedToPattern(inner) {
  return inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/, '$1: $2'))
    .join(', ');
}

// A trailing line comment after the statement is dropped rather than tripping the parser.
function stripTrail(statement) {
  return statement.replace(/(['"}])\s*;?\s*\/\/.*$/, '$1');
}

// 'utils' -> require('utils'); 'server:customers' -> require('server:customers') (code behinds only).
function resolveSpecifier(spec, lineNo, server) {
  const m = /^server:(.*)$/.exec(spec);
  if (!m) return { req: `require('${assertModule(spec, lineNo)}')`, server: false };
  if (!server) fail(`"${spec}": server scripts can be imported from a code behind only`, lineNo);
  return { req: `require('server:${assertModule(m[1], lineNo)}')`, server: true };
}

// One complete import statement -> its require() form.
function lowerImport(statement, lineNo, server) {
  statement = stripTrail(statement);
  let match = /^import\s*(['"])([^'"]+)\1\s*;?$/.exec(statement);
  if (match) {
    const bare = resolveSpecifier(match[2], lineNo, server);
    if (bare.server) fail(`"${match[2]}": a server script has nothing to import for its side effects; name what you need`, lineNo);
    return `${bare.req};`;
  }

  match = /^import\s+(.+?)\s+from\s*(['"])([^'"]+)\2\s*;?$/.exec(statement);
  if (!match) fail('Unrecognised import statement', lineNo);
  const clause = match[1].trim();
  const { req, server: isServer } = resolveSpecifier(match[3], lineNo, server);

  const star = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
  if (star) return `const ${star[1]} = ${req};`;

  const named = /^\{([\s\S]*)\}$/.exec(clause);
  if (named) return `const { ${namedToPattern(named[1])} } = ${req};`;

  const combo = /^([A-Za-z_$][\w$]*)\s*(?:,\s*(.+))?$/.exec(clause);
  if (!combo) fail('Unrecognised import statement', lineNo);
  // A server module has no default: the default import is the whole object of functions.
  const parts = [isServer ? `const ${combo[1]} = ${req};` : `const ${combo[1]} = ${PICK}(${req});`];
  if (combo[2]) {
    const rest = combo[2].trim();
    const restStar = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(rest);
    const restNamed = /^\{([\s\S]*)\}$/.exec(rest);
    if (restStar) parts.push(`const ${restStar[1]} = ${req};`);
    else if (restNamed) parts.push(`const { ${namedToPattern(restNamed[1])} } = ${req};`);
    else fail('Unrecognised import statement', lineNo);
  }
  return parts.join(' ');
}

// A joined import/export-list statement is complete when its braces balance and, for imports,
// the closing quote of the module name has arrived.
function complete(statement) {
  statement = stripTrail(statement);
  const opens = (statement.match(/\{/g) || []).length;
  const closes = (statement.match(/\}/g) || []).length;
  if (opens !== closes) return false;
  if (/^import\b/.test(statement)) {
    return /^import\s*(['"])[^'"]+\1\s*;?$/.test(statement) || /from\s*(['"])[^'"]+\1\s*;?$/.test(statement);
  }
  return /\}\s*;?\s*$/.test(statement);
}

export function lowerModules(source, { exports = true, server = false } = {}) {
  const lines = String(source ?? '').split('\n');
  const out = [...lines];
  const exported = []; // [local, exportedAs]

  for (let i = 0; i < lines.length; i += 1) {
    if (!OPEN_RE.test(lines[i])) continue;
    const indent = /^\s*/.exec(lines[i])[0];
    const line = lines[i].trim();

    // --- export forms (single-line prefixes; the body continues naturally) ---
    let match = /^export\s+(async\s+function|function\*?|class)\s+([A-Za-z_$][\w$]*)([\s\S]*)$/.exec(line);
    if (match) {
      out[i] = `${indent}${match[1]} ${match[2]}${match[3]}`;
      exported.push([match[2], match[2]]);
      continue;
    }
    match = /^export\s+(const|let|var)\s+([\s\S]*)$/.exec(line);
    if (match) {
      out[i] = `${indent}${match[1]} ${match[2]}`;
      const first = /^([A-Za-z_$][\w$]*)/.exec(match[2]);
      if (!first) fail('export const/let/var needs plain names', i + 1);
      exported.push([first[1], first[1]]);
      // Additional comma-separated declarations on the same line: `export const a = 1, b = 2`.
      for (const extra of match[2].matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=/g)) exported.push([extra[1], extra[1]]);
      continue;
    }
    match = /^export\s+default\s+([\s\S]*)$/.exec(line);
    if (match) {
      out[i] = `${indent}module.exports.default = ${match[1]}`;
      continue;
    }

    // --- statements that may span lines: import ... and export { ... } ---
    let statement = line;
    let span = 1;
    while (!complete(statement)) {
      if (i + span >= lines.length || span >= MAX_JOIN) fail(`Unfinished ${statement.split(/\s/)[0]} statement`, i + 1);
      statement += ` ${lines[i + span].trim()}`;
      span += 1;
    }
    statement = stripTrail(statement.replace(/\s+/g, ' '));

    if (/^export\s*\{/.test(statement)) {
      const list = /^export\s*\{([\s\S]*)\}\s*;?$/.exec(statement);
      if (!list) fail('Unrecognised export statement', i + 1);
      for (const part of list[1].split(',').map((p) => p.trim()).filter(Boolean)) {
        const pair = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
        if (!pair) fail(`Unrecognised export "${part}"`, i + 1);
        exported.push([pair[1], pair[2] || pair[1]]);
      }
      out[i] = '';
    } else if (/^import\b/.test(statement)) {
      out[i] = indent + lowerImport(statement, i + 1, server);
    } else {
      fail('Unrecognised export statement', i + 1);
    }
    for (let blank = 1; blank < span; blank += 1) out[i + blank] = '';
    i += span - 1;
  }

  let code = out.join('\n');
  if (exports && exported.length > 0) {
    code += `\n;${exported.map(([local, as]) => `module.exports.${as} = ${local};`).join(' ')}`;
  }
  return { code };
}
