// The widget catalogue. Everything else - the toolbox, the property grid, the designer and the
// running application - reads its behaviour from these definitions, so adding a widget is a
// single entry here plus a rule or two of CSS.
import { layoutChildren } from './layout.js';

const registry = new Map();

// Data binding, the same on every widget that takes part. A widget with a dataProp (its data:
// a grid's rows, a chart's series) or a container (its data: a record) gets a dataSource to load
// it from; a widget with a valueProp or a dataProp can name a dataField of the record loaded by
// the container around it.
export const DATA_PROPS = [
  { name: 'dataSource', type: 'function', default: '', placeholder: 'script.fn', doc: 'A server script function, "script.fn" (a script of this module) or "Module.script.fn", whose result fills the control when the form opens and on reload().' },
  { name: 'dataArgs', type: 'args', default: '', tsType: 'any[]', doc: 'The arguments handed to the source, in order (the Inspector edits them one by one; from code, an array); reload(args) overrides them.' },
  { name: 'autoLoad', type: 'bool', default: true, doc: 'Loads the source when the form opens; off, the control waits for reload().' }
];
export const DATA_EVENTS = ['onDataLoaded', 'onDataError'];
export const DATA_FIELD_PROP = { name: 'dataField', type: 'string', default: '', placeholder: 'name or address.city', doc: 'The field of the record loaded by the nearest container with a dataSource, shown in this control and read back into the container\'s data. A dotted path reaches into nested objects.' };

export function register(def) {
  const full = {
    group: 'Common',
    container: false,
    contentInset: { x: 0, y: 0 },
    defaultSize: { width: 120, height: 28 },
    defaultProps: {},
    props: [],
    events: [],
    ...def
  };
  // `bindable: false` opts a container out: a Repeater's item template has nothing of its own
  // to load (its rows come from the Repeater), though it still holds a record like any container.
  if ((full.dataProp || full.container) && full.bindable !== false) {
    full.props = [...full.props, ...DATA_PROPS];
    full.events = [...full.events, ...DATA_EVENTS];
  }
  if (full.valueProp || full.dataProp) full.props = [...full.props, DATA_FIELD_PROP];
  registry.set(def.type, full);
}

// The property a dataField writes to: the widget's value, else its data (a bound grid or chart).
export function bindProp(def) {
  return def.valueProp || (def.dataProp ? 'data' : null);
}

export function widget(type) {
  const def = registry.get(type);
  if (!def) throw new Error(`Unknown widget type "${type}".`);
  return def;
}

export function hasWidget(type) {
  return registry.has(type);
}

// The part of a container's box that is its own chrome (a caption bar, a tab strip), not client
// area. A widget whose chrome depends on its props (a Tab Control without headers) gives a function.
export function contentInsetOf(node) {
  const inset = widget(node.type).contentInset;
  return (typeof inset === 'function' ? inset(node) : inset) || { x: 0, y: 0 };
}

// The code behind constructor for each widget: 'Text Area' -> TextArea. The form itself is not
// constructible - there is always exactly one, built from the layout.
export function widgetConstructors() {
  return [...registry.values()]
    .filter((def) => def.type !== 'form')
    .map((def) => ({ type: def.type, name: def.label.replace(/[^A-Za-z0-9_$]/g, '') }));
}

export function widgets() {
  return [...registry.values()];
}

// Lays a built subtree out again, top down: a child can only be placed once its container
// knows how big it is. Lives beside the registry so a widget that builds trees of its own (a
// Repeater's items) can reach it without importing the builder.
export function relayout(node) {
  const def = widget(node.type);
  const contentEl = node.__contentEl;
  if (!contentEl) return;
  const children = node.children || [];
  const lay = () => (def.layoutChildren ? def.layoutChildren(node, contentEl) : layoutChildren(node, contentEl, contentInsetOf(node)));
  // A scrolling container's client size can change from placing its children: a scrollbar
  // that appears (or goes) takes its width. Then the children are placed once more, so they
  // fit beside the bar instead of pushing a second bar out. Every placement checks, since
  // the overflow may only show up after a child has been measured.
  const scrolling = node.props?.scroll === 'auto';
  const place = () => {
    const before = scrolling ? { w: contentEl.clientWidth, h: contentEl.clientHeight } : null;
    lay();
    if (before && (contentEl.clientWidth !== before.w || contentEl.clientHeight !== before.h)) lay();
  };
  place();
  for (const child of children) relayout(child);
  // A child that sizes itself to its content (a Label or a Column in content mode) is measured
  // once it is placed at its width and its own children have settled; a height that changed
  // lays the container out once more, so siblings in a Column move, and the children are
  // visited again at the same widths, where their measures hold. One extra pass at most.
  let changed = false;
  for (const child of children) {
    const measure = widget(child.type).measure;
    if (!measure || !child.__el) continue;
    const height = measure(child.__el, child);
    if (height === undefined) {
      if (child.__renderHeight !== undefined) {
        delete child.__renderHeight;
        changed = true;
      }
    } else if (height !== child.__renderHeight) {
      child.__renderHeight = height;
      changed = true;
    }
  }
  if (changed) {
    place();
    for (const child of children) relayout(child);
  }
}

export function toolboxWidgets() {
  return widgets().filter((d) => d.toolbox !== false);
}

// Props every widget understands, merged in front of the widget specific ones.
export const COMMON_PROPS = [
  { name: 'visible', type: 'bool', default: true },
  { name: 'enabled', type: 'bool', default: true },
  { name: 'tooltip', type: 'string', default: '' }
];

export function propsOf(type) {
  return [...COMMON_PROPS, ...widget(type).props];
}

export function propMeta(type, name) {
  return propsOf(type).find((p) => p.name === name) || null;
}

export function defaultPropsOf(type) {
  const out = {};
  for (const p of propsOf(type)) if (p.default !== undefined) out[p.name] = p.default;
  return { ...out, ...widget(type).defaultProps };
}

function el(tag, className, props) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (props) Object.assign(node, props);
  return node;
}

function applyCommon(element, name, value) {
  if (name === 'visible') {
    element.style.display = value === false ? 'none' : '';
    return true;
  }
  if (name === 'tooltip') {
    if (value) element.title = value;
    else element.removeAttribute('title');
    return true;
  }
  return false;
}

function setDisabled(element, value) {
  const disabled = value === false;
  element.classList.toggle('gd-disabled', disabled);
  const target = element.matches('input, select, textarea, button') ? element : element.querySelector('input, select, textarea, button');
  if (target) target.disabled = disabled;
}

// Items can be typed as one entry per line, or as JSON, or bound from code to an array.
export function parseItems(value) {
  if (Array.isArray(value)) return value.map(normalizeItem);
  if (typeof value !== 'string' || value.trim() === '') return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed).map(normalizeItem);
    } catch {
      /* fall through to line parsing */
    }
  }
  return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(normalizeItem);
}

// An object keeps its other fields, so a row from a dataSource comes back whole as currentItem.
function normalizeItem(item) {
  if (item && typeof item === 'object') {
    return { ...item, value: String(item.value ?? item.id ?? item.text ?? ''), text: String(item.text ?? item.label ?? item.value ?? '') };
  }
  const text = String(item);
  const sep = text.indexOf('=');
  if (sep > 0) return { value: text.slice(0, sep).trim(), text: text.slice(sep + 1).trim() };
  return { value: text, text };
}

export { el, applyCommon, setDisabled, layoutChildren };
