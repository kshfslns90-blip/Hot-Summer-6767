// A live instance of a form: the DOM, the controls, and the compiled code behind wired together.
import { buildTree, relayout, walk, disposeTree, notifyTree, repeaterTemplate } from './builder.js';
import { widget, widgetConstructors, defaultPropsOf } from './widgets.js';
import { compileCodeBehind } from './scope.js';
import { showMessage, showConfirm, showPrompt, showToast } from './dialogs.js';
import { parseDataArgs } from './data-source.js';
import { serverModule } from './server-module.js';
import { splitQualified, qualify, parseTarget, scriptContext } from './modules.js';
import { loadForm } from './endpoints.js';
import { uploadBatch, downloadUrl, triggerDownload } from './upload.js';

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

// Every running form instance gets a scope of its own, which widgets use for names that must not
// meet another form's: a radio's group (the browser groups radios by name across the whole
// page, and a form hidden by form.open(), a modal over a form, or a Frame's form all share it).
let instanceCount = 0;

export class FormInstance {
  // `name` is the form's qualified name, "Module.Form"; the code behind sees the short name
  // (handler prefixes, form.name) and reaches the module's own scripts and forms by bare name.
  // `slot` is the window this form sits in when it is not the main form - a modal, a popup, a
  // Frame - given now because Form_OnLoad runs inside mount() and may already navigate.
  constructor({ name, layout, code, args, app, mode = 'run', slot = null }) {
    const parts = splitQualified(name);
    this.name = parts.name;
    this.module = parts.module;
    this.qualifiedName = name;
    this.layout = layout;
    this.code = code || '';
    this.args = args;
    this.app = app;
    this.slot = slot;
    this.mode = mode;
    this.controls = {};
    this.exports = {};
    this.dynamic = new Map();
    // Detached subtrees made with new Button(...) etc., waiting for a controls.add(): the root
    // node maps to the Map<node, Control> that buildTree produced for it.
    this.pending = new Map();
    // Forms shown inside this one by a Frame, and the form this one sits in, if any.
    this.embedded = new Set();
    this.parentInstance = null;
    this.disposed = false;
    // Hidden behind a child it opened (form.open()); on its way out (Form_OnClose running, or
    // run); loaded (Form_OnLoad finished), which form.open() requires.
    this.suspended = false;
    this.leaving = false;
    this.ready = false;
    this.scrollState = null;
    // Settles when the form is gone, with what it closed with: close()/closeAll() give their result,
    // leave() and a bare dispose() undefined. Never left pending.
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  get element() {
    return this.layout.__el;
  }

  async mount(hostEl) {
    this.layout.type = this.layout.type || 'form';
    this.layout.id = this.layout.id || this.layout.name || this.name;

    this.host = {
      mode: this.mode,
      // Unique per instance in the running app; the design canvas has one form and needs none.
      scope: this.mode === 'run' ? `f${++instanceCount}` : '',
      emit: (node, event, payload) => this.emit(node, event, payload),
      relayout: () => this.relayout(),
      update: (node) => this.update(node),
      controlOf: (node) => this.controlsByNode.get(node),
      addHandler: (node, event, fn) => this.addHandler(node, event, fn),
      attach: (parentNode, node, index) => this.attach(parentNode, node, index),
      detach: (node) => this.detach(node),
      reload: (node, args) => this.reload(node, args),
      load: (node, source, args) => this.load(node, source, args),
      buildInner: (node) => this.buildInner(node),
      discardInner: (node) => this.discardInner(node),
      embed: (name, args, slot) => this.embed(name, args, slot),
      reportError: (err, where) => this.reportError(err, where),
      hasHandler: (node, event) => this.hasHandler(node, event),
      // An Upload control's batch: the handler is this module's script unless qualified.
      upload: (files, handler, onProgress) => uploadBatch({ files, handler: parseTarget(handler, this.module).target, onProgress })
    };

    const built = buildTree(this.layout, this.host);
    this.controlsByNode = built.controls;
    this.form = built.root;
    for (const [node, control] of built.controls) if (node.id) this.controls[node.id] = control;

    hostEl.append(this.element);
    this.relayout();

    this.observer = new ResizeObserver(() => {
      // Hidden behind a child (display: none, 0 x 0): nothing to lay out; resume() does it.
      if (this.suspended) return;
      this.relayout();
      this.noteResize();
    });
    this.observer.observe(this.element);

    if (this.mode === 'run') {
      // The form's own onKeyDown: one document listener per live instance, gone in dispose(),
      // so a code behind never has to hang (and remember to remove) its own.
      this.onDocumentKey = (e) => this.routeKey(e);
      document.addEventListener('keydown', this.onDocumentKey);
      await this.run();
      this.scheduleShow();
    }
    this.ready = true;
    return this;
  }

  // Form_OnShow: once, when the form is on screen and ready. mount() has awaited Form_OnLoad by
  // now, and whoever mounted the form settles its window right after (a modal focused, a popup
  // placed, a Frame's own onLoad raised); the next animation frame comes after all of that and
  // after the browser has laid the form out, so the handler can measure it and focus a control.
  // A form taken down meanwhile (its onLoad navigated away) never gets it; one hidden meanwhile
  // (a child opened over it within that frame) gets it when it is first seen, from resume().
  scheduleShow() {
    this.showFrame = requestAnimationFrame(() => {
      this.showFrame = 0;
      if (this.disposed || this.suspended || this.shown) return;
      this.shown = true;
      this.lastSize = this.measure();
      this.emit(this.layout, 'onShow', {});
    });
  }

  // The form's box, in whole pixels; nothing while it is not rendered (a Frame on a tab page
  // that is not selected measures 0 x 0).
  measure() {
    const el = this.element;
    if (!el || (!el.clientWidth && !el.clientHeight)) return null;
    return { width: el.clientWidth, height: el.clientHeight };
  }

  // Form_OnResize: the form's size changed after it was shown. The observer's callback only
  // books a frame, so the handler runs outside it (a handler that resizes something never trips
  // the browser's "ResizeObserver loop" complaint) and at most once a frame however fast the
  // window is dragged. A size equal to the last one reported, or no size at all, says nothing.
  noteResize() {
    if (!this.shown || this.resizeFrame || this.disposed || this.suspended) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      if (this.disposed || this.suspended) return;
      const size = this.measure();
      if (!size) return;
      if (this.lastSize && size.width === this.lastSize.width && size.height === this.lastSize.height) return;
      this.lastSize = size;
      this.emit(this.layout, 'onResize', { width: size.width, height: size.height });
    });
  }

  // A key reaches the form's onKeyDown when the form is the active one (the top modal, else the
  // current form) and the key was not typed somewhere else: a message box's field, the shell's
  // chrome or another form. A key with nothing focused, or dispatched on the document, counts.
  routeKey(e) {
    if (this.disposed || this.suspended) return;
    if (this.app) {
      const modals = this.app.modals || [];
      const top = modals.length ? modals[modals.length - 1].current : this.app.current;
      // An embedded form is active along with the form it sits in.
      let root = this;
      while (root.parentInstance) root = root.parentInstance;
      if (top !== root) return;
    }
    const target = e.target;
    if (target instanceof Element && target !== document.body && target !== document.documentElement && !this.element?.contains(target)) return;
    this.emit(this.layout, 'onKeyDown', e);
  }

  async run() {
    // A form taken down while it was still being built (another one overtook it) runs nothing.
    if (this.disposed) return;
    // Every name a code behind hands over - a form, a script, a call target - is completed with
    // this form's module before it leaves: 'Details' is this module's, 'Utils.Details' another's.
    // Navigation and closing are the form's own: form.navigate(), form.close(), form.closeAll().
    // Everything server-side goes through one object: server.callFunction, server.require (the
    // same object require('server:name') and a 'server:name' import give), server.fileUrl and
    // server.downloadFile.
    const services = {
      server: {
        callFunction: (target, args) => this.callServer(target, args),
        require: (name) => serverModule(this.qualifyOrKeep(name), (target, args) => this.app.callServer(target, args)),
        fileUrl: (target, args) => downloadUrl(parseTarget(target, this.module).target, args),
        downloadFile: (target, args) => triggerDownload(downloadUrl(parseTarget(target, this.module).target, args))
      },
      showMessage,
      showConfirm,
      showPrompt,
      showToast,
      form: this.formFacade(),
      app: this.app.facade(this.module),
      // Where this code lives: its kind, module and names.
      context: scriptContext('form', this.qualifiedName),
      __ctl: this.controls
    };
    // One constructor per widget type - new Button({...}) - each bound to this instance.
    for (const { type, name } of widgetConstructors()) {
      services[name] = this.makeConstructor(type);
    }

    this.exports = (await compileCodeBehind(this.code, {
      formName: this.qualifiedName,
      module: this.module,
      // The form itself is reached as `form`, so its id is not bound as a control identifier:
      // a form called "add" must not shadow an imported add().
      controlIds: Object.keys(this.controls).filter((id) => id !== this.layout.id),
      services
    })) || {};

    // Bound controls start loading now, alongside Form_OnLoad rather than before it: the form
    // does not wait for the server, and a reload() made in onLoad wins over the automatic one.
    this.autoLoadAll();
    await this.emit(this.layout, 'onLoad', { args: this.args });
  }

  // A script name completed with this form's module; a name that is no name at all is passed
  // on as it is, so the function it reaches words the complaint.
  qualifyOrKeep(name) {
    try {
      return qualify(name, this.module);
    } catch {
      return name;
    }
  }

  // A server call from this form: "script.fn" is this module's script, "Module.script.fn" any.
  callServer(target, args) {
    return this.app.callServer(parseTarget(target, this.module).target, args);
  }

  // --- data sources -----------------------------------------------------------

  // A node with a dataSource: a data widget (its data) or a container (its record).
  boundNode(node) {
    const def = widget(node.type);
    if (!def.dataProp && !def.container) return false;
    const target = node.props && node.props.dataSource;
    return typeof target === 'string' && target.trim() !== '';
  }

  boundNodes() {
    const out = [];
    walk(this.layout, (node) => {
      if (this.boundNode(node)) out.push(node);
    });
    return out;
  }

  autoLoadAll() {
    for (const node of this.boundNodes()) {
      // A node stores only the props that were set; the widget's default decides the rest
      // (an Autocomplete waits for text unless told otherwise).
      const props = { ...defaultPropsOf(node.type), ...node.props };
      if (props.autoLoad !== false) this.reload(node);
    }
  }

  // form.reload(): every control with a dataSource, the form's own record included.
  async reloadAll() {
    await Promise.all(this.boundNodes().map((node) => this.reload(node)));
  }

  hasHandler(node, event) {
    return Boolean(this.resolveHandler(node, event)) || (this.dynamic.get(`${node.id}::${event}`) || []).length > 0;
  }

  // Calls the control's dataSource and puts the answer in its data. The latest call wins: an
  // answer to an earlier reload that arrives later is dropped. A failed load goes to the
  // control's onDataError, or to the form's error reporting when it has none; either way the
  // promise resolves (with undefined), so a call nobody awaits never becomes an unhandled
  // rejection. Only a missing dataSource rejects - that is a programming error.
  async reload(node, args) {
    const target = node.props && node.props.dataSource;
    if (typeof target !== 'string' || target.trim() === '') {
      throw new Error(`"${node.id || this.name}" has no dataSource.`);
    }
    const state = node.__data || (node.__data = { seq: 0 });
    const seq = ++state.seq;
    const callArgs = args === undefined ? parseDataArgs(node.props.dataArgs) : args;
    try {
      const result = await this.callServer(target.trim(), callArgs);
      if (seq !== state.seq || this.disposed) return undefined;
      const control = this.controlsByNode.get(node);
      if (control) control.data = result;
      await this.emit(node, 'onDataLoaded', { data: result, args: callArgs });
      return result;
    } catch (err) {
      if (seq !== state.seq || this.disposed) return undefined;
      if (this.hasHandler(node, 'onDataError')) await this.emit(node, 'onDataError', { error: err, args: callArgs });
      else this.reportError(err, `${node.id || this.name}.dataSource`);
      return undefined;
    }
  }

  // load(source, args): the control takes the source as its dataSource and the arguments as its
  // dataArgs (none when omitted, so the function's own defaults apply), then loads. A later
  // reload() runs the same call again.
  load(node, source, args) {
    if (typeof source !== 'string' || source.trim() === '') {
      throw new Error(`"${node.id || this.name}".load() needs a dataSource, "script.fn".`);
    }
    const control = this.controlsByNode.get(node);
    if (!control) throw new Error(`"${node.id || this.name}" is not on the form.`);
    control.dataSource = source.trim();
    control.dataArgs = args === undefined ? [] : args;
    return this.reload(node);
  }

  formFacade() {
    const instance = this;
    return {
      get name() {
        return instance.name;
      },
      get args() {
        return instance.args;
      },
      // False once the form closed or its window moved on: a handler continuing after an
      // await (a modal it waited for, a server answer) can check before touching controls.
      get isOpen() {
        return !instance.disposed;
      },
      // Every control on the form, keyed by id: form.all.btnOk.
      get all() {
        return instance.controls;
      },
      // The form body's live children collection, so form.controls.add(...) works.
      get controls() {
        return instance.form.controls;
      },
      get element() {
        return instance.element;
      },
      get layout() {
        return instance.layout;
      },
      // Where the form goes from here: another form in this same window, another over this one
      // (and back to it), or out. A modal, drawer or popup opens on top, in a window of its own -
      // not from a form that is gone.
      navigate: (formName, args) => instance.navigate(formName, args),
      open: (formName, args) => instance.open(formName, args),
      close: (result) => instance.close(result),
      closeAll: (result) => instance.closeAll(result),
      showModal: async (formName, args, options) => {
        if (instance.disposed) throw new Error('The form is closed.');
        return instance.app.showModal(qualify(formName, instance.module), args, options);
      },
      showDrawer: async (formName, args, options) => {
        if (instance.disposed) throw new Error('The form is closed.');
        return instance.app.showDrawer(qualify(formName, instance.module), args, options);
      },
      showPopup: async (formName, args, anchor) => {
        if (instance.disposed) throw new Error('The form is closed.');
        return instance.app.showPopup(qualify(formName, instance.module), args, anchor);
      },
      relayout: () => instance.relayout(),
      // form.reload() reloads every bound control; form.reload(args) the form's own record with
      // those arguments (a details form opened with an id: form.reload([form.args.id])).
      reload: (args) => (args === undefined ? instance.reloadAll() : instance.reload(instance.layout, args)),
      // form.load(source, args): the form's own dataSource and dataArgs, then a load.
      load: (source, args) => instance.load(instance.layout, source, args),
      // The form's own record, when the form has a dataSource: the Form is a container too.
      get data() {
        return instance.form.data;
      },
      set data(value) {
        instance.form.data = value;
      },
      get currentItem() {
        return instance.form.currentItem;
      },
      get selectedItems() {
        return instance.form.selectedItems;
      },
      // Dirty tracking of the form's record: what the bound controls changed since the load.
      get isDirty() {
        return instance.form.isDirty;
      },
      changes: () => instance.form.changes(),
      acceptChanges: () => instance.form.acceptChanges(),
      // form.busy = true or 'Saving...' covers the form with a spinner; false takes it away.
      get busy() {
        return instance.busyValue || false;
      },
      set busy(value) {
        instance.setBusy(value);
      }
    };
  }

  setBusy(value) {
    this.busyValue = value === true ? true : value ? String(value) : false;
    const root = this.element;
    if (!root) return;
    let overlay = root.querySelector(':scope > .gd-busy');
    if (!this.busyValue) {
      overlay?.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'gd-busy';
      const spinner = document.createElement('div');
      spinner.className = 'gd-busy-spinner';
      const text = document.createElement('div');
      text.className = 'gd-busy-text';
      overlay.append(spinner, text);
      root.append(overlay);
    }
    overlay.querySelector('.gd-busy-text').textContent = typeof this.busyValue === 'string' ? this.busyValue : '';
  }

  // --- dynamic controls -----------------------------------------------------

  makeConstructor(type) {
    const instance = this;
    // Returning an object from a constructor makes `new Button()` hand back the Control.
    return function (options) {
      return instance.createControl(type, options || {});
    };
  }

  // Builds a detached control: real DOM, live accessors, but on no form until controls.add().
  createControl(type, options) {
    const def = widget(type);
    const { id, left, top, width, height, anchor, dock, grow, ...props } = options;
    const node = {
      id: typeof id === 'string' && IDENT_RE.test(id) ? id : this.uniqueId(type),
      type,
      left: Number(left) || 0,
      top: Number(top) || 0,
      width: Number(width) || def.defaultSize.width,
      height: Number(height) || def.defaultSize.height,
      anchor: Array.isArray(anchor) ? anchor : ['left', 'top'],
      dock: dock || def.defaultDock || 'none',
      ...(Number(grow) > 0 ? { grow: Number(grow) } : {}),
      props: { ...defaultPropsOf(type) },
      events: {},
      children: []
    };
    // A tab control starts with two pages, a repeater with its item template, the way the
    // designer makes them.
    if (type === 'tabcontrol') {
      node.children = [1, 2].map((n) => ({
        id: this.uniqueId('tabpage'),
        type: 'tabpage',
        left: 0, top: 0, width: node.width, height: node.height,
        anchor: ['left', 'top'], dock: 'none',
        props: { text: `Page ${n}` }, events: {}, children: []
      }));
    } else if (type === 'repeater') {
      node.children = [repeaterTemplate(node.width, this.uniqueId('repeatertemplate'))];
    }

    const built = buildTree(node, this.host);
    this.pending.set(node, built.controls);
    return built.root.setProps(props);
  }

  // Ids in use anywhere: the mounted form plus every detached subtree not yet added.
  uniqueId(base) {
    const taken = new Set();
    walk(this.layout, (n) => n.id && taken.add(n.id));
    for (const [root] of this.pending) walk(root, (n) => n.id && taken.add(n.id));
    let i = 1;
    while (taken.has(`${base}${i}`)) i += 1;
    const id = `${base}${i}`;
    taken.add(id);
    return id;
  }

  attach(parentNode, node, index) {
    if (this.disposed) throw new Error('The form is closed.');
    if (!parentNode.__contentEl) {
      throw new Error(`"${parentNode.id || parentNode.type}" is not a container.`);
    }
    if (node.__parent || node === this.layout) {
      throw new Error(`"${node.id}" is already on the form. Remove it before adding it again.`);
    }
    const map = this.pending.get(node);
    if (!map) throw new Error(`"${node.id || node.type}" was not created by this form.`);

    // An id claimed since the control was made gets quietly re-uniquified.
    for (const [n] of map) {
      if (n.id && Object.prototype.hasOwnProperty.call(this.controls, n.id)) n.id = this.uniqueId(n.type);
    }

    parentNode.children = parentNode.children || [];
    const at = index === undefined ? parentNode.children.length : Math.max(0, Math.min(index, parentNode.children.length));
    parentNode.children.splice(at, 0, node);
    node.__parent = parentNode;
    const after = parentNode.children[at + 1];
    if (after && after.__el && after.__el.parentElement === parentNode.__contentEl) {
      parentNode.__contentEl.insertBefore(node.__el, after.__el);
    } else {
      parentNode.__contentEl.append(node.__el);
    }

    for (const [n, c] of map) {
      this.controlsByNode.set(n, c);
      if (n.id) this.controls[n.id] = c;
    }
    this.pending.delete(node);
    // The subtree now has a parent: anything that depends on it (a radio's group scope) settles.
    walk(node, (n) => {
      const def = widget(n.type);
      if (def.refresh && n.__el) def.refresh(n.__el, n, this.host);
    });
    this.update(parentNode); // the parent's refresh (tab headers) plus a relayout
    return map.get(node);
  }

  detach(node) {
    const parentNode = node.__parent;
    if (!parentNode) throw new Error(`"${node.id || node.type}" is not on the form.`);
    const map = new Map();
    walk(node, (n) => {
      const control = this.controlsByNode.get(n);
      if (control) {
        map.set(n, control);
        this.controlsByNode.delete(n);
      }
      if (n.id) {
        delete this.controls[n.id];
        // Runtime .on() subscriptions die with the control.
        for (const key of [...this.dynamic.keys()]) {
          if (key.startsWith(`${n.id}::`)) this.dynamic.delete(key);
        }
      }
    });
    node.__el?.remove();
    const at = parentNode.children.indexOf(node);
    if (at >= 0) parentNode.children.splice(at, 1);
    delete node.__parent;
    // Back to detached: the control can be configured and added again.
    this.pending.set(node, map);
    this.update(parentNode);
  }

  // A form to show inside this one (a Frame's): named, checked, fetched and built now, mounted by
  // the caller once it has made room - so a form that fails to load leaves the frame as it was.
  // The child gets this form as its parent at mount; neither this form nor any form it sits in
  // can be embedded again. `slot` is the Frame as the child's window. The shape is what a
  // FormStack's prepare() returns: { layout, instance, mount }.
  async embed(name, args, slot) {
    const qualified = qualify(name, this.module);
    for (let owner = this; owner; owner = owner.parentInstance) {
      if (owner.qualifiedName === qualified) throw new Error(`A form cannot contain itself ("${qualified}").`);
    }
    const { layout, code } = await loadForm(qualified);
    if (this.disposed) throw new Error('The form is closed.');
    const child = new FormInstance({ name: qualified, layout, code, args, app: this.app, mode: this.mode, slot });
    return {
      layout,
      instance: child,
      mount: async (hostEl) => {
        child.parentInstance = this;
        this.embedded.add(child);
        child.closed.then(() => this.embedded.delete(child));
        try {
          await child.mount(hostEl);
        } catch (err) {
          // Nothing else holds it: take it down, or its key listener would outlive the failure.
          this.embedded.delete(child);
          child.dispose();
          throw err;
        }
        return child;
      }
    };
  }

  // A subtree a widget builds for its own use - a Repeater's items, one per row. Its controls
  // answer to events (their ids are the template's, so btnDel_OnClick serves every item and
  // `sender` is the item's control) but claim no id: `form.all.btnDel` stays the template's own.
  buildInner(node) {
    const built = buildTree(node, this.host);
    for (const [n, c] of built.controls) this.controlsByNode.set(n, c);
    return built;
  }

  discardInner(node) {
    disposeTree(node);
    walk(node, (n) => this.controlsByNode.delete(n));
    node.__el?.remove();
  }

  addHandler(node, event, fn) {
    const key = `${node.id}::${event}`;
    if (!this.dynamic.has(key)) this.dynamic.set(key, []);
    this.dynamic.get(key).push(fn);
  }

  // A handler is either wired explicitly in the layout or found by the naming convention
  // the designer generates, e.g. btnOk_OnClick.
  resolveHandler(node, event) {
    const suffix = `_${event.charAt(0).toUpperCase()}${event.slice(1)}`;
    const candidates = [];
    const declared = node.events && node.events[event];
    if (declared) candidates.push(declared);
    // The form itself answers to Form_OnLoad as well as to <FormName>_OnLoad.
    if (node === this.layout) candidates.push(`Form${suffix}`, `${this.name}${suffix}`);
    if (node.id) candidates.push(`${node.id}${suffix}`);
    for (const name of candidates) {
      if (typeof this.exports[name] === 'function') return this.exports[name];
    }
    return null;
  }

  async emit(node, event, payload) {
    if (this.disposed) return undefined;
    const sender = this.controlsByNode.get(node) || null;
    const extra = this.dynamic.get(`${node.id}::${event}`) || [];
    let result;
    try {
      const fn = this.resolveHandler(node, event);
      if (fn) result = await fn(sender, payload);
      for (const handler of extra) await handler(sender, payload);
    } catch (err) {
      // A handler that went on after an await once the form was gone - its window moved on
      // beneath the modal it was waiting for, a server answer came late - fails on controls
      // that no longer exist. That is noise, not the app's error: the console keeps it, the
      // error bar does not. form.isOpen lets a handler stop before that.
      if (this.disposed) console.warn(`[${this.name}] ${node.id || this.name}.${event} continued after the form closed:`, err);
      else this.reportError(err, `${node.id || this.name}.${event}`);
    }
    return result;
  }

  reportError(err, where) {
    console.error(`[${this.name}] ${where} failed:`, err);
    if (this.app && this.app.onError) this.app.onError(err, where, this);
  }

  update(node) {
    const def = widget(node.type);
    if (def.refresh && node.__el) def.refresh(node.__el, node, this.host);
    this.relayout();
  }

  relayout() {
    if (!this.element) return;
    relayout(this.layout);
    this.fitToContent();
  }

  // With scroll: auto the form is at least as large as its content, so a control that grows -
  // a content-mode Frame or Repeater, an unfolded Group Box - pushes the page's scroll range
  // out and the page shrinks back when it shrinks. Only controls placed from the top or the
  // left count: those anchored to the bottom or the right, or docked, follow the form's size
  // and cannot push it, which keeps the measure settled in one pass.
  fitToContent() {
    const props = { ...defaultPropsOf('form'), ...(this.layout.props || {}) };
    if (props.scroll !== 'auto') return;
    let right = Number(this.layout.width) || 0;
    let bottom = Number(this.layout.height) || 0;
    for (const child of this.layout.children || []) {
      const el = child.__el;
      if (!el || (child.dock || 'none') !== 'none' || child.props?.visible === false) continue;
      const anchor = new Set(Array.isArray(child.anchor) ? child.anchor : ['left', 'top']);
      if (anchor.has('left') && !anchor.has('right')) right = Math.max(right, el.offsetLeft + el.offsetWidth);
      if (anchor.has('top') && !anchor.has('bottom')) bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
    }
    this.element.style.minWidth = `${right}px`;
    this.element.style.minHeight = `${bottom}px`;
  }

  // The stack of the container this form lives in - its window's, the main area's, its Frame's -
  // or null for a slot that has none.
  stackOf() {
    const ctx = this.slot || this.app;
    return ctx && ctx.stack ? ctx.stack : null;
  }

  hiddenError() {
    return new Error('The form is hidden behind the form it opened; wait for form.open() to resolve.');
  }

  // form.open(): another form over this one, in this same container (the shell's host, a modal,
  // a drawer, a popup, a Frame); this one stays alive, hidden, and comes back exactly as it was
  // when the other calls form.close(). Resolves with what that close() hands over, undefined when
  // the stack is taken down under it. Only the form shown may call it, and only once it has
  // loaded (Form_OnLoad finished); the name is this module's unless qualified.
  async open(name, args) {
    // A form on its way out (its Form_OnClose running) opens nothing: the child would sit over a
    // form that is about to be disposed.
    if (this.disposed || this.leaving) throw new Error('The form is closed.');
    if (this.suspended) throw this.hiddenError();
    if (!this.ready) throw new Error('form.open() is not available while the form is loading; call it from Form_OnShow or a handler.');
    const stack = this.stackOf();
    if (!stack) throw new Error('form.open() is not available here.');
    return stack.open(this, qualify(name, this.module), args);
  }

  // form.open() hides this form behind the child it opened: the element goes display: none, the
  // keyboard leaves it (an Autocomplete's list hangs on the body and closes on blur, so it does
  // not float over the child), and the scroll offsets - the container's, which the child will
  // move, and those inside the form, which browsers drop for a display: none subtree - are kept
  // for restoreScroll(). Timers, data loads and handlers go on as they were.
  suspend(scroller) {
    this.suspended = true;
    const el = this.element;
    if (el && el.contains(document.activeElement)) document.activeElement.blur();
    const offsets = [];
    if (scroller && (scroller.scrollTop || scroller.scrollLeft)) offsets.push([scroller, scroller.scrollTop, scroller.scrollLeft]);
    if (el) {
      for (const node of el.querySelectorAll('*')) {
        if (node.scrollTop || node.scrollLeft) offsets.push([node, node.scrollTop, node.scrollLeft]);
      }
    }
    this.scrollState = offsets;
    // While everything is still measurable, the widgets keep what their libraries would lose.
    this.notifyWidgets('hidden');
    el?.classList.add('gd-form-suspended');
  }

  // The child is gone: shown again and laid out at whatever size the container has now (an
  // onResize only if that changed), and given its onShow if it never had one (hidden within the
  // frame after its mount, before the first paint). No onLoad: the form never went away.
  resume() {
    this.suspended = false;
    this.element?.classList.remove('gd-form-suspended');
    this.relayout();
    this.notifyWidgets('shown');
    this.noteResize();
    if (!this.shown && !this.showFrame) this.scheduleShow();
  }

  // The widgets of this form, and of the forms its Frames show, told it goes out of sight or
  // comes back (see notifyTree in builder.js).
  notifyWidgets(hook) {
    if (this.layout && this.layout.__el) notifyTree(this.layout, hook);
    for (const child of this.embedded) child.notifyWidgets(hook);
  }

  // The offsets suspend() kept, put back once the container is sized for this form again.
  restoreScroll() {
    for (const [node, top, left] of this.scrollState || []) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
    this.scrollState = null;
  }

  // form.navigate(): another form takes this one's place wherever it lives - the shell's host, a
  // modal, a popup or a Frame - along with any form hidden beneath it. The name is this module's
  // unless qualified. Resolves false when a Form_OnClosing refused to let go.
  async navigate(name, args) {
    if (this.disposed) throw new Error('The form is closed.');
    if (this.suspended) throw this.hiddenError();
    const qualified = qualify(name, this.module);
    const outcome = this.slot ? await this.slot.show(qualified, args) : await this.app.navigate(qualified, args);
    return outcome !== false;
  }

  // form.close(result): this form is done, back to whoever is waiting for it. Opened with
  // form.open(), it closes and the one beneath comes back as it was, its open() resolving with
  // `result`; any other form - the main form, a window's first form, a form in a Frame - does
  // what form.closeAll(result) does. The decision is made once, here: a close() that started
  // as a pop never ends a window, whatever happens while Form_OnClosing is asked. Resolves true
  // once the form beneath is back, false when refused or when the container moved on meanwhile.
  async close(result) {
    if (this.disposed) throw new Error('The form is closed.');
    if (this.suspended) throw this.hiddenError();
    const stack = this.stackOf();
    const entry = stack ? stack.entries[stack.entries.length - 1] : null;
    if (!entry || stack.current !== this) return this.closeAll(result);
    if (this.leaving) return false;
    const at = stack.epoch;
    if (!(await this.canLeave({ result, navigated: false }))) return false;
    // Asked across an await: a navigation, a dismissal or another close()/closeAll() may have moved
    // the container meanwhile - whoever moved it owns it.
    if (this.disposed || this.leaving || stack.epoch !== at || stack.current !== this || stack.entries[stack.entries.length - 1] !== entry) return false;
    this.leaving = true;
    let el;
    try {
      await this.emit(this.layout, 'onClose', { result, navigated: false });
    } finally {
      this.resolveClosed(result);
      el = this.element;
      this.dispose();
    }
    // False when a navigation took the stack while onClose ran: nothing is restored, the
    // navigation owns the container and has settled the open() beneath.
    return stack.pop(this, result, el);
  }

  // Before this form is left in any way - closed, navigated away from, its window dismissed -
  // its code behind may say no: Form_OnClosing gets { result, navigated, cancel } and sets
  // cancel. The forms embedded in it are asked first, since they go with it. A form already on
  // its way out agrees.
  async canLeave({ result, navigated }) {
    if (this.disposed || this.leaving) return true;
    for (const child of this.embedded) {
      if (!(await child.canLeave({ result: undefined, navigated: true }))) return false;
    }
    const e = { result, navigated: Boolean(navigated), cancel: false };
    await this.emit(this.layout, 'onClosing', e);
    return e.cancel !== true;
  }

  // form.closeAll(result): this form's container ends. A modal, drawer or popup resolves the call
  // that opened it with `result`; a Frame empties; the main form gives way to the start form.
  // Any form hidden beneath this one (form.open()) goes with it - asked first unless `force` (a
  // dialog dismissed by a navigation that already asked everyone), its open() resolving
  // undefined; `navigated` marks that dismissal in the forms' onClose. Resolves true once
  // closed, false when refused or when the form is already on its way out.
  async closeAll(result, { force = false, navigated = false } = {}) {
    if (this.disposed || this.leaving) return false;
    if (this.suspended) throw this.hiddenError();
    const stack = this.stackOf();
    const at = stack ? stack.epoch : 0;
    if (!force && !(await this.canLeave({ result, navigated }))) return false;
    if (this.disposed || this.leaving) return false;
    if (stack && stack.entries.length) {
      if (!force && !(await stack.canLeaveHidden())) return false;
      // Asked across an await: this form may have opened a child meanwhile (it is hidden now,
      // and not its container's to take down), or a navigation took the stack.
      if (this.disposed || this.leaving || stack.current !== this || stack.epoch !== at) return false;
      await stack.leaveAll();
      if (this.disposed || this.leaving) return false;
    }
    this.leaving = true;
    try {
      await this.emit(this.layout, 'onClose', { result, navigated: Boolean(navigated) });
    } finally {
      this.resolveClosed(result);
      this.dispose();
    }
    // Still the form its container shows? A navigation inside the window while onClose ran owns
    // the window now, and a closeAll() overtaken that way must not end it.
    if (this.slot) {
      if (this.slot.current === this) this.slot.finish(result);
    } else if (this.app && this.app.current === this) {
      await this.app.goHome(this, result);
    }
    return true;
  }

  // The app is moving on to another form: the code behind gets its onClose (with `navigated`
  // set) so anything it started - a timer, a subscription - can be taken down. A form already
  // on its way out (its close() or closeAll() running) is left to finish on its own.
  async leave() {
    if (this.disposed || this.leaving) return;
    this.leaving = true;
    try {
      await this.emit(this.layout, 'onClose', { result: undefined, navigated: true });
    } catch (err) {
      this.app?.reportError?.(err, `form ${this.name} onClose`);
    }
    this.resolveClosed(undefined);
    this.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // A form taken down without close(), closeAll() or leave() - its window torn down, an open() overtaken,
    // its host disposed - still settles for whoever waits on it.
    this.resolveClosed(undefined);
    for (const child of this.embedded) child.dispose();
    this.embedded.clear();
    this.observer?.disconnect();
    if (this.showFrame) cancelAnimationFrame(this.showFrame);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    if (this.onDocumentKey) document.removeEventListener('keydown', this.onDocumentKey);
    disposeTree(this.layout);
    // A window that animates its exit (a drawer) keeps the dead form's pixels on screen until
    // the window itself goes, and removes them with it; every other window removes them here.
    if (!this.slot?.keepsElement) this.element?.remove();
    walk(this.layout, (node) => {
      delete node.__el;
      delete node.__contentEl;
      delete node.__parent;
    });
  }
}
