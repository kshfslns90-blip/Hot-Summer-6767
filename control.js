// The object a code behind talks to: btnOk.text = 'Save', txtName.value, pnlMain.visible = false.
// Every property declared by a widget becomes a real accessor, so there is nothing to look up.
import { widget, propsOf, bindProp, defaultPropsOf } from './widgets.js';
import { bindingTargets, getPath, setPath, changedPaths, liveRecord } from './data-source.js';

export class Control {
  constructor(node, host) {
    const def = widget(node.type);
    Object.defineProperty(this, '__node', { value: node });
    Object.defineProperty(this, '__def', { value: def });
    Object.defineProperty(this, '__host', { value: host });

    for (const meta of propsOf(node.type)) defineProp(this, meta.name);
    defineGeometry(this, 'left');
    defineGeometry(this, 'top');
    defineGeometry(this, 'width');
    defineGeometry(this, 'height');
    // `data`, currentItem, load()/reload() and dirty tracking: a data widget's data is its own
    // data property under one name, a container's is its record. A Repeater is both, and its
    // data is its rows.
    if (def.dataProp) defineData(this);
    else if (def.container) defineRecord(this);
    if (def.container || def.dataProp) {
      defineCurrentItem(this);
      defineLoading(this);
      defineDirtyTracking(this);
    }
  }

  get id() {
    return this.__node.id;
  }

  get type() {
    return this.__node.type;
  }

  get element() {
    return this.__node.__el;
  }

  get node() {
    return this.__node;
  }

  get dock() {
    return this.__node.dock || 'none';
  }

  set dock(value) {
    this.__node.dock = value || 'none';
    this.__host.relayout();
  }

  get anchor() {
    return [...(this.__node.anchor || ['left', 'top'])];
  }

  set anchor(value) {
    this.__node.anchor = Array.isArray(value) ? value : ['left', 'top'];
    this.__host.relayout();
  }

  // The live children collection of a container: iterate it, controls.add(new Button(...)),
  // controls.remove(btn). Adding and removing only work while the form is running.
  get controls() {
    if (!this.__collection) {
      Object.defineProperty(this, '__collection', { value: new ControlCollection(this) });
    }
    return this.__collection;
  }

  focus() {
    const element = this.element;
    // A widget that is itself focusable (a Tree View has tabindex) takes the focus; otherwise the
    // first field inside it does.
    const target = element && (element.matches('input, select, textarea, button, a, [tabindex]') ? element : element.querySelector('input, select, textarea, button, a'));
    if (target) target.focus();
    return this;
  }

  on(event, handler) {
    this.__host.addHandler(this.__node, event, handler);
    return this;
  }

  setProps(values) {
    for (const [name, value] of Object.entries(values || {})) this[name] = value;
    return this;
  }
}

// A container's children, WinForms style. The collection is a live view over the node's
// children array; add/remove go through the form instance so the id map, event wiring and
// layout all stay coherent.
export class ControlCollection {
  constructor(owner) {
    Object.defineProperty(this, '__owner', { value: owner });
  }

  get __children() {
    return this.__owner.__node.children || [];
  }

  get length() {
    return this.__children.length;
  }

  at(index) {
    const child = this.__children[index];
    return (child && this.__owner.__host.controlOf(child)) || null;
  }

  get(id) {
    const child = this.__children.find((c) => c.id === id);
    return (child && this.__owner.__host.controlOf(child)) || null;
  }

  [Symbol.iterator]() {
    const host = this.__owner.__host;
    return this.__children
      .map((child) => host.controlOf(child))
      .filter(Boolean)
      [Symbol.iterator]();
  }

  add(control, index) {
    const host = this.__owner.__host;
    if (!host.attach) throw new Error('Dynamic controls are only available while the form is running.');
    if (!control || !control.__node) {
      throw new Error('controls.add expects a control made with new Button(...), new Label(...), and so on.');
    }
    return host.attach(this.__owner.__node, control.__node, index);
  }

  remove(controlOrId) {
    const host = this.__owner.__host;
    if (!host.detach) throw new Error('Dynamic controls are only available while the form is running.');
    const node =
      typeof controlOrId === 'string'
        ? this.__children.find((c) => c.id === controlOrId)
        : controlOrId && controlOrId.__node;
    if (!node || !this.__children.includes(node)) return false;
    host.detach(node);
    return true;
  }

  clear() {
    const host = this.__owner.__host;
    if (!host.detach) throw new Error('Dynamic controls are only available while the form is running.');
    while (this.__children.length > 0) {
      host.detach(this.__children[this.__children.length - 1]);
    }
  }
}

function defineProp(control, name) {
  if (name in control) return;
  Object.defineProperty(control, name, {
    enumerable: true,
    get() {
      const node = this.__node;
      const live = this.__def.read ? this.__def.read(node.__el, name) : undefined;
      if (live !== undefined) return live;
      // A node stores only the props that were set; the widget's default answers for the rest,
      // so tabs.selectedIndex + 1 counts from 0 on a control nobody has touched.
      const stored = node.props ? node.props[name] : undefined;
      return stored !== undefined ? stored : defaultPropsOf(node.type)[name];
    },
    set(value) {
      const node = this.__node;
      node.props = node.props || {};
      node.props[name] = value;
      if (node.__el) this.__def.apply?.(node.__el, node, name, value);
      this.__host.update(node);
    }
  });
}

// A data widget's `data`: the property the widget declared as its data (rows, items, nodes), or
// the widget's own way of reading and applying it (a chart takes { labels, series }).
function defineData(control) {
  Object.defineProperty(control, 'data', {
    enumerable: true,
    get() {
      const def = this.__def;
      return def.readData ? def.readData(this) : this[def.dataProp];
    },
    set(value) {
      const def = this.__def;
      if (def.applyData) def.applyData(this, value);
      else this[def.dataProp] = value;
      snapshot(this.__node, this.data);
    }
  });
}

