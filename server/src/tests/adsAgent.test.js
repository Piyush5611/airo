import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAction, normalizeSettings } from '../services/adsAgent/guardrails.js';
import { modelJson } from '../utils/modelJson.js';

const auto = { mode: 'auto', maxBudgetChangePct: 20, maxActionsPerDay: 5, dailySpendCap: 5000, monthlySpendCap: 100000, killSwitch: 0 };

test('missing settings fall back to recommend mode', () => {
  const settings = normalizeSettings(null);
  assert.equal(settings.mode, 'recommend');
  assert.equal(settings.killSwitch, false);
  const result = checkAction({ type: 'pause' }, { settings: null });
  assert.equal(result.allowed, true);
  assert.equal(result.applyNow, false);
  assert.equal(result.recommendOnly, true);
});

test('kill switch and off mode block every action', () => {
  assert.equal(checkAction({ type: 'pause' }, { settings: { ...auto, killSwitch: 1 } }).allowed, false);
  assert.equal(checkAction({ type: 'pause' }, { settings: { ...auto, mode: 'off' } }).allowed, false);
});

test('budget change above the limit is blocked', () => {
  const result = checkAction({ type: 'budget', currentBudget: 1000, newBudget: 1300 }, { settings: auto });
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(' '), /30%/);
  assert.equal(checkAction({ type: 'budget', currentBudget: 1000, newBudget: 1200 }, { settings: auto }).applyNow, true);
  assert.equal(checkAction({ type: 'budget', currentBudget: 1000, newBudget: 800 }, { settings: auto }).allowed, true);
});

test('spend caps block increases and resumes but never pauses', () => {
  const context = { settings: auto, spendToday: 5000 };
  assert.equal(checkAction({ type: 'budget', currentBudget: 1000, newBudget: 1100 }, context).allowed, false);
  assert.equal(checkAction({ type: 'resume' }, context).allowed, false);
  assert.equal(checkAction({ type: 'pause' }, context).allowed, true);
  assert.equal(checkAction({ type: 'resume' }, { settings: auto, spendMonth: 100000 }).allowed, false);
  assert.equal(checkAction({ type: 'budget', currentBudget: 4500, newBudget: 5400 }, { settings: auto }).allowed, false);
});

test('daily action limit and approve mode', () => {
  assert.equal(checkAction({ type: 'pause' }, { settings: auto, actionsToday: 5 }).allowed, false);
  const approve = checkAction({ type: 'pause' }, { settings: { ...auto, mode: 'approve' } });
  assert.equal(approve.needsApproval, true);
  assert.equal(approve.applyNow, false);
  assert.equal(checkAction({ type: 'delete' }, { settings: auto }).allowed, false);
  assert.equal(checkAction({ type: 'budget', currentBudget: 0, newBudget: 100 }, { settings: auto }).allowed, false);
});

test('model JSON is read from fenced or padded replies', () => {
  assert.deepEqual(modelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(modelJson('Here it is: {"a":{"b":2}} thanks'), { a: { b: 2 } });
  assert.equal(modelJson('no json here'), null);
  assert.equal(modelJson('{"a":'), null);
});
