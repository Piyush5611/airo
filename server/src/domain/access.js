function define(keys) {
  return keys.map(([key, description]) => {
    const split = key.lastIndexOf('.');
    return {
      key,
      resource: key.slice(0, split),
      action: key.slice(split + 1),
      description
    };
  });
}

export const CLIENT_PERMISSIONS = define([
  ['command.view', 'View the command center'],
  ['leads.view', 'View leads'],
  ['leads.create', 'Create leads'],
  ['leads.update', 'Update leads'],
  ['leads.delete', 'Delete leads'],
  ['leads.assign', 'Assign leads'],
  ['leads.export', 'Export leads'],
  ['campaigns.view', 'View campaigns'],
  ['campaigns.update', 'Update campaigns'],
  ['sources.view', 'View lead sources'],
  ['pipeline.view', 'View pipeline'],
  ['pipeline.update', 'Update opportunities'],
  ['calls.view', 'View calls'],
  ['calls.create', 'Log calls'],
  ['activities.view', 'View activities'],
  ['activities.create', 'Create activities'],
  ['activities.update', 'Update activities'],
  ['reports.view', 'View reports'],
  ['reports.export', 'Export reports'],
  ['analytics.view', 'View analytics'],
  ['connections.view', 'View connections'],
  ['connections.manage', 'Manage connections'],
  ['ai.use', 'Use AI workspace'],
  ['users.view', 'View workspace members'],
  ['users.invite', 'Invite members'],
  ['users.manage', 'Manage members, roles, and scopes'],
  ['billing.view', 'View billing'],
  ['billing.manage', 'Manage billing'],
  ['settings.view', 'View settings'],
  ['settings.manage', 'Manage settings'],
  ['audit.view', 'View audit logs']
]);

export const PLATFORM_PERMISSIONS = define([
  ['platform.overview.view', 'View platform overview'],
  ['organizations.view', 'View organizations'],
  ['organizations.manage', 'Manage organizations'],
  ['organizations.impersonate', 'Open read-only support access'],
  ['platform_users.view', 'View platform users'],
  ['platform_users.invite', 'Invite platform users'],
  ['platform_users.manage', 'Manage platform users'],
  ['platform_sales.view', 'View platform sales'],
  ['platform_sales.manage', 'Manage platform sales'],
  ['support.view', 'View support'],
  ['support.manage', 'Manage support'],
  ['finance.view', 'View finance'],
  ['finance.manage', 'Manage finance'],
  ['moderation.view', 'View moderation'],
  ['moderation.manage', 'Act on moderation'],
  ['platform_analytics.view', 'View platform analytics'],
  ['platform_integrations.view', 'View integration registry'],
  ['platform_integrations.manage', 'Manage technical integrations'],
  ['platform_ai.view', 'View platform AI'],
  ['platform_ai.manage', 'Manage platform AI'],
  ['security.view', 'View security and audit'],
  ['platform_settings.view', 'View platform settings'],
  ['platform_settings.manage', 'Manage platform settings'],
  ['whatsapp_bot.manage', 'Manage the shared WhatsApp chatbot']
]);

const clientView = CLIENT_PERMISSIONS.filter((item) => item.action === 'view').map((item) => item.key);

export const CLIENT_ROLES = {
  owner: { name: 'Owner', grants: ['*'] },
  admin: {
    name: 'Admin',
    grants: CLIENT_PERMISSIONS.map((item) => item.key).filter((key) => key !== 'billing.manage')
  },
  member: {
    name: 'Member',
    grants: [
      'command.view',
      'leads.view',
      'leads.update',
      'campaigns.view',
      'sources.view',
      'pipeline.view',
      'calls.view',
      'calls.create',
      'activities.view',
      'activities.create',
      'reports.view',
      'analytics.view',
      'connections.view',
      'ai.use'
    ]
  },
  viewer: { name: 'Viewer', grants: clientView }
};

export const PLATFORM_ROLES = {
  super_admin: { name: 'Super Admin', grants: ['*'] },
  operations_admin: {
    name: 'Operations Admin',
    grants: [
      'platform.overview.view',
      'organizations.view',
      'organizations.manage',
      'platform_users.view',
      'support.view',
      'platform_analytics.view',
      'security.view'
    ]
  },
  support_admin: {
    name: 'Support Admin',
    grants: [
      'platform.overview.view',
      'organizations.view',
      'organizations.impersonate',
      'support.view',
      'support.manage',
      'platform_users.view'
    ]
  },
  sales_admin: {
    name: 'Sales Admin',
    grants: [
      'platform.overview.view',
      'organizations.view',
      'platform_sales.view',
      'platform_sales.manage'
    ]
  },
  finance_admin: {
    name: 'Finance Admin',
    grants: ['platform.overview.view', 'organizations.view', 'finance.view', 'finance.manage']
  },
  moderation: {
    name: 'Content/Moderation',
    grants: ['platform.overview.view', 'moderation.view', 'moderation.manage']
  },
  analyst: {
    name: 'Analyst',
    grants: [
      'platform.overview.view',
      'organizations.view',
      'platform_analytics.view',
      'platform_ai.view'
    ]
  },
  developer_admin: {
    name: 'Developer/Admin',
    grants: [
      'platform.overview.view',
      'platform_integrations.view',
      'platform_integrations.manage',
      'platform_settings.view',
      'security.view',
      'platform_ai.view',
      'whatsapp_bot.manage'
    ]
  }
};

export function permissionRecords(scope) {
  return scope === 'platform' ? PLATFORM_PERMISSIONS : CLIENT_PERMISSIONS;
}

export function grantsFor(scope, roleKey) {
  const catalog = permissionRecords(scope);
  const role = (scope === 'platform' ? PLATFORM_ROLES : CLIENT_ROLES)[roleKey];
  if (!role) return [];
  if (role.grants.includes('*')) return catalog.map((item) => item.key);
  return role.grants;
}

export const VIEWER_KEYS = clientView;
