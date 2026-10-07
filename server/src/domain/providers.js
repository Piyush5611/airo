/**
 * External systems are providers inside Connections.
 * They are not AIRO modules.
 *
 * Connections → category → provider → connector → normalized AIRO records.
 */
export const PROVIDERS = [
  ['advertising', 'google_ads', 'Google Ads', 'Search and performance campaigns, spend, and lead forms.'],
  ['advertising', 'meta_ads', 'Meta Ads', 'Paid social campaigns and lead ads across Meta placements.'],
  ['advertising', 'linkedin_ads', 'LinkedIn Ads', 'Professional audience campaigns and lead gen forms.'],
  ['advertising', 'other_ads', 'Other Ad Networks', 'Additional advertising accounts mapped into campaigns and spend.'],
  ['portals', 'magicbricks', 'MagicBricks', 'Portal enquiries normalized into AIRO leads and sources.'],
  ['portals', '99acres', '99acres', 'Project and listing enquiries from 99acres.'],
  ['portals', 'housing', 'Housing.com', 'Housing.com enquiries and listing responses.'],
  ['portals', 'nobroker', 'NoBroker', 'NoBroker owner and project enquiries.'],
  ['portals', 'other_portals', 'Other Property Portals', 'Any other property portal mapped through the same connector.'],
  ['communication', 'whatsapp', 'WhatsApp', 'The shared AIRO chatbot. Businesses work in that conversation. Super Admin and Developer/Admin manage the bot.'],
  ['communication', 'email', 'Email', 'Inbound email enquiries and outbound follow-up.'],
  ['communication', 'sms', 'SMS', 'SMS notifications and reply capture.'],
  ['calling', 'nexcall', 'Call Yatri', 'Read-only pull of Call Yatri leads, calls, the call report, and follow-ups. Authenticate with x-api-key.'],
  ['calling', 'other_telephony', 'Other Telephony Providers', 'Alternate calling systems using the same call model.'],
  ['crm', 'salesforce', 'Salesforce', 'CRM accounts and opportunities mapped into the AIRO pipeline.'],
  ['crm', 'hubspot', 'HubSpot', 'HubSpot contacts and deals mapped into leads and pipeline.'],
  ['crm', 'other_crms', 'Other CRMs', 'Additional CRM systems through the provider adapter.'],
  ['analytics', 'google_analytics', 'Google Analytics', 'Site behaviour used as context for campaign and source quality.'],
  ['analytics', 'google_tag_manager', 'Google Tag Manager', 'Tag and conversion container health.'],
  ['analytics', 'other_analytics', 'Other Analytics', 'Additional analytics sources.'],  ['developer', 'api', 'API', 'Organization API access into the AIRO domain model.'],
  ['developer', 'webhooks', 'Webhooks', 'Outbound events for leads, calls, and sync health.'],
  ['developer', 'oauth', 'OAuth', 'OAuth clients for custom workspace applications.'],
  ['developer', 'custom', 'Custom Integration', 'A custom connector that still normalizes into AIRO records.']
].map(([category, key, name, description]) => ({ category, key, name, description }));

export const CATEGORIES = [
  { key: 'advertising', name: 'Advertising', purpose: 'Spend, campaigns, and paid leads.' },
  { key: 'portals', name: 'Real Estate Portals', purpose: 'Portal enquiries turned into leads.' },
  { key: 'communication', name: 'Communication', purpose: 'WhatsApp, email, and SMS.' },
  { key: 'calling', name: 'Calling', purpose: 'Calls, recordings, and transcripts.' },
  { key: 'crm', name: 'CRM', purpose: 'External pipeline context.' },
  { key: 'analytics', name: 'Analytics', purpose: 'Site and conversion context.' },  { key: 'developer', name: 'Developer / API', purpose: 'API, webhooks, and custom connectors.' }
];
