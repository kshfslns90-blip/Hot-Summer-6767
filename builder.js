// Turns a form layout (plain JSON) into a live DOM tree, and keeps that tree laid out.
// The designer and the running application both go through here.
import './widget-defs.js';
import { widget, defaultPropsOf, relayout, contentInsetOf } from './widgets.js';
import { Control } from './control.js';

export { relayout };

// Layouts saved by earlier versions: the Expander widget became a Group Box with `expandable`.
// A Repeater always has its item template as its first child; one written by hand gets one.
export function normalizeLayout(root) {
  walk(root, (node) => {
    if (node.type === 'expander') {
      node.type = 'groupbox';
      node.props = { ...(node.props || {}), expandable: true };
    }
    if (node.type === 'repeater' && !(node.children || []).some((child) => child.type === 'repeatertemplate')) {
      node.children = [repeaterTemplate(Number(node.width) || 300), ...(node.children || [])];
    }
  });
  return root;
}

// The item template a Repeater starts with; the designer and new Repeater(...) make the same.
export function repeaterTemplate(width, id = 'repeatertemplate1') {
  return {
    id,
    type: 'repeatertemplate',
    left: 0,
    top: 0,
    width,
    height: widget('repeatertemplate').defaultSize.height,
    anchor: ['left', 'top'],
    dock: 'none',
    props: {},
    events: {},
    children: []
  };
}

export function buildTree(rootNode, host) {
  normalizeLayout(rootNode);
  const controls = new Map();

  const build = (node, parent) => {
    const def = widget(node.type);
    const created = def.create(node, host) || {};
    const element = created.el;
    element.classList.add('gd-node');
    // The id normally sits on the root; a widget whose root is a wrapper (the Input, so that
    // its icon can be a real element) names the inner field instead, keeping [data-gd-id] a field.
    const idEl = created.idEl || element;
    idEl.dataset.gdId = node.id || node.name || node.type;
    idEl.dataset.gdType = node.type;

    node.__el = element;
    node.__contentEl = created.contentEl || null;
    node.__parent = parent;

    // In the running app a container's stored size is its DESIGN size: anchored children move
    // relative to it. Freeze it now, so a runtime change to the container's width or height
    // (a splitter drag, pnl.width = 300 from code) stretches the children instead of moving the
    // reference along with them. The designer keeps the live fallback, because it bakes geometry;
    // there a design size is only ever handed down by the container placing this one (a Row,
    // a Column) on each pass, so one left over from where the control was before goes.
    if (host.mode === 'run' && node.__contentEl && !node.__design && Number(node.width) > 0 && Number(node.height) > 0) {
      // With the inset it was taken with, which a container may change later (layout.js designSize).
      const inset = contentInsetOf(node);
      node.__design = {
        w: Math.max(1, Number(node.width) - inset.x),
        h: Math.max(1, Number(node.height) - inset.y),
        inset: { x: inset.x, y: inset.y }
      };
    } else if (host.mode === 'design') {
      delete node.__design;
    }

    // A form keeps its caption at the top level of the layout; the property grid reads props.
    if (node.type === 'form' && node.text !== undefined && node.props?.text === undefined) {
      node.props = { ...node.props, text: node.text };
    }
    const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
    node.props = { ...node.props };
    // `visible` only acts in the running app: on the canvas every control is drawn and laid
    // out, so it can be found and edited. The mark tells the layout code which page this is.
    node.__designing = host.mode === 'design';
    for (const [name, value] of Object.entries(props)) {
      if (name === 'visible' && node.__designing) continue;
      def.apply?.(element, node, name, value);
    }

    if (host.mode === 'run' && def.bind) {
      def.bind(element, node, (event, payload) => host.emit(node, event, payload));
    }

    const control = new Control(node, host);
    controls.set(node, control);

    if (node.__contentEl) {
      for (const child of node.children || []) {
        build(child, node);
        node.__contentEl.append(child.__el);
      }
    }
    def.refresh?.(element, node, host);
    return control;
  };

  const root = build(rootNode, null);
  return { root, controls, element: rootNode.__el };
}

// Resizing a container at design time is not the same as resizing it at run time: the anchor and
// dock rules are applied once and baked into the stored geometry, so the layout JSON always
// describes the form exactly as it is drawn. Run time then works from that as its baseline.
export function resizeContainer(node, size) {
  const inset = contentInsetOf(node);
  const width = Math.max(0, Math.round(size.width));
  const height = Math.max(0, Math.round(size.height));
  const before = { w: node.width - inset.x, h: node.height - inset.y };
  const after = { w: width - inset.x, h: height - inset.y };

  node.width = width;
  node.height = height;
  applyDesignResize(node, before, after);
}

