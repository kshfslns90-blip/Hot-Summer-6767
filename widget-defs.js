// Definitions for the v1 widget set. Importing this module registers them.
import { register, widget, el, applyCommon, setDisabled, parseItems, layoutChildren, defaultPropsOf, relayout, contentInsetOf } from './widgets.js';
import { itemRects, contentHeight } from './repeater.js';
import { imageSrc, inDesigner } from './project.js';
import { SPLITTER_DOCKS, splitterTarget, splitAxis, splitSize } from './splitter.js';
import { stackLayout, stackContentSize, STACK_ALIGN, STACK_JUSTIFY } from './stack.js';
import { place, heightOf, shown, designSize } from './layout.js';
import { renderMarkdown } from './markdown.js';
import { loadTabulator, loadChartJs, loadLeaflet } from './vendor.js';
import { parseLatLng, parseMarkers, DEFAULT_TILES, DEFAULT_ATTRIBUTION } from './map-data.js';
import { parseSuggestions, filterSuggestions } from './autocomplete.js';
import { parseDataArgs, liveRecord, getPath } from './data-source.js';
import { parseColumns, toTabulatorColumns } from './grid-columns.js';
import { parseCellAttrs } from './grid-cell-attrs.js';
import { CHART_TYPES, buildConfig } from './chart-data.js';
import { parseTreeNodes, flattenVisible, findByValue, pathTo, collectChecked, walk, setCheckedDeep, recomputeChecked } from './tree-nodes.js';
import { lucideIcon, isIconName, iconGlyph } from './icons.js';
import { FormStack } from './form-stack.js';

// The height an element takes with its height let go for a moment, as a whole number of pixels
// rounded up: text sits on fractional line heights, and a box rounded to the nearest pixel can
// be a sliver shorter than its text - enough for a scrollbar. A fake element without a bounding
// rect gives its offsetHeight.
function naturalHeight(element) {
  const placed = element.style.height;
  element.style.height = 'auto';
  const height = element.getBoundingClientRect ? element.getBoundingClientRect().height : element.offsetHeight;
  element.style.height = placed;
  return Math.ceil(height || 0);
}

register({
  type: 'form',
  label: 'Form',
  description: 'The window itself: caption, size and colour.',
  group: 'Container',
  container: true,
  toolbox: false,
  defaultSize: { width: 800, height: 560 },
  props: [
    { name: 'text', type: 'string', default: 'Form' },
    { name: 'backColor', type: 'color', default: '' },
    { name: 'scroll', type: 'enum', values: ['none', 'auto'], default: 'none', doc: 'none lets the form shrink with the window, its anchored controls moving in; auto keeps the designed size as a minimum and the page (or the Frame) scrolls instead.' }
  ],
  events: ['onLoad', 'onShow', 'onClosing', 'onClose', 'onResize', 'onKeyDown'],
  create() {
    const root = el('div', 'gd-form');
    return { el: root, contentEl: root };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    // The caption is what /run and a modal title bar read, so it stays at the top level too.
    if (name === 'text') node.text = value;
    else if (name === 'backColor') element.style.background = value || '';
    else if (name === 'scroll') {
      // The designed size as a minimum: the anchors work against the element's own size, so
      // nothing moves in, and whatever holds the form scrolls it. A running form then grows
      // the minimum to its content on every layout pass (FormInstance.fitToContent).
      const keep = value === 'auto';
      element.style.minWidth = keep ? `${Number(node.width) || 0}px` : '';
      element.style.minHeight = keep ? `${Number(node.height) || 0}px` : '';
    }
  }
});

register({
  type: 'button',
  label: 'Button',
  description: 'Trigger actions like calling the server or opening a form.',
  defaultSize: { width: 120, height: 28 },
  props: [
    { name: 'text', type: 'string', default: 'Button' },
    { name: 'icon', type: 'icon', default: '', doc: "A Lucide icon name such as 'save' or 'plus' (pick one in the Inspector); a short glyph such as an emoji works too." },
    { name: 'iconPosition', type: 'enum', values: ['left', 'right'], default: 'left' },
    { name: 'variant', type: 'enum', values: ['primary', 'default', 'danger'], default: 'primary' }
  ],
  events: ['onClick', 'onDoubleClick', 'onFocus', 'onBlur'],
  create() {
    const button = el('button', 'gd-widget gd-button', { type: 'button' });
    button.append(el('span', 'gd-button-text'));
    return { el: button };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'text') {
      element.querySelector('.gd-button-text').textContent = value ?? '';
      element.classList.toggle('gd-button-icon-only', !value && Boolean(element.querySelector('.gd-button-icon')));
    } else if (name === 'icon') {
      element.querySelector('.gd-button-icon')?.remove();
      const glyph = iconGlyph(value, 'gd-button-icon');
      if (glyph) element.prepend(glyph);
      element.classList.toggle('gd-button-icon-only', Boolean(glyph) && !element.querySelector('.gd-button-text').textContent);
    } else if (name === 'iconPosition') element.dataset.iconPosition = value === 'right' ? 'right' : 'left';
    else if (name === 'enabled') setDisabled(element, value);
    else if (name === 'variant') element.dataset.variant = value || 'primary';
  },
  bind(element, node, emit) {
    element.addEventListener('click', (e) => emit('onClick', e));
    element.addEventListener('dblclick', (e) => emit('onDoubleClick', e));
    element.addEventListener('focus', (e) => emit('onFocus', e));
    element.addEventListener('blur', (e) => emit('onBlur', e));
  }
});

register({
  type: 'label',
  label: 'Label',
  description: 'A line of static text, also handy for status messages.',
  defaultSize: { width: 100, height: 20 },
  props: [
    { name: 'text', type: 'string', default: 'Label' },
    { name: 'multiline', type: 'bool', default: false, doc: 'Lets the text wrap onto several lines; off, it stays on one line.' },
    { name: 'heightMode', type: 'enum', values: ['fixed', 'content'], default: 'fixed', doc: 'fixed keeps the designed height; content makes the label as tall as its text at its width (turn multiline on for wrapping), so what follows in a Column moves down.' },
    { name: 'align', type: 'enum', values: ['left', 'center', 'right'], default: 'left' },
    { name: 'bold', type: 'bool', default: false },
    { name: 'fontSize', type: 'number', default: 13 },
    { name: 'foreColor', type: 'color', default: '' }
  ],
  events: ['onClick'],
  valueProp: 'text',
  create() {
    return { el: el('div', 'gd-widget gd-label') };
  },
  // In content mode the label's height is its text's, at the width the layout gave it (see
  // naturalHeight), never less than a line, so an empty label keeps its place.
  measure(element, node) {
    const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
    if (props.heightMode !== 'content') return undefined;
    const natural = naturalHeight(element);
    const style = getComputedStyle(element);
    const line = parseFloat(style.lineHeight) || Math.ceil((parseFloat(style.fontSize) || 13) * 1.2);
    return Math.max(natural, Math.ceil(line));
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'text') element.textContent = value ?? '';
    else if (name === 'multiline') element.classList.toggle('gd-label-multiline', Boolean(value));
    else if (name === 'align') element.style.justifyContent = value === 'center' ? 'center' : value === 'right' ? 'flex-end' : 'flex-start';
    else if (name === 'bold') element.style.fontWeight = value ? '600' : '';
    else if (name === 'fontSize') element.style.fontSize = value ? `${value}px` : '';
    else if (name === 'foreColor') element.style.color = value || '';
  },
  bind(element, node, emit) {
    element.addEventListener('click', (e) => emit('onClick', e));
  }
});

register({
  type: 'link',
  label: 'Link',
  description: 'Text that acts like a hyperlink.',
  defaultSize: { width: 100, height: 20 },
  props: [
    { name: 'text', type: 'string', default: 'Link' },
    { name: 'icon', type: 'icon', default: '', doc: 'A Lucide icon name shown before the text (pick one in the Inspector); an emoji works too.' },
    { name: 'href', type: 'string', default: '' },
    { name: 'target', type: 'enum', values: ['_self', '_blank'], default: '_self' }
  ],
  events: ['onClick'],
  valueProp: 'text',
  create() {
    const link = el('a', 'gd-widget gd-link', { href: 'javascript:void(0)' });
    link.append(el('span', 'gd-link-text'));
    return { el: link };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'text') element.querySelector('.gd-link-text').textContent = value ?? '';
    else if (name === 'icon') {
      element.querySelector('.gd-link-icon')?.remove();
      const glyph = iconGlyph(value, 'gd-link-icon');
      if (glyph) element.prepend(glyph);
    } else if (name === 'href' || name === 'enabled') {
      // A disabled link has no href, so it neither navigates (a middle click or Open in new
      // tab included) nor takes the focus; enabling it again puts the href back.
      const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
      if (name === 'enabled') setDisabled(element, value);
      if (props.enabled === false) element.removeAttribute('href');
      else element.href = props.href || 'javascript:void(0)';
    } else if (name === 'target') element.target = value || '_self';
  },
  bind(element, node, emit) {
    element.addEventListener('click', (e) => {
      if (element.classList.contains('gd-disabled')) return;
      emit('onClick', e);
    });
  }
});

register({
  type: 'input',
  label: 'Input',
  description: 'Single-line text, number, date or password entry.',
  defaultSize: { width: 180, height: 28 },
  props: [
    { name: 'value', type: 'string', default: '' },
    { name: 'mode', type: 'enum', values: ['text', 'password', 'number', 'date', 'time', 'email'], default: 'text' },
    { name: 'placeholder', type: 'string', default: '' },
    { name: 'icon', type: 'icon', default: '', doc: 'A Lucide icon drawn inside the box, before the text (a search or mail glyph, say).' },
    { name: 'readOnly', type: 'bool', default: false },
    { name: 'maxLength', type: 'number', default: 0 }
  ],
  events: ['onChange', 'onInput', 'onKeyDown', 'onFocus', 'onBlur'],
  valueProp: 'value',
  // The root is a wrapper so the icon can be a real element beside the field (a background
  // image would be wiped by the browser's autofill styling); the <input> carries the id.
  create() {
    const wrap = el('span', 'gd-widget gd-input-wrap');
    const input = el('input', 'gd-input', { type: 'text' });
    wrap.append(input);
    return { el: wrap, idEl: input };
  },
  read(element, name) {
    if (name === 'value') return element.querySelector('input').value;
    return undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    const input = element.querySelector('input');
    if (name === 'value') input.value = value ?? '';
    else if (name === 'mode') input.type = value || 'text';
    else if (name === 'placeholder') input.placeholder = value ?? '';
    else if (name === 'icon') {
      element.querySelector('.gd-input-icon')?.remove();
      const glyph = iconGlyph(value, 'gd-input-icon');
      if (glyph) element.prepend(glyph);
      input.classList.toggle('gd-input-with-icon', Boolean(glyph));
    } else if (name === 'readOnly') input.readOnly = Boolean(value);
    else if (name === 'maxLength') {
      if (value > 0) input.maxLength = value;
      else input.removeAttribute('maxlength');
    } else if (name === 'enabled') setDisabled(element, value);
  },
  bind(element, node, emit) {
    const input = element.querySelector('input');
    input.addEventListener('change', (e) => emit('onChange', e));
    input.addEventListener('input', (e) => emit('onInput', e));
    input.addEventListener('keydown', (e) => emit('onKeyDown', e));
    input.addEventListener('focus', (e) => emit('onFocus', e));
    input.addEventListener('blur', (e) => emit('onBlur', e));
  }
});

register({
  type: 'textarea',
  label: 'Text Area',
  description: 'Multi-line text, optionally monospaced.',
  defaultSize: { width: 220, height: 90 },
  props: [
    { name: 'value', type: 'multiline', default: '' },
    { name: 'placeholder', type: 'string', default: '' },
    { name: 'readOnly', type: 'bool', default: false },
    { name: 'font', type: 'enum', values: ['default', 'monospace'], default: 'default' }
  ],
  events: ['onChange', 'onInput', 'onFocus', 'onBlur'],
  valueProp: 'value',
  create() {
    return { el: el('textarea', 'gd-widget gd-textarea') };
  },
  read(element, name) {
    return name === 'value' ? element.value : undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'value') element.value = value ?? '';
    else if (name === 'placeholder') element.placeholder = value ?? '';
    else if (name === 'readOnly') element.readOnly = Boolean(value);
    else if (name === 'font') element.classList.toggle('gd-mono', value === 'monospace');
    else if (name === 'enabled') setDisabled(element, value);
  },
  bind(element, node, emit) {
    element.addEventListener('change', (e) => emit('onChange', e));
    element.addEventListener('input', (e) => emit('onInput', e));
    element.addEventListener('focus', (e) => emit('onFocus', e));
    element.addEventListener('blur', (e) => emit('onBlur', e));
  }
});

// The item object a Combo Box or List Box is on: the entry of `items` whose value is the
// control's value (the first selected one of a multiple list), with the fields a row from a
// dataSource came with. Nothing selected, or a value no item has, is null.
function selectedItem(node, control) {
  const value = control.value;
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first === null || first === '') return null;
  return parseItems(control.items).find((item) => item.value === String(first)) || null;
}

// Every item object the control's value names, in the value's order (a multiple List Box has
// several); a value no item has is skipped.
function selectedItemList(node, control) {
  const value = control.value;
  const values = (Array.isArray(value) ? value : [value]).filter((v) => v !== undefined && v !== null && v !== '').map(String);
  const items = parseItems(control.items);
  return values.map((v) => items.find((item) => item.value === v)).filter(Boolean);
}

register({
  type: 'combobox',
  label: 'Combo Box',
  description: 'Pick one value from a list of options.',
  defaultSize: { width: 180, height: 28 },
  props: [
    { name: 'items', type: 'items', default: '' },
    { name: 'value', type: 'string', default: '' }
  ],
  events: ['onChange'],
  valueProp: 'value',
  dataProp: 'items',
  currentItem: selectedItem,
  create() {
    return { el: el('select', 'gd-widget gd-combobox') };
  },
  read(element, name) {
    return name === 'value' ? element.value : undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'items') {
      const wanted = element.value;
      element.replaceChildren(
        ...parseItems(value).map((item) => el('option', null, { value: item.value, textContent: item.text }))
      );
      element.value = node.props && node.props.value !== undefined && node.props.value !== '' ? node.props.value : wanted;
    } else if (name === 'value') element.value = value ?? '';
    else if (name === 'enabled') setDisabled(element, value);
  },
  bind(element, node, emit) {
    element.addEventListener('change', (e) => emit('onChange', e));
  }
});

// The Autocomplete: an Input whose suggestions come from `items`, filtered as the user types,
// or from a dataSource called with the typed text (the server filters). Picking one sets
// `value` and `text`, the Combo Box's pair. The list sits on the body while open, so no
// container clips it. autocomplete.js holds the pure parts.
const acProps = (node) => ({ ...defaultPropsOf(node.type), ...(node.props || {}) });

function acClose(state) {
  state.open = false;
  state.active = -1;
  state.list.remove();
}

