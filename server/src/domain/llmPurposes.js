export const LLM_PURPOSES = [
  { key: 'assistant', label: 'Workspace assistant' },
  { key: 'whatsapp', label: 'WhatsApp replies' },
  { key: 'leads', label: 'Lead follow-up' },
  { key: 'ads', label: 'Ad writing' },
  { key: 'calls', label: 'Call summary' },
  { key: 'competitors', label: 'Competitor research' }
];

export function purposeLabel(key) {
  return LLM_PURPOSES.find((row) => row.key === key)?.label || key;
}
