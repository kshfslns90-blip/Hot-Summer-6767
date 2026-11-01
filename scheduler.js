// The job scheduler: one timer, armed for the nearest next-run across every enabled job - the
// same shape as the workflow engine's arm/wake. Fire times are kept on a schedule grid anchored
// at the last fire, and occurrences that went by while the server was down are skipped: on boot
// the grid just fast-forwards to the next future time. A short grace window makes a fire that
// arrives fractionally late (timer slop, a slow tick) still count as due instead of skipped.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import * as store from '../store.js';
import { parseDuration } from '../../public/workflow/nodes.js';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const GRACE = 30_000;
const MAX_TIMER = 2 ** 31 - 1;

export class Scheduler {
  constructor(deps = {}) {
    this.now = deps.now || Date.now;
    this.setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer || ((t) => clearTimeout(t));
    this.onFire = deps.onFire;
    this.isRunning = deps.isRunning || (() => false);
    this.timer = null;
    // refresh and wake both read jobs, read state, write state and re-arm; chaining them keeps a
    // save-edit racing a timer fire from interleaving those steps.
    this.op = Promise.resolve();
  }

  stateFile() {
    return path.join(config.runtimeDir, 'jobs', 'schedule.json');
  }

  async loadState() {
    try {
      return JSON.parse(await fs.readFile(this.stateFile(), 'utf8'));
    } catch {
      return {};
    }
  }

  async saveState(state) {
    await fs.mkdir(path.dirname(this.stateFile()), { recursive: true });
    await fs.writeFile(this.stateFile(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  async loadJobs() {
    const names = await store.list('jobs');
    const jobs = [];
    for (const name of names) {
      try {
        const { job } = await store.read('jobs', name);
        if (job && job.enabled && typeof job.target === 'string' && job.target) jobs.push(job);
      } catch (err) {
        console.error(`[jobs] skipping unreadable job "${name}": ${err.message}`);
      }
    }
    return jobs;
  }

  // The next occurrence on the job's grid after the last fire, skipping anything already more
  // than GRACE in the past. The result may sit inside the grace window - that means "due now".
  nextRunAt(job, lastFireAt, now = this.now()) {
    const schedule = job.schedule || {};

    if (schedule.kind === 'every') {
      const dur = parseDuration(schedule.every);
      if (!dur) return null;
      // A job that has never fired starts one period from now, so enabling it is not a fire.
      let candidate = (lastFireAt || now) + dur;
      while (candidate <= now - GRACE) candidate += dur;
      return candidate;
    }

    if (schedule.kind === 'daily') {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(schedule.at || ''));
      if (!match) return null;
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours > 23 || minutes > 59) return null;
      const days = new Set((Array.isArray(schedule.days) ? schedule.days : []).map((d) => String(d).toLowerCase()));

      const floor = Math.max(lastFireAt || 0, now - GRACE);
      const candidate = new Date(floor);
      candidate.setHours(hours, minutes, 0, 0);
      for (let i = 0; i < 9; i += 1) {
        const ts = candidate.getTime();
        if (ts > floor && (days.size === 0 || days.has(DAY_NAMES[candidate.getDay()]))) return ts;
        candidate.setDate(candidate.getDate() + 1);
      }
      return null;
    }

    return null;
  }

  // Re-read the jobs and re-arm the timer. Called at boot and after any edit to a job.
  refresh() {
    this.op = this.op.catch(() => {}).then(() => this.pass(false));
    return this.op;
  }

  wake() {
    this.op = this.op.catch(() => {}).then(() => this.pass(true));
    return this.op;
  }

  async pass(fire) {
    const jobs = await this.loadJobs();
    const state = await this.loadState();
    const now = this.now();
    let changed = false;
    let nearest = null;

    for (const job of jobs) {
      // A job that has never fired gets the moment it was first seen as its grid anchor;
      // without one, "one period from now" would move with the clock and never come due.
      if (state[job.name] === undefined) {
        state[job.name] = now;
        changed = true;
      }
      let at = this.nextRunAt(job, state[job.name], now);
      if (at === null) continue;
      if (fire && at <= now) {
        if (this.isRunning(job.name)) {
          console.log(`[jobs] ${job.name}: previous run still in flight, skipping this occurrence`);
        } else {
          try {
            await this.onFire(job);
          } catch (err) {
            console.error(`[jobs] ${job.name} failed to start: ${err.message}`);
          }
        }
        // The occurrence is consumed either way; the grid moves on from it, not from wall time.
        state[job.name] = at;
        changed = true;
        at = this.nextRunAt(job, at, now);
        if (at === null) continue;
      }
      if (nearest === null || at < nearest) nearest = at;
    }

    if (changed) await this.saveState(state);
    this.arm(nearest, now);
  }

  arm(at, now = this.now()) {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (at === null) return;
    const delay = Math.min(Math.max(at - now, 0), MAX_TIMER);
    // The callback hands its promise back so a fake-timer harness can await the whole pass.
    this.timer = this.setTimer(() => this.wake(), delay);
  }

  // For the editor's next-run preview: every enabled job's next fire time.
  async nextRuns() {
    const jobs = await this.loadJobs();
    const state = await this.loadState();
    const now = this.now();
    const result = {};
    for (const job of jobs) {
      const at = this.nextRunAt(job, state[job.name], now);
      if (at !== null) result[job.name] = at;
    }
    return result;
  }

  stop() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
