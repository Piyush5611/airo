import * as repo from '../../repositories/adsAgentRepo.js';
import { syncAll } from './metricsSync.js';

const TICK_MS = 10 * 60 * 1000;

export const JOBS = [
  {
    key: 'ads.metrics_sync',
    everyMinutes: 180,
    lockMinutes: 30,
    run: async () => {
      const result = await syncAll();
      return {
        summary: `${result.rows} rows from ${result.connections} ad accounts.`,
        error: result.notes.length ? result.notes.join(' | ') : null
      };
    }
  }
];

function utc(value) {
  if (!value) return null;
  const time = Date.parse(`${String(value).replace(' ', 'T')}Z`);
  return Number.isFinite(time) ? time : null;
}

export async function runJob(job) {
  if (!(await repo.claimJob(job.key, job.lockMinutes))) return { skipped: true };
  try {
    const result = await job.run();
    await repo.finishJob(job.key, { status: result.error ? 'partial' : 'ok', summary: result.summary, error: result.error });
    return result;
  } catch (error) {
    await repo.finishJob(job.key, { status: 'failed', error: error.message || 'Job failed.' });
    throw error;
  }
}

async function tick() {
  for (const job of JOBS) {
    try {
      const state = await repo.jobState(job.key);
      const finished = utc(state?.finishedAt);
      if (finished && Date.now() - finished < job.everyMinutes * 60 * 1000) continue;
      await runJob(job);
    } catch (error) {
      const code = error?.cause?.code || error?.code;
      if (code === 'ER_NO_SUCH_TABLE') return;
      console.error(`Job ${job.key} failed:`, error.message);
    }
  }
}

export function startAgentJobs() {
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, TICK_MS).unref();
}