function acPlace(state) {
  const rect = state.input.getBoundingClientRect();
  state.list.style.left = `${rect.left}px`;
  state.list.style.top = `${rect.bottom + 2}px`;
  state.list.style.width = `${rect.width}px`;
}

function acRender(state) {
  state.list.replaceChildren(
    ...state.shown.map((item, index) => {
      const row = el('div', `gd-autocomplete-item${index === state.active ? ' gd-autocomplete-item-active' : ''}`, { textContent: item.text });
      // mousedown, so the pick lands before the field blurs and the list goes.
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        acPick(state, index);
      });
      return row;
    })
  );
}

// Shows the suggestions for what is in the box: the server's answer as it is, or the local
// filter of `items`. Nothing to show closes the list.
function acOpen(state) {
  const props = acProps(state.node);
  const max = Number(props.maxItems) || 8;
  state.shown = props.dataSource ? state.items.slice(0, max) : filterSuggestions(state.items, state.input.value, max);
  if (state.shown.length === 0) {
    acClose(state);
    return;
  }
  state.active = 0;
  acRender(state);
  acPlace(state);
  if (!state.open) {
    document.body.append(state.list);
    state.open = true;
  }
}

function acPick(state, index) {
  const item = state.shown[index];
  if (!item) return;
  const changed = state.value !== item.value;
  state.value = item.value;
  state.picked = item;
  state.input.value = item.text;
  acClose(state);
  state.emit?.('onSelect', { value: item.value, text: item.text, item });
  if (changed) state.emit?.('onChange', { value: item.value, text: item.text });
}

// What typing does: below minChars the list closes; with a dataSource the server is asked
// after `delay` ms of quiet (the answer lands in `items` and opens the list); without one
// the local filter opens it at once.
function acQuery(state) {
  const props = acProps(state.node);
  const text = state.input.value;
  if (text.length < (Number(props.minChars) || 0)) {
    acClose(state);
    return;
  }
  if (props.dataSource && state.host?.reload) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      state.pending = true;
      state.host.reload(state.node, [text, ...parseDataArgs(props.dataArgs)]);
    }, Number(props.delay) || 0);
  } else acOpen(state);
}

register({
  type: 'autocomplete',
  label: 'Autocomplete',
  description: 'Type to pick from suggestions: a fixed list, or what the server finds for the text.',
  defaultSize: { width: 180, height: 28 },
  props: [
    { name: 'value', type: 'string', default: '', doc: 'The value of the suggestion picked; empty while the text matches none.' },
    { name: 'text', type: 'string', default: '', doc: 'What the box shows; typing changes it and clears value until a suggestion is picked.' },
    { name: 'placeholder', type: 'string', default: '' },
    { name: 'icon', type: 'icon', default: '', doc: 'A Lucide icon drawn inside the box, before the text (a search glyph, say).' },
    { name: 'readOnly', type: 'bool', default: false },
    { name: 'items', type: 'items', default: '', tsType: 'string | any[]', doc: 'The suggestions: one per line as value=Text, or an array of strings or { value, text, ... } objects from code; what dataSource fills.' },
    { name: 'minChars', type: 'number', default: 1, min: 0, doc: 'Typed characters before suggestions show or the server is asked.' },
    { name: 'delay', type: 'number', default: 250, min: 0, doc: 'Milliseconds of quiet before the server is asked.' },
    { name: 'maxItems', type: 'number', default: 8, min: 1, doc: 'Suggestions shown at most.' },
    { name: 'dataSource', type: 'function', default: '', placeholder: 'script.fn', doc: 'A server script function, "script.fn" (a script of this module) or "Module.script.fn", called with the typed text first and dataArgs after; what it returns becomes the suggestions.' },
    { name: 'dataArgs', type: 'args', default: '', tsType: 'any[]', doc: 'Arguments handed to the source after the typed text.' },
    { name: 'autoLoad', type: 'bool', default: false, doc: 'Calls the source when the form opens (with dataArgs only); off by default, since a lookup waits for text.' }
  ],
  events: ['onSelect', 'onChange', 'onInput', 'onKeyDown', 'onFocus', 'onBlur', 'onDataLoaded', 'onDataError'],
  valueProp: 'value',
  dataProp: 'items',
  bindable: false,
  // The suggestion picked (the one the value names), or null while the text matches none.
  currentItem(node) {
    const state = node.__ac;
    if (!state || state.value === '') return null;
    if (state.picked && state.picked.value === state.value) return state.picked;
    return state.items.find((item) => item.value === state.value) || null;
  },
  create(node, host) {
    const wrap = el('span', 'gd-widget gd-input-wrap gd-autocomplete');
    const input = el('input', 'gd-input', { type: 'text', autocomplete: 'off' });
    wrap.append(input);
    const list = el('div', 'gd-autocomplete-list');
    const state = { host, node, input, list, items: [], shown: [], value: '', active: -1, open: false, focused: false, timer: null, pending: false, emit: null };
    node.__ac = state;
    wrap.__gdNode = node;
    // The canvas is a picture; only a running form types.
    if (host?.mode !== 'design') {
      input.addEventListener('input', () => {
        if (state.value !== '') {
          state.value = '';
          state.emit?.('onChange', { value: '', text: input.value });
        }
        acQuery(state);
      });
      input.addEventListener('keydown', (e) => {
        if (!state.open) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : -1;
          state.active = (state.active + step + state.shown.length) % state.shown.length;
          acRender(state);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          acPick(state, state.active);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          acClose(state);
        }
      });
      input.addEventListener('focus', () => {
        state.focused = true;
      });
      input.addEventListener('blur', () => {
        state.focused = false;
        acClose(state);
      });
      state.onWindow = () => {
        if (state.open) acClose(state);
      };
      window.addEventListener('scroll', state.onWindow, true);
      window.addEventListener('resize', state.onWindow);
    }
    return { el: wrap, idEl: input };
  },
  read(element, name) {
    const state = element.__gdNode?.__ac;
    if (!state) return undefined;
    if (name === 'value') return state.value;
    if (name === 'text') return state.input.value;
    return undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    const state = node.__ac;
    const input = state.input;
    if (name === 'value') {
      state.value = value === undefined || value === null ? '' : String(value);
      const item = state.items.find((i) => i.value === state.value);
      input.value = item ? item.text : state.value;
    } else if (name === 'text') input.value = value ?? '';
    else if (name === 'items') {
      state.items = parseSuggestions(value);
      // A value set before the list arrived now gets its text.
      if (state.value && input.value === '') {
        const item = state.items.find((i) => i.value === state.value);
        if (item) input.value = item.text;
      }
      if (state.open || (state.focused && state.pending)) acOpen(state);
      state.pending = false;
    } else if (name === 'placeholder') input.placeholder = value ?? '';
    else if (name === 'icon') {
      element.querySelector('.gd-input-icon')?.remove();
      const glyph = iconGlyph(value, 'gd-input-icon');
      if (glyph) element.prepend(glyph);
      input.classList.toggle('gd-input-with-icon', Boolean(glyph));
    } else if (name === 'readOnly') input.readOnly = Boolean(value);
    else if (name === 'enabled') setDisabled(element, value);
  },
  bind(element, node, emit) {
    const state = node.__ac;
    state.emit = emit;
    const input = state.input;
    input.addEventListener('input', (e) => emit('onInput', e));
    input.addEventListener('keydown', (e) => emit('onKeyDown', e));
    input.addEventListener('focus', (e) => emit('onFocus', e));
    input.addEventListener('blur', (e) => emit('onBlur', e));
  },
  dispose(element, node) {
    const state = node.__ac;
    if (!state) return;
    clearTimeout(state.timer);
    acClose(state);
    if (state.onWindow) {
      window.removeEventListener('scroll', state.onWindow, true);
      window.removeEventListener('resize', state.onWindow);
    }
  }
});

// Radios exclude each other per container, as in WinForms: the DOM name is the parent's id, plus
// the group label when one is set, so two group boxes each hold their own set without any setup.
// In the running app the name starts with the form instance's scope too (`f7:grpA`): the browser
// groups radios by name across the whole page, and two forms on it - one hidden by form.open(),
// a modal over a form, a Frame's form and its host - may use the same container ids.
function scopedGroup(node, group) {
  const parent = node.__parent;
  const scope = (parent && (parent.id || parent.name)) || 'form';
  const name = group ? `${scope}.${group}` : scope;
  return node.__formScope ? `${node.__formScope}:${name}` : name;
}

function checkable(type, label, inputType, options = {}) {
  register({
    type,
    label,
    description:
      options.description ||
      (inputType === 'radio'
        ? 'One choice out of a group; radios sharing a group name exclude each other.'
        : 'A yes / no switch with a label next to it.'),
    defaultSize: { width: 140, height: 24 },
    props: [
      { name: 'text', type: 'string', default: label },
      { name: 'checked', type: 'bool', default: false },
      ...(inputType === 'radio' ? [{ name: 'group', type: 'string', default: '', placeholder: 'this container' }] : []),
      ...(inputType === 'radio' ? [{ name: 'value', type: 'string', default: '' }] : [])
    ],
    events: ['onChange', 'onClick'],
    valueProp: 'checked',
    create(node, host) {
      // The form instance's scope, for the group name (see scopedGroup); none on the canvas.
      if (inputType === 'radio' && host && host.scope) node.__formScope = host.scope;
      const wrapper = el('label', `gd-widget gd-${type}`);
      const box = el('input', null, { type: inputType });
      const caption = el('span', 'gd-caption');
      // A toggle draws its own track; the checkbox underneath keeps keyboard and form semantics.
      if (options.track) wrapper.append(box, el('span', 'gd-toggle-track'), caption);
      else wrapper.append(box, caption);
      return { el: wrapper };
    },
    read(element, name) {
      if (name === 'checked') return element.querySelector('input').checked;
      return undefined;
    },
    apply(element, node, name, value) {
      if (applyCommon(element, name, value)) return;
      const box = element.querySelector('input');
      if (name === 'text') element.querySelector('.gd-caption').textContent = value ?? '';
      else if (name === 'checked') box.checked = Boolean(value);
      else if (name === 'group') box.name = scopedGroup(node, value);
      else if (name === 'value') box.value = value ?? '';
      else if (name === 'enabled') setDisabled(element, value);
    },
    // The parent is only known once the control is in the tree, so the scope is settled here:
    // after the build, and again when a code-created radio is added to a container.
    refresh(element, node) {
      if (inputType !== 'radio') return;
      element.querySelector('input').name = scopedGroup(node, node.props && node.props.group);
    },
    bind(element, node, emit) {
      const box = element.querySelector('input');
      box.addEventListener('change', (e) => emit('onChange', e));
      box.addEventListener('click', (e) => emit('onClick', e));
    }
  });
}

checkable('checkbox', 'Check Box', 'checkbox');
checkable('radio', 'Radio', 'radio');
checkable('toggle', 'Toggle', 'checkbox', { track: true, description: 'A switch that is on or off, with a label next to it.' });

// The slider's numeric bounds. A max at or below the min means "no max", so the 0..100 defaults
// never trap a value a script sets.
function applyBounds(element, name, value, node) {
  const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
  const min = Number(props.min);
  const max = Number(props.max);
  const step = Number(props.step);
  element.min = Number.isFinite(min) ? String(min) : '';
  element.max = Number.isFinite(max) && max > min ? String(max) : '';
  element.step = Number.isFinite(step) && step > 0 ? String(step) : 'any';
  // Bounds clamp the value the browser shows, so re-apply it after they change.
  const current = props.value;
  element.value = current === '' || current === null || current === undefined ? '' : String(current);
}

register({
  type: 'slider',
  label: 'Slider',
  description: 'Pick a number by dragging a thumb.',
  defaultSize: { width: 180, height: 24 },
  props: [
    { name: 'value', type: 'number', default: 50 },
    { name: 'min', type: 'number', default: 0 },
    { name: 'max', type: 'number', default: 100 },
    { name: 'step', type: 'number', default: 1, min: 0 }
  ],
  events: ['onChange', 'onInput'],
  valueProp: 'value',
  create() {
    return { el: el('input', 'gd-widget gd-slider', { type: 'range' }) };
  },
  read(element, name) {
    return name === 'value' ? Number(element.value) : undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'value' || name === 'min' || name === 'max' || name === 'step') applyBounds(element, name, value, node);
    else if (name === 'enabled') setDisabled(element, value);
  },
  bind(element, node, emit) {
    element.addEventListener('change', (e) => emit('onChange', e));
    element.addEventListener('input', (e) => emit('onInput', e));
  }
});

register({
  type: 'listbox',
  label: 'List Box',
  description: 'A scrolling list of items; pick one, or several.',
  defaultSize: { width: 180, height: 120 },
  props: [
    { name: 'items', type: 'items', default: '' },
    { name: 'value', type: 'string', default: '' },
    { name: 'multiple', type: 'bool', default: false }
  ],
  events: ['onChange', 'onDoubleClick'],
  valueProp: 'value',
  dataProp: 'items',
  currentItem: selectedItem,
  selectedItems: selectedItemList,
  create() {
    // Any size above one renders a select as a list; the CSS stretches it to the widget box.
    return { el: el('select', 'gd-widget gd-listbox', { size: 2 }) };
  },
  read(element, name) {
    if (name !== 'value') return undefined;
    if (element.multiple) return [...element.selectedOptions].map((option) => option.value);
    return element.value;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'items') {
      const wanted = element.value;
      element.replaceChildren(
        ...parseItems(value).map((item) => el('option', null, { value: item.value, textContent: item.text }))
      );
      const props = node.props || {};
      selectValues(element, props.value !== undefined && props.value !== '' ? props.value : wanted);
    } else if (name === 'value') selectValues(element, value);
    else if (name === 'multiple') {
      // Props apply in declaration order, so the value may have landed before this flag.
      element.multiple = Boolean(value);
      selectValues(element, (node.props || {}).value);
    } else if (name === 'enabled') setDisabled(element, value);
  },
  bind(element, node, emit) {
    element.addEventListener('change', (e) => emit('onChange', e));
    element.addEventListener('dblclick', (e) => emit('onDoubleClick', e));
  }
});

// A list box value is one string, or an array (or comma list) when several may be selected.
function selectValues(element, value) {
  const wanted = Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)];
  if (element.multiple) {
    const set = new Set(wanted.length === 1 && wanted[0].includes(',') ? wanted[0].split(',').map((v) => v.trim()) : wanted);
    for (const option of element.options) option.selected = set.has(option.value);
  } else {
    element.value = wanted[0] ?? '';
  }
}

// The Data Grid wraps Tabulator, loaded on first use. Everything the code behind needs is a
// property (rows, selectedRows, selectedIndex, table) so the Control facade stays generic; the
// table itself is created once the library is in and the element is on the page.
const GRID_REBUILD = new Set(['selectable', 'pagination', 'placeholder']);
// The density presets: a data attribute on the host the skin sizes rows, cells and header by.
const DENSITIES = new Set(['compact', 'comfortable', 'spacious']);

function gridProps(node) {
  return { ...defaultPropsOf(node.type), ...(node.props || {}) };
}

function gridRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// The formatter of a column with an attributesField: the value as text, as the default
// formatter draws it, plus what the row's attributes say - the tone, the colours (two custom
// properties the skin reads), bold, italic, a Lucide icon before the text and a tooltip.
// Tabulator calls it again on the same cell element when the value changes, so it first takes
// its own marks off, and only those: the element also carries Tabulator's width, alignment and
// classes.
const NBSP = String.fromCharCode(160);

function cellAttrsFormatter(cell, params) {
  const element = cell.getElement();
  element.removeAttribute('data-tone');
  element.classList.remove('gd-cell-bold', 'gd-cell-italic', 'gd-cell-colored');
  element.style.removeProperty('--gd-cell-fg');
  element.style.removeProperty('--gd-cell-bg');
  element.removeAttribute('title');
  const value = cell.getValue();
  const text = document.createTextNode(value === null || value === undefined || value === '' ? NBSP : String(value));
  const attrs = parseCellAttrs(getPath(cell.getData(), params && params.attributesField));
  if (!attrs) return text;
  if (attrs.severity) element.dataset.tone = attrs.severity;
  if (attrs.bold) element.classList.add('gd-cell-bold');
  if (attrs.italic) element.classList.add('gd-cell-italic');
  if (attrs.textColor) element.style.setProperty('--gd-cell-fg', attrs.textColor);
  if (attrs.backgroundColor) element.style.setProperty('--gd-cell-bg', attrs.backgroundColor);
  if (attrs.textColor || attrs.backgroundColor) element.classList.add('gd-cell-colored');
  if (attrs.tooltip) element.title = attrs.tooltip;
  if (!attrs.icon) return text;
  const icon = lucideIcon(attrs.icon, 'gd-cell-icon');
  if (attrs.iconColor) icon.style.color = attrs.iconColor;
  const fragment = document.createDocumentFragment();
  fragment.append(icon, text);
  return fragment;
}

function gridColumns(props) {
  return toTabulatorColumns(parseColumns(props.columns), { editable: Boolean(props.editable), sortable: props.sortable !== false, attributesFormatter: cellAttrsFormatter, frozenLeft: props.frozenLeft, frozenRight: props.frozenRight });
}

// The first segment of every column's attributesField: the row fields whose change must redraw
// the cells that read them.
function attributeRoots(node) {
  const roots = new Set();
  for (const column of parseColumns(gridProps(node).columns)) {
    if (column.attributesField) roots.add(column.attributesField.split('.')[0].trim());
  }
  return roots;
}

function buildGrid(node) {
  const state = node.__grid;
  if (!state || state.disposed) return;
  const element = state.inner;
  // Tabulator measures its host, so wait for the element to be on the page (a few frames at most).
  if (!element.isConnected) {
    if (state.waits++ < 120) requestAnimationFrame(() => buildGrid(node));
    return;
  }
  state.waits = 0;
  if (state.table) {
    state.table.destroy();
    state.table = null;
  }
  const props = gridProps(node);
  const design = state.host?.mode === 'design';
  let rows = gridRows(props.rows);
  const columns = gridColumns(props);
  // On the canvas an empty grid still shows its shape: a few blank rows under the headers.
  if (design && rows.length === 0 && columns.length > 0) rows = [{}, {}, {}];
  const pageSize = Number(props.pagination) || 0;
  const table = new state.Tabulator(element, {
    data: rows,
    columns,
    layout: 'fitColumns',
    height: '100%',
    placeholder: props.placeholder || '',
    selectableRows: design ? false : props.selectable === 'multiple' ? true : props.selectable === 'none' ? false : 1,
    selectableRowsRangeMode: 'click',
    editTriggerEvent: 'dblclick',
    ...(pageSize > 0 ? { pagination: true, paginationMode: 'local', paginationSize: pageSize, paginationCounter: 'rows' } : {})
  });
  state.table = table;
  table.on('tableBuilt', () => {
    if (state.table !== table) return;
    // Anything set while the table was still building lands here.
    if (state.pending) {
      state.pending = false;
      const latest = gridProps(node);
      table.setColumns(gridColumns(latest));
      table.setData(gridRows(latest.rows));
    }
    const wanted = Number(gridProps(node).selectedIndex);
    if (wanted >= 0) gridSelect(state, wanted);
  });
  if (!design) {
    const emit = (event, payload) => state.emit?.(event, payload);
    table.on('rowClick', (e, row) => emit('onRowClick', { row: row.getData(), index: row.getPosition(true) - 1 }));
    table.on('rowDblClick', (e, row) => emit('onRowDoubleClick', { row: row.getData(), index: row.getPosition(true) - 1 }));
    table.on('rowSelectionChanged', (data) => emit('onSelectionChange', { rows: data }));
    table.on('cellEdited', (cell) => emit('onCellEdit', { row: cell.getData(), field: cell.getField(), value: cell.getValue(), oldValue: cell.getOldValue() }));
  }
}

// The selected rows in the grid's order (Tabulator's own list is in the order they were
// clicked), each wrapped so that assigning a field redraws its cell. A field that holds a
// column's attributes redraws the whole row once the update has landed: Tabulator re-lays only
// the cell of the field itself, not the cells that read it.
function gridSelected(node) {
  const table = node.__grid?.table;
  if (!table || !table.initialized) return [];
  const roots = attributeRoots(node);
  return table
    .getRows('active')
    .filter((row) => row.isSelected())
    .map((row) =>
      liveRecord(row.getData(), (key, value) => {
        const updated = row.update({ [key]: value });
        if (roots.has(key)) updated.then(() => row.reformat()).catch((err) => node.__grid?.host?.reportError?.(err, `${node.id}.${key}`));
      })
    );
}

function gridSelect(state, index) {
  const table = state.table;
  if (!table) return;
  table.deselectRow();
  const rows = table.getRows('active');
  if (index >= 0 && rows[index]) table.selectRow(rows[index]);
}

register({
  type: 'datagrid',
  label: 'Data Grid',
  description: 'Rows and columns from your data: sortable, selectable, optionally editable.',
  defaultSize: { width: 360, height: 200 },
  props: [
    { name: 'columns', type: 'columns', default: 'id | ID | 60\nname | Name', tsType: 'string | GdGridColumn[]', doc: 'One column per line as "field | Title | width | align", or an array of column objects.' },
    { name: 'rows', type: 'json', default: '', tsType: 'any[]', doc: 'The row objects shown; assign an array from code. Reads back the live rows, edits included.' },
    { name: 'selectable', type: 'enum', values: ['none', 'single', 'multiple'], default: 'single' },
    { name: 'editable', type: 'bool', default: false, doc: 'Lets the user edit cells (double click); onCellEdit reports each change.' },
    { name: 'sortable', type: 'bool', default: true },
    { name: 'pagination', type: 'number', default: 0, min: 0, doc: 'Rows per page; 0 shows all rows in one scrolling list.' },
    { name: 'placeholder', type: 'string', default: 'No rows' },
    { name: 'density', type: 'enum', values: ['compact', 'comfortable', 'spacious'], default: 'comfortable', doc: 'Row height and cell padding: compact, comfortable or spacious.' },
    { name: 'frozenLeft', type: 'number', default: 0, min: 0, doc: 'How many of the first columns stay in view while the grid scrolls sideways.' },
    { name: 'frozenRight', type: 'number', default: 0, min: 0, doc: 'How many of the last columns stay in view while the grid scrolls sideways.' },
    { name: 'selectedIndex', type: 'number', default: -1, hidden: true, doc: 'The position of the selected row, or -1; set it to select a row from code.' },
    { name: 'selectedRows', type: 'json', hidden: true, readonly: true, tsType: 'any[]', doc: 'The row objects currently selected.' },
    { name: 'table', type: 'json', hidden: true, readonly: true, tsType: 'any', doc: 'The underlying Tabulator table, for anything the grid does not expose itself.' }
  ],
  events: ['onRowClick', 'onRowDoubleClick', 'onSelectionChange', 'onCellEdit'],
  dataProp: 'rows',
  // The selected rows' objects, in the grid's order (selectedItems), and the first of them or
  // null (currentItem): the records the grid is on. Live: assigning a field updates the row
  // through Tabulator, so the cell redraws (without an onCellEdit, since nobody edited a cell)
  // and grid.rows carries the value.
  currentItem(node) {
    return gridSelected(node)[0] || null;
  },
  selectedItems(node) {
    return gridSelected(node);
  },
  create(node, host) {
    const root = el('div', 'gd-widget gd-datagrid');
    const inner = el('div', 'gd-datagrid-table');
    root.append(inner);
    root.__gdNode = node;
      node.__grid = { inner, host, table: null, Tabulator: null, emit: null, waits: 0, pending: false, disposed: false };
    loadTabulator()
      .then((Tabulator) => {
        node.__grid.Tabulator = Tabulator;
        buildGrid(node);
      })
      .catch((err) => {
        inner.textContent = err.message;
      });
    return { el: root };
  },
  read(element, name) {
    const table = element.__gdNode?.__grid?.table || null;
    if (name === 'table') return table;
    if (!table) return undefined;
    if (name === 'rows') return table.getData();
    if (name === 'selectedRows') return table.getSelectedData();
    if (name === 'selectedIndex') {
      const selected = table.getSelectedRows()[0];
      return selected ? selected.getPosition(true) - 1 : -1;
    }
    return undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    const state = node.__grid;
    const table = state?.table;
    if (name === 'enabled') element.classList.toggle('gd-disabled', value === false);
    // The skin does the sizing; the setter's refresh (redraw(true)) re-measures every row after.
    else if (name === 'density') element.dataset.density = DENSITIES.has(value) ? value : 'comfortable';
    else if (name === 'selectedRows' || name === 'table') return;
    else if (!table) return; // buildGrid reads node.props once the library has landed
    else if (!table.initialized) state.pending = true; // replayed on tableBuilt
    else if (name === 'columns' || name === 'editable' || name === 'sortable' || name === 'frozenLeft' || name === 'frozenRight') table.setColumns(gridColumns(gridProps(node)));
    else if (name === 'rows') table.setData(gridRows(value));
    else if (name === 'selectedIndex') gridSelect(state, Number(value));
    else if (GRID_REBUILD.has(name)) buildGrid(node);
  },
  bind(element, node, emit) {
    node.__grid.emit = emit;
  },
  refresh(element, node) {
    const table = node.__grid?.table;
    if (table && table.initialized && element.isConnected) table.redraw(true);
  },
  // Its form goes out of sight (form.open()): Tabulator still redraws at 0 x 0 and loses where
  // the rows were scrolled, so the offsets are kept here, while the grid is still measurable.
  hidden(element, node) {
    const holder = node.__grid?.table ? element.querySelector('.tabulator-tableholder') : null;
    if (holder) node.__grid.scrolled = { top: holder.scrollTop, left: holder.scrollLeft };
  },
  // And back: redrawn at its real size first (the holder gets its height back), then scrolled
  // to where it was; Tabulator's own redraw on becoming visible keeps that position.
  shown(element, node) {
    const state = node.__grid;
    const at = state?.scrolled;
    if (!state || !at) return;
    state.scrolled = null;
    if (!state.table || !state.table.initialized) return;
    state.table.redraw();
    const holder = element.querySelector('.tabulator-tableholder');
    if (holder) {
      holder.scrollTop = at.top;
      holder.scrollLeft = at.left;
    }
  },
  dispose(element, node) {
    const state = node.__grid;
    if (!state) return;
    state.disposed = true;
    if (state.table) {
      state.table.destroy();
      state.table = null;
    }
  }
});

// The Tree View. Its node objects are the model (expanded and checked live on them), the rows
// are re-rendered whole on every change - trees on a form are small - and the keyboard walks the
// visible rows. On the canvas only the chevrons react, and only visually.
const TREE_STATE = new Set(['selectedValue', 'selectedNode', 'checkedValues', 'checkedNodes']);

function treeProps(node) {
  return { ...defaultPropsOf(node.type), ...(node.props || {}) };
}

function treeRows(node) {
  return flattenVisible(node.__tree.roots, { expandAll: Boolean(treeProps(node).expandAll) });
}

function renderTree(node) {
  const state = node.__tree;
  const element = state.element;
  const props = treeProps(node);
  const design = state.host?.mode === 'design';
  const rows = treeRows(node);
  if (state.selected && !rows.some((r) => r.node === state.selected)) {
    // The selected node is still in the tree, only folded away; keep it. Gone entirely: drop it.
    if (!findByValue(state.roots, state.selected.value)) state.selected = null;
  }
  state.rows = new Map();
  element.replaceChildren(
    ...rows.map(({ node: item, depth }) => {
      const row = el('div', 'gd-tree-row', { role: 'treeitem' });
      row.style.paddingLeft = `${6 + depth * 16}px`;
      const branch = (item.children || []).length > 0;
      const open = branch && (props.expandAll || item.expanded);
      if (branch) row.setAttribute('aria-expanded', open ? 'true' : 'false');
      row.setAttribute('aria-selected', item === state.selected ? 'true' : 'false');
      row.classList.toggle('gd-tree-row-selected', item === state.selected);
      const chevron = el('span', 'gd-tree-chevron' + (branch ? ' gd-designer-interactive' : ' gd-tree-chevron-leaf'));
      if (branch && design) chevron.dataset.gdClick = '';
      row.append(chevron);
      if (props.checkboxes) {
        const check = el('input', 'gd-tree-check', { type: 'checkbox', checked: Boolean(item.checked), tabIndex: -1 });
        check.indeterminate = Boolean(item.indeterminate) && !item.checked;
        row.append(check);
      }
      const glyph = open && item.iconExpanded ? item.iconExpanded : item.icon;
      if (glyph) {
        // A Lucide name draws from the sprite; anything short (an emoji) is shown as text.
        const holder = el('span', 'gd-tree-icon');
        if (isIconName(glyph)) holder.append(lucideIcon(glyph));
        else holder.textContent = glyph.length <= 3 ? glyph : '';
        row.append(holder);
      }
      row.append(el('span', 'gd-tree-text', { textContent: item.text }));
      state.rows.set(row, item);
      return row;
    })
  );
}

function treeEmit(node, event, payload) {
  node.__tree.emit?.(event, payload);
}

function treeSelect(node, item, { reveal = false } = {}) {
  const state = node.__tree;
  const changed = state.selected !== (item || null);
  state.selected = item || null;
  let revealed = false;
  if (reveal && item) {
    for (const parent of pathTo(state.roots, item)) {
      if (!parent.expanded) revealed = true;
      parent.expanded = true;
    }
  }
  // Rows are only rebuilt when the set of visible rows changes; a plain selection change marks
  // the existing rows in place, so a double click still lands on the same element twice.
  if (revealed) renderTree(node);
  else treeMarkSelection(node);
  if (reveal && item) treeScrollTo(node, item);
  if (changed) treeEmit(node, 'onSelect', { node: state.selected, value: state.selected ? state.selected.value : '' });
}

function treeMarkSelection(node) {
  const state = node.__tree;
  for (const [row, item] of state.rows) {
    const selected = item === state.selected;
    row.classList.toggle('gd-tree-row-selected', selected);
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
  }
}

