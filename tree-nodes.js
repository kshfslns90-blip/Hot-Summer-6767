// Node definitions for the Tree View. Typed one per line in the property grid with children
// indented, or handed over from code as nested objects; this module has no DOM so the tests can
// import it directly. The node objects are the tree's model: expanded and checked live on them.

// "value=Text | icon" per line with children indented (two spaces or a tab per level), a JSON
// array, or an array of { text, value, icon, expanded, checked, children } objects.
export function parseTreeNodes(value) {
  if (Array.isArray(value)) return value.map(normalizeNode).filter(Boolean);
  if (typeof value !== 'string' || value.trim() === '') return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      return parseTreeNodes(JSON.parse(trimmed));
    } catch {
      /* fall through to line parsing */
    }
  }
  return parseLines(value.split(/\r?\n/));
}

function parseLines(lines) {
  const roots = [];
  // One entry per open level: the node a deeper line becomes a child of, and its indent.
  const stack = [];
  for (const raw of lines) {
    if (raw.trim() === '') continue;
    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
    const node = parseLine(raw.trim());
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ node, indent });
  }
  return roots;
}

function parseLine(line) {
  let icon;
  const bar = line.lastIndexOf('|');
  if (bar > 0) {
    icon = line.slice(bar + 1).trim() || undefined;
    line = line.slice(0, bar).trim();
  }
  const sep = line.indexOf('=');
  const value = sep > 0 ? line.slice(0, sep).trim() : line;
  const text = sep > 0 ? line.slice(sep + 1).trim() : line;
  return normalizeNode({ value, text, icon });
}

function normalizeNode(node) {
  if (typeof node === 'string') return parseLine(node.trim());
  if (!node || typeof node !== 'object') return null;
  const text = String(node.text ?? node.label ?? node.value ?? '');
  node.text = text;
  node.value = String(node.value ?? text);
  for (const key of ['icon', 'iconExpanded']) {
    if (node[key] !== undefined && node[key] !== null && node[key] !== '') node[key] = String(node[key]);
    else delete node[key];
  }
  node.expanded = Boolean(node.expanded);
  node.checked = Boolean(node.checked);
  node.children = Array.isArray(node.children) ? node.children.map(normalizeNode).filter(Boolean) : [];
  return node;
}

// Every node, depth first, with its parent (null for a root).
export function walk(roots, fn, parent = null, depth = 0) {
  for (const node of roots) {
    if (fn(node, parent, depth) === false) return false;
    if (walk(node.children || [], fn, node, depth + 1) === false) return false;
  }
  return true;
}

// The rows a tree shows: every node whose ancestors are all expanded, in display order.
export function flattenVisible(roots, { expandAll = false } = {}) {
  const rows = [];
  const visit = (nodes, parent, depth) => {
    for (const node of nodes) {
      rows.push({ node, parent, depth });
      if ((node.children || []).length && (expandAll || node.expanded)) visit(node.children, node, depth + 1);
    }
  };
  visit(roots, null, 0);
  return rows;
}

export function findByValue(roots, value) {
  let found = null;
  walk(roots, (node) => {
    if (node.value === String(value)) {
      found = node;
      return false;
    }
    return true;
  });
  return found;
}

// The parents of a node from the root down, so they can be expanded to reveal it.
export function pathTo(roots, target) {
  const path = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node === target) return true;
      path.push(node);
      if (visit(node.children || [])) return true;
      path.pop();
    }
    return false;
  };
  return visit(roots) ? path : [];
}

// Cascading check boxes: ticking a branch ticks everything under it, and a branch reflects its
// children - all ticked, none ticked, or mixed (`indeterminate`, shown as a dash).
export function setCheckedDeep(node, checked) {
  node.checked = checked;
  node.indeterminate = false;
  for (const child of node.children || []) setCheckedDeep(child, checked);
}

// Recomputes every branch from its leaves up; the flags land on the nodes.
export function recomputeChecked(roots) {
  const visit = (node) => {
    const kids = node.children || [];
    if (!kids.length) {
      node.indeterminate = false;
      return;
    }
    let all = true;
    let none = true;
    for (const child of kids) {
      visit(child);
      if (child.checked || child.indeterminate) none = false;
      if (!child.checked || child.indeterminate) all = false;
    }
    node.checked = all;
    node.indeterminate = !all && !none;
  };
  for (const root of roots) visit(root);
}

export function collectChecked(roots) {
  const out = [];
  walk(roots, (node) => {
    if (node.checked) out.push(node);
    return true;
  });
  return out;
}
