// The workflow interpreter.
//
// Execution state is a list of tokens rather than a call stack, because a call stack cannot be
// written to disk. Each token knows the node it sits on and carries a stack of the loops and
// joins it is inside. After every node the whole instance is checkpointed, so a crash resumes
// from the last completed step rather than from the beginning.
//
// Concurrency: while an instance is being ticked, the tick's in-memory object is the authority
// and is published in `live`. Signals, cancels and child completions apply themselves to that
// object instead of the file - a write to the file here would be overwritten by the tick's next
// checkpoint - and the tick re-checks for their effects after every save. When no tick is in
// flight they go through a short per-instance lock, so two of them can never interleave a
// read-modify-write on the same checkpoint.
import { nodeDef, hasNode, outputsOf, defaultPropsOf, parseDuration } from '../../public/workflow/nodes.js';
import * as instances from './instances.js';
import * as store from '../store.js';
import { createScope, evaluate } from './expressions.js';

const MAX_STEPS_PER_TICK = 100000;
// setTimeout silently clamps anything above this to 1ms, which would turn a long delay into a
// busy loop; the timer is armed for at most this long and re-armed for the rest when it fires.
const MAX_TIMER_MS = 2 ** 31 - 1;
const FINAL = instances.FINAL_STATUSES;

// Variable names that would land on Object.prototype instead of the instance, or vanish.
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function assertVarName(name, what = 'variable') {
  const text = String(name);
  if (RESERVED_NAMES.has(text)) throw new Error(`"${text}" cannot be used as a ${what} name.`);
  return text;
}

export class WorkflowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'WorkflowError';
    this.status = status;
  }
}

export class Engine {
  constructor(deps = {}) {
    this.now = deps.now || (() => Date.now());
    this.setTimer = deps.setTimer || ((ms, fn) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer || ((handle) => clearTimeout(handle));
    // Injected rather than imported, so the engine and the server script runner do not have to
    // import each other.
    this.callServer = deps.callServer || (() => { throw new WorkflowError('No server script runner is wired up.'); });
    // A Run Script node marked `heavy` goes here instead: a worker thread, off the event loop.
    this.runInWorker = deps.runInWorker || this.callServer;
    // Threads in flight for heavy Run Script nodes, by "instance/token"; the token is parked
    // meanwhile, so the tick moves on to other tokens and other instances are not held up.
    this.threads = new Map();
    this.listeners = new Map();
    this.ticking = new Map();
    this.live = new Map();
    this.locks = new Map();
    this.cancelRequests = new Map();
    this.timer = null;
    this.timerAt = null;
  }

  // --- events ------------------------------------------------------------

  subscribe(id, listener) {
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    this.listeners.get(id).add(listener);
    return () => {
      const set = this.listeners.get(id);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  watcherCount(id) {
    return this.listeners.get(id)?.size || 0;
  }

  emit(instance) {
    const set = this.listeners.get(instance.id);
    if (!set || set.size === 0) return;
    const payload = {
      id: instance.id,
      workflow: instance.workflow,
      status: instance.status,
      nodeStates: instance.nodeStates,
      vars: instance.vars,
      waiting: instance.waiting,
      result: instance.result,
      error: instance.error,
      log: instance.log.slice(-100),
      logOffset: Math.max(0, instance.log.length - 100),
      updatedAt: instance.updatedAt
    };
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        /* a broken listener must not derail the run */
      }
    }
  }

  // --- definition ----------------------------------------------------------

  async definitionOf(workflow) {
    let artifact;
    try {
      artifact = await store.read('workflows', workflow);
    } catch (err) {
      throw new WorkflowError(`Workflow "${workflow}" could not be loaded: ${err.message}`, err.status || 500);
    }
    const definition = artifact.definition || { nodes: [], edges: [] };
    const byId = new Map((definition.nodes || []).map((n) => [n.id, n]));
    const out = new Map();
    for (const edge of definition.edges || []) {
      const key = `${edge.from}::${edge.port || 'out'}`;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(edge.to);
    }
    return { definition, byId, out };
  }

  propsOf(node) {
    return { ...defaultPropsOf(node.type), ...(node.props || {}) };
  }

  targetsFrom(graph, nodeId, port) {
    return graph.out.get(`${nodeId}::${port}`) || [];
  }

  // Token and join ids live inside checkpoints, so the counter behind them has to be part of the
  // instance itself - a process-wide counter would restart from zero and collide after a reboot.
  nextId(instance) {
    instance.seq = (instance.seq || 0) + 1;
    return `t${instance.seq}`;
  }

  // A short per-instance queue for checkpoint reads and writes. It is only ever held across
  // single file operations, never across user code, so it cannot deadlock.
  locked(id, fn) {
    const prev = this.locks.get(id) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    const tail = next.catch(() => {});
    this.locks.set(id, tail);
    tail.then(() => {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    });
    return next;
  }

  // --- lifecycle -----------------------------------------------------------

  async start(workflow, args, options = {}) {
    const graph = await this.definitionOf(workflow);
    const entry = [...graph.byId.values()].find((n) => n.type === 'start');
    if (!entry) throw new WorkflowError(`Workflow "${workflow}" has no Start node.`);

    const instance = instances.create(workflow, args, { ...options, now: this.now() });
    instance.tokens = [{ id: this.nextId(instance), at: entry.id, stack: [], attempts: 0 }];
    instance.joins = {};
    this.note(instance, entry.id, 'info', `started${options.debug ? ' (debug)' : ''}`);
    await instances.save(instance);

    // Deliberately not awaited: startWorkflow returns as soon as the instance exists.
    this.tick(instance.id).catch((err) => console.error(`[workflow ${instance.id}]`, err));
    return instance;
  }

  note(instance, node, level, message) {
    instance.log.push({ t: this.now(), node, level, message: String(message) });
    if (instance.log.length > 2000) instance.log.splice(0, instance.log.length - 2000);
  }

  async cancel(id, reason = 'cancelled') {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await this.locked(id, async () => {
        // Mid-tick: leave a request the tick consumes at its next checkpoint; writing the file
        // from here would only be overwritten.
        if (this.live.has(id)) {
          this.cancelRequests.set(id, reason);
          return { queued: true };
        }
        const instance = await instances.read(id);
        if (!instance || FINAL.has(instance.status)) return { instance };
        this.abandon(instance, instance.tokens, `parent workflow ${id} was cancelled`);
        this.markCancelled(instance);
        instance.status = 'cancelled';
        instance.tokens = [];
        instance.waiting = null;
        instance.finishedAt = this.now();
        instance.updatedAt = instance.finishedAt;
        this.note(instance, null, 'warn', reason);
        await instances.save(instance);
        return { instance, notify: true };
      });

      if (!result.queued) {
        this.cancelRequests.delete(id);
        if (result.notify) {
          this.emit(result.instance);
          await this.onFinished(result.instance);
        }
        return result.instance;
      }

      // A tick had the instance; wait for it, then check the request was honoured.
      await this.ticking.get(id)?.catch(() => {});
      const after = await instances.read(id);
      if (after && FINAL.has(after.status)) {
        this.cancelRequests.delete(id);
        return after;
      }
      // The tick parked the instance without seeing the request; go round and cancel on disk.
    }
    throw new WorkflowError(`Workflow instance "${id}" would not settle long enough to cancel.`, 409);
  }