function treeScrollTo(node, item) {
  for (const [row, candidate] of node.__tree.rows) if (candidate === item) row.scrollIntoView({ block: 'nearest' });
}

function treeToggle(node, item, expanded = !item.expanded) {
  if (!(item.children || []).length) return;
  const props = treeProps(node);
  if (props.expandAll && !expanded) {
    // Folding one branch under expandAll: the flag becomes per-node state from here on.
    walk(node.__tree.roots, (n) => {
      n.expanded = true;
      return true;
    });
    node.props = { ...node.props, expandAll: false };
  }
  item.expanded = expanded;
  renderTree(node);
  treeEmit(node, 'onExpand', { node: item, expanded });
}

function treeCheck(node, item, checked = !item.checked) {
  const state = node.__tree;
  if (treeProps(node).checkCascade) {
    setCheckedDeep(item, checked);
    recomputeChecked(state.roots);
  } else {
    item.checked = checked;
    item.indeterminate = false;
  }
  // Boxes are updated in place so a click never lands on a rebuilt row.
  for (const [row, candidate] of state.rows) {
    const box = row.querySelector('.gd-tree-check');
    if (!box) continue;
    box.checked = Boolean(candidate.checked);
    box.indeterminate = Boolean(candidate.indeterminate) && !candidate.checked;
  }
  treeEmit(node, 'onCheck', { node: item, checked });
}

function treeKey(node, e) {
  const state = node.__tree;
  const rows = treeRows(node);
  if (!rows.length) return;
  const index = rows.findIndex((r) => r.node === state.selected);
  const current = index >= 0 ? rows[index] : null;
  const go = (i) => treeSelect(node, rows[Math.max(0, Math.min(rows.length - 1, i))].node, { reveal: true });
  switch (e.key) {
    case 'ArrowDown': go(index + 1); break;
    case 'ArrowUp': go(index <= 0 ? 0 : index - 1); break;
    case 'Home': go(0); break;
    case 'End': go(rows.length - 1); break;
    case 'ArrowRight':
      if (!current) go(0);
      else if ((current.node.children || []).length && !(treeProps(node).expandAll || current.node.expanded)) treeToggle(node, current.node, true);
      else if ((current.node.children || []).length) go(index + 1);
      break;
    case 'ArrowLeft':
      if (!current) go(0);
      else if ((current.node.children || []).length && (treeProps(node).expandAll || current.node.expanded)) treeToggle(node, current.node, false);
      else if (current.parent) treeSelect(node, current.parent);
      break;
    case ' ':
      if (current && treeProps(node).checkboxes) treeCheck(node, current.node);
      break;
    case 'Enter':
      if (current) treeEmit(node, 'onNodeDoubleClick', { node: current.node, value: current.node.value });
      break;
    default:
      return;
  }
  e.preventDefault();
}

register({
  type: 'treeview',
  label: 'Tree View',
  description: 'A hierarchy of nodes to expand, select and tick.',
  defaultSize: { width: 220, height: 200 },
  props: [
    { name: 'nodes', type: 'nodes', default: 'Fruit\n  Apple\n  Pear\nVegetables\n  Carrot', tsType: 'string | GdTreeNode[]', doc: 'One node per line with children indented by two spaces ("value=Text | icon"), or an array of node objects. Reads back the live node objects.' },
    { name: 'checkboxes', type: 'bool', default: false, doc: 'A check box on every node; checkedValues and onCheck follow them.' },
    { name: 'checkCascade', type: 'bool', default: true, doc: 'Ticking a branch ticks everything under it, and a branch shows a dash while only some of its children are ticked.' },
    { name: 'expandAll', type: 'bool', default: false, doc: 'Shows every branch open.' },
    { name: 'selectedValue', type: 'string', default: '', hidden: true, doc: 'The value of the selected node, or ""; set it to select (and reveal) a node from code.' },
    { name: 'selectedNode', type: 'json', hidden: true, readonly: true, tsType: 'GdTreeNode | null', doc: 'The selected node object.' },
    { name: 'checkedValues', type: 'json', hidden: true, tsType: 'string[]', doc: 'The values of the ticked nodes; assign an array to tick from code.' },
    { name: 'checkedNodes', type: 'json', hidden: true, readonly: true, tsType: 'GdTreeNode[]', doc: 'The ticked node objects.' }
  ],
  events: ['onSelect', 'onNodeDoubleClick', 'onExpand', 'onCheck'],
  dataProp: 'nodes',
  // The selected node object, or null.
  currentItem(node) {
    return node.__tree?.selected || null;
  },
  create(node, host) {
    const element = el('div', 'gd-widget gd-treeview', { tabIndex: 0 });
    element.setAttribute('role', 'tree');
    element.__gdNode = node;
    node.__tree = { element, host, roots: [], selected: null, rows: new Map(), emit: null };
    const design = host?.mode === 'design';
    element.addEventListener('click', (e) => {
      const row = e.target.closest('.gd-tree-row');
      if (!row) return;
      const item = node.__tree.rows.get(row);
      if (!item) return;
      if (e.target.closest('.gd-tree-chevron')) {
        e.stopPropagation();
        if (design) {
          item.expanded = !(treeProps(node).expandAll || item.expanded);
          if (treeProps(node).expandAll) node.props = { ...node.props };
          renderTree(node);
        } else treeToggle(node, item);
        return;
      }
      if (design) return;
      if (e.target.classList.contains('gd-tree-check')) {
        treeCheck(node, item, e.target.checked);
        return;
      }
      treeSelect(node, item);
    });
    if (!design) {
      element.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.gd-tree-row');
        const item = row && node.__tree.rows.get(row);
        if (!item || e.target.closest('.gd-tree-chevron, .gd-tree-check')) return;
        if ((item.children || []).length) treeToggle(node, item);
        treeEmit(node, 'onNodeDoubleClick', { node: item, value: item.value });
      });
      element.addEventListener('keydown', (e) => treeKey(node, e));
    }
    return { el: element };
  },
  read(element, name) {
    const state = element.__gdNode?.__tree;
    if (!state) return undefined;
    if (name === 'nodes') return state.roots;
    if (name === 'selectedValue') return state.selected ? state.selected.value : '';
    if (name === 'selectedNode') return state.selected;
    if (name === 'checkedNodes') return collectChecked(state.roots);
    if (name === 'checkedValues') return collectChecked(state.roots).map((n) => n.value);
    return undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    const state = node.__tree;
    if (name === 'enabled') {
      element.classList.toggle('gd-disabled', value === false);
      element.tabIndex = value === false ? -1 : 0;
    } else if (name === 'nodes') {
      const wanted = state.selected ? state.selected.value : '';
      state.roots = parseTreeNodes(value);
      if (treeProps(node).checkCascade) {
        walk(state.roots, (n) => {
          if (n.checked) setCheckedDeep(n, true);
          return true;
        });
        recomputeChecked(state.roots);
      }
      state.selected = wanted ? findByValue(state.roots, wanted) : null;
      renderTree(node);
    } else if (name === 'selectedValue') {
      const item = value === '' || value === null || value === undefined ? null : findByValue(state.roots, value);
      treeSelect(node, item, { reveal: Boolean(item) });
    } else if (name === 'checkedValues') {
      const set = new Set((Array.isArray(value) ? value : []).map(String));
      walk(state.roots, (n) => {
        n.checked = set.has(n.value);
        n.indeterminate = false;
        return true;
      });
      if (treeProps(node).checkCascade) {
        // A listed branch takes its subtree with it; then every branch reflects its children.
        walk(state.roots, (n) => {
          if (set.has(n.value)) setCheckedDeep(n, true);
          return true;
        });
        recomputeChecked(state.roots);
      }
      renderTree(node);
    } else if (name === 'selectedNode' || name === 'checkedNodes') return;
    else if (name === 'checkCascade') {
      if (value) recomputeChecked(state.roots);
      renderTree(node);
    } else if (name === 'checkboxes' || name === 'expandAll') renderTree(node);
  },
  bind(element, node, emit) {
    node.__tree.emit = emit;
  },
  refresh(element, node) {
    renderTree(node);
  }
});

// --- Upload -------------------------------------------------------------------------

const uploadProps = (node) => ({ ...defaultPropsOf(node.type), ...(node.props || {}) });

// The control's accept list applied by hand to dropped files (the browser applies it to the
// dialog alone): "image/*", ".pdf" or "application/pdf" entries, comma separated.
export function acceptsFile(accept, file) {
  const rules = String(accept || '')
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (!rules.length) return true;
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

function uploadShow(state, text) {
  state.text.textContent = text ?? '';
}

// One selection or drop is one batch: filtered by accept, cut to one file unless multiple,
// sent through the host, reported through the events. An error nobody handles is reported
// the way a failed dataSource is.
async function uploadStart(node, list) {
  const state = node.__upload;
  const props = uploadProps(node);
  if (state.busy || !list || !list.length) return;
  const fail = async (error) => {
    if (state.host.hasHandler && !state.host.hasHandler(node, 'onError')) state.host.reportError?.(error, `${node.id}.upload`);
    await state.emit?.('onError', { error });
  };
  const accepted = [...list].filter((file) => acceptsFile(props.accept, file));
  if (!accepted.length) {
    await fail(new Error(`No accepted files: "${node.id}" takes ${props.accept}.`));
    return;
  }
  const files = props.multiple ? accepted : accepted.slice(0, 1);
  const handler = String(props.handler || '').trim();
  if (!handler) {
    await fail(new Error(`"${node.id}" has no handler: name the server script function that receives the files.`));
    return;
  }
  if (!state.host.upload) {
    await fail(new Error('Uploads are only available while the form is running.'));
    return;
  }
  state.busy = true;
  state.root.classList.add('gd-upload-busy');
  uploadShow(state, 'Uploading 0%');
  try {
    const result = await state.host.upload(files, handler, (progress) => {
      uploadShow(state, `Uploading ${progress.percent}%`);
      state.emit?.('onProgress', progress);
    });
    state.files = result;
    await state.emit?.('onUpload', { files: result.files, result: result.result });
  } catch (err) {
    await fail(err instanceof Error ? err : new Error(String(err)));
  } finally {
    state.busy = false;
    state.root.classList.remove('gd-upload-busy');
    uploadShow(state, state.label);
    state.input.value = '';
  }
}

register({
  type: 'upload',
  label: 'Upload',
  description: 'Takes files from the user and hands them, as one batch, to a server script function.',
  defaultSize: { width: 140, height: 28 },
  props: [
    { name: 'text', type: 'string', default: 'Choose file...' },
    { name: 'icon', type: 'icon', default: 'upload', doc: 'A Lucide icon name (pick one in the Inspector); an emoji works too.' },
    { name: 'variant', type: 'enum', values: ['primary', 'default', 'danger'], default: 'primary', doc: 'The button look; a drop zone has its own.' },
    { name: 'dropZone', type: 'bool', default: false, doc: 'Draws the control as a dashed area filling its box that takes dropped files as well as a click; off, it is a button.' },
    { name: 'accept', type: 'string', default: '', placeholder: 'image/*,.pdf', doc: 'What the dialog offers and a drop accepts: MIME types, "image/*" patterns or ".ext" extensions, comma separated. Empty takes anything.' },
    { name: 'multiple', type: 'bool', default: false, doc: 'Lets the user pick several files at once; they go up as one batch and reach the handler together.' },
    { name: 'handler', type: 'function', default: '', placeholder: 'script.fn', doc: 'The server script function called once per batch, as "script.fn" (a script of this module) or "Module.script.fn", with { files }: each file has name, type, size, read(), readText(), openReadStream() and save(path). What it returns comes back in onUpload as e.result.' },
    { name: 'files', type: 'json', hidden: true, readonly: true, tsType: 'GdUploadResult | null', doc: "What the last batch came back with: the handler's result and the files with what each was saved as." }
  ],
  events: ['onProgress', 'onUpload', 'onError'],
  create(node, host) {
    const root = el('div', 'gd-widget gd-upload gd-button', { tabIndex: 0 });
    root.setAttribute('role', 'button');
    const text = el('span', 'gd-button-text');
    const input = el('input', 'gd-upload-input', { type: 'file', tabIndex: -1 });
    root.append(text, input);
    root.__gdNode = node;
    const state = { host, node, root, text, input, label: '', busy: false, files: null, emit: null };
    node.__upload = state;
    // The canvas is a picture; only a running form opens the dialog or takes a drop.
    if (host?.mode !== 'design') {
      const isDrop = () => root.classList.contains('gd-upload-drop');
      const blocked = () => state.busy || root.classList.contains('gd-disabled');
      root.addEventListener('click', (e) => {
        if (e.target === input || blocked()) return;
        input.click();
      });
      root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          root.click();
        }
      });
      input.addEventListener('change', () => uploadStart(node, input.files));
      const over = (e) => {
        if (!isDrop() || blocked()) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        root.dataset.over = '1';
      };
      root.addEventListener('dragenter', over);
      root.addEventListener('dragover', over);
      root.addEventListener('dragleave', (e) => {
        if (!root.contains(e.relatedTarget)) delete root.dataset.over;
      });
      root.addEventListener('drop', (e) => {
        if (!isDrop()) return;
        e.preventDefault();
        delete root.dataset.over;
        if (!blocked()) uploadStart(node, e.dataTransfer && e.dataTransfer.files);
      });
    }
    return { el: root };
  },
  read(element, name) {
    const state = element.__gdNode?.__upload;
    if (!state) return undefined;
    if (name === 'files') return state.files;
    return undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    const state = node.__upload;
    if (name === 'text') {
      state.label = value ?? '';
      if (!state.busy) uploadShow(state, state.label);
    } else if (name === 'icon') {
      element.querySelector('.gd-button-icon')?.remove();
      const glyph = iconGlyph(value, 'gd-button-icon');
      if (glyph) element.prepend(glyph);
    } else if (name === 'variant') element.dataset.variant = value || 'primary';
    else if (name === 'dropZone') {
      const drop = value === true;
      element.classList.toggle('gd-button', !drop);
      element.classList.toggle('gd-upload-drop', drop);
    } else if (name === 'accept') state.input.accept = value || '';
    else if (name === 'multiple') state.input.multiple = value === true;
    else if (name === 'enabled') setDisabled(element, value);
  },
  bind(element, node, emit) {
    node.__upload.emit = emit;
  }
});

register({
  type: 'progressbar',
  label: 'Progress Bar',
  description: 'Shows how far along something is.',
  group: 'Display',
  defaultSize: { width: 180, height: 12 },
  props: [
    { name: 'value', type: 'number', default: 0, min: 0 },
    { name: 'max', type: 'number', default: 100, min: 1 },
    { name: 'indeterminate', type: 'bool', default: false }
  ],
  events: [],
  valueProp: 'value',
  create() {
    const bar = el('div', 'gd-widget gd-progressbar');
    bar.setAttribute('role', 'progressbar');
    bar.append(el('div', 'gd-progress-fill'));
    return { el: bar };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'value' || name === 'max') {
      const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
      const max = Math.max(1, Number(props.max) || 100);
      const current = Math.min(max, Math.max(0, Number(props.value) || 0));
      element.querySelector('.gd-progress-fill').style.width = `${(current / max) * 100}%`;
      element.setAttribute('aria-valuenow', String(current));
      element.setAttribute('aria-valuemax', String(max));
    } else if (name === 'indeterminate') element.classList.toggle('gd-progress-indeterminate', Boolean(value));
    else if (name === 'enabled') element.classList.toggle('gd-disabled', value === false);
  }
});

