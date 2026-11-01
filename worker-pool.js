// Background script runs on worker threads, so a script that computes for half an hour never
// blocks the server's event loop. One thread per run, at most `size` at a time; the rest wait
// in order. The thread's built-ins that reach the workflow engine or the runs registry come
// back here as messages and are served by the main thread's real implementations.
import { Worker } from 'node:worker_threads';
import { config } from '../config.js';
import { ScriptError, defaultServices } from '../runner.js';
import { append as appendConsole, consoleBudgetCells } from '../console-log.js';

// A cancelled run gets this long to notice job.cancelled before its thread is terminated.
export const CANCEL_GRACE_MS = 10_000;

export class WorkerPool {
  constructor({ size = config.workerThreads, cancelGrace = CANCEL_GRACE_MS, services = defaultServices } = {}) {
    this.size = Math.max(1, size);
    this.cancelGrace = cancelGrace;
    this.services = services;
    this.active = 0;
    this.queue = [];
  }

  // Same signature as callServer(target, args, extras). `extras.job` is a run's handle: its
  // log/setProgress receive what the script reports, and its onCancel (when offered) lets a
  // cancel reach the thread.
  run(target, args, extras = {}) {
    return new Promise((resolve, reject) => {
      const entry = { target, args, job: extras.job || null, resolve, reject, worker: null, settled: false };
      if (entry.job && typeof entry.job.onCancel === 'function') entry.job.onCancel(() => this.cancel(entry));
      if (this.active < this.size) this.spawn(entry);
      else {
        this.queue.push(entry);
        entry.job?.log?.(`queued behind ${this.active + this.queue.length - 1} run(s)`);
      }
    });
  }

  cancel(entry) {
    const queued = this.queue.indexOf(entry);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      entry.settled = true;
      entry.reject(new ScriptError('The run was cancelled before it started.'));
      return;
    }
    if (!entry.worker || entry.settled) return;
    Atomics.store(entry.flag, 0, 1);
    if (entry.graceTimer) return;
    entry.graceTimer = setTimeout(() => {
      this.finish(entry, 'reject', new ScriptError(`The run was cancelled and did not stop within ${Math.round(this.cancelGrace / 1000)} s; its thread was terminated.`));
    }, this.cancelGrace);
  }

  finish(entry, how, value) {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.graceTimer) clearTimeout(entry.graceTimer);
    entry.worker.terminate().catch(() => {});
    this.active -= 1;
    (how === 'resolve' ? entry.resolve : entry.reject)(value);
    const next = this.queue.shift();
    if (next) this.spawn(next);
  }

  spawn(entry) {
    this.active += 1;
    const { job } = entry;
    entry.flag = new Int32Array(new SharedArrayBuffer(4));
    // Cancelled while waiting in the queue: the script starts already told.
    if (job && job.cancelled) Atomics.store(entry.flag, 0, 1);
    let worker;
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), {
        // consoleBudget: the runner's console budgets, shared memory every worker draws on.
        workerData: { target: entry.target, args: entry.args, job: job ? { id: job.id, flag: entry.flag } : null, consoleBudget: consoleBudgetCells() }
      });
    } catch (err) {
      this.active -= 1;
      entry.settled = true;
      entry.reject(new ScriptError(`The run cannot start on a worker thread: ${err.message}`));
      return;
    }
    entry.worker = worker;

    worker.on('message', (msg) => this.onMessage(entry, msg));
    worker.on('error', (err) => this.finish(entry, 'reject', new ScriptError(err.message, 500, err.stack)));
    worker.on('exit', (code) => this.finish(entry, 'reject', new ScriptError(`The worker thread exited (code ${code}) before the script finished.`)));
  }

  async onMessage(entry, msg) {
    switch (msg.type) {
      case 'rpc': {
        let reply;
        try {
          const impl = this.services[msg.name];
          if (typeof impl !== 'function') throw new ScriptError(`"${msg.name}" is not available to scripts.`, 404);
          reply = { type: 'rpc-result', id: msg.id, result: await impl(...(msg.args || [])) };
        } catch (err) {
          reply = { type: 'rpc-result', id: msg.id, error: { message: err.message, status: err.status, detail: err.detail } };
        }
        if (entry.settled) return;
        try {
          entry.worker.postMessage(reply);
        } catch (err) {
          entry.worker.postMessage({ type: 'rpc-result', id: msg.id, error: { message: `The result of ${msg.name} cannot be sent to the worker thread: ${err.message}` } });
        }
        return;
      }
      case 'log':
        entry.job?.log?.(msg.message);
        return;
      case 'console':
        appendConsole(msg.entry);
        return;
      case 'progress':
        entry.job?.setProgress?.(msg.value);
        return;
      case 'done':
        this.finish(entry, 'resolve', msg.result);
        return;
      case 'error':
        this.finish(entry, 'reject', new ScriptError(msg.message, msg.status || 500, msg.stack));
        return;
      default:
    }
  }
}

export const pool = new WorkerPool();

export function runInWorker(target, args, extras) {
  return pool.run(target, args, extras);
}
