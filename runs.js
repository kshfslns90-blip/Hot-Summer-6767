// Background job runs: a server script executed detached from any HTTP request. A run is not
// resumable - that is what workflows are for - so its record is bookkeeping, not a checkpoint:
// status, progress, log, result. One file per run under runtimeDir/jobs.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { parseTarget } from '../runner.js';
import { assertName } from '../store.js';
import { parseDuration } from '../../public/workflow/nodes.js';

// setTimeout clamps anything longer than this to 1ms; a run scheduled further out is re-armed.
const MAX_TIMER_MS = 2 ** 31 - 1;

// The `at` / `delay` options of a deferred run: a Date, a timestamp, an ISO string, or a
// duration such as "2h". Returns the moment to start, or null when neither was given.
function scheduledMoment({ at, delay }, now) {
  if (at !== undefined && at !== null && at !== '') {
    const time = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(String(at));
    if (!Number.isFinite(time)) throw new Error(`"${at}" is not a time to run at.`);
    return time;
  }
  if (delay !== undefined && delay !== null && delay !== '') {
    const ms = parseDuration(delay);
    if (ms === null) throw new Error(`"${delay}" is not a delay like 30s, 5m or 2h.`);
    return now + ms;
  }
  return null;
}

const ID_RE = /^job_[0-9a-f]{12}$/;
const KEEP_FINISHED = 200;
const LOG_CAP = 500;
const SAVE_INTERVAL = 500;

export const FINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

export function newId() {
  return `job_${crypto.randomBytes(6).toString('hex')}`;
}

export function assertId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    const err = new Error(`Invalid job run id "${id}".`);
    err.status = 400;
    throw err;
  }
  return id;
}

function serialise(record) {
  try {
    return JSON.stringify(record, null, 2);
  } catch {
    const seen = new WeakSet();
    return JSON.stringify(
      record,
      (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[circular]';
          seen.add(value);
        }
        return value;
      },
      2
    );
  }
}

export function summarise(record) {
  return {
    id: record.id,
    job: record.job,
    kind: record.kind || 'script',
    target: record.target,
    instance: record.kind === 'workflow' && record.result ? record.result.instance : undefined,
    status: record.status,
    scheduledFor: record.scheduledFor ?? null,
    progress: record.progress ?? null,
    cancelRequested: record.cancelRequested || false,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    error: record.error ? record.error.message : null
  };
}

export class Runs {
  constructor(deps = {}) {
    this.now = deps.now || Date.now;
    this.startWorkflow = deps.startWorkflow || (() => { throw new Error('No workflow engine is wired up.'); });
    this.callServer = deps.callServer;
    this.setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer || ((handle) => clearTimeout(handle));
    // id -> { record, lastSaved } while a run is in flight; the file lags the live object by at
    // most SAVE_INTERVAL, and the live object is what read/list/cancel prefer.
    this.live = new Map();
    // id -> the in-flight execution promise, so tests can await settling.
    this.running = new Map();
    // id -> { record, timer } for runs that are waiting for their moment.
    this.scheduled = new Map();
    this.writing = new Map(); // save chains, by run id
  }

  dir() {
    return path.join(config.runtimeDir, 'jobs');
  }

  fileOf(id) {
    return path.join(this.dir(), `${assertId(id)}.json`);
  }

  async ensureDirs() {
    await fs.mkdir(this.dir(), { recursive: true });
  }

  // Atomic temp+rename, with the Windows retry the workflow store also needs. Saves of one run
  // are chained and serialised when their turn comes: a cancel request's save and the run's
  // final save can be in flight together (a script that stops the moment it sees job.cancelled),
  // and the later state must be the one that ends up on disk.
  async save(record) {
    const previous = this.writing.get(record.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.writeOnce(record));
    this.writing.set(record.id, next);
    try {
      await next;
    } finally {
      if (this.writing.get(record.id) === next) this.writing.delete(record.id);
    }
  }

