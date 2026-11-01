// Source scanning helpers shared by the browser runtime and the server script runner.
// Both need to know which top level names a loose script declares, so that they can be
// exposed to the outside world, and which modules a script pulls in with require().

const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'return', 'catch', 'try', 'do', 'else', 'with', 'case', 'new',
  'delete', 'typeof', 'void', 'in', 'of', 'instanceof', 'this', 'super', 'yield', 'await'
]);

// Declarations that start at column zero are treated as top level. That is a convention rather
// than a parse, and it is the same convention a developer reads off the screen.
const DECLARATIONS = [
  /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,
  /^(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)/gm,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm
];

export function scanTopLevelNames(source) {
  const found = [];
  const seen = new Set();
  for (const re of DECLARATIONS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) {
      const name = match[1];
      if (RESERVED.has(name) || seen.has(name)) continue;
      seen.add(name);
      found.push(name);
    }
  }
  return found;
}

// Every name a script binds at top level: the declarations above plus the names taken out of a
// destructuring `const { a, b: c } = ...` or `const [d] = ...` - what a lowered import produces.
// Used to keep a control binding from colliding with a name the code behind declares itself.
const PATTERNS = [/^(?:export\s+)?(?:const|let|var)\s*\{([^}]*)\}\s*=/gm, /^(?:export\s+)?(?:const|let|var)\s*\[([^\]]*)\]\s*=/gm];

export function scanTopLevelBindings(source) {
  const found = new Set(scanTopLevelNames(source));
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) {
      for (const part of match[1].split(',')) {
        const local = part.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(local)) found.add(local);
      }
    }
  }
  return [...found];
}

// require() has to resolve synchronously inside a code behind, so the modules are preloaded
// before the code runs. That means the argument must be a plain string literal: a script name,
// with the module in front when the script is in another one ('utils', 'Utils.format').
// Only a bare require() counts: a member call such as server.require('customers') is a server
// script, and so is require('server:customers') - the name class has no colon - so neither is
// preloaded as a client script.
const REQUIRE_RE = /(?<![\w$.])require\s*\(\s*(['"])([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?)\1\s*\)/g;

export function scanRequires(source) {
  const names = new Set();
  REQUIRE_RE.lastIndex = 0;
  let match;
  while ((match = REQUIRE_RE.exec(source)) !== null) names.add(match[2]);
  return [...names];
}
