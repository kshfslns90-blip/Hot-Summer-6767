// Modules group forms, client scripts and server scripts. Shared by the browser runtime, the
// designer and the server, so every side spells a name the same way:
//
//   'Details'               a form or script in the caller's own module
//   'Utils.Details'         the same in module Utils
//   'customers.list'        a call target: function list of script customers, own module
//   'Utils.customers.list'  the same in module Utils
//
// The number of dot-separated parts decides, so nothing is ambiguous. Outside code - project
// settings, workflow and job targets, URLs - a name is always qualified: there is no current
// module to fall back on.

export const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const MEMBER_RE = /^[A-Za-z_$][\w$]*$/;

export class NameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NameError';
    this.status = 400;
  }
}

export function isIdent(text) {
  return typeof text === 'string' && IDENT.test(text);
}

export function isQualified(name) {
  if (typeof name !== 'string') return false;
  const parts = name.split('.');
  return parts.length === 2 && IDENT.test(parts[0]) && IDENT.test(parts[1]);
}

// 'Main.Details' -> { module: 'Main', name: 'Details' }.
export function splitQualified(name) {
  if (!isQualified(name)) {
    throw new NameError(`"${name}" is not a qualified name. Use "Module.Name", such as "Main.Details".`);
  }
  const [module, short] = name.split('.');
  return { module, name: short };
}

// What a piece of code can learn about itself - the `context` global of a code behind, a client
// script or a server script. It describes where the code was written, not who is running it.
export function scriptContext(kind, qualifiedName) {
  if (!['form', 'client-script', 'server-script'].includes(kind)) throw new NameError(`Unknown context kind "${kind}".`);
  const { module, name } = splitQualified(qualifiedName);
  return Object.freeze({ kind, module, name, qualifiedName });
}

// A name as written in code, made absolute: a bare name takes the current module.
export function qualify(name, module) {
  if (typeof name !== 'string' || name === '') throw new NameError(`A name is needed, such as 'Details' or 'Utils.Details'; got ${JSON.stringify(name)}.`);
  if (isQualified(name)) return name;
  if (IDENT.test(name)) {
    if (!isIdent(module)) throw new NameError(`"${name}" needs its module: use "Module.${name}".`);
    return `${module}.${name}`;
  }
  throw new NameError(`"${name}" is not a valid name. Use letters, digits and underscore, with an optional "Module." prefix.`);
}

// A call target as written in code, made absolute: 'script.fn' takes the current module,
// 'Module.script.fn' is complete. Without a current module only the complete form is accepted.
export function parseTarget(target, module) {
  const parts = typeof target === 'string' ? target.split('.') : [];
  let mod;
  let script;
  let member;
  if (parts.length === 3) [mod, script, member] = parts;
  else if (parts.length === 2 && isIdent(module)) [script, member] = parts, mod = module;
  else {
    const want = isIdent(module) ? '"script.fn" or "Module.script.fn"' : '"Module.script.fn"';
    throw new NameError(`A server call needs a target of the form ${want} (got ${JSON.stringify(target)}): a server script is a library of functions.`);
  }
  if (!isIdent(mod) || !isIdent(script)) {
    throw new NameError(`Invalid target ${JSON.stringify(target)}: the module and the script are names of letters, digits and underscore, starting with a letter.`);
  }
  if (!MEMBER_RE.test(member)) throw new NameError(`Invalid function name "${member}" in target "${target}".`);
  return { module: mod, script, member, qualified: `${mod}.${script}`, target: `${mod}.${script}.${member}` };
}