  // A signal releases every token in this instance parked on that name.
  async signal(id, name, payload) {
    const outcome = await this.locked(id, async () => {
      const wasLive = this.live.has(id);
      const target = wasLive ? this.live.get(id) : await instances.read(id);
      if (!target) throw new WorkflowError(`Workflow instance "${id}" does not exist.`, 404);
      if (FINAL.has(target.status)) return { delivered: 0, status: target.status };

      let delivered = 0;
      for (const token of target.tokens) {
        if (token.wait && token.wait.kind === 'signal' && token.wait.signal === name) {
          delete token.wait;
          token.signal = payload === undefined ? null : payload;
          delivered += 1;
        }
      }
      if (delivered === 0) {
        // Nothing is parked on that name yet: keep it, so a signal that arrives a moment before
        // the run reaches its Wait For Signal node is not lost.
        target.pendingSignals = target.pendingSignals || {};
        (target.pendingSignals[name] = target.pendingSignals[name] || []).push(payload === undefined ? null : payload);
        this.note(target, null, 'info', `signal "${name}" received early; kept for the next Wait For Signal`);
        if (!wasLive) await instances.save(target);
        return { delivered: 0, queued: true, status: target.status };
      }

      this.note(target, null, 'info', `signal "${name}" received`);
      target.status = 'running';
      // A live instance is persisted by its tick; a parked one has to be written here.
      if (!wasLive) await instances.save(target);
      return { delivered, status: 'running' };
    });

    if (outcome.delivered > 0) this.tick(id).catch((err) => console.error(`[workflow ${id}]`, err));
    return outcome;
  }

  // A child started by a Call Workflow node reports back here. Same rule as a signal: mutate the
  // live object when the parent is mid-tick, the checkpoint under the lock otherwise.
  async onFinished(instance) {
    if (!instance.parent) return;
    const pid = instance.parent.instance;
    const delivered = await this.locked(pid, async () => {
      const wasLive = this.live.has(pid);
      const parent = wasLive ? this.live.get(pid) : await instances.read(pid);
      if (!parent || FINAL.has(parent.status)) return false;
      const token = parent.tokens.find((t) => t.id === instance.parent.token);
      // The childId match matters: a retried Call Workflow starts a fresh child, and the stale
      // one finishing later must not release the token that now waits on its replacement.
      if (!token || !token.wait || token.wait.kind !== 'child' || token.wait.childId !== instance.id) return false;
      delete token.wait;
      token.child = { status: instance.status, result: instance.result, error: instance.error };
      parent.status = 'running';
      if (!wasLive) await instances.save(parent);
      return true;
    });
    if (delivered) this.tick(pid).catch((err) => console.error(`[workflow ${pid}]`, err));
  }

  // --- heavy scripts on threads ------------------------------------------------

