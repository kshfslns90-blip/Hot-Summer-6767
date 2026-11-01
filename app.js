// The application shell the running forms live in: navigation, modals and the bridge to the
// server scripts. The main form's history is the browser's - one entry per screen - so the Back
// button and a reload agree; nothing steps it from code. Every container (the main area, a
// modal, a drawer, a popup) also holds a stack of forms for form.open() / form.close(): the form
// shown may open another over itself and get it back as it was.
import { FormInstance } from './form-runtime.js';
import { FormStack, restoreFocus } from './form-stack.js';
import { apiBase, reportUnauthorized, loadForm } from './endpoints.js';
import { qualify } from './modules.js';
import { argHoles } from './data-source.js';
import { windowBoxWidth } from './layout.js';

export { loadForm };

// The page's URL for a form - /app/Module.Form, /run/Module.Form - with the arguments as JSON
// in the query when there are any.
export function formUrl(base, name, args) {
  const search = args === undefined || args === null ? '' : `?args=${encodeURIComponent(JSON.stringify(args))}`;
  return `${base}/${encodeURIComponent(name)}${search}`;
}

// `target` is complete here - "Module.script.fn" - a form fills its module in before calling.
// An argument left undefined (so the function's own default applies) has no JSON form; its
// position travels in `holes` and the server puts the undefined back before the call.
export async function callServer(target, args) {
  const holes = argHoles(args);
  const response = await fetch(`${apiBase()}/exec/${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args: args === undefined ? [] : args, ...(holes.length ? { holes } : {}) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) reportUnauthorized(data);
    const error = new Error(data.error?.message || `server.callFunction('${target}') failed.`);
    error.serverStack = data.error?.stack;
    error.target = target;
    throw error;
  }
  return data.result;
}

// The elements the keyboard can land on inside a modal, in document order: enabled, shown.
function focusablesIn(root) {
  return [...root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (element) => !element.disabled && element.offsetParent !== null
  );
}

// A layer over the page stops the mouse, not the keys: Tab stays inside the frame, wrapping at
// the ends. From the frame itself (where the keyboard lands on opening) Tab goes to the form's
// first control, Shift+Tab to the last one.
function trapFocus(layerEl, frameEl, pageEl) {
  layerEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = focusablesIn(frameEl);
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    if (document.activeElement === frameEl) {
      e.preventDefault();
      (e.shiftKey ? last : focusablesIn(pageEl)[0] || first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

// Where a modal or popup mounts its form: a page inside a body that scrolls when the window
// caps the frame, rather than clipping the form. The page takes each form's designed height
// as the form is shown.
function formPage(prefix) {
  const body = document.createElement('div');
  body.className = `${prefix}-body`;
  const page = document.createElement('div');
  page.className = `${prefix}-page`;
  body.append(page);
  return { body, page };
}

// The window's box is the form's designed width plus the box's own border and whatever the
// body's vertical scrollbar takes, so the page never narrows under the form (a `scroll: auto`
// form keeps its designed width as a minimum and would overflow sideways otherwise). Measured
// from the live elements: the box's border as offsetWidth - clientWidth, the scrollbar the same
// way on the body. True when the width changed; false when it was already right - or when a
// CSS max-width holds the box narrower, since the requested width is compared, not the rendered.
function fitWindowWidth(box, body, designed) {
  const width = windowBoxWidth({ designed, border: box.offsetWidth - box.clientWidth, gutter: body.offsetWidth - body.clientWidth, current: parseInt(box.style.width, 10) || null });
  if (width === null) return false;
  box.style.width = `${width}px`;
  return true;
}

// A form fetched and built for a window or the main area, not yet mounted: what a stack needs in
// hand before it changes anything. The instance is inert until mount() - no DOM, no observers -
// so one that is never mounted is disposed and forgotten at no cost.
async function prepareForm(app, slot, name, args) {
  const { layout, code } = await loadForm(name);
  const instance = new FormInstance({ name, layout, code, args, app, slot });
  return { layout, instance, mount: (hostEl) => instance.mount(hostEl) };
}

// Runs a window to its end: the first form shown, the result awaited, the window taken down
// and the keyboard given back. A window with no form in it (the form failed to load) goes with
// the error; one whose form failed while mounting stays up with that form, until the X or a
// form.closeAll().
async function runWindow(slot, name, args, teardown, opener) {
  try {
    await slot.show(name, args);
  } catch (err) {
    if (!slot.current) {
      teardown();
      throw err;
    }
  }
  const result = await slot.done;
  teardown();
  restoreFocus(opener);
  return result;
}

// A drawer's exit: the panel slides out and the layer goes once it has. The slide is the
// panel's own CSS transition, read back as an Animation, so no transitionend listener is
// needed; a slide-in still under way simply reverses from where it is. The wait is bounded, in
// case the timeline stops advancing (the tab hidden mid-slide), and skipped in a hidden tab or
// under reduced motion (no transition, nothing to wait for).
function slideOut(layer, panel) {
  layer.classList.remove('gd-drawer-open');
  // The panel's own transitions only: a toggle or chevron animating inside the dead form is
  // not waited for. The call forces the style update, so the reversed slide is already listed.
  const slides = panel.getAnimations({ subtree: false });
  let timer = null;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    for (const a of slides) a.cancel();
    layer.remove();
  };
  if (document.hidden || !slides.length) {
    finish();
    return;
  }
  timer = setTimeout(finish, 400); // the slide is 200 ms
  Promise.allSettled(slides.map((a) => a.finished)).then(finish);
}

// Escape closes the window on top (a modal, a drawer), as the X would: not when the form took
// the key first (its Form_OnKeyDown called preventDefault before any await - the listener is
// bound after the form mounted, so the form's own goes first), not when the key was typed
// elsewhere (a message box or a modal above: siblings on the body), and not one a message box
// or an autocomplete list has just used (both call preventDefault, the box in the capture
// phase, so it is defaultPrevented by the time this bubbling listener runs, whatever has the
// focus). A key typed with nothing focused counts: a message box that just closed leaves the
// keyboard on the body. bind() goes again each time a form settles in the window, which moves
// the listener behind that form's own; the DOM ignores a second registration of the same
// function, so repeated navigation never stacks listeners.
function escapeCloses(app, layerEl) {
  let slot = null;
  const onKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !slot || app.modals[app.modals.length - 1] !== slot) return;
    const target = e.target;
    if (!(layerEl.contains(target) || target === document.body || target === document.documentElement)) return;
    e.preventDefault();
    e.stopPropagation();
    slot.close(undefined);
  };
  return {
    bind(current) {
      document.removeEventListener('keydown', onKey);
      slot = current;
      document.addEventListener('keydown', onKey);
    },
    unbind() {
      document.removeEventListener('keydown', onKey);
      slot = null;
    }
  };
}

// A window a form lives in - a modal, a drawer, a popup - as form.navigate() / open() / close() /
// closeAll() see it: the form in it can be replaced in place, can open another over itself (the
// window's stack), and the window is done when the form in it closes. fit(layout, name) titles
// and sizes the window before a form mounts; settle() places and focuses it after; `scroller`
// is the window's body, whose offset a hidden form keeps. With keepsElement a disposed form's
// element stays where it is - a window that animates its exit keeps the pixels until it goes
// itself, and removes them with it.
class FormSlot {
  constructor(app, { page, scroller, where, fit, settle, keepsElement = false }) {
    Object.assign(this, { app, page, where, fit, settle, keepsElement });
    this.current = null;
    this.loading = 0;
    this.done = new Promise((resolve) => {
      this.finish = resolve;
    });
    const slot = this;
    this.stack = new FormStack({
      where,
      container: page,
      scroller: scroller || page,
      get current() {
        return slot.current;
      },
      set current(value) {
        slot.current = value;
      },
      get loading() {
        return slot.loading;
      },
      prepare: (name, args) => prepareForm(app, slot, name, args),
      fit,
      settle,
      report: (err, label) => app.reportError(err, label)
    });
  }

  // The first form, or a replacement: every form in the window (the one shown, the ones hidden
  // beneath it) gets onClose with `navigated`. The form is fetched before any of them goes, so a
  // form that fails to load changes nothing. The stack is taken at the point of no return, before
  // the old form is waited for, so a close() landing meanwhile finds no parent to restore.
  async show(name, args) {
    // The forms shown may refuse to be left (Form_OnClosing): nothing changes then.
    if (!(await this.stack.canLeaveAll())) return false;
    const seq = ++this.loading;
    const { layout, code } = await loadForm(name);
    if (seq !== this.loading) return undefined;
    const previous = this.current;
    this.current = null;
    const taken = this.stack.take();
    if (previous) await previous.leave();
    await FormStack.leave(taken);
    // Overtaken while the old form was leaving (its onClose navigated): the newer show mounts.
    if (seq !== this.loading) return undefined;
    this.page.replaceChildren();
    this.fit(layout, name);
    const instance = new FormInstance({ name, layout, code, args, app: this.app, slot: this });
    this.current = instance;
    try {
      await instance.mount(this.page);
    } catch (err) {
      // Failed while mounting: it stays as the window's form, on screen as far as it got, the
      // error reported - as the main form's open does. closeAll() (the X, Escape) or the next
      // show() disposes it, so nothing leaks.
      this.app.reportError(err, `${this.where} ${name}`);
      throw err;
    }
    // Overtaken while mounting (its onLoad navigated): the newer show has left this form
    // already; nothing to place or focus.
    if (seq !== this.loading) return undefined;
    this.settle();
    return instance;
  }

  // X button, Escape, click outside: closes the whole window - the shown form's closeAll() (its
  // Form_OnClosing may refuse; the forms hidden beneath it go with it), or ends a window with no form in it yet
  // (one is on its way; end() takes care of it) - whatever is hidden gets its onClose first.
  async close(result) {
    if (this.current && !this.current.disposed) return this.current.closeAll(result);
    await this.stack.leaveAll();
    this.finish(result);
    return undefined;
  }

  // A navigation of the main form dismisses the window, as the X or Escape would, once every
  // form involved was asked: a modal's opener gets undefined, a popup's null. A form already on
  // its way out (its onClose running) is not closed again: the window ends now, and the form
  // finishes on its own.
  async dismiss() {
    const value = this.where === 'popup' ? null : undefined;
    if (this.current && !this.current.disposed && !this.current.leaving) return this.current.closeAll(value, { force: true, navigated: true });
    await this.stack.leaveAll();
    this.finish(value);
    return undefined;
  }

  // The window is going away (its form closed, or the X hit while a form was on its way):
  // a show still in flight gives up at its next check, and whatever it mounted or hid is disposed.
  end() {
    this.loading += 1;
    this.stack.end();
    if (this.current && !this.current.disposed) this.current.dispose();
  }
}

export class RuntimeApp {
  constructor(hostEl, options = {}) {
    this.host = hostEl;
    this.onError = options.onError;
    // The shell, when there is one, follows navigation to keep its title and menu in step.
    this.onNavigate = options.onNavigate || null;
    // What to show for a popped history entry that is not a form's (a shell page).
    this.onRestore = options.onRestore || null;
    // The preview page: told what closed, and with what, when the main form closes and there
    // is no start form to go to.
    this.onClosed = options.onClosed || null;
    // The page's URL for a form; the history is left alone without one.
    this.urlFor = options.urlFor || null;
    // The start form, `{ name, args }`: where the main form's close() and closeAll() go.
    this.home = options.home || null;
    this.user = options.user || null;
    this.signOut = options.signOut || (async () => {});
    this.current = null;
    // The open modals, drawers and popups, as windows, the top one last.
    this.modals = [];
    this.loading = 0;
    this.entryPending = 0;
    // The depth of the entry shown, to undo a pop the forms refused; `undoing` marks that
    // undo's own popstate; `asking` is the pop the forms are being asked about, gathering any
    // further pops that arrive while they think.
    this.atDepth = 0;
    this.undoing = false;
    this.asking = null;
    this.onPopState = (e) => this.restore(e.state);
    window.addEventListener('popstate', this.onPopState);
    // The main area's stack for form.open(): the host is both container and scroller; the
    // shell's title and menu follow the form shown.
    const app = this;
    this.stack = new FormStack({
      where: 'form',
      container: hostEl,
      scroller: hostEl,
      get current() {
        return app.current;
      },
      set current(value) {
        app.current = value;
      },
      get loading() {
        return app.loading;
      },
      prepare: (name, args) => prepareForm(app, null, name, args),
      fit: (layout, name, args) => {
        document.title = layout.text || name;
        app.onNavigate?.({ name, args, title: layout.text || name });
      },
      settle: null,
      report: (err, label) => app.reportError(err, label)
    });
  }

  callServer(target, args) {
    return callServer(target, args);
  }

  // The `app` a code behind sees: who is signed in, the main form's navigation and a way out.
  // `module` is the calling form's, so app.navigate('Details') opens that module's Details.
  // navigate() moves the main form - the one in the shell - whichever form calls.
  facade(module) {
    const app = this;
    return {
      get user() {
        return app.user;
      },
      navigate: async (name, args) => (await app.navigate(module ? qualify(name, module) : name, args)) !== false,
      signOut: () => app.signOut()
    };
  }

  async start(name, args) {
    return this.open(name, args);
  }

  // navigate replaces the main form; the previous one is a browser history entry, so the Back
  // button comes back to it.
  async navigate(name, args) {
    return this.open(name, args, { push: true });
  }

  // --- the main form's stack: the browser's history ------------------------------------------

  // One browser entry per screen of the app: its state names what to show and how deep in the
  // app it is, so the Back button knows whether the entry before is the app's. Showing the URL already
  // shown replaces the entry rather than adding one. `depth` given (0 for the start form after
  // a close) overrides the count.
  depth() {
    return Number(history.state?.depth) || 0;
  }

  remember(state, url, { push = false, depth } = {}) {
    const same = location.pathname + location.search === url;
    if (push && !same) history.pushState({ ...state, depth: this.depth() + 1 }, '', url);
    else history.replaceState({ ...state, depth: depth ?? this.depth() }, '', url);
    this.atDepth = this.depth();
  }

  // Before the main form moves on - a navigate, a popped entry, a shell page: every open dialog
  // (the top one first, every form in it) and then the main area's forms may refuse
  // (Form_OnClosing), and one refusal stops the move. Otherwise the dialogs are dismissed as the
  // X or Escape would, and the way is clear.
  async prepareLeave() {
    const dialogs = [...this.modals].reverse();
    for (const slot of dialogs) {
      if (!(await slot.stack.canLeaveAll())) return false;
    }
    if (!(await this.stack.canLeaveAll())) return false;
    for (const slot of dialogs) await slot.dismiss();
    return true;
  }

  // The main form changes to `name`. Later wins: an open that another one overtook while it was
  // fetching, leaving or mounting disposes what it built and resolves undefined - the browser
  // shows the newer entry, so must the app. The history entry goes in right after the fetch,
  // before any code behind runs (the old form's onClose, the new one's onLoad). An open overtaken
  // after writing its entry and before finishing its mount never really showed: the open that
  // overtakes it replaces that entry instead of pushing, so a form whose onLoad goes elsewhere
  // leaves no entry for Back to bounce through. The main area's stack is taken at the point of no
  // return, before the old form is waited for, so a close() landing meanwhile finds no parent.
  open(name, args, { push = false, depth, record = true } = {}) {
    const seq = ++this.loading;
    return (async () => {
      try {
        // The forms have their say first (a popped entry was asked in restore() already).
        if (record && !(await this.prepareLeave())) return false;
        if (seq !== this.loading) return undefined;
        const { layout, code } = await loadForm(name);
        if (seq !== this.loading) return undefined;
        if (record && this.urlFor) {
          this.remember({ name, args }, this.urlFor(name, args), { push: push && !this.entryPending, depth });
          this.entryPending = seq;
        } else if (!record) {
          this.entryPending = 0; // the browser moved: whatever was pending is forward history now
        }
        document.title = layout.text || name;
        this.onNavigate?.({ name, args, title: layout.text || name });
        const previous = this.current;
        const taken = this.stack.take();
        if (previous) await previous.leave();
        await FormStack.leave(taken);
        if (seq !== this.loading) return undefined;
        const instance = new FormInstance({ name, layout, code, args, app: this });
        this.current = instance;
        this.host.replaceChildren();
        try {
          await instance.mount(this.host);
        } finally {
          // Mounted, or failed while mounting and left on screen with the error: the entry stands.
          if (this.entryPending === seq && seq === this.loading) this.entryPending = 0;
        }
        if (seq !== this.loading) {
          // Overtaken while mounting (its own onLoad navigated, say): the newer open owns the host.
          instance.dispose();
          return undefined;
        }
        return instance;
      } catch (err) {
        this.reportError(err, `form ${name}`);
        throw err;
      }
    })();
  }

  // The browser moved to another entry of the app (Back or Forward): show it. A form entry opens
  // here without a new entry; anything else - a system page, an entry with no state - is the
  // page's to restore.
  async restore(state) {
    // The popstate of an undo (below): the app never moved, nothing to show.
    if (this.undoing) {
      this.undoing = false;
      return;
    }
    // A pop while the forms are still being asked about an earlier one (the question may be a
    // confirm box the user has not answered): the browser has moved again, and the one answer
    // will cover the whole distance. Only the latest entry matters.
    if (this.asking) {
      this.asking.state = state;
      return;
    }
    // The browser has moved already; the forms are asked now, and a refusal moves it back to
    // the entry the app is still showing.
    const asking = { state };
    this.asking = asking;
    let allowed;
    try {
      allowed = await this.prepareLeave();
    } finally {
      this.asking = null;
    }
    const final = asking.state;
    const target = Number(final?.depth) || 0;
    if (!allowed) {
      const delta = this.atDepth - target;
      if (delta) {
        this.undoing = true;
        history.go(delta);
      }
      return;
    }
    try {
      if (final?.name) await this.open(final.name, final.args, { record: false });
      else await this.onRestore?.(final);
    } catch {
      // open() reported it; the entry is shown as far as it could be.
    } finally {
      this.atDepth = target;
    }
  }

  // form.close(result) or form.closeAll(result) on the main form: that screen is done. With a start form the app starts
  // over there, the entry replaced at depth 0 so Back has nowhere to go. Without one (the
  // preview page) the host is emptied, the entry reset to depth 0, and the page told what closed
  // and with what, so it can show a receipt. `closed` is the form that called it, already
  // disposed: the name and arguments come from it, never from `current` after an await. If the
  // app moved on to another form meanwhile, the closed form's window is already gone and nothing
  // more is done.
  async goHome(closed, result) {
    if (this.current !== closed) return false;
    if (!this.home) {
      this.current = null;
      this.host.replaceChildren();
      if (this.urlFor) this.remember({ name: closed.qualifiedName, args: closed.args }, this.urlFor(closed.qualifiedName, closed.args), { depth: 0 });
      this.onClosed?.({ name: closed.qualifiedName, args: closed.args, result });
      return false;
    }
    await this.open(this.home.name, this.home.args, { depth: 0 });
    return true;
  }

  // --- modals and popups --------------------------------------------------------------------

  // A form in a modal window: the X closes it with undefined, and so does Escape unless
  // options.dismissible is false or the form handles the key itself.
  async showModal(name, args, options = {}) {
    // Whatever had the keyboard (the button that opened the modal, say) gets it back on close.
    const opener = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'gd-modal-overlay';
    const frame = document.createElement('div');
    frame.className = 'gd-modal-frame';
    frame.tabIndex = -1;

    const bar = document.createElement('div');
    bar.className = 'gd-modal-title';
    // The title is a text node of its own: a swap changes it without touching the X button.
    const title = document.createTextNode('');
    const closeButton = document.createElement('button');
    closeButton.className = 'gd-modal-close';
    closeButton.type = 'button';
    closeButton.textContent = 'x';
    bar.append(title, closeButton);

    // The form mounts on a page of its designed height; the frame is that plus the title bar.
    const { body, page } = formPage('gd-modal');
    trapFocus(overlay, frame, page);
    frame.append(bar, body);
    overlay.append(frame);

    // The frame's width follows the form and the body's scrollbar (fitWindowWidth): measured
    // when a form is fitted, and again whenever the body's box changes - the scrollbar coming
    // or going as the content grows or shrinks, the window resized under the height cap.
    let designed = 0;
    const widthWatch = new ResizeObserver(() => {
      if (designed) fitWindowWidth(frame, body, designed);
    });
    widthWatch.observe(body);

    const dismissible = !(options && options.dismissible === false);
    const escape = dismissible ? escapeCloses(this, overlay) : null;
    const slot = new FormSlot(this, {
      page,
      scroller: body,
      where: 'modal',
      // The window follows the form in it: title, width, page height, frame height. It goes on
      // the page only once the first form is in hand, so a slow fetch shows no empty window.
      fit: (layout, formName) => {
        if (!overlay.isConnected) document.body.append(overlay);
        title.data = layout.text || formName;
        designed = Number(layout.width) || 480;
        const height = Number(layout.height) || 320;
        page.style.height = `${height}px`;
        frame.style.height = `${height + bar.offsetHeight}px`;
        fitWindowWidth(frame, body, designed);
      },
      // The keyboard moves into the modal, unless the form's onLoad already placed it there: on
      // the frame itself, so the Space or Enter that opened it presses nothing else and the
      // first Tab lands on the form's first control. Escape is bound here, after the form.
      settle: () => {
        escape?.bind(slot);
        if (!frame.contains(document.activeElement)) frame.focus();
      }
    });
    this.modals.push(slot);
    closeButton.addEventListener('click', () => slot.close(undefined));
    const teardown = () => {
      slot.end();
      widthWatch.disconnect();
      escape?.unbind();
      overlay.remove();
      this.modals = this.modals.filter((s) => s !== slot);
    };

    return runWindow(slot, name, args, teardown, opener);
  }

  // A form as a floating popup: under `anchor` (a control or an element), or above it when the
  // room below runs out, always inside the window; centred over the current form without an
  // anchor. A click outside or Escape closes it with null; form.close(value) inside resolves
  // with value, and form.navigate() inside replaces the form in the same popup. Nothing in the
  // shell moves.
  async showPopup(name, args, anchor) {
    const opener = document.activeElement;

    const layer = document.createElement('div');
    layer.className = 'gd-popup-layer';
    const popup = document.createElement('div');
    popup.className = 'gd-popup';
    popup.tabIndex = -1;
    const { body, page } = formPage('gd-popup');
    trapFocus(layer, popup, page);
    popup.append(body);
    layer.append(popup);

    const anchorEl = anchor && typeof anchor === 'object' ? (anchor.element instanceof Element ? anchor.element : anchor instanceof Element ? anchor : null) : null;
    const place = () => {
      const margin = 8;
      const gap = 4;
      const width = popup.offsetWidth;
      const height = popup.offsetHeight;
      const maxLeft = Math.max(margin, window.innerWidth - width - margin);
      const maxTop = Math.max(margin, window.innerHeight - height - margin);
      let left;
      let top;
      if (anchorEl && anchorEl.isConnected) {
        const rect = anchorEl.getBoundingClientRect();
        left = rect.left;
        top = rect.bottom + gap;
        const below = window.innerHeight - margin - top;
        const above = rect.top - gap - margin;
        if (height > below && above > below) top = rect.top - gap - height;
      } else {
        const rect = (this.host || document.body).getBoundingClientRect();
        left = rect.left + (rect.width - width) / 2;
        top = rect.top + (rect.height - height) / 2;
      }
      popup.style.left = `${Math.round(Math.min(maxLeft, Math.max(margin, left)))}px`;
      popup.style.top = `${Math.round(Math.min(maxTop, Math.max(margin, top)))}px`;
    };

    // The box's width follows the form and the body's scrollbar (fitWindowWidth), measured when
    // a form is fitted and whenever the body's box changes; a box that got wider is placed
    // again, so it stays inside the window.
    let designed = 0;
    const widthWatch = new ResizeObserver(() => {
      if (designed && fitWindowWidth(popup, body, designed)) place();
    });
    widthWatch.observe(body);

    const slot = new FormSlot(this, {
      page,
      scroller: body,
      where: 'popup',
      // The box is the form's size plus its own border (and the scrollbar's gutter when the form
      // is taller than the capped box), so the page keeps the form's designed width; a
      // replacement resizes the box and hangs it from the same anchor. The layer goes on the
      // page only once the first form is in hand, so a slow fetch shows no empty box.
      fit: (layout) => {
        if (!layer.isConnected) document.body.append(layer);
        designed = Number(layout.width) || 320;
        const height = Number(layout.height) || 200;
        page.style.height = `${height}px`;
        popup.style.height = `${height}px`;
        popup.style.height = `${height + popup.offsetHeight - popup.clientHeight}px`;
        fitWindowWidth(popup, body, designed);
        place();
      },
      settle: () => {
        place();
        if (!popup.contains(document.activeElement)) popup.focus();
      }
    });
    this.modals.push(slot);
    const onDown = (e) => {
      if (e.target === layer) slot.close(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && this.modals[this.modals.length - 1] === slot) {
        e.preventDefault();
        e.stopPropagation();
        slot.close(null);
      }
    };
    layer.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    const teardown = () => {
      slot.end();
      widthWatch.disconnect();
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      layer.remove();
      this.modals = this.modals.filter((s) => s !== slot);
    };

    return runWindow(slot, name, args, teardown, opener);
  }

  // A form in a drawer: a panel the height of the window sliding in from the right edge over
  // the app, which is dimmed and blocked behind it. The panel is as wide as the form's design
  // (options.width overrides that), never wider than the window; the form stretches to the
  // panel's height, so anchored and docked controls follow, and a form taller than the window
  // scrolls inside. The X and form.close(value) always close it (with undefined, or value); so
  // do Escape and a click on the backdrop, unless options.dismissible is false (a form that
  // handles Escape itself keeps it open either way). form.navigate() replaces the form in the
  // same panel. The form closes exactly as a modal's does - disposed, its result handed over,
  // the keyboard given back - and only the panel's own exit, the slide, outlives it.
  async showDrawer(name, args, options = {}) {
    const opener = document.activeElement;

    const layer = document.createElement('div');
    layer.className = 'gd-drawer-layer';
    const panel = document.createElement('div');
    panel.className = 'gd-drawer';
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const bar = document.createElement('div');
    bar.className = 'gd-drawer-title';
    const title = document.createTextNode('');
    const closeButton = document.createElement('button');
    closeButton.className = 'gd-drawer-close';
    closeButton.type = 'button';
    closeButton.textContent = 'x';
    closeButton.setAttribute('aria-label', 'Close');
    bar.append(title, closeButton);

    const { body, page } = formPage('gd-drawer');
    trapFocus(layer, panel, page);
    panel.append(bar, body);
    layer.append(panel);

    // The panel's width follows the form and the body's scrollbar, as a modal's frame does.
    let designed = 0;
    const widthWatch = new ResizeObserver(() => {
      if (designed) fitWindowWidth(panel, body, designed);
    });
    widthWatch.observe(body);

    const dismissible = !(options && options.dismissible === false);
    const escape = dismissible ? escapeCloses(this, layer) : null;
    const slot = new FormSlot(this, {
      page,
      scroller: body,
      where: 'drawer',
      keepsElement: true,
      // The panel goes on the page, and slides in, only once the first form is in hand. The
      // page keeps the form's designed height as a minimum and otherwise fills the panel.
      fit: (layout, formName) => {
        const text = layout.text || formName;
        title.data = text;
        panel.setAttribute('aria-label', text);
        // A width that is not a positive number (0, negative, NaN, Infinity) means the design's.
        const wanted = Number(options && options.width);
        designed = Number.isFinite(wanted) && wanted > 0 ? Math.round(wanted) : Number(layout.width) || 480;
        page.style.minHeight = `${Number(layout.height) || 320}px`;
        if (!layer.isConnected) {
          // On the page, sized, laid out once off-screen, and only then set sliding: the slide
          // starts from translateX(100%) of that first layout, so the panel must already have
          // its width there - laid out empty it would start a few pixels off and pop into place.
          document.body.append(layer);
          fitWindowWidth(panel, body, designed);
          void panel.offsetWidth;
          layer.classList.add('gd-drawer-open');
        } else {
          fitWindowWidth(panel, body, designed);
        }
      },
      // Escape is bound here, after the form; then the keyboard moves into the panel.
      settle: () => {
        escape?.bind(slot);
        if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
      }
    });
    this.modals.push(slot);
    closeButton.addEventListener('click', () => slot.close(undefined));
    const onDown = (e) => {
      if (dismissible && e.target === layer) slot.close(undefined);
    };
    layer.addEventListener('mousedown', onDown);
    // The form is gone by now (disposed, its result handed over). Its pixels stay in the panel
    // for the slide, inert - nothing in it can be clicked, typed into, focused or read - and
    // the layer keeps the app covered until the slide ends; a click on it does nothing.
    const teardown = () => {
      slot.end();
      widthWatch.disconnect();
      layer.removeEventListener('mousedown', onDown);
      escape?.unbind();
      this.modals = this.modals.filter((s) => s !== slot);
      panel.inert = true;
      panel.removeAttribute('tabindex');
      slideOut(layer, panel);
    };
    return runWindow(slot, name, args, teardown, opener);
  }

  // Takes the current form down without opening another (the shell's own pages use this), once
  // the dialogs and the forms agreed to go; false when one refused.
  async leaveCurrent() {
    if (!(await this.prepareLeave())) return false;
    const current = this.current;
    this.current = null;
    const taken = this.stack.take();
    if (current) await current.leave();
    await FormStack.leave(taken);
    return true;
  }

  reportError(err, where) {
    console.error(`[runtime] ${where}:`, err);
    if (this.onError) this.onError(err, where);
  }
}
