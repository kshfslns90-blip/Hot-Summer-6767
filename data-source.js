// The pure part of data binding: the arguments a dataSource is called with, dotted field paths
// into a record, and which controls under a container bind to its record. No DOM here, so the
// tests can import it.

// The dataArgs property: an array from code, or the Inspector's text - a JSON array, or a single
// JSON value which becomes the one argument. Empty or unparsable means no arguments.
export function parseDataArgs(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  if (typeof value !== 'string') return [value];
  const text = value.trim();
  if (text === '') return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

// An argument list crosses the wire as JSON, which has no undefined: an entry left undefined so
// the function's own default applies (select(text, undefined, 50)) would arrive as null. The
// client sends the positions of those holes beside the arguments; the server puts them back.
export function argHoles(args) {
  if (!Array.isArray(args)) return [];
  const out = [];
  args.forEach((value, index) => {
    if (value === undefined) out.push(index);
  });
  return out;
}

export function restoreHoles(args, holes) {
  if (!Array.isArray(args) || !Array.isArray(holes)) return args;
  const out = [...args];
  for (const index of holes) {
    if (Number.isInteger(index) && index >= 0 && index < out.length) out[index] = undefined;
  }
  return out;
}

const segments = (path) => String(path || '').split('.').map((s) => s.trim()).filter(Boolean);

// record.address.city for the path 'address.city'; undefined when any step is missing.
export function getPath(obj, path) {
  let current = obj;
  for (const key of segments(path)) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

// Writes a value at a dotted path, creating the objects along the way.
export function setPath(obj, path, value) {
  const keys = segments(path);
  if (keys.length === 0) return obj;
  let current = obj;
  for (const key of keys.slice(0, -1)) {
    if (current[key] === null || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
  return obj;
}

// A record that writes through: reading a field is the plain value, assigning one hands the
// field to `write` (a grid redraws the cell, a container fills the bound control) and keeps it
// on the object too. What currentItem hands out, so `grid.currentItem.name = 'x'` shows. Only
// the record's own fields are watched; a nested object is the plain object it is.
export function liveRecord(record, write) {
  return new Proxy(record, {
    set(target, key, value) {
      if (typeof key === 'string') write(key, value);
      target[key] = value;
      return true;
    }
  });
}

// A value as the wire would carry it: what dirty tracking compares. undefined and a missing key
// are the same thing, a Date is its ISO text, functions and symbols do not count.
const leaf = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;
  return undefined;
};
const isObject = (value) => value !== null && typeof value === 'object' && !(value instanceof Date);
const isEmptyValue = (value) => value === undefined || (isObject(value) && Object.keys(value).length === 0);

// The dotted paths at which `after` differs from `before`: 'name', 'address.city', '2.qty' (an
// array index is a segment). A leaf that turned into an object, or the other way round, is one
// change at its own path. What dirty tracking is built on; no framework state on the records.
export function changedPaths(before, after) {
  const out = [];
  const visit = (a, b, path) => {
    if (isObject(a) && isObject(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        const av = a[key];
        const bv = b[key];
        if (typeof av === 'function' || typeof bv === 'function') continue;
        if (isEmptyValue(av) && isEmptyValue(bv)) continue;
        visit(av, bv, path ? `${path}.${key}` : key);
      }
      return;
    }
    if (isObject(a) !== isObject(b)) {
      if (!(isEmptyValue(a) && isEmptyValue(b))) out.push(path);
      return;
    }
    if (leaf(a) !== leaf(b)) out.push(path);
  };
  // No baseline (or none yet) counts as an empty record, so a fresh record's fields all show.
  visit(isEmptyValue(before) ? {} : before, isEmptyValue(after) ? {} : after, '');
  return out;
}

// The nodes under a container that show a field of its record: every descendant with a
// dataField, except those inside a child that owns its data - a nested container with a
// dataSource of its own (its own record), or a Repeater (its rows reach the controls inside).
// `ownsData(node)` says which children those are; the child itself can still be a target.
export function bindingTargets(container, ownsData) {
  const out = [];
  const visit = (node) => {
    for (const child of node.children || []) {
      if (child.props && typeof child.props.dataField === 'string' && child.props.dataField.trim() !== '') out.push(child);
      if (ownsData(child)) continue;
      visit(child);
    }
  };
  visit(container);
  return out;
}