  startThread(instance, token, node, target, args) {
    const key = `${instance.id}/${token.id}`;
    // Numbered per token, so an outcome from an earlier start (a retry's predecessor, a thread
    // outlived by a reconcile) cannot be mistaken for the current one's.
    const seq = (token.threadSeq = (token.threadSeq || 0) + 1);
    const { handle, cancel } = this.threadHandle(instance.id, node.id);
    const done = Promise.resolve()
      .then(() => this.runInWorker(target, args, { job: handle }))
      .then(
        (value) => ({ ok: true, value: value === undefined ? null : value }),
        (err) => ({ ok: false, error: { message: err.message, stack: err.detail || err.stack } })
      );
    // The map entry lives for the whole delivery, not just the script: whoever waits on it (the
    // tests) sees the resumed tick already registered when it goes. Its cancel reaches the thread.
    const entry = { cancel };
    entry.delivered = done
      .then((outcome) => this.onThreadDone(instance.id, token.id, node.id, seq, outcome))
      .catch((err) => console.error(`[workflow ${instance.id}]`, err))
      .then(() => {
        if (this.threads.get(key) === entry) this.threads.delete(key);
      });
    this.threads.set(key, entry);
  }

  // The `job` a heavy script sees, shaped like a background run's: an id, log lines that go
  // into the instance log against the node, a progress value kept on the instance, and a
  // cancelled flag the thread runner turns into shared memory. Log and progress land on the live
  // object mid-tick, on the checkpoint under the lock otherwise, like every other outside event.
  threadHandle(id, nodeId) {
    const hooks = [];
    let cancelled = false;
    const touch = (mutate) =>
      this.locked(id, async () => {
        const wasLive = this.live.has(id);
        const current = wasLive ? this.live.get(id) : await instances.read(id);
        if (!current || FINAL.has(current.status)) return;
        mutate(current);
        current.updatedAt = this.now();
        if (!wasLive) await instances.save(current);
        this.emit(current);
      }).catch((err) => console.error(`[workflow ${id}]`, err));
    const handle = {
      id: `${id}/${nodeId}`,
      get cancelled() {
        return cancelled;
      },
      log: (message) => touch((current) => this.note(current, nodeId, 'info', message)),
      setProgress: (value) =>
        touch((current) => {
          current.progress = current.progress || {};
          current.progress[nodeId] = value;
        }),
      onCancel: (fn) => {
        hooks.push(fn);
      }
    };
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      for (const fn of hooks) {
        try {
          fn();
        } catch (err) {
          console.error(`[workflow ${id}] cancel hook for ${nodeId} failed: ${err.message}`);
        }
      }
    };
    return { handle, cancel };
  }

  // The thread's outcome lands on the parked token the same way a child's result does: on the
  // live object when the instance is mid-tick, on the checkpoint under the lock otherwise. A
  // token that is no longer parked there (cancelled, retried, restarted) simply ignores it.
  async onThreadDone(id, tokenId, nodeId, seq, outcome) {
    const delivered = await this.locked(id, async () => {
      const wasLive = this.live.has(id);
      const instance = wasLive ? this.live.get(id) : await instances.read(id);
      if (!instance || FINAL.has(instance.status)) return false;
      const token = instance.tokens.find((t) => t.id === tokenId);
      if (!token || !token.wait || token.wait.kind !== 'thread' || token.parked !== nodeId || token.threadSeq !== seq) return false;
      delete token.wait;
      token.thread = outcome;
      instance.status = 'running';
      if (!wasLive) await instances.save(instance);
      return true;
    });
    if (delivered) this.tick(id).catch((err) => console.error(`[workflow ${id}]`, err));
  }

  // A cancelled run must not keep showing a node as running or waiting: whatever had not finished
  // is marked cancelled, so the last picture of the run says what actually happened.
  markCancelled(instance) {
    for (const [id, state] of Object.entries(instance.nodeStates || {})) {
      if (state === 'running' || state === 'waiting') instance.nodeStates[id] = 'cancelled';
    }
  }

  // Tokens that are thrown away (cancel, finish, a losing Parallel branch) may be waiting on child
  // workflows or on heavy scripts' threads; those are cancelled rather than left running
  // unattended. A thread is told through its job handle: job.cancelled turns true at once, and
  // the thread runner terminates it if it has not stopped within the grace period.
  abandon(instance, tokens, reason) {
    for (const token of tokens || []) {
      if (!token.wait) continue;
      if (token.wait.kind === 'thread') {
        this.threads.get(`${instance.id}/${token.id}`)?.cancel();
        continue;
      }
      if (token.wait.kind !== 'child' || !token.wait.childId) continue;
      this.cancel(token.wait.childId, reason).catch((err) => console.error(`[workflow ${token.wait.childId}]`, err));
    }
  }

  // Used by boot: a parent parked on a child that finished (or vanished) while the server was
  // down is released here, under the instance lock, from a fresh read of the checkpoint.
  async reconcileChildren(id) {
    return this.locked(id, async () => {
      let instance;
      try {
        instance = await instances.read(id);
      } catch (err) {
        console.error(`[workflow ${id}] unreadable checkpoint:`, err.message);
        return null;
      }
      if (!instance || FINAL.has(instance.status)) return instance;
      let woken = false;
      for (const token of instance.tokens || []) {
        // A heavy script's thread died with the old process; the node runs again (at-least-once).
        if (token.wait && token.wait.kind === 'thread') {
          delete token.wait;
          delete token.parked;
          delete token.thread;
          woken = true;
          continue;
        }
        if (!token.wait || token.wait.kind !== 'child' || !token.wait.childId) continue;
        let child;
        try {
          child = await instances.read(token.wait.childId);
        } catch {
          continue; // unreadable: leave the token waiting, the child may still be recoverable
        }
        if (child && !FINAL.has(child.status)) continue;
        delete token.wait;
        token.child = child
          ? { status: child.status, result: child.result, error: child.error }
          : { status: 'vanished', result: undefined, error: { message: 'the child instance no longer exists' } };
        woken = true;
      }
      if (woken) {
        instance.status = 'running';
        await instances.save(instance);
      }
      return instance;
    });
  }

  // --- the run loop --------------------------------------------------------

  // One tick drains every runnable token, checkpointing after each node, and stops when the
  // instance either finishes or has nothing left but tokens that are waiting.
  async tick(id) {
    if (this.ticking.has(id)) return this.ticking.get(id);
    const run = this.runTick(id);
    this.ticking.set(id, run);
    return run;
  }

  async runTick(id) {
    try {
      return await this.runTickBody(id);
    } finally {
      // Both maps are cleared in the same synchronous block: a signal or cancel that sees the
      // instance as not live can then start a fresh tick rather than join a finished one.
      this.live.delete(id);
      this.ticking.delete(id);
    }
  }

  async runTickBody(id) {
    let instance;
    try {
      instance = await this.locked(id, async () => {
        const found = await instances.read(id);
        if (found && !FINAL.has(found.status)) this.live.set(id, found);
        return found;
      });
    } catch (err) {
      // An unreadable checkpoint cannot be failed on disk; report it and leave it for repair.
      console.error(`[workflow ${id}] cannot be resumed:`, err.message);
      return null;
    }
    if (!instance || FINAL.has(instance.status)) {
      this.cancelRequests.delete(id);
      return instance;
    }

    try {
      instance.joins = instance.joins || {};
      const graph = await this.definitionOf(instance.workflow);
      const scope = await createScope(instance, this.services(instance));
      let steps = 0;

      for (;;) {
        if (await this.consumeCancel(instance)) return instance;
        this.releaseElapsedWaits(instance);
        const token = instance.tokens.find((t) => !t.wait);

        if (!token) {
          if (instance.tokens.length === 0) {
            await this.finish(instance, 'completed');
            return instance;
          }
          this.computeWaiting(instance);
          instance.updatedAt = this.now();
          await instances.save(instance);
          // A signal, a cancel or a finished child may have landed on the live object while
          // that checkpoint was being written; one more look catches them.
          if (this.cancelRequests.has(id) || instance.tokens.some((t) => !t.wait)) continue;
          this.emit(instance);
          this.arm(instance.waiting ? instance.waiting.until : null);
          return instance;
        }

        if ((steps += 1) > MAX_STEPS_PER_TICK) {
          await this.fail(instance, token.at, new Error(`Workflow exceeded ${MAX_STEPS_PER_TICK} steps in one run. Check for a loop that never ends.`));
          return instance;
        }

        const finished = await this.step(instance, graph, scope, token);
        // Round robin: the token that just ran goes to the back, so parallel branches and
        // fan-out tokens take turns instead of the first one running to the end alone.
        const at = instance.tokens.indexOf(token);
        if (at >= 0 && instance.tokens.length > 1) {
          instance.tokens.splice(at, 1);
          instance.tokens.push(token);
        }
        instance.updatedAt = this.now();
        await instances.save(instance);
        this.emit(instance);
        if (finished) return instance;
      }
    } catch (err) {
      // Whatever went wrong, never leave the instance stranded as "running" on disk with no
      // tick ever coming back for it.
      try {
        await this.fail(instance, null, err);
      } catch (second) {
        console.error(`[workflow ${id}] failed while recording a failure:`, second);
      }
      return instance;
    }
  }

  async consumeCancel(instance) {
    const reason = this.cancelRequests.get(instance.id);
    if (reason === undefined) return false;
    this.cancelRequests.delete(instance.id);
    this.abandon(instance, instance.tokens, `parent workflow ${instance.id} was cancelled`);
    this.markCancelled(instance);
    instance.status = 'cancelled';
    instance.tokens = [];
    instance.waiting = null;
    instance.finishedAt = this.now();
    instance.updatedAt = instance.finishedAt;
    this.note(instance, null, 'warn', reason);
    await instances.save(instance);
    this.emit(instance);
    await this.onFinished(instance);
    return true;
  }

  releaseElapsedWaits(instance) {
    const now = this.now();
    let released = false;
    for (const token of instance.tokens) {
      if (!token.wait) continue;
      if (token.wait.kind === 'delay' && token.wait.until <= now) {
        delete token.wait;
        released = true;
      } else if (token.wait.kind === 'signal' && token.wait.timeoutAt && token.wait.timeoutAt <= now) {
        token.timedOut = true;
        delete token.wait;
        released = true;
      }
    }
    // The checkpoints written while the released token runs must say so, or a restart would
    // see a "waiting" instance with nothing to wait for and never resume it.
    if (released) {
      instance.status = 'running';
      instance.waiting = null;
    }
  }

  computeWaiting(instance) {
    const waits = instance.tokens.map((t) => t.wait).filter(Boolean);
    const timed = waits.map((w) => w.until ?? w.timeoutAt).filter((v) => typeof v === 'number');
    // A thread still computing means the instance is running, not parked on the outside world.
    instance.status = waits.some((w) => w.kind === 'thread') ? 'running' : 'waiting';
    instance.waiting = {
      kind: waits[0]?.kind || 'signal',
      until: timed.length ? Math.min(...timed) : null,
      signal: waits.find((w) => w.kind === 'signal')?.signal || null,
      count: waits.length
    };
  }

  async finish(instance, status, result) {
    this.abandon(instance, instance.tokens, `parent workflow ${instance.id} ${status}`);
    instance.status = status;
    instance.tokens = [];
    instance.waiting = null;
    if (result !== undefined) instance.result = result;
    instance.finishedAt = this.now();
    instance.updatedAt = instance.finishedAt;
    this.note(instance, null, status === 'completed' ? 'info' : 'error', status);
    await instances.save(instance);
    this.emit(instance);
    await this.onFinished(instance);
  }

  async fail(instance, nodeId, err) {
    instance.error = { node: nodeId, message: err.message, stack: err.stack };
    if (nodeId) instance.nodeStates[nodeId] = 'failed';
    this.note(instance, nodeId, 'error', err.message);
    await this.finish(instance, 'failed');
  }

  services(instance) {
    return {
      log: (message, level = 'info') => this.note(instance, null, level, message),
      callFunction: (target, args) => this.callServer(target, args),
      startWorkflow: async (name, args) => {
        const child = await this.start(name, args);
        return { id: child.id, status: child.status };
      },
      signalWorkflow: (id, name, payload) => this.signal(id, name, payload)
    };
  }

  // --- one node ------------------------------------------------------------

  // Returns true when the instance has finished and the tick should stop.
  async step(instance, graph, scope, token) {
    const node = graph.byId.get(token.at);
    if (!node) {
      await this.fail(instance, token.at, new Error(`Node "${token.at}" is not in the workflow any more.`));
      return true;
    }

    if (!hasNode(node.type)) {
      await this.fail(instance, node.id, new Error(`Node type "${node.type}" cannot be executed.`));
      return true;
    }

    instance.nodeStates[node.id] = 'running';
    let outcome;
    try {
      outcome = await this.runNode(instance, graph, scope, token, node);
    } catch (err) {
      return this.handleNodeError(instance, graph, token, node, err);
    }

    if (outcome.end) {
      instance.nodeStates[node.id] = 'done';
      const status = outcome.end.status === 'failed' ? 'failed' : 'completed';
      if (status === 'failed') {
        instance.error = { node: node.id, message: 'The workflow reached an End node marked failed.' };
      }
      await this.finish(instance, status, outcome.end.result);
      return true;
    }
    if (outcome.wait) {
      token.wait = outcome.wait;
      token.parked = node.id;
      // A node whose thread is computing is running, whatever the token's bookkeeping says.
      instance.nodeStates[node.id] = outcome.wait.kind === 'thread' ? 'running' : 'waiting';
      return false;
    }
    if (outcome.tokens) {
      this.drop(instance, token);
      instance.tokens.push(...outcome.tokens);
      instance.nodeStates[node.id] = 'done';
      return false;
    }
    this.advance(instance, graph, token, node, outcome.go);
    return false;
  }

  async handleNodeError(instance, graph, token, node, err) {
    const def = nodeDef(node.type);
    const props = this.propsOf(node);
    const retries = Number(props.retries) || 0;

    if (def.canFail && (token.attempts || 0) < retries) {
      token.attempts = (token.attempts || 0) + 1;
      delete token.parked;
      const backoff = parseDuration(props.retryDelay) ?? 30000;
      token.wait = { kind: 'delay', until: this.now() + backoff };
      instance.nodeStates[node.id] = 'waiting';
      this.note(instance, node.id, 'warn', `${err.message} - retry ${token.attempts} of ${retries} in ${props.retryDelay}`);
      return false;
    }

    if (def.canFail && this.targetsFrom(graph, node.id, 'error').length > 0) {
      instance.vars.lastError = { node: node.id, message: err.message };
      instance.nodeStates[node.id] = 'failed';
      this.note(instance, node.id, 'warn', `${err.message} - taking the error path`);
      token.attempts = 0;
      this.advance(instance, graph, token, node, 'error');
      return false;
    }

    await this.fail(instance, node.id, err);
    return true;
  }

  drop(instance, token) {
    instance.tokens = instance.tokens.filter((t) => t !== token);
  }

  advance(instance, graph, token, node, port) {
    if (instance.nodeStates[node.id] !== 'failed') instance.nodeStates[node.id] = 'done';
    const targets = this.targetsFrom(graph, node.id, port);
    if (targets.length === 0) {
      this.deadEnd(instance, graph, token, node, port);
      return;
    }
    token.attempts = 0;
    delete token.parked;
    delete token.signal;
    delete token.child;
    delete token.timedOut;
    token.at = targets[0];
    // Several edges from one port fan out; each extra target gets its own token.
    for (const extra of targets.slice(1)) instance.tokens.push(this.sideToken(instance, token, extra));
  }

  // A token split off an existing one. The stack is deep-copied so the tokens behave the same
  // before and after a checkpoint reload. Loop frames are marked as side frames: only the
  // original token drives the loop, a side token that runs off the end is simply dropped. A join
  // frame gains one more branch to wait for.
  sideToken(instance, token, at) {
    const stack = JSON.parse(JSON.stringify(token.stack));
    for (const frame of stack) {
      if (frame.kind === 'loop') frame.side = true;
      else if (frame.kind === 'join' && instance.joins[frame.joinId]) instance.joins[frame.joinId].remaining += 1;
    }
    return { id: this.nextId(instance), at, stack, attempts: 0, item: token.item, index: token.index };
  }

  // A branch that runs off the end of the graph returns to whatever it is inside: the next turn
  // of the enclosing loop, or the join that is counting its siblings.
  deadEnd(instance, graph, token, node, port) {
    while (token.stack.length > 0) {
      const frame = token.stack[token.stack.length - 1];
      if (frame.kind === 'loop') {
        if (frame.side) {
          // A side token inside a loop body has done its work; the main token turns the loop.
          token.stack.pop();
          continue;
        }
        token.at = frame.node;
        token.attempts = 0;
        delete token.parked;
        return;
      }
      token.stack.pop();
      const join = instance.joins[frame.joinId];
      if (!join || join.done) {
        this.drop(instance, token);
        return;
      }
      join.remaining -= 1;
      if (join.mode === 'any' || join.remaining <= 0) {
        join.done = true;
        this.cancelBranches(instance, frame.joinId, token);
        delete instance.joins[frame.joinId];
        this.advance(instance, graph, token, { id: join.node }, 'done');
        return;
      }
      this.drop(instance, token);
      return;
    }
    if (node && port && port !== 'out' && port !== 'done') {
      // A Condition's false path or a Wait For Signal's timeout with nothing wired: the token is
      // gone, the run may well complete "successfully", so say what happened.
      this.note(instance, node.id, 'warn', `nothing is connected to the "${port}" port; this path ends here`);
    }
    this.drop(instance, token);
  }

  cancelBranches(instance, joinId, keep) {
    const losers = instance.tokens.filter((t) => t !== keep && t.stack.some((f) => f.joinId === joinId));
    this.abandon(instance, losers, `a parallel branch of ${instance.id} was abandoned`);
    // A loser parked on a node (a wait, a thread) would otherwise stay painted as running or
    // waiting in a run that went on without it.
    for (const token of losers) {
      const state = token.parked && instance.nodeStates[token.parked];
      if (state === 'running' || state === 'waiting') instance.nodeStates[token.parked] = 'cancelled';
    }
    instance.tokens = instance.tokens.filter((t) => !losers.includes(t));
  }

  // --- node behaviour -------------------------------------------------------

  async runNode(instance, graph, scope, token, node) {
    const props = this.propsOf(node);
    const locals = { item: token.item, index: token.index, signal: token.signal, child: token.child };

    switch (node.type) {
      case 'start':
        return { go: 'out' };

      case 'end':
        return { end: { status: props.status, result: await evaluate(scope, props.result, locals) } };

      case 'log': {
        const message = await evaluate(scope, props.message, locals);
        this.note(instance, node.id, props.level || 'info', message ?? '');
        return { go: 'out' };
      }

      case 'setVar': {
        for (const row of props.assignments || []) {
          if (!row || !row.name) continue;
          instance.vars[assertVarName(row.name)] = await evaluate(scope, row.expression, locals);
        }
        return { go: 'out' };
      }

      case 'condition': {
        const verdict = await evaluate(scope, props.expression, locals);
        if (verdict !== undefined && typeof verdict !== 'boolean') {
          this.note(instance, node.id, 'warn', `condition produced ${Array.isArray(verdict) ? 'an array' : `a ${typeof verdict}`}, taken as ${verdict ? 'true' : 'false'}`);
        }
        return { go: verdict ? 'true' : 'false' };
      }

      case 'delay': {
        if (token.parked === node.id) return { go: 'out' };
        let until;
        if (String(props.until || '').trim() !== '') {
          const value = await evaluate(scope, props.until, locals);
          // A Date made inside the expression sandbox is not an instance of the host's Date.
          until = value && typeof value.getTime === 'function' ? value.getTime() : Number(value);
          if (!Number.isFinite(until)) throw new Error(`Delay "until" did not produce a time: ${props.until}`);
        } else {
          const text = String(props.duration ?? '').trim();
          if (/^\d+(\.\d+)?$/.test(text)) throw new Error(`Delay duration "${text}" needs a unit: ${text}s, ${text}m, ${text}h or ${text}d.`);
          const ms = parseDuration(text);
          if (ms === null) throw new Error(`Delay duration "${props.duration}" is not a duration like 30s, 5m or 2h.`);
          until = this.now() + ms;
        }
        this.note(instance, node.id, 'info', `waiting until ${new Date(until).toISOString()}`);
        return { wait: { kind: 'delay', until } };
      }

      case 'waitSignal': {
        if (token.parked === node.id) {
          if (token.timedOut) {
            this.note(instance, node.id, 'warn', `signal "${props.signal}" timed out`);
            return { go: 'timeout' };
          }
          if (props.assign) instance.vars[assertVarName(props.assign)] = token.signal ?? null;
          return { go: 'out' };
        }
        const timeout = String(props.timeout || '').trim() === '' ? null : parseDuration(props.timeout);
        if (props.timeout && timeout === null) throw new Error(`Timeout "${props.timeout}" is not a duration.`);
        const queued = instance.pendingSignals && instance.pendingSignals[props.signal];
        if (queued && queued.length > 0) {
          // The signal arrived before the run got here; take it and carry straight on.
          const payload = queued.shift();
          if (queued.length === 0) delete instance.pendingSignals[props.signal];
          token.signal = payload;
          if (props.assign) instance.vars[assertVarName(props.assign)] = payload ?? null;
          this.note(instance, node.id, 'info', `signal "${props.signal}" had already arrived`);
          return { go: 'out' };
        }
        this.note(instance, node.id, 'info', `waiting for signal "${props.signal}"`);
        return {
          wait: { kind: 'signal', signal: props.signal, timeoutAt: timeout === null ? null : this.now() + timeout }
        };
      }

      case 'script': {
        // A heavy script's thread has reported back: the token was parked on this node with the
        // outcome attached, and the step now finishes as if the call had just returned.
        if (props.heavy && token.parked === node.id && token.thread) {
          const outcome = token.thread;
          delete token.thread;
          if (!outcome.ok) {
            const err = new Error(outcome.error.message);
            err.detail = outcome.error.stack;
            throw err;
          }
          if (props.assign) instance.vars[assertVarName(props.assign)] = outcome.value ?? null;
          return { go: 'out' };
        }
        const args = await this.argsOf(scope, props.args, locals);
        const target = String(props.target || '').trim();
        if (!target) throw new Error('This Run Script node names no server script.');
        if (props.heavy) {
          // The thread works while the token waits, so sibling branches - and every other
          // instance - keep going instead of queueing behind this call.
          this.startThread(instance, token, node, target, args);
          return { wait: { kind: 'thread' } };
        }
        const result = await this.callServer(target, args);
        if (props.assign) instance.vars[assertVarName(props.assign)] = result === undefined ? null : result;
        return { go: 'out' };
      }

      case 'callWorkflow': {
        if (token.parked === node.id) {
          const child = token.child || {};
          // Anything short of completed - failed, cancelled, or gone - is a failure here.
          if (child.status !== 'completed') {
            const detail = child.error && child.error.message ? `: ${child.error.message}` : '';
            throw new Error(`Child workflow ${child.status || 'vanished'}${detail}`);
          }
          if (props.assign) instance.vars[assertVarName(props.assign)] = child.result ?? null;
          return { go: 'out' };
        }
        const name = String(props.workflow || '').trim();
        if (!name) throw new Error('This Call Workflow node names no workflow.');
        const args = await evaluate(scope, props.args, locals);

        // A child of a debug run is a debug run too, so it goes when the watch goes.
        if (props.wait === false) {
          const child = await this.start(name, args, { debug: Boolean(instance.debug) });
          if (props.assign) instance.vars[assertVarName(props.assign)] = child.id;
          return { go: 'out' };
        }
        const child = await this.start(name, args, { parent: { instance: instance.id, token: token.id }, debug: Boolean(instance.debug) });
        this.note(instance, node.id, 'info', `waiting for ${name} (${child.id})`);
        return { wait: { kind: 'child', childId: child.id } };
      }

      default:
        return this.runStructuralNode(instance, graph, scope, token, node, props, locals);
    }
  }

  async argsOf(scope, source, locals) {
    const value = await evaluate(scope, source, locals);
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }

  // Loops and joins keep their state on the token's stack, so nesting works and the whole thing
  // still serialises.
  async runStructuralNode(instance, graph, scope, token, node, props, locals) {
    const top = token.stack[token.stack.length - 1];
    const returning = top && top.kind === 'loop' && top.node === node.id && !top.side;

    if (node.type === 'forEach') {
      const itemVar = assertVarName(props.itemVar || 'item');
      const indexVar = assertVarName(props.indexVar || 'index');
      let frame = returning ? top : null;
      if (!frame) {
        const items = await evaluate(scope, props.items, locals);
        if (items !== undefined && !Array.isArray(items)) {
          this.note(instance, node.id, 'warn', `items is not a list (${typeof items}); the loop runs zero times`);
        }
        frame = { kind: 'loop', node: node.id, index: -1, items: Array.isArray(items) ? items : [], scope: this.saveLoopScope(instance, token, [itemVar, indexVar]) };
        token.stack.push(frame);
      }
      frame.index += 1;
      if (frame.index >= frame.items.length) {
        token.stack.pop();
        this.restoreLoopScope(instance, token, frame);
        return { go: 'done' };
      }
      instance.vars[itemVar] = frame.items[frame.index];
      instance.vars[indexVar] = frame.index;
      token.item = frame.items[frame.index];
      token.index = frame.index;
      return { go: 'body' };
    }

    if (node.type === 'while') {
      const indexVar = assertVarName(props.indexVar || 'index');
      let frame = returning ? top : null;
      if (!frame) {
        frame = { kind: 'loop', node: node.id, index: -1, scope: this.saveLoopScope(instance, token, [indexVar]) };
        token.stack.push(frame);
      }
      frame.index += 1;
      const limit = Number(props.maxIterations) || 1000;
      if (frame.index >= limit) {
        token.stack.pop();
        this.restoreLoopScope(instance, token, frame);
        throw new Error(`While loop passed its ${limit} iteration limit.`);
      }
      if (!(await evaluate(scope, props.expression, locals))) {
        token.stack.pop();
        this.restoreLoopScope(instance, token, frame);
        return { go: 'done' };
      }
      instance.vars[indexVar] = frame.index;
      token.index = frame.index;
      return { go: 'body' };
    }

    if (node.type === 'parallel') {
      const outputs = outputsOf(node)
        .map((o) => o.name)
        .filter((name) => name.startsWith('branch'));
      // Every edge out of every branch port starts a token; the join waits for all of them.
      const starts = outputs.flatMap((port) => this.targetsFrom(graph, node.id, port));
      if (starts.length === 0) return { go: 'done' };

      const joinId = `${node.id}#${this.nextId(instance)}`;
      instance.joins[joinId] = {
        node: node.id,
        mode: props.join === 'any' ? 'any' : 'all',
        remaining: starts.length,
        done: false
      };
      return {
        tokens: starts.map((at) => ({
          id: this.nextId(instance),
          at,
          stack: [...JSON.parse(JSON.stringify(token.stack)), { kind: 'join', node: node.id, joinId }],
          attempts: 0,
          item: token.item,
          index: token.index
        }))
      };
    }

    throw new Error(`Node type "${node.type}" cannot be executed.`);
  }

  // A loop shadows its item and index variables for the body and puts the previous values back
  // when it is done, so a nested loop does not leave the outer one's variables clobbered.
  saveLoopScope(instance, token, names) {
    const vars = {};
    for (const name of names) vars[name] = { had: name in instance.vars, value: instance.vars[name] };
    return { vars, item: token.item, index: token.index, hadItem: 'item' in token, hadIndex: 'index' in token };
  }

  restoreLoopScope(instance, token, frame) {
    const saved = frame.scope;
    if (!saved) return;
    for (const [name, entry] of Object.entries(saved.vars || {})) {
      if (entry.had) instance.vars[name] = entry.value;
      else delete instance.vars[name];
    }
    if (saved.hadItem) token.item = saved.item;
    else delete token.item;
    if (saved.hadIndex) token.index = saved.index;
    else delete token.index;
  }

  // --- timers ---------------------------------------------------------------

  // One timer for the whole engine, armed for the nearest wake time across every live instance.
  arm(at) {
    if (typeof at !== 'number' || !Number.isFinite(at)) return;
    if (this.timer !== null && this.timerAt !== null && this.timerAt <= at) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timerAt = at;
    // The promise is returned rather than swallowed, so a caller that controls the clock - the
    // tests do - can wait for the wake-up it just triggered. A wait further off than the timer
    // can express fires early and wake() simply arms the remainder.
    this.timer = this.setTimer(Math.min(MAX_TIMER_MS, Math.max(0, at - this.now())), () => {
      this.timer = null;
      this.timerAt = null;
      return this.wake().catch((err) => console.error('[workflow scheduler]', err));
    });
  }

  // Resume everything whose moment has come, and re-arm for the next one.
  async wake() {
    const active = await instances.listActive();
    const now = this.now();
    let next = null;
    for (const instance of active) {
      const due = instance.tokens.some(
        (t) => t.wait && ((t.wait.kind === 'delay' && t.wait.until <= now) ||
          (t.wait.kind === 'signal' && t.wait.timeoutAt && t.wait.timeoutAt <= now))
      );
      if (due) {
        // One instance that cannot be ticked must not stop the others, or the re-arm below.
        await this.tick(instance.id).catch((err) => console.error(`[workflow ${instance.id}]`, err));
        continue;
      }
      for (const token of instance.tokens) {
        const at = token.wait?.until ?? token.wait?.timeoutAt;
        if (typeof at === 'number' && (next === null || at < next)) next = at;
      }
    }
    if (next !== null) this.arm(next);
  }

  stop() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.timerAt = null;
  }
}