register({
  // Labelled Picture so the code behind constructor does not shadow the browser's Image().
  type: 'image',
  label: 'Picture',
  description: 'A picture from a URL.',
  group: 'Display',
  defaultSize: { width: 120, height: 120 },
  props: [
    { name: 'src', type: 'image', default: '', doc: 'The picture: upload one in the Inspector (it lands in data/images and is served at /images/<name>), choose an uploaded one, or give a URL.' },
    { name: 'alt', type: 'string', default: '' },
    { name: 'fit', type: 'enum', values: ['contain', 'cover', 'fill', 'none'], default: 'contain' }
  ],
  events: ['onClick', 'onLoad', 'onError'],
  valueProp: 'src',
  create() {
    const frame = el('div', 'gd-widget gd-image');
    const img = el('img', null, { draggable: false, alt: '' });
    const placeholder = el('span', 'gd-image-placeholder');
    frame.append(img, placeholder);
    return { el: frame };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    const img = element.querySelector('img');
    if (name === 'src') {
      if (value) img.src = imageSrc(value);
      else img.removeAttribute('src');
      element.classList.toggle('gd-image-empty', !value);
    } else if (name === 'alt') {
      img.alt = value ?? '';
      element.querySelector('.gd-image-placeholder').textContent = value || 'Image';
    } else if (name === 'fit') img.style.objectFit = value || 'contain';
    else if (name === 'enabled') element.classList.toggle('gd-disabled', value === false);
  },
  bind(element, node, emit) {
    const img = element.querySelector('img');
    element.addEventListener('click', (e) => emit('onClick', e));
    img.addEventListener('load', (e) => emit('onLoad', e));
    img.addEventListener('error', (e) => emit('onError', e));
  }
});

register({
  type: 'badge',
  label: 'Badge',
  description: 'A small pill for a status or a count.',
  group: 'Display',
  defaultSize: { width: 60, height: 20 },
  props: [
    { name: 'text', type: 'string', default: 'New' },
    { name: 'icon', type: 'icon', default: '', doc: 'A Lucide icon shown before the text (pick one in the Inspector); an emoji works too.' },
    { name: 'tone', type: 'enum', values: ['neutral', 'info', 'success', 'warning', 'danger'], default: 'neutral' }
  ],
  events: ['onClick'],
  valueProp: 'text',
  create() {
    const badge = el('span', 'gd-widget gd-badge');
    badge.append(el('span', 'gd-badge-text'));
    return { el: badge };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'text') element.querySelector('.gd-badge-text').textContent = value ?? '';
    else if (name === 'icon') {
      element.querySelector('.gd-badge-icon')?.remove();
      const glyph = iconGlyph(value, 'gd-badge-icon');
      if (glyph) element.prepend(glyph);
    } else if (name === 'tone') element.dataset.tone = value || 'neutral';
    else if (name === 'enabled') element.classList.toggle('gd-disabled', value === false);
  },
  bind(element, node, emit) {
    element.addEventListener('click', (e) => emit('onClick', e));
  }
});

// An icon on its own, for decoration: it fills its box, so the control's size is the icon's.
register({
  type: 'icon',
  label: 'Icon',
  description: 'A Lucide icon or an emoji on its own, for decoration.',
  group: 'Display',
  defaultSize: { width: 24, height: 24 },
  props: [
    { name: 'icon', type: 'icon', default: 'star', doc: 'A Lucide icon name (pick one in the Inspector); an emoji works too.' },
    { name: 'color', type: 'color', default: '', doc: 'The icon colour; empty follows the text colour around it.' }
  ],
  events: ['onClick'],
  create() {
    return { el: el('div', 'gd-widget gd-iconbox') };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'icon') {
      const glyph = iconGlyph(value, 'gd-iconbox-glyph');
      element.replaceChildren(...(glyph ? [glyph] : []));
    } else if (name === 'color') element.style.color = value || '';
    else if (name === 'enabled') element.classList.toggle('gd-disabled', value === false);
  },
  bind(element, node, emit) {
    element.addEventListener('click', (e) => emit('onClick', e));
  }
});

register({
  type: 'separator',
  label: 'Separator',
  description: 'A thin rule, optionally with a caption in the middle.',
  group: 'Display',
  defaultSize: { width: 200, height: 8 },
  props: [
    { name: 'orientation', type: 'enum', values: ['horizontal', 'vertical'], default: 'horizontal' },
    { name: 'text', type: 'string', default: '' }
  ],
  events: [],
  create() {
    const rule = el('div', 'gd-widget gd-separator');
    rule.append(el('span', 'gd-separator-text'));
    return { el: rule };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'orientation') element.classList.toggle('gd-separator-vertical', value === 'vertical');
    else if (name === 'text') {
      const caption = element.querySelector('.gd-separator-text');
      caption.textContent = value ?? '';
      caption.hidden = !value;
    }
  }
});

register({
  type: 'markdown',
  label: 'Markdown',
  description: 'Formatted text written in Markdown.',
  group: 'Display',
  defaultSize: { width: 260, height: 160 },
  props: [
    { name: 'text', type: 'multiline', default: '# Title\n\nSome *markdown* text.' },
    { name: 'allowHtml', type: 'bool', default: false },
    { name: 'scroll', type: 'enum', values: ['none', 'auto'], default: 'auto' },
    { name: 'heightMode', type: 'enum', values: ['fixed', 'content'], default: 'fixed', doc: 'fixed keeps the designed height and scrolls the text inside; content makes the control as tall as its rendered text at its width, so what follows in a Column moves down.' }
  ],
  events: ['onClick'],
  valueProp: 'text',
  create() {
    return { el: el('div', 'gd-widget gd-markdown') };
  },
  // In content mode the control is as tall as its rendered text at the width the layout gave
  // it (see naturalHeight), at least a pixel so an empty one keeps its place.
  measure(element, node) {
    const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
    if (props.heightMode !== 'content') return undefined;
    return Math.max(1, naturalHeight(element));
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'text' || name === 'allowHtml') {
      const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
      element.innerHTML = renderMarkdown(props.text, { allowHtml: Boolean(props.allowHtml) });
    } else if (name === 'scroll') element.style.overflow = value === 'none' ? 'hidden' : 'auto';
    else if (name === 'enabled') element.classList.toggle('gd-disabled', value === false);
  },
  bind(element, node, emit) {
    element.addEventListener('click', (e) => emit('onClick', e));
  }
});

register({
  type: 'webview',
  label: 'Web View',
  description: 'A web page inside the form.',
  group: 'Display',
  defaultSize: { width: 320, height: 200 },
  props: [
    { name: 'src', type: 'string', default: '' },
    { name: 'title', type: 'string', default: '' },
    { name: 'sandbox', type: 'bool', default: false }
  ],
  events: ['onLoad'],
  create() {
    const frame = el('div', 'gd-widget gd-webview');
    const iframe = el('iframe', null, { title: '' });
    frame.append(iframe, el('span', 'gd-webview-placeholder', { textContent: 'Web View' }));
    return { el: frame };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    const iframe = element.querySelector('iframe');
    if (name === 'src') {
      // A page of this app (/app or /run) lives on the project's own origin, which the designer
      // cannot show inside the canvas; it loads when the app runs.
      const ownPage = inDesigner && /^\/(app|run)(\/|\?|$)/.test(String(value || ''));
      if (value && !ownPage) iframe.src = value;
      else iframe.removeAttribute('src');
      element.classList.toggle('gd-webview-empty', !value);
      element.querySelector('.gd-webview-placeholder').textContent = ownPage ? 'Web View (loads when the app runs)' : 'Web View';
      element.classList.toggle('gd-webview-deferred', Boolean(ownPage));
    } else if (name === 'title') iframe.title = value ?? '';
    else if (name === 'sandbox') {
      if (value) iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
      else iframe.removeAttribute('sandbox');
    } else if (name === 'enabled') element.classList.toggle('gd-disabled', value === false);
  },
  bind(element, node, emit) {
    element.querySelector('iframe').addEventListener('load', (e) => emit('onLoad', e));
  }
});

// The Chart wraps Chart.js, loaded on first use. Labels, series and settings are properties
// (chart-data.js turns them into the Chart.js configuration) and `chart` is the raw instance. A
// type change rebuilds the chart; anything else updates it in place.
const CHART_REBUILD = new Set(['chartType', 'animate']);

function chartProps(node) {
  return { ...defaultPropsOf(node.type), ...(node.props || {}) };
}

function buildChart(node) {
  const state = node.__chart;
  if (!state || state.disposed || !state.Chart) return;
  const canvas = state.canvas;
  // Chart.js measures the canvas' parent, so wait for the element to be on the page.
  if (!canvas.isConnected) {
    if (state.waits++ < 120) requestAnimationFrame(() => buildChart(node));
    return;
  }
  state.waits = 0;
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }
  const design = state.host?.mode === 'design';
  try {
    state.chart = new state.Chart(canvas, buildConfig(chartProps(node), { design }));
    state.error.hidden = true;
  } catch (err) {
    state.error.textContent = err.message;
    state.error.hidden = false;
  }
}

function updateChart(node) {
  const state = node.__chart;
  if (!state?.chart) return;
  const config = buildConfig(chartProps(node), { design: state.host?.mode === 'design' });
  state.chart.data = config.data;
  state.chart.options = config.options;
  state.chart.update();
}

register({
  type: 'chart',
  label: 'Chart',
  group: 'Display',
  description: 'A bar, line, area, pie, doughnut, radar, polar or scatter chart, drawn by Chart.js.',
  defaultSize: { width: 360, height: 240 },
  props: [
    { name: 'chartType', type: 'enum', values: CHART_TYPES, default: 'bar', doc: 'The kind of chart; area is a filled line.' },
    { name: 'labels', type: 'multiline', default: '', tsType: 'string | string[]', doc: 'The labels along the axis (or the slices): one per line, or a comma list; an array from code.' },
    { name: 'series', type: 'multiline', default: '', tsType: 'string | GdChartSeries[]', doc: 'One series per line as "Name | 1, 2, 3" (blank for a gap, x:y for a scatter point), or an array of { label, data, color } objects from code.' },
    { name: 'title', type: 'string', default: '' },
    { name: 'legend', type: 'enum', values: ['none', 'top', 'bottom', 'left', 'right'], default: 'top' },
    { name: 'horizontal', type: 'bool', default: false, doc: 'Bars run left to right instead of bottom up (bar charts only).' },
    { name: 'stacked', type: 'bool', default: false, doc: 'Stacks the series on top of each other.' },
    { name: 'beginAtZero', type: 'bool', default: true, doc: 'The value axis starts at zero rather than at the smallest value.' },
    { name: 'colors', type: 'string', default: '', doc: 'A comma list of colours, one per series (one per slice for a pie); the built-in palette when empty.' },
    { name: 'animate', type: 'bool', default: true, doc: 'Animates changes; the design canvas never animates.' },
    { name: 'options', type: 'json', default: '', tsType: 'any', doc: 'Extra Chart.js options (an object, or JSON) merged over what the properties produce, for anything they do not cover.' },
    { name: 'chart', type: 'json', hidden: true, readonly: true, tsType: 'any', doc: 'The underlying Chart.js instance, for anything the widget does not expose itself.' }
  ],
  events: ['onPointClick'],
  // A bound chart's data is { labels, series } from its source, or just the series.
  dataProp: 'series',
  applyData(control, value) {
    if (Array.isArray(value)) {
      control.series = value;
    } else if (value && typeof value === 'object') {
      if (value.labels !== undefined) control.labels = value.labels;
      control.series = value.series || [];
    } else {
      control.series = [];
    }
  },
  readData(control) {
    return { labels: control.labels, series: control.series };
  },
  create(node, host) {
    const root = el('div', 'gd-widget gd-chart');
    const inner = el('div', 'gd-chart-host');
    const canvas = document.createElement('canvas');
    const error = el('div', 'gd-chart-error');
    error.hidden = true;
    inner.append(canvas);
    root.append(inner, error);
    root.__gdNode = node;
    const state = { canvas, error, host, chart: null, Chart: null, emit: null, waits: 0, disposed: false };
    node.__chart = state;
    loadChartJs()
      .then((Chart) => {
        if (state.disposed) return;
        state.Chart = Chart;
        buildChart(node);
      })
      .catch((err) => {
        error.textContent = err.message;
        error.hidden = false;
      });
    return { el: root };
  },
  read(element, name) {
    if (name === 'chart') return element.__gdNode?.__chart?.chart || null;
    return undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'enabled') element.classList.toggle('gd-disabled', value === false);
    else if (name === 'chart') return;
    else if (!node.__chart?.chart) return; // buildChart reads node.props once the library has landed
    else if (CHART_REBUILD.has(name)) buildChart(node);
    else updateChart(node);
  },
  bind(element, node, emit) {
    const state = node.__chart;
    state.emit = emit;
    state.canvas.addEventListener('click', (e) => {
      const chart = state.chart;
      if (!chart) return;
      const hits = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true);
      if (!hits.length) return;
      const { datasetIndex, index } = hits[0];
      const dataset = chart.data.datasets[datasetIndex] || {};
      emit('onPointClick', {
        index,
        datasetIndex,
        label: String(chart.data.labels?.[index] ?? ''),
        series: String(dataset.label ?? ''),
        value: Array.isArray(dataset.data) ? dataset.data[index] : undefined
      });
    });
  },
  refresh(element, node) {
    updateChart(node);
  },
  dispose(element, node) {
    const state = node.__chart;
    if (!state) return;
    state.disposed = true;
    state.chart?.destroy();
    state.chart = null;
  }
});

// The Map wraps Leaflet, loaded on first use, with OpenStreetMap tiles unless `tiles` says
// otherwise. Centre, zoom and markers are properties (map-data.js reads them), `center` and
// `zoom` read back where the user left the view, and `map` is the raw Leaflet instance.
function mapProps(node) {
  return { ...defaultPropsOf(node.type), ...(node.props || {}) };
}

function setMapTiles(node) {
  const state = node.__map;
  const props = mapProps(node);
  state.tiles?.remove();
  state.tiles = state.L.tileLayer(props.tiles || DEFAULT_TILES, { attribution: props.attribution ?? DEFAULT_ATTRIBUTION, maxZoom: 19 }).addTo(state.map);
}

function setMapView(node) {
  const state = node.__map;
  const props = mapProps(node);
  const center = parseLatLng(props.center) || { lat: 0, lng: 0 };
  state.map.setView([center.lat, center.lng], Number(props.zoom) || 0);
}