  async writeOnce(record) {
    await this.ensureDirs();
    const target = this.fileOf(record.id);
    const temp = `${target}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    await fs.writeFile(temp, `${serialise(record)}\n`, 'utf8');
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(temp, target);
        return;
      } catch (err) {
        if (attempt >= 5 || (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'EBUSY')) {
          await fs.rm(temp, { force: true });
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  }

  // Progress and log updates flow through here: cheap while the run hammers them, flushed for
  // sure by the final save.
  async touch(entry) {
    if (this.now() - entry.lastSaved < SAVE_INTERVAL) return;
    entry.lastSaved = this.now();
    await this.save(entry.record).catch((err) => {
      console.error(`[jobs] failed to save run ${entry.record.id}: ${err.message}`);
    });
  }

  // Starts the target detached and returns as soon as the run record exists on disk. A job of
  // kind "workflow" starts an instance instead of calling a script: the run is over as soon as
  // the instance exists, and the instance is followed in the Workflows tab. With `at` or `delay`
  // the run is recorded as scheduled and launched when its moment comes; it survives a restart.
  async start(target, args, { job = null, kind = 'script', at, delay } = {}) {
    if (kind === 'workflow') assertName(target);
    else parseTarget(target);
    const moment = scheduledMoment({ at, delay }, this.now());
    const record = {
      id: newId(),
      job,
      kind,
      target,
      args: args === undefined ? null : args,
      status: moment !== null && moment > this.now() ? 'scheduled' : 'running',
      scheduledFor: moment,
      cancelRequested: false,
      progress: null,
      log: [],
      result: null,
      error: null,
      startedAt: this.now(),
      finishedAt: null
    };
    if (record.status === 'scheduled') {
      await this.save(record);
      this.arm(record);
      return summarise(record);
    }
    return this.launch(record);
  }

  // Waits for a scheduled run's moment, then launches it. Long waits are armed in slices.
  arm(record) {
    const wait = Math.max(0, record.scheduledFor - this.now());
    const timer = this.setTimer(() => {
      this.scheduled.delete(record.id);
      if (record.scheduledFor > this.now()) {
        this.arm(record);
        return;
      }
      record.status = 'running';
      record.startedAt = this.now();
      this.launch(record).catch((err) => console.error(`[jobs] scheduled run ${record.id} failed to start: ${err.message}`));
    }, Math.min(wait, MAX_TIMER_MS));
    this.scheduled.set(record.id, { record, timer });
  }

  // Executes a run record that is due now.
  async launch(record) {
    const entry = { record, lastSaved: this.now(), cancelHooks: [] };
    this.live.set(record.id, entry);
    await this.save(record);

    const ctx = {
      id: record.id,
      get cancelled() {
        return record.cancelRequested;
      },
      // For the runner of the script: told when a cancel is requested, so a worker thread can
      // be reached. A script itself keeps reading job.cancelled.
      onCancel: (fn) => {
        entry.cancelHooks.push(fn);
      },
      setProgress: (value) => {
        record.progress = value;
        return this.touch(entry);
      },
      log: (message) => {
        record.log.push({ t: this.now(), message: String(message) });
        if (record.log.length > LOG_CAP) record.log.splice(0, record.log.length - LOG_CAP);
        return this.touch(entry);
      }
    };

    const { target, kind } = record;
    const execution = Promise.resolve()
      .then(async () => {
        if (kind !== 'workflow') return this.callServer(target, record.args === null ? [] : record.args, { job: ctx });
        const instance = await this.startWorkflow(target, record.args === null ? {} : record.args);
        await ctx.log(`started workflow ${target} as ${instance.id}`);
        return { instance: instance.id };
      })
      .then(
        (result) => {
          record.result = result === undefined ? null : result;
          record.status = record.cancelRequested ? 'cancelled' : 'completed';
        },
        (err) => {
          // A cancelled script often bails by throwing; the request is what the user asked for.
          record.status = record.cancelRequested ? 'cancelled' : 'failed';
          if (!record.cancelRequested) record.error = { message: err.message, stack: err.detail || err.stack };
        }
      )
      .then(async () => {
        record.finishedAt = this.now();
        await this.save(record).catch((err) => {
          console.error(`[jobs] failed to save run ${record.id}: ${err.message}`);
        });
        this.live.delete(record.id);
        this.running.delete(record.id);
        await this.prune().catch(() => {});
      });
    this.running.set(record.id, execution);

    return summarise(record);
  }

  // Cooperative: the script has to look at job.cancelled. A run that never looks simply finishes,
  // and the record then says cancelled to be honest about what was asked.
  async cancel(id) {
    const pending = this.scheduled.get(assertId(id));
    if (pending) {
      // Not started yet: it simply never will be.
      this.clearTimer(pending.timer);
      this.scheduled.delete(id);
      pending.record.status = 'cancelled';
      pending.record.finishedAt = this.now();
      await this.save(pending.record);
      return summarise(pending.record);
    }
    const entry = this.live.get(assertId(id));
    if (entry) {
      entry.record.cancelRequested = true;
      for (const hook of entry.cancelHooks) {
        try {
          hook();
        } catch (err) {
          console.error(`[jobs] cancel hook for ${id} failed: ${err.message}`);
        }
      }
      await this.save(entry.record).catch(() => {});
      return summarise(entry.record);
    }
    const record = await this.read(id);
    if (!record) return null;
    if (record.status === 'running') {
      // On disk as running but not live: the process that ran it is gone.
      record.status = 'interrupted';
      record.finishedAt = this.now();
      await this.save(record);
    }
    return summarise(record);
  }

  async read(id) {
    const entry = this.live.get(assertId(id));
    if (entry) return entry.record;
    const pending = this.scheduled.get(id);
    if (pending) return pending.record;
    let raw;
    try {
      raw = await fs.readFile(this.fileOf(id), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      return JSON.parse(raw);
    } catch (err) {
      const failure = new Error(`Job run "${id}" has an unreadable record: ${err.message}`);
      failure.status = 500;
      throw failure;
    }
  }

  async readAll() {
    let names;
    try {
      names = await fs.readdir(this.dir());
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const ids = names.filter((n) => n.endsWith('.json') && ID_RE.test(n.slice(0, -5))).map((n) => n.slice(0, -5));
    const loaded = await Promise.all(
      ids.map((id) =>
        this.read(id).catch((err) => {
          console.error(`[jobs] skipping unreadable run ${id}: ${err.message}`);
          return null;
        })
      )
    );
    return loaded.filter(Boolean);
  }

  async list({ job, status } = {}) {
    const all = await this.readAll();
    return all
      .filter((r) => (job ? r.job === job : true))
      .filter((r) => (status ? r.status === status : true))
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(summarise);
  }

  // The scheduler's overlap guard: is a run of this job still in flight?
  isJobRunning(name) {
    for (const entry of this.live.values()) {
      if (entry.record.job === name && entry.record.status === 'running') return true;
    }
    return false;
  }

  // The Jobs panel's clear button: drops every finished record, keeps anything in flight.
  async clearFinished() {
    let cleared = 0;
    for (const record of await this.readAll()) {
      if (!FINAL_STATUSES.has(record.status) || this.live.has(record.id)) continue;
      await fs.rm(this.fileOf(record.id), { force: true });
      cleared += 1;
    }
    return { cleared };
  }

  // Drops every armed timer; the records stay scheduled on disk for the next boot.
  stop() {
    for (const { timer } of this.scheduled.values()) this.clearTimer(timer);
    this.scheduled.clear();
  }

  async prune() {
    const finished = (await this.readAll())
      .filter((r) => FINAL_STATUSES.has(r.status))
      .sort((a, b) => b.startedAt - a.startedAt);
    for (const record of finished.slice(KEEP_FINISHED)) {
      await fs.rm(this.fileOf(record.id), { force: true });
    }
  }

  // A record still marked running at boot belonged to the previous process; the script it was
  // running is gone and cannot be resumed. A scheduled one is re-armed - overdue means now.
  async boot() {
    await this.ensureDirs();
    for (const record of await this.readAll()) {
      if (record.status === 'scheduled' && !this.scheduled.has(record.id)) {
        this.arm(record);
        continue;
      }
      if (record.status !== 'running' || this.live.has(record.id)) continue;
      record.status = 'interrupted';
      record.finishedAt = this.now();
      await this.save(record);
    }
    await this.prune().catch(() => {});
  }

  // Test hook: resolves when every in-flight run has settled.
  async settle() {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running.values()]);
    }
  }
}
