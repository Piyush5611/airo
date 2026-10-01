/**
 * Development adapters.
 * They do not call Google, Meta, MagicBricks, 99acres, or any other live API.
 * A live adapter can replace `pull` later and must return the same shape.
 */

function pack(providerKey, accountName, extras = []) {
  return {
    mode: 'development',
    providerKey,
    summary: `Development adapter refreshed ${accountName}. No live provider API was called.`,
    objects: [
      { type: 'account', externalId: `${providerKey}-account`, name: accountName },
      ...extras
    ]
  };
}

export const adapters = {
  google_ads: {
    pull(connection) {
      return pack('google_ads', connection.accountLabel || 'Google Ads', [
        { type: 'campaign', externalId: 'g-camp-sector62', name: 'Search — Sector 62 Residences', project: 'Sector 62', parent: 'google_ads-account' },
        { type: 'ad_group', externalId: 'g-ag-62-3bhk', name: '3 BHK — Sector 62', parent: 'g-camp-sector62' },
        { type: 'ad', externalId: 'g-ad-62-ready', name: 'Ready inventory on the Noida corridor', parent: 'g-ag-62-3bhk' }
      ]);
    }
  },
  meta_ads: {
    pull(connection) {
      return pack('meta_ads', connection.accountLabel || 'Meta Ads', [
        { type: 'campaign', externalId: 'm-camp-nex', name: 'Meta — Noida Extension Launch', project: 'Noida Extension', parent: 'meta_ads-account' },
        { type: 'ad', externalId: 'm-ad-nex-lead', name: 'Lead ad — 2 and 3 BHK launch', parent: 'm-camp-nex' }
      ]);
    }
  },
  magicbricks: {
    pull(connection) {
      return pack('magicbricks', connection.accountLabel || 'MagicBricks', [
        { type: 'listing', externalId: 'mb-gurugram', name: 'Gurugram inventory', parent: 'magicbricks-account' }
      ]);
    }
  },
  '99acres': {
    pull(connection) {
      return pack('99acres', connection.accountLabel || '99acres', [
        { type: 'listing', externalId: 'ac-dwarka', name: 'Dwarka Expressway projects', parent: '99acres-account' }
      ]);
    }
  },
  linkedin_ads: {
    pull(connection) {
      return pack('linkedin_ads', connection.accountLabel || 'LinkedIn Ads', [
        { type: 'campaign', externalId: 'li-camp-sample', name: 'LinkedIn — sample campaign', project: 'Not specified', parent: 'linkedin_ads-account' }
      ]);
    }
  },
  other_ads: {
    pull(connection) {
      return pack('other_ads', connection.accountLabel || 'Other Ad Networks', [
        { type: 'campaign', externalId: 'oa-camp-sample', name: 'Other ads — sample campaign', project: 'Not specified', parent: 'other_ads-account' }
      ]);
    }
  }
};

export function getAdapter(providerKey) {
  return adapters[providerKey] || {
    pull(connection) {
      return pack(providerKey, connection.accountLabel || providerKey);
    }
  };
}