// The baseline dirty tracking compares against: a deep copy of `data` as it read right after the
// last load or assignment. Kept beside the reload sequence, so a control has one data state.
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function snapshot(node, value) {
  const state = node.__data || (node.__data = { seq: 0 });
  state.original = clone(value);
}

// currentItem: the record the control is on. A widget with a notion of "current" (a grid's
// selected row, a tree's selected node, a list's picked item) answers through its definition;
// a container's is its record, live: assigning a field fills the control bound to it; anything
// else has none. The property itself is read only, and never a server call.
function defineCurrentItem(control) {
  Object.defineProperty(control, 'currentItem', {
    enumerable: true,
    get() {
      const def = this.__def;
      if (def.currentItem) return def.currentItem(this.__node, this) ?? null;
      return def.container ? liveRecord(this.data, (key, value) => writeRecordField(this, key, value)) : null;
    },
    set() {
      throw new TypeError(`${this.id}.currentItem is read only: select a row or node, or assign data.`);
    }
  });
  // selectedItems: every record selected, as an array. A widget with several (a grid, a
  // multiple List Box) answers itself; anything else has its currentItem alone, or nothing.
  Object.defineProperty(control, 'selectedItems', {
    enumerable: true,
    get() {
      const def = this.__def;
      if (def.selectedItems) return def.selectedItems(this.__node, this) || [];
      const item = this.currentItem;
      return item ? [item] : [];
    },
    set() {
      throw new TypeError(`${this.id}.selectedItems is read only: select rows or nodes, or assign data.`);
    }
  });
}

// One field of a container's record assigned through currentItem: it goes into the stored
// record and into every control bound at or under it (`address` reaches a control bound to
// `address.city`), the way a whole record does; a control whose field the value lacks is left
// alone. The baseline stays, so the container is dirty afterwards, as after typing.
function writeRecordField(control, key, value) {
  const node = control.__node;
  const record = node.__record || (node.__record = {});
  record[key] = value;
  for (const target of bindingTargets(node, ownsData)) {
    const field = target.props.dataField;
    if (field !== key && !field.startsWith(`${key}.`)) continue;
    const child = control.__host.controlOf(target);
    const prop = bindProp(widget(target.type));
    if (!child || !prop) continue;
    const shown = getPath(record, field);
    if (shown !== undefined) child[prop] = shown;
  }
}

// isDirty / changes(): what differs between the data as it is now (edits in the bound controls
// or the grid's cells included) and the baseline. acceptChanges() makes the current data the
// baseline, after a save that keeps the form open.
function defineDirtyTracking(control) {
  Object.defineProperty(control, 'changes', {
    value() {
      return changedPaths(this.__node.__data?.original, this.data);
    }
  });
  Object.defineProperty(control, 'isDirty', {
    enumerable: true,
    get() {
      return this.changes().length > 0;
    }
  });
  Object.defineProperty(control, 'acceptChanges', {
    value() {
      snapshot(this.__node, this.data);
    }
  });
}

// A child whose descendants bind to its own data rather than to the record around it: a
// container with a dataSource (its own record), or a data widget such as a Repeater (its rows
// reach the controls of its template).
const ownsData = (node) => {
  const def = widget(node.type);
  return Boolean(def.dataProp) || (def.container && Boolean(node.props && node.props.dataSource));
};

// A container's `data` is its record. Reading it gives the record last loaded or assigned with
// every bound control's current value written at its dataField, so edits come back; assigning
// one pushes each field into the control that shows it. A field the record lacks leaves its
// control alone.
function defineRecord(control) {
  Object.defineProperty(control, 'data', {
    enumerable: true,
    get() {
      const node = this.__node;
      const record = node.__record ? JSON.parse(JSON.stringify(node.__record)) : {};
      for (const target of bindingTargets(node, ownsData)) {
        const child = this.__host.controlOf(target);
        const prop = bindProp(widget(target.type));
        if (child && prop) setPath(record, target.props.dataField, child[prop]);
      }
      return record;
    },
    set(value) {
      const node = this.__node;
      node.__record = value && typeof value === 'object' ? value : {};
      for (const target of bindingTargets(node, ownsData)) {
        const child = this.__host.controlOf(target);
        const prop = bindProp(widget(target.type));
        if (!child || !prop) continue;
        const field = getPath(node.__record, target.props.dataField);
        if (field !== undefined) child[prop] = field;
      }
      // The baseline is the record as the controls now show it, so a field the record lacks
      // (an empty box on a new record) is not a change until someone types in it.
      snapshot(node, this.data);
    }
  });
}

// reload(args) runs the control's dataSource again; load(source, args) assigns the source (and
// dataArgs) first. Only a running form can (the design canvas never calls the server), so
// elsewhere both resolve with nothing.
function defineLoading(control) {
  Object.defineProperty(control, 'reload', {
    value(args) {
      return this.__host.reload ? this.__host.reload(this.__node, args) : Promise.resolve(undefined);
    }
  });
  Object.defineProperty(control, 'load', {
    value(source, args) {
      return this.__host.load ? this.__host.load(this.__node, source, args) : Promise.resolve(undefined);
    }
  });
}

function defineGeometry(control, name) {
  Object.defineProperty(control, name, {
    enumerable: true,
    get() {
      return Number(this.__node[name]) || 0;
    },
    set(value) {
      this.__node[name] = Number(value) || 0;
      this.__host.relayout();
    }
  });
}
