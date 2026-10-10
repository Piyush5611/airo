import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokensOf } from '../integrations/llm.js';
import { fillDays } from '../services/usageService.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('tokensOf reads each provider usage block', () => {
  assert.deepEqual(tokensOf('openai', { usage: { prompt_tokens: 120, completion_tokens: 30 } }), { input: 120, output: 30 });
  assert.deepEqual(tokensOf('anthropic', { usage: { input_tokens: 90, output_tokens: 15 } }), { input: 90, output: 15 });
  assert.deepEqual(tokensOf('gemini', { usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 } }), { input: 200, output: 50 });
  assert.deepEqual(tokensOf('gemini', {}), { input: undefined, output: 0 });
});

test('fillDays returns every day in the window with zeros for quiet days', () => {
  const now = new Date('2026-10-10T08:00:00Z');
  const days = fillDays([{ day: '2026-10-09', calls: 4, inputTokens: 1000, outputTokens: 200 }], 3, now);
  assert.deepEqual(days.map((row) => row.day), ['2026-10-08', '2026-10-09', '2026-10-10']);
  assert.equal(days[0].calls, 0);
  assert.equal(days[1].calls, 4);
  assert.equal(days[1].inputTokens, 1000);
});

test('every model and Apify call goes through the usage recorder', () => {
  const llm = fs.readFileSync(path.join(here, '../integrations/llm.js'), 'utf8');
  assert.match(llm, /async function completeLlm\(options\) \{\s+return track\(/);
  const apify = fs.readFileSync(path.join(here, '../integrations/apify.js'), 'utf8');
  assert.equal((apify.match(/runActorOnce\(/g) || []).length, 2);
  const service = fs.readFileSync(path.join(here, '../services/llmService.js'), 'utf8');
  const calls = service.split('replyLlm({').length - 1;
  const tagged = (service.match(/usage: \{ purpose:/g) || []).length;
  assert.equal(tagged, calls);
});

test('the usage page needs a platform permission', () => {
  const routes = fs.readFileSync(path.join(here, '../routes/index.js'), 'utf8');
  assert.match(routes, /admin\.get\('\/usage', requirePermission\('platform_ai\.view'\)/);
});
