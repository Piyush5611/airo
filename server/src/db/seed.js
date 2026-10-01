import bcrypt from 'bcryptjs';
import { adminConnection } from '../config/db.js';
import { env } from '../config/env.js';
import { migrate } from './migrate.js';
import { CLIENT_ROLES, PLATFORM_ROLES, grantsFor, permissionRecords } from '../domain/access.js';
import { PROVIDERS } from '../domain/providers.js';
import { encryptJson } from '../utils/cryptoBox.js';
import { refreshAll } from '../services/intelligenceService.js';
import { pool } from '../config/db.js';

function utc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function daysAgo(days, hour = 9) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 20, 0, 0);
  return date;
}

function dayStamp(days) {
  return daysAgo(days).toISOString().slice(0, 10);
}

async function insert(conn, table, row) {
  const keys = Object.keys(row);
  const [result] = await conn.query(
    `INSERT INTO \`${table}\` (${keys.map((key) => `\`${key}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    keys.map((key) => (row[key] === undefined ? null : row[key]))
  );
  return result.insertId;
}

async function seed() {
  await migrate();
  const conn = await adminConnection();
  await conn.query(`USE \`${env.db.name}\``);
  const [tables] = await conn.query(
    `SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
    [env.db.name]
  );
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  for (const table of tables) {
    const name = table.tableName || table.TABLE_NAME || table.table_name;
    if (!/^[A-Za-z0-9_]+$/.test(name) || name === 'schema_migrations') continue;
    await conn.query(`TRUNCATE TABLE \`${name}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1');

  const passwordHash = await bcrypt.hash(env.seedPassword, 12);
  const roleIds = {};
  for (const scope of ['client', 'platform']) {
    const roles = scope === 'client' ? CLIENT_ROLES : PLATFORM_ROLES;
    for (const [roleKey, role] of Object.entries(roles)) {
      roleIds[`${scope}:${roleKey}`] = await insert(conn, 'roles', {
        scope,
        role_key: roleKey,
        name: role.name,
        description: `${role.name} system role`,
        is_system: 1
      });
    }
    const permIds = {};
    for (const permission of permissionRecords(scope)) {
      permIds[permission.key] = await insert(conn, 'permissions', {
        scope,
        perm_key: permission.key,
        resource_name: permission.resource,
        action_name: permission.action,
        description: permission.description
      });
    }
    for (const roleKey of Object.keys(roles)) {
      for (const key of grantsFor(scope, roleKey)) {
        await insert(conn, 'role_permissions', {
          role_id: roleIds[`${scope}:${roleKey}`],
          permission_id: permIds[key]
        });
      }
    }
  }

  const planOperating = await insert(conn, 'plans', {
    plan_key: 'operating', name: 'Operating', monthly_inr: 125000,
    description: 'Command center, growth, sales, and connections for one workspace.'
  });
  const planIntelligence = await insert(conn, 'plans', {
    plan_key: 'intelligence', name: 'Intelligence', monthly_inr: 75000,
    description: 'Lead, campaign, and pipeline intelligence for a smaller desk.'
  });
  await insert(conn, 'plans', {
    plan_key: 'enterprise', name: 'Enterprise', monthly_inr: 250000,
    description: 'Multiple workspaces, support access, and advanced audit.'
  });

  const prestige = await insert(conn, 'organizations', {
    name: 'Prestige Homes', legal_name: 'Prestige Homes NCR Pvt Ltd', slug: 'prestige-homes',
    city: 'Noida', status: 'active', health_score: 76, onboarding_step: 'live'
  });
  const aurelia = await insert(conn, 'organizations', {
    name: 'Aurelia Estates', legal_name: 'Aurelia Estates LLP', slug: 'aurelia-estates',
    city: 'New Delhi', status: 'active', health_score: 84, onboarding_step: 'live'
  });
  const prestigeWs = await insert(conn, 'workspaces', { organization_id: prestige, name: 'NCR Workspace', slug: 'ncr', is_default: 1 });
  const aureliaWs = await insert(conn, 'workspaces', { organization_id: aurelia, name: 'Delhi Workspace', slug: 'delhi', is_default: 1 });

  await insert(conn, 'subscriptions', { organization_id: prestige, plan_id: planOperating, status: 'active', current_period_end: dayStamp(-20).slice(0, 10) });
  await insert(conn, 'subscriptions', { organization_id: aurelia, plan_id: planIntelligence, status: 'active', current_period_end: dayStamp(-12).slice(0, 10) });

  const periodFix = dayStamp(-20);
  await conn.query(`UPDATE subscriptions SET current_period_end = DATE_ADD(UTC_DATE(), INTERVAL 18 DAY) WHERE organization_id = ?`, [prestige]);
  await conn.query(`UPDATE subscriptions SET current_period_end = DATE_ADD(UTC_DATE(), INTERVAL 11 DAY) WHERE organization_id = ?`, [aurelia]);
  void periodFix;

  const users = {};
  async function addUser({ key, email, name, phone, realm, role, organizationId }) {
    const id = await insert(conn, 'users', {
      email, password_hash: passwordHash, full_name: name, phone: phone || null, realm, status: 'active',
      last_login_at: utc(daysAgo(1, 11))
    });
    users[key] = id;
    if (realm === 'platform') {
      await insert(conn, 'user_roles', { user_id: id, role_id: roleIds[`platform:${role}`], organization_id: null });
    } else {
      await insert(conn, 'organization_users', {
        organization_id: organizationId, user_id: id, role_id: roleIds[`client:${role}`], status: 'active'
      });
      await insert(conn, 'user_roles', { user_id: id, role_id: roleIds[`client:${role}`], organization_id: organizationId });
    }
    return id;
  }

  await addUser({ key: 'arjun', email: 'arjun.mehta@airo.internal', name: 'Arjun Mehta', realm: 'platform', role: 'super_admin' });
  await addUser({ key: 'neha', email: 'neha.kapoor@airo.internal', name: 'Neha Kapoor', realm: 'platform', role: 'operations_admin' });
  await addUser({ key: 'sameer', email: 'sameer.qureshi@airo.internal', name: 'Sameer Qureshi', realm: 'platform', role: 'support_admin' });
  await addUser({ key: 'sales', email: 'sales.iyer@airo.internal', name: 'Lakshmi Iyer', realm: 'platform', role: 'sales_admin' });
  await addUser({ key: 'isha', email: 'isha.bansal@airo.internal', name: 'Isha Bansal', realm: 'platform', role: 'finance_admin' });
  await addUser({ key: 'mod', email: 'moderation.das@airo.internal', name: 'Anil Das', realm: 'platform', role: 'moderation' });
  await addUser({ key: 'analyst', email: 'analyst.sen@airo.internal', name: 'Ritika Sen', realm: 'platform', role: 'analyst' });
  await addUser({ key: 'dev', email: 'dev.rao@airo.internal', name: 'Dev Rao', realm: 'platform', role: 'developer_admin' });
  await addUser({ key: 'rahul', email: 'rahul.sharma@prestigehomes.in', name: 'Rahul Sharma', phone: '9810011122', realm: 'client', role: 'owner', organizationId: prestige });
  await addUser({ key: 'meera', email: 'meera.nair@prestigehomes.in', name: 'Meera Nair', phone: '9810011133', realm: 'client', role: 'admin', organizationId: prestige });
  await addUser({ key: 'kabir', email: 'kabir.malhotra@prestigehomes.in', name: 'Kabir Malhotra', phone: '9810011144', realm: 'client', role: 'member', organizationId: prestige });
  await addUser({ key: 'ananya', email: 'ananya.gupta@prestigehomes.in', name: 'Ananya Gupta', phone: '9810011155', realm: 'client', role: 'viewer', organizationId: prestige });
  await addUser({ key: 'vikram', email: 'vikram.singh@aureliaestates.in', name: 'Vikram Singh', phone: '9810099001', realm: 'client', role: 'owner', organizationId: aurelia });

  const salesTeam = await insert(conn, 'teams', { organization_id: prestige, name: 'Sales', description: 'Site visits and closures for NCR projects.' });
  await insert(conn, 'teams', { organization_id: prestige, name: 'Marketing', description: 'Campaigns, portals, and lead quality.' });
  await insert(conn, 'team_members', { team_id: salesTeam, user_id: users.kabir });
  await insert(conn, 'team_members', { team_id: salesTeam, user_id: users.meera });
  await insert(conn, 'data_scopes', { organization_id: prestige, user_id: users.kabir, resource_name: 'leads', scope_type: 'assigned' });

  for (const provider of PROVIDERS) {
    await insert(conn, 'integration_providers', {
      category: provider.category, provider_key: provider.key, name: provider.name, description: provider.description, availability: 'available'
    });
  }
  const [providerRows] = await conn.query(`SELECT id, provider_key AS providerKey FROM integration_providers`);
  const providerId = Object.fromEntries(providerRows.map((row) => [row.providerKey || row.provider_key, row.id]));
  if (!providerId.google_ads) throw new Error('Provider registry did not seed.');

  async function connectOrg(organizationId, providerKey, status, accountLabel) {
    const id = await insert(conn, 'integration_connections', {
      organization_id: organizationId,
      provider_id: providerId[providerKey],
      status,
      account_label: accountLabel,
      mode: 'development',
      connected_at: utc(daysAgo(40)),
      last_sync_at: status === 'error' ? utc(daysAgo(3, 6)) : utc(daysAgo(0, 6))
    });
    await insert(conn, 'integration_credentials', {
      connection_id: id,
      ciphertext: encryptJson({ mode: 'development', provider: providerKey, secret: null })
    });
    await insert(conn, 'integration_configs', {
      connection_id: id,
      mapping_json: JSON.stringify({ campaigns: 'campaigns', spend: 'campaign_metrics', leads: 'leads', conversions: 'leads.status' }),
      sync_json: JSON.stringify({ frequency: 'hourly', objects: ['campaigns', 'leads', 'spend'] })
    });
    return id;
  }

  const google = await connectOrg(prestige, 'google_ads', 'connected', 'Prestige Homes — Google Ads');
  const meta = await connectOrg(prestige, 'meta_ads', 'error', 'Prestige Homes — Meta');
  const magic = await connectOrg(prestige, 'magicbricks', 'degraded', 'Prestige Homes — MagicBricks');
  const acres = await connectOrg(prestige, '99acres', 'connected', 'Prestige Homes — 99acres');
  await connectOrg(prestige, 'housing', 'connected', 'Prestige Homes — Housing.com');
  await connectOrg(prestige, 'whatsapp', 'connected', 'Prestige Homes — WhatsApp');
  await connectOrg(prestige, 'nexcall', 'connected', 'Nexcall desk');
  await connectOrg(prestige, 'google_analytics', 'connected', 'prestigehomes.in');
  const aureliaGoogle = await connectOrg(aurelia, 'google_ads', 'connected', 'Aurelia — Google Ads');
  await connectOrg(aurelia, '99acres', 'connected', 'Aurelia — 99acres');

  await insert(conn, 'integration_errors', {
    connection_id: meta, organization_id: prestige, code: 'AUTH_EXPIRED',
    message: 'Meta Ads authentication expired. Campaign spend from Meta is stale.'
  });
  await insert(conn, 'integration_errors', {
    connection_id: magic, organization_id: prestige, code: 'SYNC_DELAYED',
    message: 'MagicBricks sync is running behind. Portal enquiries may be a few hours late.'
  });

  const job = await insert(conn, 'integration_sync_jobs', {
    connection_id: google, organization_id: prestige, status: 'succeeded', summary: 'Development adapter refreshed Google Ads objects.',
    finished_at: utc(daysAgo(0, 6))
  });
  await insert(conn, 'integration_sync_logs', { job_id: job, level: 'info', message: 'Development adapter refreshed Google Ads. No live Google API was called.' });
  await insert(conn, 'integration_objects', {
    organization_id: prestige, connection_id: google, object_type: 'account', external_id: 'google_ads-account',
    name: 'Prestige Homes — Google Ads', payload: JSON.stringify({ mode: 'development' })
  });
  await insert(conn, 'integration_objects', {
    organization_id: prestige, connection_id: google, object_type: 'ad_group', external_id: 'g-ag-62-3bhk',
    name: '3 BHK — Sector 62', parent_external_id: 'g-camp-sector62', payload: JSON.stringify({ mode: 'development' })
  });
  await insert(conn, 'integration_objects', {
    organization_id: aurelia, connection_id: aureliaGoogle, object_type: 'account', external_id: 'aurelia-google',
    name: 'Aurelia — Google Ads', payload: JSON.stringify({ mode: 'development' })
  });
  void acres;

  async function sourcesFor(organizationId) {
    const defs = [
      ['Google Ads', 'advertising', 'google_ads'],
      ['Meta Ads', 'advertising', 'meta_ads'],
      ['MagicBricks', 'portals', 'magicbricks'],
      ['99acres', 'portals', '99acres'],
      ['Housing.com', 'portals', 'housing'],
      ['Website', 'direct', null],
      ['WhatsApp', 'communication', 'whatsapp'],
      ['Referral', 'direct', null]
    ];
    const ids = {};
    for (const [name, category, provider] of defs) {
      ids[name] = await insert(conn, 'lead_sources', {
        organization_id: organizationId, name, category, provider_key: provider
      });
    }
    return ids;
  }
  const pSources = await sourcesFor(prestige);
  const aSources = await sourcesFor(aurelia);

  async function addCampaign(organizationId, workspaceId, sourceId, row) {
    return insert(conn, 'campaigns', {
      organization_id: organizationId,
      workspace_id: workspaceId,
      source_id: sourceId,
      provider_key: row.provider,
      external_id: row.externalId,
      name: row.name,
      project: row.project,
      status: 'active',
      budget_inr: row.budget,
      start_date: dayStamp(30)
    });
  }

  const campaigns = {
    search: await addCampaign(prestige, prestigeWs, pSources['Google Ads'], {
      provider: 'google_ads', externalId: 'g-camp-sector62', name: 'Search — Sector 62 Residences', project: 'Sector 62', budget: 850000
    }),
    meta: await addCampaign(prestige, prestigeWs, pSources['Meta Ads'], {
      provider: 'meta_ads', externalId: 'm-camp-nex', name: 'Meta — Noida Extension Launch', project: 'Noida Extension', budget: 620000
    }),
    magic: await addCampaign(prestige, prestigeWs, pSources.MagicBricks, {
      provider: 'magicbricks', externalId: 'mb-gurugram', name: 'MagicBricks — Gurugram Inventory', project: 'Gurugram', budget: 280000
    }),
    acres: await addCampaign(prestige, prestigeWs, pSources['99acres'], {
      provider: '99acres', externalId: 'ac-dwarka', name: '99acres — Dwarka Expressway', project: 'Dwarka Expressway', budget: 340000
    }),
    housing: await addCampaign(prestige, prestigeWs, pSources['Housing.com'], {
      provider: 'housing', externalId: 'h-gnw', name: 'Housing — Greater Noida West', project: 'Greater Noida West', budget: 190000
    })
  };
  await addCampaign(aurelia, aureliaWs, aSources['Google Ads'], {
    provider: 'google_ads', externalId: 'aur-search', name: 'Search — Aurelia Dwarka', project: 'Dwarka Expressway', budget: 420000
  });

  const metricProfile = {
    [campaigns.search]: { spend: 26000, leads: 5, rate: 0.46, recent: 1 },
    [campaigns.meta]: { spend: 24000, leads: 9, rate: 0.33, recent: 0.42 },
    [campaigns.magic]: { spend: 8000, leads: 4, rate: 0.4, recent: 0.75 },
    [campaigns.acres]: { spend: 10000, leads: 4, rate: 0.45, recent: 0.9 },
    [campaigns.housing]: { spend: 6500, leads: 3, rate: 0.34, recent: 1 }
  };
  for (const [campaignId, profile] of Object.entries(metricProfile)) {
    for (let day = 13; day >= 0; day -= 1) {
      const wave = ((day * 3 + Number(campaignId)) % 3) - 1;
      const factor = day < 7 ? profile.recent : 1;
      const leads = Math.max(1, Math.round(profile.leads * factor) + wave);
      await insert(conn, 'campaign_metrics', {
        organization_id: prestige,
        campaign_id: Number(campaignId),
        metric_date: dayStamp(day),
        impressions: leads * 420,
        clicks: leads * 18,
        spend_inr: profile.spend,
        leads,
        qualified_leads: Math.max(0, Math.round(leads * profile.rate))
      });
    }
  }

  const pipeline = await insert(conn, 'pipelines', { organization_id: prestige, name: 'NCR Sales', is_default: 1 });
  const stageNames = [
    ['inquiry', 'Inquiry', 1],
    ['site_visit', 'Site visit', 2],
    ['negotiation', 'Negotiation', 3],
    ['token', 'Token', 4],
    ['booked', 'Booked', 5],
    ['lost', 'Lost', 6]
  ];
  const stages = {};
  for (const [key, name, order] of stageNames) {
    stages[key] = await insert(conn, 'pipeline_stages', {
      pipeline_id: pipeline, organization_id: prestige, name, stage_key: key, sort_order: order
    });
  }

  const people = [
    ['Aditya Khanna', 'Sector 62', 'Google Ads', campaigns.search, 91, 2],
    ['Riya Malhotra', 'Noida Extension', 'Meta Ads', campaigns.meta, 88, 2],
    ['Sameer Bedi', 'Gurugram', 'MagicBricks', campaigns.magic, 86, 3],
    ['Neelam Joshi', 'Dwarka Expressway', '99acres', campaigns.acres, 92, 3],
    ['Farhan Qureshi', 'Greater Noida West', 'Housing.com', campaigns.housing, 84, 4],
    ['Ishita Rao', 'Sector 62', 'Google Ads', campaigns.search, 90, 2],
    ['Kunal Mehta', 'Noida Extension', 'Meta Ads', campaigns.meta, 87, 4],
    ['Priya Nanda', 'Gurugram', 'WhatsApp', null, 83, 3],
    ['Arjun Sethi', 'Dwarka Expressway', '99acres', campaigns.acres, 89, 2],
    ['Mahima Kapoor', 'Sector 62', 'Website', null, 85, 5],
    ['Rohan Bhatia', 'Noida Extension', 'Meta Ads', campaigns.meta, 93, 3],
    ['Tanya Grover', 'Greater Noida West', 'Housing.com', campaigns.housing, 81, 4]
  ];
  const progressed = [
    ['Aman Verma', 'contacted', 'Sector 62', 'Google Ads', campaigns.search, 74, 1, null],
    ['Sana Iqbal', 'contacted', 'Noida Extension', 'Meta Ads', campaigns.meta, 69, 2, null],
    ['Harsh Lal', 'qualified', 'Gurugram', 'MagicBricks', campaigns.magic, 77, 2, 'inquiry'],
    ['Nandini Rao', 'qualified', 'Sector 62', 'Google Ads', campaigns.search, 80, 3, 'inquiry'],
    ['Vivek Anand', 'site_visit', 'Dwarka Expressway', '99acres', campaigns.acres, 82, 4, 'site_visit'],
    ['Pallavi Shah', 'site_visit', 'Greater Noida West', 'Housing.com', campaigns.housing, 76, 8, 'site_visit'],
    ['Imran Siddiqi', 'negotiation', 'Gurugram', 'MagicBricks', campaigns.magic, 88, 9, 'negotiation'],
    ['Rhea Kapoor', 'negotiation', 'Sector 62', 'Referral', null, 91, 10, 'negotiation'],
    ['Devika Menon', 'booked', 'Sector 62', 'Google Ads', campaigns.search, 94, 11, 'booked'],
    ['Nikhil Arora', 'booked', 'Dwarka Expressway', '99acres', campaigns.acres, 90, 12, 'booked'],
    ['Pooja Seth', 'lost', 'Noida Extension', 'Meta Ads', campaigns.meta, 61, 8, 'lost'],
    ['Gaurav Tyagi', 'unqualified', 'Greater Noida West', 'Housing.com', campaigns.housing, 28, 5, null]
  ];

  async function addLead(organizationId, workspaceId, sourceMap, row, assignee) {
    const id = await insert(conn, 'leads', {
      organization_id: organizationId,
      workspace_id: workspaceId,
      source_id: sourceMap[row.source],
      campaign_id: row.campaignId,
      assigned_user_id: assignee,
      full_name: row.name,
      phone: row.phone,
      email: `${row.name.split(' ')[0].toLowerCase()}@example.net`,
      project: row.project,
      city: 'NCR',
      status: row.status,
      score: row.score,
      intent: row.score >= 80 ? 'high' : row.score >= 60 ? 'medium' : 'low',
      budget_inr: row.budget,
      configuration: row.score % 2 === 0 ? '3 BHK' : '2 BHK',
      created_at: utc(daysAgo(row.days, 10))
    });
    await insert(conn, 'lead_scores', {
      lead_id: id, organization_id: organizationId, score: row.score,
      reason: row.score >= 80 ? 'Budget, configuration, and project match.' : 'Early enquiry. Budget still open.',
      created_at: utc(daysAgo(row.days, 10))
    });
    await insert(conn, 'lead_activities', {
      lead_id: id, organization_id: organizationId, actor_user_id: assignee, activity_type: 'created',
      body: `Entered from ${row.source}.`, created_at: utc(daysAgo(row.days, 10))
    });
    return id;
  }

  let phone = 9810100000;
  const leadIds = {};
  for (let index = 0; index < people.length; index += 1) {
    const [name, project, source, campaignId, score, days] = people[index];
    phone += 1;
    const assignee = index < 8 ? users.kabir : null;
    leadIds[name] = await addLead(prestige, prestigeWs, pSources, {
      name, project, source, campaignId, score, days, status: 'new', phone: String(phone), budget: 18000000 + index * 500000
    }, assignee);
  }
  for (const [name, status, project, source, campaignId, score, days, stage] of progressed) {
    phone += 1;
    const id = await addLead(prestige, prestigeWs, pSources, {
      name, project, source, campaignId, score, days, status, phone: String(phone), budget: 16500000
    }, users.kabir);
    leadIds[name] = id;
    if (stage) {
      const value = stage === 'booked' ? 24500000 : stage === 'negotiation' ? 21000000 : 18000000;
      const opp = await insert(conn, 'opportunities', {
        organization_id: prestige, pipeline_id: pipeline, stage_id: stages[stage], lead_id: id,
        owner_user_id: users.kabir, title: `${name} — ${project}`, project, value_inr: value,
        status: stage === 'booked' ? 'won' : stage === 'lost' ? 'lost' : 'open',
        lost_reason: stage === 'lost' ? 'Chose a ready unit in a competing project' : null,
        expected_on: dayStamp(-14),
        created_at: utc(daysAgo(days, 12))
      });
      await insert(conn, 'opportunity_activities', {
        opportunity_id: opp, organization_id: prestige, actor_user_id: users.kabir,
        body: stage === 'booked' ? 'Booking recorded.' : `Sitting in ${stage.replaceAll('_', ' ')}.`,
        created_at: utc(daysAgo(Math.max(days - 2, 1), 15))
      });
    }
  }

  const aureliaLead = await addLead(aurelia, aureliaWs, aSources, {
    name: 'Karan Malhotra', project: 'Dwarka Expressway', source: 'Google Ads', campaignId: null,
    score: 79, days: 2, status: 'qualified', phone: '9811199001', budget: 32000000
  }, users.vikram);

  const callLead = leadIds['Vivek Anand'];
  const call = await insert(conn, 'calls', {
    organization_id: prestige, lead_id: callLead, agent_user_id: users.kabir, direction: 'outbound',
    status: 'completed', started_at: utc(daysAgo(1, 12)), duration_seconds: 740, outcome: 'Site visit agreed',
    provider_key: 'nexcall'
  });
  await insert(conn, 'call_recordings', {
    call_id: call, storage_key: 'dev://nexcall/prestige/call-1', duration_seconds: 740, available: 0,
    note: 'Playback stays with Nexcall until a live media credential is connected.'
  });
  await insert(conn, 'call_transcripts', {
    call_id: call,
    body: 'Kabir: You had asked about the Dwarka Expressway 3 BHK.\nVivek: Yes. I can visit Saturday if the price is still around 2.4.\nKabir: The available stack is 2.35 to 2.55, depending on floor.\nVivek: I am comparing one ready unit in Sector 62 as well. If possession is this year, I can decide after the visit.'
  });
  await insert(conn, 'call_analysis', {
    call_id: call,
    summary: 'Buyer is comparing Dwarka Expressway with a ready Sector 62 option and agreed to a Saturday visit.',
    buying_signals: JSON.stringify(['Asked for a Saturday site visit', 'Stated a 2.4 budget band', 'Possession this year matters']),
    objections: JSON.stringify(['Comparing a ready Sector 62 unit', 'Floor-wise price sensitivity']),
    score: 78
  });
  await insert(conn, 'calls', {
    organization_id: prestige, lead_id: leadIds['Rohan Bhatia'], agent_user_id: users.kabir, direction: 'inbound',
    status: 'missed', started_at: utc(daysAgo(1, 16)), duration_seconds: 0, outcome: 'Missed', provider_key: 'nexcall'
  });
  await insert(conn, 'calls', {
    organization_id: aurelia, lead_id: aureliaLead, agent_user_id: users.vikram, direction: 'outbound',
    status: 'completed', started_at: utc(daysAgo(2, 11)), duration_seconds: 420, outcome: 'Follow-up booked', provider_key: 'nexcall'
  });

  await insert(conn, 'tasks', {
    organization_id: prestige, assignee_user_id: users.kabir, title: 'Call untouched high-intent leads from Noida Extension',
    status: 'open', due_at: utc(daysAgo(-1, 11)), related_type: 'lead', related_id: leadIds['Rohan Bhatia']
  });
  await insert(conn, 'notes', {
    organization_id: prestige, author_user_id: users.meera, subject_type: 'lead', subject_id: leadIds['Imran Siddiqi'],
    body: 'Negotiation is on floor and covered car park, not on the base price.'
  });
  await insert(conn, 'reminders', {
    organization_id: prestige, user_id: users.kabir, title: 'Saturday site visit — Vivek Anand', remind_at: utc(daysAgo(-3, 5)),
    related_type: 'lead', related_id: callLead
  });
  await insert(conn, 'activities', {
    organization_id: prestige, actor_user_id: users.kabir, activity_type: 'call', title: 'Site visit agreed',
    body: 'Vivek Anand, Dwarka Expressway.', subject_type: 'call', subject_id: call, occurred_at: utc(daysAgo(1, 12))
  });

  for (const [slug, name, kind, description, custom] of [
    ['executive', 'Executive report', 'executive', 'What changed in the business this week.', 0],
    ['marketing', 'Marketing report', 'marketing', 'Spend, leads, and cost per lead.', 0],
    ['sales', 'Sales report', 'sales', 'Pipeline, bookings, and lost reasons.', 0],
    ['leads', 'Lead report', 'leads', 'Volume, quality, and untouched intent.', 0],
    ['calls', 'Call report', 'calls', 'Coverage, scores, and missed calls.', 0],
    ['campaigns', 'Campaign report', 'campaign', 'Which campaigns are carrying cost.', 0],
    ['team', 'Team report', 'team', 'Assignment load on the sales desk.', 0],
    ['noida-review', 'Weekly Noida review', 'marketing', 'Custom cut for Noida Extension and Sector 62.', 1]
  ]) {
    await insert(conn, 'reports', {
      organization_id: prestige, slug, name, report_kind: kind, description, is_custom: custom,
      config_json: custom ? JSON.stringify({ projects: ['Noida Extension', 'Sector 62'] }) : null
    });
  }

  const invoice = await insert(conn, 'invoices', {
    organization_id: prestige, invoice_number: 'AIRO-2409', amount_inr: 125000, status: 'paid',
    issued_on: dayStamp(20), due_on: dayStamp(10)
  });
  const paid = await insert(conn, 'payments', {
    organization_id: prestige, invoice_id: invoice, amount_inr: 125000, status: 'succeeded',
    method_label: 'NEFT', paid_at: utc(daysAgo(12)), created_at: utc(daysAgo(12))
  });
  await insert(conn, 'invoices', {
    organization_id: aurelia, invoice_number: 'AIRO-2410', amount_inr: 75000, status: 'open',
    issued_on: dayStamp(6), due_on: dayStamp(-8)
  });
  await insert(conn, 'payments', {
    organization_id: aurelia, amount_inr: 75000, status: 'failed', method_label: 'Card',
    failure_reason: 'Bank declined the recurring charge.', created_at: utc(daysAgo(2))
  });
  await insert(conn, 'credits', { organization_id: prestige, amount_inr: 15000, reason: 'Onboarding support credit' });
  await insert(conn, 'refunds', { organization_id: prestige, payment_id: paid, amount_inr: 0, reason: 'No refund due. Row reserved for the billing ledger.' });
  await conn.query(`DELETE FROM refunds WHERE amount_inr = 0`);

  const ticket = await insert(conn, 'tickets', {
    organization_id: prestige, assignee_user_id: users.sameer, subject: 'Meta Ads authentication expired',
    category: 'integration', priority: 'high', status: 'open', requester_name: 'Meera Nair', sla_due_at: utc(daysAgo(-1, 18))
  });
  await insert(conn, 'ticket_messages', {
    ticket_id: ticket, author_user_id: users.meera, author_name: 'Meera Nair',
    body: 'Meta spend stopped updating. The last successful sync was three days ago.'
  });
  await insert(conn, 'tickets', {
    organization_id: aurelia, assignee_user_id: users.sameer, subject: 'Invoice AIRO-2410 payment failed',
    category: 'billing', priority: 'normal', status: 'waiting', requester_name: 'Vikram Singh', sla_due_at: utc(daysAgo(-2, 12))
  });

  await insert(conn, 'platform_prospects', {
    company_name: 'Haveli & Co', contact_name: 'Sanjay Haveli', city: 'Gurugram', stage: 'proposal',
    value_inr: 250000, owner_user_id: users.sales, next_follow_up: dayStamp(-2), source_name: 'Referral',
    notes: 'Wants Operating for two NCR projects.'
  });
  await insert(conn, 'platform_prospects', {
    company_name: 'Northwind Realty', contact_name: 'Asha Narang', city: 'Noida', stage: 'demo',
    value_inr: 125000, owner_user_id: users.sales, next_follow_up: dayStamp(-1), source_name: 'Website'
  });
  await insert(conn, 'platform_prospects', {
    company_name: 'Saffron Developers', contact_name: 'Rohit Saffron', city: 'New Delhi', stage: 'qualified',
    value_inr: 75000, owner_user_id: users.sales, next_follow_up: dayStamp(-4), source_name: 'Event'
  });

  await insert(conn, 'moderation_items', {
    organization_id: prestige, item_type: 'listing_copy', status: 'queue', severity: 'normal',
    summary: 'Project description for Noida Extension repeats a possession date that is not on the price list.'
  });
  await insert(conn, 'moderation_items', {
    organization_id: aurelia, item_type: 'user_report', status: 'flagged', severity: 'low',
    summary: 'A workspace member reported an exported lead file shared outside the sales team.'
  });

  await insert(conn, 'platform_api_keys', {
    name: 'Platform read key', key_prefix: 'airo_live_7f', key_hash: 'seeded-hash-not-a-secret', created_by: users.dev
  });
  await insert(conn, 'platform_webhooks', {
    name: 'Billing events', target_url: 'https://example.invalid/airo/billing', event_name: 'invoice.payment_failed', status: 'active'
  });
  await insert(conn, 'oauth_clients', {
    name: 'Prestige internal tool', client_public_id: 'airo_oauth_prestige', redirect_uri: 'https://example.invalid/callback', status: 'active'
  });

  await insert(conn, 'platform_settings', { setting_key: 'general', setting_value: JSON.stringify({ name: 'AIRO', supportEmail: 'support@airo.invalid' }) });
  await insert(conn, 'platform_settings', { setting_key: 'featureFlags', setting_value: JSON.stringify({ supportAccess: true, developmentAdapters: true }) });
  await insert(conn, 'platform_settings', { setting_key: 'security', setting_value: JSON.stringify({ sessionMinutes: 15, supportAccessMinutes: 30 }) });
  await insert(conn, 'organization_settings', {
    organization_id: prestige, setting_key: 'workspace', setting_value: JSON.stringify({ timezone: 'Asia/Kolkata', currency: 'INR' })
  });
  await insert(conn, 'organization_settings', {
    organization_id: prestige, setting_key: 'branding', setting_value: JSON.stringify({ displayName: 'Prestige Homes', accent: 'brass' })
  });
  await insert(conn, 'organization_settings', {
    organization_id: prestige, setting_key: 'ai', setting_value: JSON.stringify({ answersUseWorkspaceData: true })
  });
  await insert(conn, 'organization_settings', {
    organization_id: prestige, setting_key: 'notifications', setting_value: JSON.stringify({ highIntent: true, connectionHealth: true })
  });
  await insert(conn, 'organization_settings', {
    organization_id: prestige, setting_key: 'security', setting_value: JSON.stringify({ supportAccess: 'read_only' })
  });

  await insert(conn, 'audit_logs', {
    organization_id: prestige, actor_user_id: users.meera, action: 'connection.synced', resource_name: 'connection',
    resource_id: String(google), metadata: JSON.stringify({ provider: 'google_ads' }), created_at: utc(daysAgo(0, 6))
  });
  await insert(conn, 'security_events', {
    event_type: 'login_failed', severity: 'warning', message: 'Rejected sign-in attempt.', ip: '127.0.0.1', created_at: utc(daysAgo(1, 7))
  });
  await insert(conn, 'sessions', { user_id: users.rahul, ip: '127.0.0.1', user_agent: 'seed', started_at: utc(daysAgo(1, 11)) });
  await insert(conn, 'ai_usage_logs', { organization_id: prestige, user_id: users.rahul, surface: 'assistant', prompt_excerpt: 'Why did qualified leads move?' });

  await insert(conn, 'whatsapp_bot', {
    id: 1, display_name: 'AIRO WhatsApp', phone_label: 'Not connected', status: 'pending', mode: 'development',
    webhook_path: '/api/whatsapp/webhook', note: null
  });
  await insert(conn, 'whatsapp_businesses', { organization_id: prestige, enabled: 1, business_label: 'Prestige Homes' });
  await insert(conn, 'whatsapp_businesses', { organization_id: aurelia, enabled: 1, business_label: 'Aurelia Estates' });
  await conn.end();
  await refreshAll();
  await pool.end();

  console.log(`
AIRO development data is ready.

Client workspace
  rahul.sharma@prestigehomes.in     Owner, Prestige Homes
  kabir.malhotra@prestigehomes.in   Member, Sales, assigned leads only
  vikram.singh@aureliaestates.in    Owner, Aurelia Estates

Platform
  arjun.mehta@airo.internal         Super Admin

Password: ${env.seedPassword}
`);
}

seed().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
