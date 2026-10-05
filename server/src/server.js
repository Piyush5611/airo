import { env } from './config/env.js';
import { pingDatabase } from './config/db.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { refreshAll } from './services/intelligenceService.js';
import { startAgentJobs } from './services/adsAgent/jobs.js';

const app = createApp();

async function start() {
  if (!env.isProd) {
    await migrate();
  }
  const up = await pingDatabase();
  if (!up) throw new Error('Database did not respond.');
  app.listen(env.port, () => {
    console.log(`AIRO API listening on ${env.port}`);
  });
  refreshAll().catch((error) => {
    console.error('Insight refresh skipped:', error.message);
  });
  startAgentJobs();
}

start().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
