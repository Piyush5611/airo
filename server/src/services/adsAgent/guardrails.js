export const MODES = ['off', 'recommend', 'approve', 'auto'];

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'recommend',
  dailySpendCap: null,
  monthlySpendCap: null,
  maxBudgetChangePct: 20,
  maxActionsPerDay: 5,
  minSpendForDecision: 500,
  killSwitch: false
});

function amount(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeSettings(row) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    mode: MODES.includes(row.mode) ? row.mode : DEFAULT_SETTINGS.mode,
    dailySpendCap: amount(row.dailySpendCap),
    monthlySpendCap: amount(row.monthlySpendCap),
    maxBudgetChangePct: amount(row.maxBudgetChangePct) ?? DEFAULT_SETTINGS.maxBudgetChangePct,
    maxActionsPerDay: amount(row.maxActionsPerDay) ?? DEFAULT_SETTINGS.maxActionsPerDay,
    minSpendForDecision: amount(row.minSpendForDecision) ?? DEFAULT_SETTINGS.minSpendForDecision,
    killSwitch: Boolean(Number(row.killSwitch))
  };
}

// Owner-approved launches skip the agent mode and action count, but still respect the kill switch and spend caps.
export function checkLaunch({ dailyBudget, settings, spendToday = 0, spendMonth = 0 }) {
  const rules = normalizeSettings(settings);
  const reasons = [];
  const budget = amount(dailyBudget);
  if (!(budget > 0)) reasons.push('Set a daily budget.');
  if (rules.killSwitch) reasons.push('Kill switch is on. Turn it off in guardrails first.');
  if (budget > 0 && rules.dailySpendCap != null && budget > rules.dailySpendCap) {
    reasons.push(`Daily budget ${budget} is above the daily spend cap (${rules.dailySpendCap}).`);
  }
  if (rules.dailySpendCap != null && spendToday >= rules.dailySpendCap) reasons.push('Daily spend cap already reached today.');
  if (rules.monthlySpendCap != null && spendMonth >= rules.monthlySpendCap) reasons.push('Monthly spend cap already reached.');
  return { allowed: reasons.length === 0, reasons };
}

// Pausing lowers spend, so caps never block it. Anything that can raise spend is checked against every cap.
export function checkAction(action, { settings, actionsToday = 0, spendToday = 0, spendMonth = 0 }) {
  const rules = normalizeSettings(settings);
  const reasons = [];
  const type = action?.type;
  if (!['pause', 'resume', 'budget'].includes(type)) reasons.push('Unknown action.');
  if (rules.killSwitch) reasons.push('Kill switch is on.');
  if (rules.mode === 'off') reasons.push('Agent is off.');
  if (actionsToday >= rules.maxActionsPerDay) reasons.push(`Daily action limit reached (${rules.maxActionsPerDay}).`);

  let raisesSpend = type === 'resume';
  if (type === 'budget') {
    const current = amount(action.currentBudget);
    const next = amount(action.newBudget);
    if (!(current > 0) || !(next > 0)) {
      reasons.push('Budget must be a positive amount.');
    } else {
      const change = Math.abs(next - current) / current * 100;
      if (change > rules.maxBudgetChangePct + 1e-9) {
        reasons.push(`Budget change ${Math.round(change)}% is above the ${rules.maxBudgetChangePct}% limit.`);
      }
      raisesSpend = next > current;
      if (raisesSpend && rules.dailySpendCap != null && next > rules.dailySpendCap) {
        reasons.push(`New budget is above the daily cap (${rules.dailySpendCap}).`);
      }
    }
  }
  if (raisesSpend) {
    if (rules.dailySpendCap != null && spendToday >= rules.dailySpendCap) reasons.push('Daily spend cap already reached.');
    if (rules.monthlySpendCap != null && spendMonth >= rules.monthlySpendCap) reasons.push('Monthly spend cap already reached.');
  }

  const allowed = reasons.length === 0;
  return {
    allowed,
    reasons,
    applyNow: allowed && rules.mode === 'auto',
    needsApproval: allowed && rules.mode === 'approve',
    recommendOnly: allowed && rules.mode === 'recommend'
  };
}