function syncMapMarkers(node) {
  const state = node.__map;
  state.list = parseMarkers(mapProps(node).markers);
  state.markers.clearLayers();
  state.list.forEach((item, index) => {
    const marker = state.L.marker([item.lat, item.lng], { title: item.title || '' });
    if (item.popup) marker.bindPopup(item.popup);
    marker.on('click', () => state.emit?.('onMarkerClick', { index, marker: item }));
    marker.addTo(state.markers);
  });
}

function wireMap(node) {
  const state = node.__map;
  if (!state.map || !state.emit || state.wired) return;
  state.wired = true;
  state.map.on('click', (e) => state.emit('onClick', { lat: e.latlng.lat, lng: e.latlng.lng }));
  state.map.on('moveend', () => {
    const center = state.map.getCenter();
    state.emit('onMove', { center: { lat: center.lat, lng: center.lng }, zoom: state.map.getZoom() });
  });
}

function buildMap(node) {
  const state = node.__map;
  if (!state || state.disposed || !state.L || state.map) return;
  // Leaflet measures its container, so wait for the element to be on the page.
  if (!state.canvas.isConnected) {
    if (state.waits++ < 120) requestAnimationFrame(() => buildMap(node));
    return;
  }
  const props = mapProps(node);
  // On the canvas the map is a picture: it draws, but the designer owns the pointer.
  const design = state.host?.mode === 'design';
  try {
    state.map = state.L.map(state.canvas, {
      zoomControl: props.zoomControl !== false,
      scrollWheelZoom: props.scrollZoom !== false && !design,
      dragging: !design,
      keyboard: !design,
      touchZoom: !design,
      doubleClickZoom: !design,
      boxZoom: !design,
      attributionControl: true
    });
    state.markers = state.L.layerGroup().addTo(state.map);
    setMapTiles(node);
    setMapView(node);
    syncMapMarkers(node);
    wireMap(node);
    state.error.hidden = true;
  } catch (err) {
    state.error.textContent = err.message;
    state.error.hidden = false;
  }
}

register({
  type: 'map',
  label: 'Map',
  group: 'Display',
  description: 'A map with markers, drawn by Leaflet on OpenStreetMap tiles.',
  defaultSize: { width: 360, height: 240 },
  props: [
    { name: 'center', type: 'string', default: '20, 0', tsType: 'string | [number, number] | { lat: number; lng: number }', doc: 'The middle of the view as "lat, lng"; reads back where the user panned to, as { lat, lng }.' },
    { name: 'zoom', type: 'number', default: 2, min: 0, max: 19, doc: 'The zoom level, 0 (the world) to 19 (a street); reads back the live level.' },
    { name: 'markers', type: 'multiline', default: '', tsType: 'string | GdMapMarker[]', doc: 'One marker per line as "lat, lng | Title | popup text", or an array of { lat, lng, title, popup } objects from code or a dataSource (a row keeps its other fields).' },
    { name: 'tiles', type: 'string', default: DEFAULT_TILES, doc: 'The tile server as a URL template with {z}, {x} and {y}.' },
    { name: 'attribution', type: 'string', default: DEFAULT_ATTRIBUTION, doc: 'The credit shown in the corner, as the tile server requires.' },
    { name: 'zoomControl', type: 'bool', default: true, doc: 'The + and - buttons.' },
    { name: 'scrollZoom', type: 'bool', default: true, doc: 'The mouse wheel zooms the map.' },
    { name: 'map', type: 'json', hidden: true, readonly: true, tsType: 'any', doc: 'The underlying Leaflet map, for anything the widget does not expose itself.' }
  ],
  events: ['onClick', 'onMarkerClick', 'onMove'],
  dataProp: 'markers',
  create(node, host) {
    const root = el('div', 'gd-widget gd-map');
    const canvas = el('div', 'gd-map-canvas');
    const error = el('div', 'gd-map-error', { hidden: true });
    root.append(canvas, error);
    root.__gdNode = node;
    const state = { host, canvas, error, L: null, map: null, tiles: null, markers: null, list: [], emit: null, wired: false, waits: 0, disposed: false };
    node.__map = state;
    // Docking, anchoring or a splitter change the box; Leaflet has to be told. Not while the box
    // measures 0 x 0 (its form hidden by form.open(), a tab page not selected): Leaflet would
    // re-centre on nothing, and the way back would move the view and raise onMove twice.
    // Nor when the box is back at the size it had last time: invalidateSize() would drop the
    // exact centre Leaflet keeps, and `center` would read back rounded to a pixel.
    state.observer = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h || (state.size && state.size.w === w && state.size.h === h)) return;
      state.size = { w, h };
      state.map?.invalidateSize();
    });
    state.observer.observe(canvas);
    loadLeaflet()
      .then((L) => {
        state.L = L;
        buildMap(node);
      })
      .catch((err) => {
        error.textContent = err.message;
        error.hidden = false;
      });
    return { el: root };
  },
  read(element, name) {
    const state = element.__gdNode?.__map;
    const map = state?.map || null;
    if (name === 'map') return map;
    if (!map) return undefined;
    if (name === 'center') {
      const center = map.getCenter();
      return { lat: center.lat, lng: center.lng };
    }
    if (name === 'zoom') return map.getZoom();
    // The markers as they are on the map: the parsed list, whatever text or rows set them.
    if (name === 'markers') return state.list;
    return undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'enabled') {
      element.classList.toggle('gd-disabled', value === false);
      return;
    }
    const state = node.__map;
    if (name === 'map' || !state?.map) return; // buildMap reads node.props once the library has landed
    if (name === 'center' || name === 'zoom') setMapView(node);
    else if (name === 'markers') syncMapMarkers(node);
    else if (name === 'tiles' || name === 'attribution') setMapTiles(node);
    else if (name === 'zoomControl') {
      const control = state.map.zoomControl || (state.map.zoomControl = state.L.control.zoom());
      if (value === false) control.remove();
      else control.addTo(state.map);
    } else if (name === 'scrollZoom') {
      if (value === false) state.map.scrollWheelZoom.disable();
      else if (state.host?.mode !== 'design') state.map.scrollWheelZoom.enable();
    }
  },
  bind(element, node, emit) {
    node.__map.emit = emit;
    wireMap(node);
  },
  dispose(element, node) {
    const state = node.__map;
    if (!state) return;
    state.disposed = true;
    state.observer?.disconnect();
    state.map?.remove();
    state.map = null;
  }
});

// The Frame: another form of the project inside this one. The canvas draws that form's layout
// in the box (the designer's host supplies the picture); the running form gets a real instance
// of it, its own code behind included, mounted in the body (the form host supplies it). The
// frame is that form's window: formName and formArgs (a list, picked like dataArgs) name the
// first form; frm.navigate() from the host, or form.navigate() inside, change it in place;
// form.open() inside opens a form over it, in the frame, and form.close() brings it back;
// form.close() on the first form, or form.closeAll(), empties the frame.
const frameProps = (node) => ({ ...defaultPropsOf(node.type), ...(node.props || {}) });

// formArgs as the Inspector stores it: the JSON text of a list, or any value from code.
function frameArgs(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function frameNote(state, text) {
  state.note.textContent = text;
  state.note.hidden = !text;
}

// In `content` mode the frame renders as tall as the embedded form; on the canvas an empty
// frame keeps its designed height, so it stays visible and selectable.
function setFrameHeight(node, height) {
  const state = node.__frame;
  const h = Math.max(0, Number(height) || 0);
  if (frameProps(node).heightMode === 'content' && (h > 0 || state.host?.embed)) node.__renderHeight = h;
  else delete node.__renderHeight;
  if (state.started) state.host?.relayout?.();
}

// The forms in the frame leave it - the one shown and any hidden beneath it by form.open() - as
// forms the app moves away from, with their onClose marked `navigated`, so whatever they
// started can be taken down. The stack is taken before the form shown is waited for, so a
// close() landing meanwhile finds no parent to restore.
async function frameEmpty(node) {
  const state = node.__frame;
  const child = state.child;
  state.child = null;
  state.facade = null;
  const taken = frameSlot(node).stack.take();
  if (child) await child.leave();
  await FormStack.leave(taken);
  state.body.replaceChildren();
  setFrameHeight(node, 0);
}

// Puts `child` up as the frame's form (null for none): what frm.form reads, and the watch that
// empties the frame once the form closes itself - set once per form, since a form hidden by
// form.open() comes up again on the other one's close().
function frameShow(node, child) {
  const state = node.__frame;
  state.child = child;
  state.facade = child ? child.formFacade() : null;
  if (!child || state.watched.has(child)) return;
  state.watched.add(child);
  child.closed.then((result) => {
    // A form that went with its frame (the host disposed), or one replaced or hidden meanwhile,
    // has nothing to empty.
    if (state.disposed || state.child !== child) return;
    state.child = null;
    state.facade = null;
    frameNote(state, '');
    state.body.replaceChildren();
    setFrameHeight(node, 0);
    state.emit?.('onClose', { result });
  });
}

// Shows a form in the frame; resolves with the embedded form as its own code behind sees it.
// The form is fetched before the one shown goes, so a form that fails to load leaves the frame
// as it is, with the error in the note. Every form in the frame is asked first. The latest load
// wins over one still on its way. With `rethrow` the error goes to the caller (form.navigate()
// inside rejects like a modal's) instead of the host's error reporting.
async function frameLoad(node, name, args, { rethrow = false } = {}) {
  const state = node.__frame;
  const host = state.host;
  if (!host?.embed) return null;
  const seq = ++state.loading;
  frameNote(state, '');
  try {
    // The forms shown may refuse to be left (Form_OnClosing): nothing changes then.
    if (!(await frameSlot(node).stack.canLeaveAll())) return false;
    if (seq !== state.loading || state.disposed) return null;
    const prepared = await host.embed(name, args, frameSlot(node));
    if (seq !== state.loading || state.disposed) {
      prepared.instance.dispose();
      return null;
    }
    await frameEmpty(node);
    // Overtaken while the old child was leaving (its onClose loaded another form): that load mounts.
    if (seq !== state.loading || state.disposed) {
      prepared.instance.dispose();
      return null;
    }
    const child = await prepared.mount(state.body);
    if (seq !== state.loading || state.disposed) {
      child.dispose();
      return null;
    }
    frameShow(node, child);
    setFrameHeight(node, child.layout.height);
    state.emit?.('onLoad', { form: state.facade });
    return state.facade;
  } catch (err) {
    if (seq !== state.loading) return null;
    frameNote(state, err.message);
    if (rethrow) throw err;
    host.reportError?.(err, `${node.id}.navigate`);
    return null;
  }
}

// The Frame as the embedded form's window: form.navigate() inside loads the new form into the
// same frame (the Frame's onLoad fires for it); form.closeAll() empties the frame; frm.navigate()
// from the host is the same call. The window's stack serves form.open() / form.close() inside:
// the frame's body is both container and scroller, a child is built through the host form's
// embed() (so it is the host's embedded form like any other), the height follows the form shown
// in content mode, and a form that came up fresh is the frame's onLoad - one brought back by
// close() never left.
function frameSlot(node) {
  const state = node.__frame;
  if (!state.slot) {
    const slot = {
      get current() {
        return state.child;
      },
      show: (name, args) => frameLoad(node, name, args, { rethrow: true }),
      finish() {} // the frame empties itself through child.closed
    };
    slot.stack = new FormStack({
      where: 'frame',
      container: state.body,
      scroller: state.body,
      get current() {
        return state.child;
      },
      set current(value) {
        frameShow(node, value);
      },
      get loading() {
        return state.loading;
      },
      prepare: (name, args) => state.host.embed(name, args, slot),
      fit: (layout) => {
        frameNote(state, '');
        setFrameHeight(node, layout.height);
      },
      settle: (fresh) => {
        if (fresh) state.emit?.('onLoad', { form: state.facade });
      },
      report: (err, where) => state.host.reportError?.(err, where)
    });
    state.slot = slot;
  }
  return state.slot;
}

register({
  type: 'frame',
  label: 'Frame',
  description: 'Another form of the project, shown inside this one.',
  group: 'Container',
  defaultSize: { width: 320, height: 200 },
  props: [
    { name: 'formName', type: 'form', default: '', doc: 'The form shown when this form opens: "Details" for one of this module, "Module.Details" for another\'s. At run time only navigate() changes what the frame shows.' },
    { name: 'formArgs', type: 'args', default: '', tsType: 'any[]', hint: 'handed to the embedded form in this order', doc: 'The arguments handed to the embedded form as its form.args when this form opens: one typed value per line in the Inspector, read as form.args[0], form.args[1], ...; any value from code.' },
    { name: 'heightMode', type: 'enum', values: ['fixed', 'content'], default: 'fixed', doc: 'fixed keeps the designed height and the embedded form stretches to it; content makes the frame as tall as the embedded form was designed, so what follows in a Column moves down.' },
    { name: 'border', type: 'bool', default: false },
    { name: 'borderColor', type: 'color', default: '', doc: 'Replaces the default border colour while border is on.' },
    { name: 'borderRadius', type: 'number', default: 0, min: 0, doc: 'Corner rounding in pixels.' },
    { name: 'form', type: 'json', hidden: true, readonly: true, tsType: 'any', doc: 'The embedded form as its own code behind sees it (name, args, all, controls, data, reload, navigate, open, close, closeAll), or null while the frame is empty. frm.form.close() closes the form shown (the one it was opened over comes back, or the frame empties); frm.form.closeAll() empties the frame.' },
    { name: 'navigate', type: 'json', hidden: true, readonly: true, tsType: '(formName: string, args?: any) => Promise<any>', doc: 'Shows another form in the frame, as form.navigate() inside it would: navigate("Details", { id: 3 }). Resolves with the new form once its own onLoad ran, or false when a form shown refused to be left (its Form_OnClosing).' }
  ],
  events: ['onLoad', 'onClose'],
  create(node, host) {
    const root = el('div', 'gd-widget gd-frame');
    const body = el('div', 'gd-frame-body');
    const note = el('div', 'gd-frame-note', { hidden: true });
    root.append(body, note);
    root.__gdNode = node;
    node.__frame = { host, body, note, child: null, facade: null, watched: new WeakSet(), preview: null, previewName: null, started: false, loading: 0, emit: null, disposed: false };
    return { el: root };
  },
  read(element, name) {
    const node = element.__gdNode;
    const state = node?.__frame;
    if (!state) return undefined;
    if (name === 'form') return state.facade;
    if (name === 'navigate') return (formName, args) => frameSlot(node).show(formName, args);
    return undefined;
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'border' || name === 'borderColor' || name === 'borderRadius') {
      if (name === 'border') element.classList.toggle('gd-frame-border', value === true);
      applyBorderStyle(element, node);
    } else if (name === 'heightMode') {
      const state = node.__frame;
      setFrameHeight(node, state.child ? state.child.layout.height : state.preview ? state.preview.height : 0);
    } else if (name === 'enabled') element.classList.toggle('gd-disabled', value === false);
  },
  // After the tree is built: the running form loads formName once; the canvas shows the
  // form's picture, drawn again when the name changes.
  refresh(element, node, host) {
    const state = node.__frame;
    const props = frameProps(node);
    if (host.embed) {
      if (state.started) return;
      state.started = true;
      if (props.formName) frameLoad(node, props.formName, frameArgs(props.formArgs));
      return;
    }
    state.started = true;
    if (!host.embedPreview) {
      frameNote(state, props.formName ? `Frame: ${props.formName}` : 'Frame');
      return;
    }
    if (state.previewName === props.formName) return;
    state.previewName = props.formName;
    state.preview = null;
    state.body.replaceChildren();
    frameNote(state, props.formName || 'Frame');
    if (!props.formName) {
      setFrameHeight(node, 0);
      return;
    }
    host
      .embedPreview(state.body, props.formName)
      .then((layout) => {
        if (state.disposed || state.previewName !== props.formName) return;
        state.preview = layout;
        setFrameHeight(node, layout.height);
      })
      .catch((err) => frameNote(state, err.message));
  },
  bind(element, node, emit) {
    node.__frame.emit = emit;
  },
  dispose(element, node) {
    const state = node.__frame;
    if (!state) return;
    state.disposed = true;
    state.loading += 1;
    // The host's dispose() has taken every embedded form down already; what is left is to
    // settle the open() promises of the forms hidden in the frame.
    state.slot?.stack.end();
    const child = state.child;
    state.child = null;
    state.facade = null;
    child?.dispose();
  }
});

