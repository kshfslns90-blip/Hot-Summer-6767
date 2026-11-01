// The one Runs registry and the one Scheduler this server process owns, wired together here the
// way server/workflow/index.js wires its engine.
import { Runs } from './runs.js';
import { Scheduler } from './scheduler.js';
import { runInWorker } from './worker-pool.js';
import { startWorkflow } from '../workflow/index.js';
import * as store from '../store.js';
import { StoreError } from '../store.js';

// Script runs - runBackground and scheduled jobs alike - execute on worker threads, so a long
// computation never blocks the server.
export const runs = new Runs({ callServer: runInWorker, startWorkflow });

// A job's kind: "script" (the default, so older job files keep working) or "workflow".
function kindOf(job) {
  return job.kind === 'workflow' ? 'workflow' : 'script';
}

export const scheduler = new Scheduler({
  onFire: (job) => runs.start(job.target, job.args, { job: job.name, kind: kindOf(job) }),
  isRunning: (name) => runs.isJobRunning(name)
});

// Run a defined job immediately - the Run Now button and POST /jobs/:name/run.
export async function runJob(name) {
  const { job } = await store.read('jobs', name);
  if (!job.target) throw new StoreError(`Job "${name}" names no ${kindOf(job) === 'workflow' ? 'workflow' : 'script'} yet.`);
  return runs.start(job.target, job.args, { job: name, kind: kindOf(job) });
}

export async function boot() {
  await runs.boot();
  await scheduler.refresh();
}
