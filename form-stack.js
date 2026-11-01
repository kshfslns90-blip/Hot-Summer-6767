// form.open(): a stack of forms in one container. The container shows one form; open() hides
// that form behind another, close() takes the other down and brings the hidden one back exactly
// as it was. One stack per container - the main area, a modal, a drawer, a popup, a Frame - over
// a small context the container provides:
//   where      a word for error messages ('modal', 'form', 'frame')
//   container  the element forms mount in; scroller the element that scrolls them (the window's
//              body, the app's host, the frame's body - the container itself when it is the same)
//   current    the form shown (get and set)
//   loading    the container's navigation counter, read only: a navigation bumps it, and an
//              open() that fetched across one gives up
//   prepare    (name, args) -> { layout, instance, mount(container) }: the form fetched and built
//              but not mounted (a Frame's goes through its host's embed())
//   fit        (layout, name, args) sizes and titles the container for a form, or null
//   settle     (fresh) places the keyboard once a form is up, or null; `fresh` says whether the
//              form just came up (open) or came back (close)
//   report     (err, where) where errors go
// Everything that changes `entries` or `current` is synchronous; what is awaited - a fetch, a
// mount, a form's own events - is followed by a re-check, so an operation the container moved
// on from gives up without touching it. The navigations that replace a container take() the
// entries at their point of no return, before they wait for the old form to leave, so nothing
// that lands meanwhile finds a parent to restore.

// Whatever had the keyboard when a window or a child form opened gets it back when it closes -
// without scrolling it into view, so a container brought back as it was keeps its offset.
export function restoreFocus(opener) {
  if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
}

export class FormStack {
  constructor(ctx) {
    this.ctx = ctx;
    // The hidden forms, bottom first, each with the promise its form.open() waits on and the
    // element that had the keyboard when it opened its child. ctx.current is the top.
    this.entries = [];
    // Bumped on every push, pop and take.
    this.epoch = 0;
  }

  get current() {
    return this.ctx.current;
  }

  // The live forms in the container, bottom first.
  forms() {
    const list = this.entries.map((entry) => entry.form);
    if (this.ctx.current) list.push(this.ctx.current);
    return list.filter((form) => !form.disposed);
  }

  // Detaches every entry, synchronously: the container is being replaced or is going, and
  // nothing that arrives later must find a parent to restore. Returns them, top first.
  take() {
    const taken = this.entries.splice(0).reverse();
    if (taken.length) this.epoch += 1;
    return taken;
  }

  // form.open(): `caller`, the form shown, goes behind `name`. Resolves with what the child hands
  // to form.close(result), or undefined when the stack is taken down under it. Rejects when the
  // child cannot be fetched or built - the caller is back on screen then, as if nothing happened.
  async open(caller, name, args) {
    const ctx = this.ctx;
    if (caller.disposed || caller.leaving || ctx.current !== caller) throw new Error('The form is closed.');
    if (caller.suspended) throw new Error('The form is hidden behind the form it opened; wait for form.open() to resolve.');
    const under = caller;
    const seen = ctx.loading;
    const at = this.epoch;
    const prepared = await ctx.prepare(name, args);
    // Overtaken while fetching: a navigation replaced the container, or the stack moved (another
    // open() got there first, or its child closed again). The instance never mounted and holds
    // nothing; it is marked disposed so a reference kept by the caller is dead too.
    if (ctx.loading !== seen || this.epoch !== at || ctx.current !== under || under.disposed) {
      prepared.instance.dispose();
      return undefined;
    }
    const child = prepared.instance;
    const entry = { form: under, resolve: null, opener: document.activeElement };
    const result = new Promise((resolve) => {
      entry.resolve = resolve;
    });
    try {
      this.entries.push(entry);
      this.epoch += 1;
      under.suspend(ctx.scroller);
      ctx.current = child;
      ctx.fit?.(prepared.layout, name, args);
      await prepared.mount(ctx.container);
    } catch (err) {
      // Nothing of the child stays. The parent comes back as it was - unless the container was
      // torn down or moved on meanwhile, in which case it is not ours to touch (a modal's fit()
      // would re-append its overlay, settle() would bind Escape again).
      const alive = ctx.loading === seen && ctx.current === child && !child.disposed;
      const el = child.element;
      child.dispose();
      el?.remove();
      if (alive && !under.disposed && this.entries[this.entries.length - 1] === entry) {
        this.entries.pop();
        this.epoch += 1;
        ctx.current = under;
        under.resume();
        ctx.fit?.(under.layout, under.qualifiedName, under.args);
        under.restoreScroll();
      }
      ctx.report(err, `${ctx.where} ${name}`);
      throw err;
    }
    // Still the form shown (its onLoad did not move on, the window was not torn down): placed.
    if (ctx.loading === seen && ctx.current === child && !child.disposed) ctx.settle?.(true);
    return result;
  }

  // form.close(): `form`, the top, has closed (and is disposed; `element` is what it left behind,
  // which a drawer's keepsElement would otherwise keep). The form beneath comes back: shown,
  // laid out, sized for, scrolled and focused as it was, and only then is its open() answered,
  // so the code waiting on it finds itself on screen. False when there is nothing beneath or
  // the container moved on while `form` was closing - whoever moved it owns it.
  pop(form, result, element) {
    const ctx = this.ctx;
    if (ctx.current !== form || !this.entries.length) return false;
    const entry = this.entries.pop();
    this.epoch += 1;
    element?.remove();
    ctx.current = entry.form;
    entry.form.resume();
    ctx.fit?.(entry.form.layout, entry.form.qualifiedName, entry.form.args);
    entry.form.restoreScroll();
    ctx.settle?.(false);
    restoreFocus(entry.opener);
    entry.resolve(result);
    return true;
  }

  // Before the container is replaced: every live form, top first, may refuse (Form_OnClosing).
  async canLeaveAll() {
    for (const form of this.forms().reverse()) {
      if (!(await form.canLeave({ result: undefined, navigated: true }))) return false;
    }
    return true;
  }

  // Before the top closes the container: the hidden forms, top first, may refuse.
  async canLeaveHidden() {
    for (const entry of [...this.entries].reverse()) {
      if (!(await entry.form.canLeave({ result: undefined, navigated: true }))) return false;
    }
    return true;
  }

  // The hidden forms go: each gets its Form_OnClose (navigated) and is disposed, top first, and
  // each open() waiting on one resolves undefined. The form shown is its caller's business.
  async leaveAll() {
    await FormStack.leave(this.take());
  }

  // The same on entries a navigation took at its point of no return.
  static async leave(taken) {
    for (const entry of taken) {
      await entry.form.leave();
      entry.resolve(undefined);
    }
  }

  // The container is going (a window torn down, a Frame disposed): whatever is still hidden is
  // disposed without ceremony and every open() waiting on it resolves undefined.
  end() {
    for (const entry of this.take()) {
      if (!entry.form.disposed) entry.form.dispose();
      entry.resolve(undefined);
    }
  }
}