// Containers. The toolbox groups by registration order, so they sit together from here on.

// A container's border: `border` switches it on, `borderColor` replaces the theme colour while
// it is on, `borderRadius` rounds the corners. Inline styles only carry what differs from the
// stylesheet, so the class rules keep drawing the default look.
function applyBorderStyle(element, node) {
  const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
  const on = props.border !== false;
  element.style.boxShadow = on && props.borderColor ? `inset 0 0 0 1px ${props.borderColor}` : '';
  const radius = Number(props.borderRadius);
  element.style.borderRadius = props.borderRadius === '' || props.borderRadius === undefined || Number.isNaN(radius) ? '' : `${Math.max(0, radius)}px`;
}

register({
  type: 'panel',
  label: 'Panel',
  description: 'Group controls together; the group moves and docks as one.',
  group: 'Container',
  container: true,
  defaultSize: { width: 260, height: 160 },
  props: [
    { name: 'border', type: 'bool', default: true },
    { name: 'borderColor', type: 'color', default: '', doc: 'Replaces the default border colour while border is on.' },
    { name: 'borderRadius', type: 'number', default: 3, min: 0, doc: 'Corner rounding in pixels.' },
    { name: 'backColor', type: 'color', default: '' },
    { name: 'scroll', type: 'enum', values: ['none', 'auto'], default: 'none', doc: 'none clips whatever falls outside the panel; auto shows scroll bars instead.' }
  ],
  events: ['onClick'],
  create() {
    const panel = el('div', 'gd-widget gd-panel');
    return { el: panel, contentEl: panel };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'border' || name === 'borderColor' || name === 'borderRadius') {
      if (name === 'border') element.classList.toggle('gd-no-border', value === false);
      applyBorderStyle(element, node);
    } else if (name === 'backColor') element.style.background = value || '';
    else if (name === 'scroll') element.style.overflow = value === 'auto' ? 'auto' : '';
  },
  bind(element, node, emit) {
    element.addEventListener('click', (e) => {
      if (e.target === element) emit('onClick', e);
    });
  }
});

// A group box is a panel with a caption bar; its children live in the body below the caption,
// which is what contentInset tells the layout engine and the designer.
const GROUP_CAPTION_HEIGHT = 22;

// With `expandable` on, the caption folds the box down to its own height while the stored size
// stays put, so opening it again restores everything. The designer and the Column layout read
// the folded height through node.__renderHeight.
function applyGroupState(element, node) {
  const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
  const expandable = Boolean(props.expandable);
  const open = !expandable || props.expanded !== false;
  const caption = element.querySelector('.gd-groupbox-caption');
  element.classList.toggle('gd-groupbox-expandable', expandable);
  element.classList.toggle('gd-groupbox-collapsed', !open);
  caption.classList.toggle('gd-designer-interactive', expandable);
  if (expandable) caption.dataset.gdClick = '';
  else delete caption.dataset.gdClick;
  if (open) delete node.__renderHeight;
  else node.__renderHeight = GROUP_CAPTION_HEIGHT;
}

register({
  type: 'groupbox',
  label: 'Group Box',
  description: 'A titled frame around a set of controls; expandable, it folds down to its caption.',
  group: 'Container',
  container: true,
  contentInset: { x: 0, y: GROUP_CAPTION_HEIGHT },
  defaultSize: { width: 260, height: 160 },
  props: [
    { name: 'text', type: 'string', default: 'Group' },
    { name: 'icon', type: 'icon', default: '', doc: 'A Lucide icon shown in the caption before the text.' },
    { name: 'expandable', type: 'bool', default: false },
    { name: 'expanded', type: 'bool', default: true },
    { name: 'backColor', type: 'color', default: '' }
  ],
  events: ['onClick', 'onToggle'],
  create(node, host) {
    const root = el('div', 'gd-widget gd-groupbox');
    const caption = el('button', 'gd-groupbox-caption', { type: 'button' });
    caption.append(el('span', 'gd-groupbox-chevron'), el('span', 'gd-groupbox-text'));
    root.dataset.gdIcon = '';
    const body = el('div', 'gd-groupbox-body');
    root.append(caption, body);
    caption.addEventListener('click', (e) => {
      const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
      if (!props.expandable) return;
      e.stopPropagation();
      const expanded = props.expanded === false;
      host?.snapshot?.();
      node.props = node.props || {};
      node.props.expanded = expanded;
      applyGroupState(root, node);
      host?.update(node);
      host?.emit(node, 'onToggle', { expanded });
    });
    return { el: root, contentEl: body };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'text') element.querySelector('.gd-groupbox-text').textContent = value ?? '';
    else if (name === 'icon') {
      element.querySelector('.gd-groupbox-icon')?.remove();
      const glyph = iconGlyph(value, 'gd-groupbox-icon');
      if (glyph) element.querySelector('.gd-groupbox-text').before(glyph);
    }
    else if (name === 'expandable' || name === 'expanded') applyGroupState(element, node);
    else if (name === 'backColor') element.style.background = value || '';
  },
  refresh(element, node) {
    applyGroupState(element, node);
  },
  bind(element, node, emit) {
    // The box itself, its empty body or its caption - not a child control inside it.
    element.addEventListener('click', (e) => {
      const own = e.target === element || e.target.classList.contains('gd-groupbox-body') || Boolean(e.target.closest('.gd-groupbox-caption'));
      if (own) emit('onClick', e);
    });
  }
});

// Row and Column: children stacked along one axis in child order. Their left/top are ignored;
// their own size on the stacking axis counts, a per-child `grow` shares the leftover, and the
// container's align/justify props place them. The layout maths live in stack.js.
function stackWidget(axis) {
  const isRow = axis === 'x';
  const contentMode = (props) => !isRow && props.heightMode === 'content';
  // Where the children go in a box of `size`. allShown counts every child, the way the design
  // canvas draws them.
  const arrange = (node, props, size, allShown) => stackLayout({
    axis,
    size,
    gap: Number(props.gap) || 0,
    padding: Number(props.padding) || 0,
    align: props.align || 'stretch',
    justify: props.justify || 'start',
    children: (node.children || []).map((child) => ({
      main: isRow ? child.width : heightOf(child),
      cross: isRow ? heightOf(child) : child.width,
      grow: child.grow,
      visible: allShown || shown(child)
    }))
  });
  // How tall a Column in content mode is: its children, gaps and padding.
  const contentHeightOf = (node, props, allShown) => stackContentSize({
    gap: Number(props.gap) || 0,
    padding: Number(props.padding) || 0,
    children: (node.children || []).map((child) => ({ main: heightOf(child), visible: allShown || shown(child) }))
  });
  // The box this stack had on the design canvas: its design size (handed down by a Row or Column
  // placing it, else its stored size), less what a scroll bar takes from it now. A Column in
  // content mode is as tall as all its children, so a grown child had no leftover there either.
  const designBox = (node, props, content) => {
    const design = designSize(node, content, { x: 0, y: 0 });
    return {
      w: design.w - Math.max(0, (content.offsetWidth || 0) - content.clientWidth),
      h: contentMode(props) ? contentHeightOf(node, props, true) : design.h - Math.max(0, (content.offsetHeight || 0) - content.clientHeight)
    };
  };
  register({
    type: isRow ? 'row' : 'column',
    label: isRow ? 'Row' : 'Column',
    description: isRow
      ? 'Lays its children out left to right; give one grow to fill the rest.'
      : 'Stacks its children top to bottom; give one grow to fill the rest.',
    group: 'Container',
    container: true,
    stack: axis,
    defaultSize: isRow ? { width: 400, height: 48 } : { width: 200, height: 300 },
    props: [
      { name: 'gap', type: 'number', default: 8 },
      { name: 'padding', type: 'number', default: 8 },
      { name: 'align', type: 'enum', values: STACK_ALIGN, default: 'stretch' },
      { name: 'justify', type: 'enum', values: STACK_JUSTIFY, default: 'start' },
      { name: 'border', type: 'bool', default: false },
      { name: 'borderColor', type: 'color', default: '', doc: 'Replaces the default border colour while border is on.' },
      { name: 'borderRadius', type: 'number', default: 0, min: 0, doc: 'Corner rounding in pixels.' },
      { name: 'backColor', type: 'color', default: '' },
      { name: 'scroll', type: 'enum', values: ['none', 'auto'], default: 'none', doc: `none clips whatever falls outside the ${isRow ? 'row' : 'column'}; auto scrolls it ${isRow ? 'left to right' : 'up and down'} instead.` },
      ...(isRow ? [] : [{ name: 'heightMode', type: 'enum', values: ['fixed', 'content'], default: 'fixed', doc: 'fixed keeps the designed height; content makes the column as tall as its children and gaps, so what follows it moves down (a child\'s grow has no leftover to take in this mode).' }])
    ],
    events: ['onClick'],
    create() {
      const box = el('div', `gd-widget gd-stack ${isRow ? 'gd-row' : 'gd-column'}`);
      return { el: box, contentEl: box };
    },
    // A Column in content mode is as tall as its children as they render (a grown Repeater,
    // Frame or Label, a nested content Column, a folded Group Box) plus its gaps and padding.
    measure(element, node) {
      const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
      return contentMode(props) ? contentHeightOf(node, props, false) : undefined;
    },
    apply(element, node, name, value) {
      if (applyCommon(element, name, value)) return;
      if (name === 'border' || name === 'borderColor' || name === 'borderRadius') {
        if (name === 'border') element.classList.toggle('gd-stack-border', value === true);
        applyBorderStyle(element, node);
      } else if (name === 'backColor') element.style.background = value || '';
      else if (name === 'scroll') {
        // A stack scrolls along its own axis only: the other axis stays clipped, so the width
        // a scrollbar takes (a fraction of a pixel at some display scales) never brings a
        // second bar out.
        const on = value === 'auto';
        element.style.overflowX = on && isRow ? 'auto' : '';
        element.style.overflowY = on && !isRow ? 'auto' : '';
      }
    },
    bind(element, node, emit) {
      element.addEventListener('click', (e) => {
        if (e.target === element) emit('onClick', e);
      });
    },
    layoutChildren(node, content) {
      const children = node.children || [];
      if (children.length === 0) return;
      // A node only stores the props that were set; the declared defaults fill the rest.
      const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
      const rects = arrange(node, props, { w: content.clientWidth, h: content.clientHeight }, false);
      // A child container's own children anchor to its design size. On the canvas that is what
      // it was just given. In the running app it is what the canvas gave it - the same layout in
      // this stack's design box, every child counted - so the inside follows its anchors when
      // the stack runs at another size or a sibling is hidden.
      const designed = node.__designing ? rects : arrange(node, props, designBox(node, props, content), true);
      children.forEach((child, i) => {
        if (!child.__el) return;
        place(child.__el, rects[i]);
        // Less the container's own chrome (a caption bar), which is not client area - kept with
        // it, should the chrome change before the next pass (layout.js designSize).
        const inset = contentInsetOf(child);
        child.__design = { w: Math.max(1, designed[i].width - inset.x), h: Math.max(1, designed[i].height - inset.y), inset: { x: inset.x, y: inset.y } };
      });
    },
    // Design-time resize of the stack itself: the stacking axis is recomputed live, the cross
    // size is stored only when children stretch. A child container's inside goes from the size
    // the child was drawn at to the size it is drawn at now - a grown child keeps its own size
    // as its basis while its share of the leftover changes. Nothing here bakes dock/anchor rules
    // of the stack's own children, which it never reads.
    resizeChildren(node, { before, after, resizeChild, resizeInside }) {
      const props = { ...defaultPropsOf(node.type), ...(node.props || {}) };
      const stretch = (props.align || 'stretch') === 'stretch';
      const padding = Number(props.padding) || 0;
      const cross = Math.max(1, (isRow ? after.h : after.w) - padding * 2);
      const box = (size) => (contentMode(props) ? { w: size.w, h: contentHeightOf(node, props, true) } : size);
      const was = arrange(node, props, box(before), true);
      const now = arrange(node, props, box(after), true);
      (node.children || []).forEach((child, i) => {
        if (!widget(child.type).container) {
          if (stretch) resizeChild(child, isRow ? child.width : cross, isRow ? cross : child.height);
          return;
        }
        if (stretch && isRow) child.height = cross;
        else if (stretch) child.width = cross;
        const inset = contentInsetOf(child);
        resizeInside(child, { w: was[i].width - inset.x, h: was[i].height - inset.y }, { w: now[i].width - inset.x, h: now[i].height - inset.y });
      });
    }
  });
}
stackWidget('x');
stackWidget('y');

