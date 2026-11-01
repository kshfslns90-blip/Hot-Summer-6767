// Workflow instances are the running state, not the design, so they live under runtimeDir rather
// than in the data folder you version. One file per instance, rewritten at every checkpoint.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

const ID_RE = /^wf_[0-9a-f]{12}$/;

export const ACTIVE = 'active';
export const DONE = 'completed';

// An instance that has finished is moved aside, so the folder the scheduler scans on boot only
// ever holds work that is still live.
export const FINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function dirOf(bucket) {
  return path.join(config.runtimeDir, 'workflows', bucket);
}

export function newId() {
  return `wf_${crypto.randomBytes(6).toString('hex')}`;
}

export function assertId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    const err = new Error(`Invalid workflow instance id "${id}".`);
    err.status = 400;
    throw err;
  }
  return id;
}

export async function ensureDirs() {
  await fs.mkdir(dirOf(ACTIVE), { recursive: true });
  await fs.mkdir(dirOf(DONE), { recursive: true });
}

function fileOf(bucket, id) {
  return path.join(dirOf(bucket), `${assertId(id)}.json`);
}

export function create(workflow, args, { debug = false, parent = null, now = Date.now() } = {}) {
  return {
    id: newId(),
    workflow,
    seq: 0,
    status: 'running',
    debug,
    parent,
    args: args === undefined ? {} : args,
    vars: {},
    tokens: [],
    nodeStates: {},
    waiting: null,
    result: undefined,
    error: null,
    log: [],
    startedAt: now,
    updatedAt: now,
    finishedAt: null
  };
}

async function readFrom(bucket, id) {
  let raw;
  try {
    raw = await fs.readFile(fileOf(bucket, id), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    // A checkpoint torn by a crash mid-write: say so rather than pretending it is missing.
    const failure = new Error(`Workflow instance "${id}" has an unreadable checkpoint: ${err.message}`);
    failure.status = 500;
    throw failure;
  }
}

// The finished copy wins: a crash between writing it and removing the active one must not bring
// a completed run back as running.
export async function read(id) {
  return (await readFrom(DONE, id)) || (await readFrom(ACTIVE, id));
}

// Writing is atomic: a crash mid-save must not leave a half-written checkpoint behind. Saves of
// one instance are also chained, so two checkpoints in flight cannot trip over each other.
const writing = new Map();
let tempSeq = 0;

export async function save(instance) {
  const previous = writing.get(instance.id) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => writeOnce(instance));
  writing.set(instance.id, next);
  try {
    return await next;
  } finally {
    if (writing.get(instance.id) === next) writing.delete(instance.id);
  }
}

// Write to a temp file and rename it into place, so a reader never sees a half-written
// checkpoint. Windows can refuse the rename while the destination still has a handle open, which
// is momentary, so it is retried rather than treated as fatal.
// A workflow variable can end up holding a cyclic object; that must degrade the checkpoint, not
// sink it - an unsaveable instance would be stuck forever. The fallback replaces repeated
// references with a marker.
function serialise(instance) {
  try {
    return JSON.stringify(instance, null, 2);
  } catch {
    // Only a true cycle is replaced: the same object reached twice by different paths is fine.
    const ancestors = [];
    return JSON.stringify(
      instance,
      function replacer(key, value) {
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
        if (typeof value === 'object' && value !== null) {
          if (ancestors.includes(value)) return '[circular]';
          ancestors.push(value);
        }
        return value;
      },
      2
    );
  }
}

async function writeOnce(instance) {
  await ensureDirs();
  const bucket = FINAL_STATUSES.has(instance.status) ? DONE : ACTIVE;
  const target = fileOf(bucket, instance.id);
  const temp = `${target}.${(tempSeq += 1)}.tmp`;

  await fs.writeFile(temp, `${serialise(instance)}\n`, 'utf8');
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temp, target);
      break;
    } catch (err) {
      if (attempt >= 5 || (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'EBUSY')) {
        await fs.rm(temp, { force: true });
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  if (bucket === DONE) await fs.rm(fileOf(ACTIVE, instance.id), { force: true });
  return instance;
}

export async function remove(id) {
  await fs.rm(fileOf(ACTIVE, id), { force: true });
  await fs.rm(fileOf(DONE, id), { force: true });
}

async function listBucket(bucket) {
  let names;
  try {
    names = await fs.readdir(dirOf(bucket));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const ids = names
    .filter((n) => n.endsWith('.json') && ID_RE.test(n.slice(0, -5)))
    .map((n) => n.slice(0, -5));
  const loaded = await Promise.all(
    ids.map((id) =>
      readFrom(bucket, id).catch((err) => {
        console.error(`[workflow] skipping unreadable instance ${id}: ${err.message}`);
        return null;
      })
    )
  );
  return loaded.filter(Boolean);
}

// An id present in both buckets is a run that finished but whose active copy was not removed
// (a crash in between): the finished record is the truth, and the stale copy is cleaned up.
export async function listActive() {
  const active = await listBucket(ACTIVE);
  let finished;
  try {
    finished = new Set((await fs.readdir(dirOf(DONE))).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    finished = new Set();
  }
  const out = [];
  for (const instance of active) {
    if (finished.has(instance.id)) {
      await fs.rm(fileOf(ACTIVE, instance.id), { force: true });
      continue;
    }
    out.push(instance);
  }
  return out;
}

// The Instances panel's clear button: finished instances all live in the completed bucket, so
// clearing history never touches anything still running.
export async function clearFinished() {
  let names = [];
  try {
    names = await fs.readdir(dirOf(DONE));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let cleared = 0;
  for (const name of names) {
    if (!name.endsWith('.json') || !ID_RE.test(name.slice(0, -5))) continue;
    await fs.rm(path.join(dirOf(DONE), name), { force: true });
    cleared += 1;
  }
  return { cleared };
}

// The panel wants a summary, never the whole log of every instance.
export function summarise(instance) {
  return {
    id: instance.id,
    workflow: instance.workflow,
    status: instance.status,
    debug: instance.debug,
    waiting: instance.waiting,
    startedAt: instance.startedAt,
    updatedAt: instance.updatedAt,
    finishedAt: instance.finishedAt,
    error: instance.error ? { node: instance.error.node, message: instance.error.message } : null
  };
}

export async function list({ workflow, status } = {}) {
  const finished = await listBucket(DONE);
  const done = new Set(finished.map((i) => i.id));
  const all = [...(await listBucket(ACTIVE)).filter((i) => !done.has(i.id)), ...finished];
  return all
    .filter((i) => (workflow ? i.workflow === workflow : true))
    .filter((i) => (status ? i.status === status : true))
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(summarise);
}