function resizeChild(child, width, height) {
  const w = Math.max(0, Math.round(width));
  const h = Math.max(0, Math.round(height));
  if (child.width === w && child.height === h) return;
  if (widget(child.type).container) resizeContainer(child, { width: w, height: h });
  else {
    child.width = w;
    child.height = h;
  }
}

function applyDesignResize(node, before, after) {
  const dx = after.w - before.w;
  const dy = after.h - before.h;
  if (dx === 0 && dy === 0) return;
  const children = node.children || [];

  // Tab pages are never placed freely; they always fill the body, so each page's inside goes
  // from the body's old size to its new one, whatever size the page has stored.
  if (node.type === 'tabcontrol') {
    for (const page of children) {
      page.width = Math.max(0, Math.round(after.w));
      page.height = Math.max(0, Math.round(after.h));
      applyDesignResize(page, before, after);
    }
    return;
  }
  // A container that positions its own children (Row, Column) says how a resize reaches them,
  // instead of having dock and anchor rules baked into geometry it never reads. It gets the
  // client size before and after, and resizeInside to carry a child container's inside from the
  // size that child was drawn at to the size it is drawn at now.
  const def = widget(node.type);
  if (def.resizeChildren) {
    def.resizeChildren(node, { before, after, resizeChild, resizeInside: applyDesignResize });
    return;
  }

  // Docked children first, walking the same shrinking rectangle the layout engine walks.
  let left = 0;
  let top = 0;
  let right = after.w;
  let bottom = after.h;
  for (const child of children) {
    const dock = child.dock || 'none';
    if (dock === 'none') continue;
    if (dock === 'top') {
      resizeChild(child, right - left, child.height);
      top += child.height;
    } else if (dock === 'bottom') {
      resizeChild(child, right - left, child.height);
      bottom -= child.height;
    } else if (dock === 'left') {
      resizeChild(child, child.width, bottom - top);
      left += child.width;
    } else if (dock === 'right') {
      resizeChild(child, child.width, bottom - top);
      right -= child.width;
    } else {
      resizeChild(child, right - left, bottom - top);
      left = right;
      top = bottom;
    }
  }

  for (const child of children) {
    if ((child.dock || 'none') !== 'none') continue;
    const anchor = new Set(Array.isArray(child.anchor) ? child.anchor : ['left', 'top']);
    let width = child.width;
    let height = child.height;

    if (anchor.has('left') && anchor.has('right')) width += dx;
    else if (anchor.has('right')) child.left += dx;
    else if (!anchor.has('left')) child.left += Math.round(dx / 2);

    if (anchor.has('top') && anchor.has('bottom')) height += dy;
    else if (anchor.has('bottom')) child.top += dy;
    else if (!anchor.has('top')) child.top += Math.round(dy / 2);

    resizeChild(child, width, height);
  }
}

// Lets every widget with a dispose hook let go of what it holds outside the DOM - a Tabulator
// table, a Chart.js instance - before its elements are dropped: a form closing, or the designer
// rebuilding its canvas.
export function disposeTree(root) {
  walk(root, (node) => {
    if (!node.__el) return;
    try {
      widget(node.type)?.dispose?.(node.__el, node);
    } catch (err) {
      console.error(`Disposing a ${node.type} failed:`, err);
    }
  });
}

// Tells every widget with a `hidden` / `shown` hook that its form is going out of sight
// (form.open() hides it behind a child, display: none) or coming back: what a widget's own
// library loses while it measures 0 x 0 - a grid's scroll position - is kept across it.
// `hook` is 'hidden' or 'shown'.
export function notifyTree(root, hook) {
  walk(root, (node) => {
    if (!node.__el) return;
    try {
      widget(node.type)?.[hook]?.(node.__el, node);
    } catch (err) {
      console.error(`Telling a ${node.type} it was ${hook} failed:`, err);
    }
  });
}

export function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

export function findNode(root, predicate) {
  let found = null;
  walk(root, (node) => {
    if (!found && predicate(node)) found = node;
  });
  return found;
}

export function findById(root, id) {
  return findNode(root, (node) => node.id === id);
}

export function parentOf(root, target) {
  return findNode(root, (node) => (node.children || []).includes(target));
}

// Recreates a subtree in place after a structural edit in the designer.
export function rebuild(node, host) {
  const old = node.__el;
  const parentContent = old && old.parentElement;
  const index = parentContent ? [...parentContent.children].indexOf(old) : -1;
  const { controls } = buildTree(node, host);
  if (parentContent) {
    if (index >= 0 && index < parentContent.children.length) parentContent.insertBefore(node.__el, parentContent.children[index]);
    else parentContent.append(node.__el);
    old.remove();
  }
  return controls;
}
