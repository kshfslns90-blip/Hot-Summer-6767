// The worker-thread side of a background script run. One thread per run: the pool starts it
// with the run in workerData, this file executes the script through the ordinary runner and
// posts the outcome back. The database is reached directly (node:sqlite opens its own
// connection here); the workflow engine and the job runs registry live on the main thread only,
// so those built-ins become message round-trips.
import { parentPort, workerData } from 'node:worker_threads';
import { callServer, setServices, SERVICE_NAMES } from '../runner.js';
import { setSink, useConsoleBudget } from '../console-log.js';

const pending = new Map();
let seq = 0;

function post(message) {
  parentPort.postMessage(message);
}

function rpc(name, args) {
  return new Promise((resolve, reject) => {
    const id = (seq += 1);
    pending.set(id, { resolve, reject });
    try {
      post({ type: 'rpc', id, name, args });
    } catch (err) {
      pending.delete(id);
      reject(new Error(`The arguments of ${name} cannot be sent to the server thread: ${err.message}`));
    }
  });
}

setServices(Object.fromEntries(SERVICE_NAMES.map((name) => [name, (...args) => rpc(name, args)])));
// What the script prints goes to the main thread's console buffer, the way job.log travels,
// within the runner's budgets, which all its threads share.
setSink((entry) => post({ type: 'console', entry }));
if (workerData.consoleBudget) useConsoleBudget(workerData.consoleBudget);

parentPort.on('message', (msg) => {
  if (msg.type !== 'rpc-result') return;
  const waiter = pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  if (msg.error) {
    const err = new Error(msg.error.message);
    if (msg.error.status) err.status = msg.error.status;
    if (msg.error.detail) err.detail = msg.error.detail;
    waiter.reject(err);
  } else waiter.resolve(msg.result);
});

// The `job` global of a background run. The cancel flag is shared memory, so a loop that never
// yields still sees it; log and progress are fire-and-forget messages to the record's owner.
function jobHandle(spec) {
  const flag = spec.flag;
  return {
    id: spec.id,
    get cancelled() {
      return Atomics.load(flag, 0) !== 0;
    },
    log(message) {
      post({ type: 'log', message: String(message) });
      return Promise.resolve();
    },
    setProgress(value) {
      try {
        post({ type: 'progress', value });
      } catch (err) {
        return Promise.reject(new Error(`Progress cannot be reported from a worker: ${err.message}`));
      }
      return Promise.resolve();
    }
  };
}

async function main() {
  const { target, args, job } = workerData;
  const extras = job ? { job: jobHandle(job) } : {};
  let result;
  try {
    result = await callServer(target, args, extras);
  } catch (err) {
    post({ type: 'error', message: err.message, status: err.status || 500, stack: err.detail || err.stack });
    return;
  }
  try {
    post({ type: 'done', result: result === undefined ? null : result });
  } catch (err) {
    post({ type: 'error', message: `The script's result cannot be returned from a worker thread: ${err.message}`, status: 500 });
  }
}

main();