// A WinForms-style splitter: dock it to a side right after the pane docked to that side, and
// dragging it resizes that pane. The runtime drag lives here; the designer has its own, since
// widget elements take no pointer events on the design canvas.
register({
  type: 'splitter',
  label: 'Splitter',
  description: 'Drag to resize the docked pane before it. Dock it to a side.',
  group: 'Container',
  defaultSize: { width: 8, height: 8 },
  defaultDock: 'left',
  docks: SPLITTER_DOCKS,
  props: [{ name: 'minSize', type: 'number', default: 40 }],
  create(node, host) {
    const bar = el('div', 'gd-widget gd-splitter');
    bar.addEventListener('mouseenter', () => {
      bar.dataset.axis = splitAxis(node.dock);
    });
    if (host && host.mode === 'run') {
      bar.addEventListener('pointerdown', (e) => {
        const parent = node.__parent;
        const target = parent && splitterTarget(parent, node);
        if (!target || e.button !== 0) return;
        e.preventDefault();
        const axis = splitAxis(node.dock);
        const startPointer = axis === 'x' ? e.clientX : e.clientY;
        const startSize = axis === 'x' ? Number(target.width) || 0 : Number(target.height) || 0;
        const minSize = Number(node.props?.minSize) || 40;
        bar.setPointerCapture(e.pointerId);
        bar.classList.add('gd-splitter-active');
        const move = (ev) => {
          const box = parent.__contentEl || parent.__el;
          const containerSize = axis === 'x' ? box.clientWidth : box.clientHeight;
          const delta = (axis === 'x' ? ev.clientX : ev.clientY) - startPointer;
          const size = splitSize(node, target, startSize, delta, containerSize, minSize);
          if (axis === 'x') target.width = size;
          else target.height = size;
          host.relayout();
        };
        const stop = () => {
          bar.removeEventListener('pointermove', move);
          bar.removeEventListener('pointerup', stop);
          bar.removeEventListener('pointercancel', stop);
          bar.classList.remove('gd-splitter-active');
        };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', stop);
        bar.addEventListener('pointercancel', stop);
      });
    }
    return { el: bar };
  },
  apply(element, node, name, value) {
    applyCommon(element, name, value);
  },
  refresh(element, node) {
    element.dataset.axis = splitAxis(node.dock);
  }
});

register({
  type: 'tabpage',
  label: 'Tab Page',
  description: 'One page inside a tab control.',
  group: 'Container',
  container: true,
  toolbox: false,
  intrinsic: true,
  defaultSize: { width: 260, height: 160 },
  props: [
    { name: 'text', type: 'string', default: 'Tab' },
    { name: 'icon', type: 'icon', default: '', doc: 'A Lucide icon shown in the tab header before its text.' }
  ],
  events: [],
  create() {
    const page = el('div', 'gd-tabpage');
    return { el: page, contentEl: page };
  },
  apply(element, node, name, value) {
    const common = applyCommon(element, name, value);
    if (name === 'icon' || name === 'text' || name === 'visible') {
      // The header lives in the tab control; its refresh redraws every header (a hidden page
      // loses its header, and the page on view moves if it was this one).
      const owner = node.__parent;
      if (owner && owner.__el && owner.__host) {
        widget(owner.type).refresh?.(owner.__el, owner, owner.__host);
        if (name === 'visible') owner.__host.relayout?.();
      }
    }
    if (common) return;
    if (name === 'text') element.dataset.text = value ?? '';
  }
});

const TAB_HEADER_HEIGHT = 32;

// The header strip's height by style: none takes no room, the pages fill the box.
const tabHeaderHeight = (node) => ((node.props && node.props.headerStyle) === 'none' ? 0 : TAB_HEADER_HEIGHT);

register({
  type: 'tabcontrol',
  label: 'Tab Control',
  description: 'Pages the user switches between with tab headers, or the steps of a wizard.',
  group: 'Container',
  container: true,
  accepts: ['tabpage'],
  childType: 'tabpage',
  contentInset: (node) => ({ x: 0, y: tabHeaderHeight(node) }),
  defaultSize: { width: 320, height: 200 },
  props: [
    { name: 'selectedIndex', type: 'number', default: 0 },
    { name: 'headerStyle', type: 'enum', values: ['tabs', 'steps', 'none'], default: 'tabs', doc: 'tabs shows tab headers; steps shows the pages as a row of steps (a circle with the page icon, or a plain page icon when it has none), done before the selected one, upcoming after it; none shows no header and the pages fill the box. Clicking a header selects its page in every style; the code behind decides what is allowed.' }
  ],
  events: ['onTabChange'],
  create(node, host) {
    const root = el('div', 'gd-widget gd-tabcontrol');
    node.__host = host; // so a page can ask for its header to be redrawn
    const headers = el('div', 'gd-tab-headers gd-designer-interactive');
    const body = el('div', 'gd-tab-body');
    root.append(headers, body);
    return { el: root, contentEl: body };
  },
  // Pages are not positioned freely - each one fills the body, so the tab control owns layout.
  // The pages' design size is the tab control's own: handed down by a Row or Column placing it,
  // frozen when the form was built, else its stored size - always less the header it shows now,
  // so a header style switched at run time leaves the pages' controls where they were designed.
  layoutChildren(node, body) {
    const pages = node.children || [];
    const selected = shownIndex(node, pages);
    const design = designSize(node, body, contentInsetOf(node));
    pages.forEach((page, i) => {
      const element = page.__el;
      if (!element) return;
      page.__design = design;
      element.style.left = '0px';
      element.style.top = '0px';
      element.style.width = `${body.clientWidth}px`;
      element.style.height = `${body.clientHeight}px`;
      element.classList.toggle('gd-tabpage-active', i === selected);
    });
  },
  // The headers: tabs, or numbered steps (done, current, upcoming by their place against the
  // selected page), or nothing. A click selects the page in every style; whether the user may
  // is the code behind's business.
  refresh(element, node, ctx) {
    const headers = element.querySelector('.gd-tab-headers');
    const pages = node.children || [];
    const selected = shownIndex(node, pages);
    // A selection that landed on a hidden page moves to the page shown, so code reads what
    // the user sees.
    if (pages.length && selected !== clampIndex(node, pages.length)) {
      node.props = node.props || {};
      node.props.selectedIndex = selected;
    }
    const style = (node.props && node.props.headerStyle) || 'tabs';
    // onTabChange fires whenever the selected page changes, from a header click or from code
    // (a wizard's Next button sets selectedIndex): one place, once per change, and only once
    // the headers are drawn, so a handler that puts selectedIndex back redraws over them.
    const changed = node.__shownIndex !== undefined && node.__shownIndex !== selected;
    node.__shownIndex = selected;
    const announce = () => {
      if (changed) ctx.emit(node, 'onTabChange', { selectedIndex: selected });
    };
    if (style === 'none') {
      headers.replaceChildren();
      announce();
      return;
    }
    // Hidden pages have no header.
    headers.replaceChildren(
      ...pages.filter(pageShown).map((page) => {
        const i = pages.indexOf(page);
        const tab = el('button', style === 'steps' ? 'gd-tab-header gd-step' : 'gd-tab-header', { type: 'button' });
        tab.dataset.gdClick = '';
        if (style === 'steps') {
          // The circle holds the page's icon, a plain page icon when it has none; done is a tick.
          const state = i < selected ? 'done' : i === selected ? 'current' : 'upcoming';
          tab.dataset.state = state;
          const circle = el('span', 'gd-step-number');
          if (state === 'done') circle.textContent = '✓';
          else circle.append(iconGlyph((page.props && page.props.icon) || 'chevron-right', 'gd-step-icon'));
          tab.append(circle);
        } else {
          const glyph = iconGlyph(page.props && page.props.icon, 'gd-tab-icon');
          if (glyph) tab.append(glyph);
        }
        tab.append(el('span', 'gd-tab-text', { textContent: (page.props && page.props.text) || `Tab ${i + 1}` }));
        tab.classList.toggle('gd-tab-header-active', i === selected);
        tab.addEventListener('click', (e) => {
          e.stopPropagation();
          if (i === selected) return;
          ctx.snapshot?.();
          node.props = node.props || {};
          node.props.selectedIndex = i;
          ctx.update(node); // refresh raises onTabChange
        });
        return tab;
      })
    );
    announce();
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'headerStyle') element.dataset.header = value || 'tabs';
  }
});

function clampIndex(node, count) {
  const wanted = Number((node.props && node.props.selectedIndex) || 0);
  if (!Number.isFinite(wanted) || count === 0) return 0;
  return Math.min(Math.max(0, Math.trunc(wanted)), count - 1);
}

const pageShown = (page) => shown(page);

// The page to show: the selected one, or - when that one is hidden - the nearest visible page
// in the direction of travel. Asked for a page before the one on view (a Back button), that is
// the nearest before it, else after it; otherwise (a move forward, the page on view hidden, the
// first draw) after it, else before it. A hidden page has no header and is never the one on view.
// __shownIndex still holds the page on view here: refresh() asks before it records the new one.
function shownIndex(node, pages) {
  const wanted = clampIndex(node, pages.length);
  if (pages.length === 0 || pageShown(pages[wanted])) return wanted;
  const back = node.__shownIndex !== undefined && wanted < node.__shownIndex;
  const first = nearestShown(pages, wanted, back ? -1 : 1);
  if (first !== -1) return first;
  const other = nearestShown(pages, wanted, back ? 1 : -1);
  return other !== -1 ? other : wanted;
}

// The first visible page from `from` (not included) going `step` (1 or -1), or -1.
function nearestShown(pages, from, step) {
  for (let i = from + step; i >= 0 && i < pages.length; i += step) if (pageShown(pages[i])) return i;
  return -1;
}

// A Repeater shows its item template once per row of its data, the items stacked top to
// bottom. The template is its one child, designed like a panel; at run time it stays hidden
// and every row gets a copy of it, built through the form (host.buildInner) so the copy's
// controls answer to events under the template's ids - btnDel_OnClick serves every item, with
// `sender` the item's own button - and each control knows its `item` and `itemIndex`.

register({
  type: 'repeatertemplate',
  label: 'Item Template',
  description: 'What one item of the Repeater looks like: design it like a panel.',
  group: 'Container',
  container: true,
  toolbox: false,
  intrinsic: true,
  bindable: false,
  defaultSize: { width: 300, height: 56 },
  props: [
    { name: 'border', type: 'bool', default: false },
    { name: 'borderColor', type: 'color', default: '', doc: 'Replaces the default border colour while border is on.' },
    { name: 'borderRadius', type: 'number', default: 0, min: 0, doc: 'Corner rounding in pixels.' },
    { name: 'backColor', type: 'color', default: '' }
  ],
  events: [],
  create() {
    const item = el('div', 'gd-widget gd-repeatertemplate');
    return { el: item, contentEl: item };
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'border' || name === 'borderColor' || name === 'borderRadius') {
      if (name === 'border') element.classList.toggle('gd-repeatertemplate-border', value === true);
      applyBorderStyle(element, node);
    } else if (name === 'backColor') element.style.background = value || '';
  }
});

const templateOf = (node) => (node.children || []).find((child) => child.type === 'repeatertemplate') || null;

// The rows: an array from code or a dataSource; JSON text with an array is taken too.
function repeaterRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* not rows */
    }
  }
  return [];
}

function clearRepeaterItems(node) {
  for (const instance of node.__instances || []) node.__host?.discardInner?.(instance.node);
  node.__instances = [];
}

// One copy of the template per row, on the running form only (the canvas shows the template).
function buildRepeaterItems(node, rows) {
  clearRepeaterItems(node);
  const host = node.__host;
  const template = templateOf(node);
  if (!host || host.mode !== 'run' || !host.buildInner || !template || !node.__el) return;
  rows.forEach((row, index) => {
    const copy = JSON.parse(JSON.stringify(template, (key, value) => (key.startsWith('__') ? undefined : value)));
    const built = host.buildInner(copy);
    copy.__el.dataset.gdItem = String(index);
    node.__el.append(copy.__el);
    for (const control of built.controls.values()) {
      // The row as the item shows it now (edits included) and where the item sits.
      Object.defineProperty(control, 'item', { get: () => built.root.data });
      Object.defineProperty(control, 'itemIndex', { value: index });
    }
    built.root.data = row;
    node.__instances.push({ node: copy, root: built.root });
  });
}

// Every second item takes altBackColor when there is one; the rest keep the template's own.
function styleRepeaterItems(node) {
  const alt = repeaterProps(node).altBackColor || '';
  const own = (templateOf(node)?.props?.backColor) || '';
  (node.__instances || []).forEach((instance, i) => {
    instance.node.__el.style.background = i % 2 === 1 && alt ? alt : own;
  });
}

const repeaterProps = (node) => ({ ...defaultPropsOf(node.type), ...(node.props || {}) });

// In `content` mode the Repeater renders as tall as its items (the Column and the anchor/dock
// layout read it through heightOf, so what follows moves); `fixed` keeps the stored height.
function applyRepeaterHeight(node) {
  const props = repeaterProps(node);
  const template = templateOf(node);
  if (props.heightMode === 'content' && node.__host?.mode === 'run' && template) {
    node.__renderHeight = contentHeight((node.__instances || []).length, template.height, props.itemGap);
  } else delete node.__renderHeight;
}

register({
  type: 'repeater',
  label: 'Repeater',
  description: 'Shows its item template once per row of its data, one item under the other.',
  group: 'Container',
  container: true,
  dataProp: 'items',
  defaultSize: { width: 300, height: 200 },
  props: [
    { name: 'items', type: 'json', default: '', hidden: true, tsType: 'any[]', doc: 'The rows, one item each: what dataSource fills, or assign an array from code. Reads back the rows with each item\'s bound values, edits included.' },
    { name: 'itemGap', type: 'number', default: 4, min: 0, doc: 'Pixels between two items.' },
    { name: 'heightMode', type: 'enum', values: ['fixed', 'content'], default: 'fixed', doc: 'fixed keeps the designed height and scrolls the items; content grows to fit them all, so what follows in a Column moves down.' },
    { name: 'altBackColor', type: 'color', default: '', doc: 'The background of every second item; empty leaves every item as the template draws it.' }
  ],
  events: [],
  create(node, host) {
    const root = el('div', 'gd-widget gd-repeater');
    root.__gdNode = node;
    node.__host = host;
    node.__instances = [];
    return { el: root, contentEl: root };
  },
  read(element, name) {
    const node = element.__gdNode;
    if (name !== 'items' || !node || !node.__items) return undefined;
    return node.__instances.map((instance) => instance.root.data);
  },
  apply(element, node, name, value) {
    if (applyCommon(element, name, value)) return;
    if (name === 'items') {
      node.__items = repeaterRows(value);
      buildRepeaterItems(node, node.__items);
      styleRepeaterItems(node);
      applyRepeaterHeight(node);
    } else if (name === 'itemGap' || name === 'heightMode') {
      element.classList.toggle('gd-repeater-fixed', repeaterProps(node).heightMode !== 'content');
      applyRepeaterHeight(node);
    } else if (name === 'altBackColor') styleRepeaterItems(node);
  },
  // The canvas shows the template at the top, full width; the running form hides it and
  // places one item per row.
  layoutChildren(node, content) {
    const template = templateOf(node);
    if (!template || !template.__el) return;
    const run = node.__host?.mode === 'run';
    template.__el.classList.toggle('gd-repeater-master', run);
    const width = content.clientWidth;
    if (!run) {
      place(template.__el, { left: 0, top: 0, width, height: template.height });
      return;
    }
    const rects = itemRects({ count: node.__instances.length, width, itemHeight: template.height, gap: repeaterProps(node).itemGap });
    node.__instances.forEach((instance, i) => {
      place(instance.node.__el, rects[i]);
      relayout(instance.node);
    });
  },
  // Design-time resize: the template follows the width; its height is the item's own.
  resizeChildren(node, { after, resizeChild }) {
    const template = templateOf(node);
    if (template) resizeChild(template, after.w, template.height);
  },
  dispose(element, node) {
    clearRepeaterItems(node);
  }
});

export { layoutChildren };
