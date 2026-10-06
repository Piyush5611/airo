import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { happened, inr, label, num, when } from '../format.js';
import { Badge, Page, State, Subnav, Table, useSection } from '../ui.jsx';
import { AssistantChat } from './AssistantChat.jsx';

const HOME = ['Dashboard', 'Platform KPIs', 'Organization Overview', 'System Health', 'AIRO Alerts', 'Recent Activity'];
const ORGS = ['All Organizations', 'Organization Details', 'Onboarding', 'Organization Status', 'Subscription', 'Usage', 'Client Activity', 'Client Health', 'Impersonation / Support Access'];
const USERS = ['All Platform Users', 'Invite User', 'User Details', 'Platform Roles', 'Permissions', 'Access Scope', 'Login / Session Activity', 'Suspended Users'];
const SALES = ['Prospects', 'Leads', 'Accounts', 'Opportunities', 'Sales Pipeline', 'Activities', 'Follow-ups', 'Customer Conversion'];
const SUPPORT = ['Support Dashboard', 'Tickets', 'Conversations', 'Customer Issues', 'Escalations', 'SLA', 'Customer Activity', 'Support Notes'];
const FINANCE = ['Billing Dashboard', 'Subscriptions', 'Plans', 'Invoices', 'Payments', 'Refunds', 'Credits', 'Failed Payments', 'Revenue', 'Billing History'];
const MODERATION = ['Content Review', 'User Reports', 'Violations', 'Flagged Content', 'Moderation Queue', 'Actions / Restrictions', 'Appeals', 'Moderation History'];
const ANALYTICS = ['Overview', 'User Analytics', 'Organization Analytics', 'Usage Analytics', 'Revenue Analytics', 'Feature Usage', 'Engagement', 'Retention', 'Performance'];
const TECH = ['Integration Registry', 'API Configuration', 'API Keys', 'Webhooks', 'OAuth', 'Integration Health', 'Sync Jobs', 'Data Pipelines', 'Logs', 'System Configuration', 'Developer Tools'];
const PAI = ['Assistant', 'AI Overview', 'AI Usage', 'AI Models', 'AI Configuration', 'AI Costs', 'AI Monitoring', 'AI Evaluations', 'AI Logs', 'AI Policies'];
const SECURITY = ['Audit Logs', 'Security Events', 'Login Activity', 'Access Logs', 'API Activity', 'Admin Actions', 'System Events'];
const SETTINGS = ['General', 'Platform Configuration', 'Notifications', 'Email', 'Security', 'Feature Flags', 'Localization', 'System Preferences'];

function orgColumns(section) {
  const name = { key: 'name', label: 'Organization' };
  const city = { key: 'city', label: 'City' };
  const status = { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> };
  const plan = { key: 'planName', label: 'Plan', render: (row) => row.planName || '—' };
  const subscription = { key: 'subscriptionStatus', label: 'Subscription', render: (row) => <Badge value={row.subscriptionStatus || 'pending'} /> };
  const health = { key: 'healthScore', label: 'Health' };
  const leads = { key: 'leads', label: 'Leads', render: (row) => num(row.leads) };
  const members = { key: 'members', label: 'Members' };
  const step = { key: 'onboardingStep', label: 'Onboarding', render: (row) => label(row.onboardingStep) };
  if (section === 'Onboarding') return [name, city, step, status];
  if (section === 'Organization Status') return [name, city, status, health];
  if (section === 'Subscription') return [name, plan, subscription];
  if (section === 'Usage' || section === 'Client Activity') return [name, leads, members, plan];
  if (section === 'Client Health') return [name, city, health, status, leads];
  return [name, city, status, plan, health, leads, members];
}

function Gate({ path, title, eyebrow, lede, children }) {
  const state = useResource(path);
  return (
    <Page eyebrow={eyebrow} title={title} lede={lede}>
      <State loading={state.loading} error={state.error} onRetry={state.reload}>
        {state.data ? children(state.data, state.reload) : null}
      </State>
    </Page>
  );
}

export function PlatformHome() {
  const navigate = useNavigate();
  const [section, setSection] = useSection(HOME);
  const show = (name) => section === 'Dashboard' || section === name;
  return (
    <Gate path="/api/admin/overview" eyebrow="Platform" title="Platform overview" lede="Dashboard, KPIs, organizations, system health, alerts, and recent activity.">
      {(data) => (
        <>
          <Subnav items={HOME} value={section} onChange={setSection} />
          {show('Platform KPIs') ? <div className="metric-strip">
            <div className="metric"><span>Organizations</span><strong>{num(data.counts.organizations)}</strong><em>{num(data.counts.activeOrganizations)} active</em></div>
            <div className="metric"><span>Open tickets</span><strong>{num(data.counts.openTickets)}</strong><em>Support queue</em></div>
            <div className="metric"><span>Unhealthy connections</span><strong>{num(data.counts.unhealthyConnections)}</strong><em>Error or delayed</em></div>
            <div className="metric"><span>Failed payments</span><strong>{num(data.counts.failedPayments)}</strong><em>Needs finance</em></div>
          </div> : null}
          <div className="layout">
            {show('Organization Overview') ? <section className="panel">
              <header><h2>Clients</h2><p>Plan, leads, and health</p></header>
              <Table
                columns={[
                  { key: 'name', label: 'Organization' },
                  { key: 'city', label: 'City' },
                  { key: 'planName', label: 'Plan', render: (row) => row.planName || '—' },
                  { key: 'leads', label: 'Leads', render: (row) => num(row.leads) },
                  { key: 'healthScore', label: 'Health', render: (row) => num(row.healthScore) },
                  { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> }
                ]}
                rows={data.organizations}
                onRow={(row) => navigate(`/platform/organizations/${row.id}`)}
              />
            </section> : null}
            <aside className="stack">
              {show('System Health') || show('AIRO Alerts') ? <section className="panel">
                <header><h2>Needs a person</h2></header>
                <div className="watch">
                  <Link to="/platform/integrations"><strong>{num(data.counts.unhealthyConnections)}</strong><span><b>Connections</b><em>Auth expired or sync delayed</em></span></Link>
                  <Link to="/platform/support"><strong>{num(data.counts.openTickets)}</strong><span><b>Support</b><em>Open or escalated tickets</em></span></Link>
                  <Link to="/platform/finance"><strong>{num(data.counts.failedPayments)}</strong><span><b>Payments</b><em>Failed charges</em></span></Link>
                </div>
              </section> : null}
              {show('Recent Activity') ? <section className="panel">
                <header><h2>Latest</h2></header>
                <ul className="alert-list">
                  {data.activity.map((item, index) => (
                    <li key={index}>
                      <strong>{item.actorName || 'System'}</strong>
                      <span>{happened(item.action)} · {item.organizationName || 'Platform'} · {when(item.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section> : null}
            </aside>
          </div>
        </>
      )}
    </Gate>
  );
}

export function Organizations() {
  const navigate = useNavigate();
  const [section, setSection] = useSection(ORGS);
  return (
    <Gate path="/api/admin/organizations" eyebrow="Platform" title="Organizations" lede="All clients, onboarding, status, subscription, usage, health, and support access.">
      {(data) => (
        <>
        <Subnav items={ORGS} value={section} onChange={setSection} />
        {section === 'Impersonation / Support Access' ? <p className="quiet">Open an organization. Support access is read only and expires.</p> : null}
        <Table
          columns={orgColumns(section)}
          rows={section === 'Client Health' ? [...data.items].sort((a, b) => Number(a.healthScore || 0) - Number(b.healthScore || 0)) : section === 'Usage' || section === 'Client Activity' ? [...data.items].sort((a, b) => Number(b.leads) - Number(a.leads)) : data.items}
          onRow={(row) => navigate(`/platform/organizations/${row.id}`)}
        />
        </>
      )}
    </Gate>
  );
}

export function OrganizationDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource(`/api/admin/organizations/${id}`);
  const { can } = useAuth();
  const navigate = useNavigate();

  return (
    <Page eyebrow="Platform / Organizations" title={data?.organization.name || 'Organization'} lede={data ? [data.organization.city, data.organization.sector ? label(data.organization.sector) : 'Sector not set', data.organization.planName || 'No plan'].filter(Boolean).join(' · ') : ''}>
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            <div className="metric-strip">
              <div className="metric"><span>Leads</span><strong>{num(data.usage.leads)}</strong></div>
              <div className="metric"><span>Campaigns</span><strong>{num(data.usage.campaigns)}</strong></div>
              <div className="metric"><span>Calls</span><strong>{num(data.usage.calls)}</strong></div>
              <div className="metric"><span>Connections</span><strong>{num(data.usage.connections)}</strong></div>
            </div>
            <p>Health {data.organization.healthScore ?? '—'} · subscription {label(data.organization.subscriptionStatus)} · {data.organization.monthlyInr ? inr(data.organization.monthlyInr) : ''}</p>
            {can('organizations.impersonate') ? <SupportButton id={id} onOpen={() => navigate('/app')} /> : <p className="quiet">Support access is limited to the support role.</p>}
          </div>
        ) : null}
      </State>
    </Page>
  );
}

function SupportButton({ id, onOpen }) {
  const { enterSupport } = useAuth();
  const [error, setError] = useState('');
  return (
    <div>
      <button className="btn-primary" onClick={async () => {
        try {
          await enterSupport(id);
          onOpen();
        } catch (err) {
          setError(err.message);
        }
      }}>Open read-only support access</button>
      {error ? <p className="delta-down">{error}</p> : null}
    </div>
  );
}

export function PlatformUsers() {
  const { data, loading, error, reload } = useResource('/api/admin/users');
  const { can } = useAuth();
  const [section, setSection] = useSection(USERS);
  const [invite, setInvite] = useState({ fullName: '', email: '', role: 'analyst' });
  const [notice, setNotice] = useState('');
  const rows = (data?.items || []).filter((row) => section !== 'Suspended Users' || row.status === 'suspended');
  return (
    <Page eyebrow="Platform" title="Platform users and access" lede="Users, invites, roles, permissions, access scope, sessions, and suspended accounts.">
      <Subnav items={USERS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        {section === 'Invite User' && can('platform_users.invite') ? (
          <form className="filters" onSubmit={async (event) => {
            event.preventDefault();
            const result = await api.post('/api/admin/users/invite', invite);
            setNotice(result.developmentResetPath || 'Invitation recorded.');
            reload();
          }}>
            <input placeholder="Name" value={invite.fullName} onChange={(event) => setInvite({ ...invite, fullName: event.target.value })} required />
            <input type="email" placeholder="Email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} required />
            <button className="btn-primary" type="submit">Invite</button>
            {notice ? <p>{notice}</p> : null}
          </form>
        ) : null}
        {section === 'Platform Roles' || section === 'Permissions' ? (
          <Table columns={[
            { key: 'roleName', label: 'Role' },
            { key: 'people', label: 'People' },
            { key: 'names', label: 'Users' }
          ]} rows={Object.values((data?.items || []).reduce((groups, row) => {
            const current = groups[row.roleKey] || { id: row.roleKey, roleName: row.roleName, people: 0, names: [] };
            current.people += 1;
            current.names.push(row.fullName);
            groups[row.roleKey] = current;
            return groups;
          }, {})).map((row) => ({ ...row, names: row.names.join(', ') }))} />
        ) : null}
        {section === 'Access Scope' ? <p className="quiet">These accounts are platform-wide. A client workspace is opened only through support access.</p> : null}
        {section === 'Login / Session Activity' ? <p className="quiet">Last sign-in recorded on each platform account.</p> : null}
        {section !== 'Platform Roles' && section !== 'Permissions' ? <Table columns={[
          { key: 'fullName', label: 'User' },
          { key: 'email', label: 'Email' },
          { key: 'roleName', label: 'Role' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
          { key: 'lastLoginAt', label: 'Last login', render: (row) => when(row.lastLoginAt) },
          { key: 'action', label: '', render: (row) => can('platform_users.manage') && row.roleKey !== 'super_admin' ? (
            <button className="btn-ghost" onClick={() => api.patch(`/api/admin/users/${row.id}`, { status: row.status === 'suspended' ? 'active' : 'suspended' }).then(reload)}>{row.status === 'suspended' ? 'Restore' : 'Suspend'}</button>
          ) : null }
        ]} rows={section === 'Login / Session Activity' ? [...rows].sort((a, b) => new Date(b.lastLoginAt || 0) - new Date(a.lastLoginAt || 0)) : rows} /> : null}
      </State>
    </Page>
  );
}

export function PlatformSales() {
  const { data, loading, error, reload } = useResource('/api/admin/sales');
  const [section, setSection] = useSection(SALES);
  const rowsFor = {
    Prospects: (row) => ['prospect', 'qualified', 'demo'].includes(row.stage),
    Leads: (row) => row.stage === 'qualified',
    Opportunities: (row) => ['demo', 'proposal'].includes(row.stage),
    'Customer Conversion': (row) => row.stage === 'won',
    'Follow-ups': (row) => Boolean(row.nextFollowUp)
  };
  return (
    <Page eyebrow="Platform" title="Platform sales" lede="Prospects, leads, accounts, opportunities, pipeline, activities, follow-ups, and conversion. These are AIRO's own customers.">
      <Subnav items={SALES} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            <div className="filters">{data.stages.map((stage) => <span className="badge" key={stage.stage}>{label(stage.stage)} {stage.count}</span>)}</div>
            <Table columns={[
              { key: 'companyName', label: 'Account' },
              { key: 'contactName', label: 'Contact' },
              { key: 'city', label: 'City' },
              { key: 'stage', label: 'Stage', render: (row) => <Badge value={row.stage} /> },
              { key: 'valueInr', label: 'Value', render: (row) => inr(row.valueInr) },
              { key: 'nextFollowUp', label: 'Follow-up' },
              { key: 'notes', label: section === 'Activities' ? 'Activity' : 'Note', render: (row) => row.notes || '—' }
            ]} rows={rowsFor[section] ? data.items.filter(rowsFor[section]) : data.items} />
          </div>
        ) : null}
      </State>
    </Page>
  );
}

export function PlatformSupport() {
  const { data, loading, error, reload } = useResource('/api/admin/support');
  const [section, setSection] = useSection(SUPPORT);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const detail = useResource(open ? `/api/admin/support/${open}` : null);
  return (
    <Page eyebrow="Platform" title="Customer support" lede="Dashboard, tickets, conversations, issues, escalations, SLA, activity, and notes.">
      <Subnav items={SUPPORT} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        <Table columns={[
          { key: 'subject', label: section === 'Customer Issues' ? 'Issue' : 'Ticket' },
          { key: 'organizationName', label: 'Organization' },
          { key: 'requesterName', label: 'Customer' },
          { key: 'category', label: 'Type', render: (row) => label(row.category) },
          { key: 'priority', label: 'Priority', render: (row) => <Badge value={row.priority} /> },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
          { key: 'slaDueAt', label: 'SLA', render: (row) => when(row.slaDueAt) }
        ]} rows={(data?.items || []).filter((row) => {
          if (section === 'Escalations') return row.status === 'escalated';
          if (section === 'Customer Issues') return row.priority === 'high' || row.status === 'open';
          return true;
        }).sort((a, b) => section === 'SLA' ? new Date(a.slaDueAt || 0) - new Date(b.slaDueAt || 0) : 0)} onRow={(row) => setOpen(row.id)} />
        {open && detail.data && (section === 'Support Dashboard' || section === 'Tickets' || section === 'Conversations' || section === 'Support Notes' || section === 'Customer Activity' || section === 'Escalations' || section === 'SLA' || section === 'Customer Issues') ? (
          <section className="panel">
            <header><h2>{section === 'Conversations' || section === 'Customer Activity' ? 'Conversation' : 'Support notes'} · {detail.data.ticket.subject}</h2></header>
            <ul className="alert-list">{detail.data.messages.map((message, index) => <li key={index}><strong>{message.authorName}</strong><span>{message.body}</span></li>)}</ul>
            <form className="form-grid" onSubmit={async (event) => { event.preventDefault(); await api.post(`/api/admin/support/${open}/notes`, { body: note }); setNote(''); detail.reload(); }}>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Support note" required />
              <button className="btn-primary" type="submit">Add note</button>
            </form>
          </section>
        ) : null}
      </State>
    </Page>
  );
}

export function PlatformFinance() {
  const [section, setSection] = useSection(FINANCE);
  const show = (name) => section === 'Billing Dashboard' || section === name;
  return (
    <Gate path="/api/admin/finance" eyebrow="Platform" title="Finance and billing" lede="Billing, subscriptions, plans, invoices, payments, refunds, credits, failures, revenue, and history.">
      {(data) => (
        <div className="stack">
          <Subnav items={FINANCE} value={section} onChange={setSection} />
          {show('Revenue') ? <div className="metric-strip">
            <div className="metric"><span>MRR</span><strong>{inr(data.summary.mrr)}</strong></div>
            <div className="metric"><span>Open invoices</span><strong>{inr(data.summary.openInvoices)}</strong></div>
            <div className="metric"><span>Failed payments</span><strong>{num(data.summary.failed)}</strong></div>
          </div> : null}
          {show('Invoices') || show('Billing History') ? <section className="panel"><header><h2>Invoices</h2></header>
            <Table columns={[{ key: 'invoiceNumber', label: 'Invoice' }, { key: 'organizationName', label: 'Organization' }, { key: 'amountInr', label: 'Amount', render: (row) => inr(row.amountInr) }, { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> }]} rows={data.invoices} />
          </section> : null}
          {show('Payments') || show('Failed Payments') ? <section className="panel"><header><h2>Payments</h2></header>
            <Table columns={[{ key: 'organizationName', label: 'Organization' }, { key: 'amountInr', label: 'Amount', render: (row) => inr(row.amountInr) }, { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> }, { key: 'failureReason', label: 'Note', render: (row) => row.failureReason || row.methodLabel }]} rows={section === 'Failed Payments' ? data.payments.filter((row) => row.status === 'failed') : data.payments} />
          </section> : null}
          {show('Subscriptions') ? <section className="panel"><header><h2>Subscriptions</h2></header>
            <Table columns={[{ key: 'organizationName', label: 'Organization' }, { key: 'planName', label: 'Plan' }, { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> }, { key: 'monthlyInr', label: 'Monthly', render: (row) => inr(row.monthlyInr) }]} rows={data.subscriptions} />
          </section> : null}
          {show('Refunds') ? <section className="panel"><header><h2>Refunds</h2></header>
            <Table columns={[{ key: 'organizationName', label: 'Organization' }, { key: 'amountInr', label: 'Amount', render: (row) => inr(row.amountInr) }, { key: 'reason', label: 'Reason' }]} rows={data.refunds} />
          </section> : null}
          {show('Credits') ? <section className="panel"><header><h2>Credits</h2></header>
            <Table columns={[{ key: 'organizationName', label: 'Organization' }, { key: 'amountInr', label: 'Amount', render: (row) => inr(row.amountInr) }, { key: 'reason', label: 'Reason' }]} rows={data.credits} />
          </section> : null}
          {show('Plans') ? <section className="panel"><header><h2>Plans</h2></header>
            {data.plans.map((plan) => <p key={plan.planKey}><strong>{plan.name}</strong> · {inr(plan.monthlyInr)} · {plan.description}</p>)}
          </section> : null}
        </div>
      )}
    </Gate>
  );
}

export function PlatformModeration() {
  const { data, loading, error, reload } = useResource('/api/admin/moderation');
  const [section, setSection] = useSection(MODERATION);
  const match = {
    'User Reports': (row) => row.itemType === 'user_report',
    Violations: (row) => row.status === 'flagged' || row.severity === 'high',
    'Flagged Content': (row) => row.status === 'flagged',
    'Moderation Queue': (row) => row.status === 'queue',
    'Actions / Restrictions': (row) => row.status === 'actioned',
    Appeals: (row) => row.status === 'appealed',
    'Moderation History': (row) => row.status === 'actioned' || row.status === 'dismissed'
  };
  return (
    <Page eyebrow="Platform" title="Content and moderation" lede="Review, reports, violations, the queue, restrictions, appeals, and history.">
      <Subnav items={MODERATION} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        <p className="quiet">{data?.queue || 0} items still need a decision.</p>
        <Table columns={[
          { key: 'summary', label: 'Item' },
          { key: 'itemType', label: 'Type', render: (row) => label(row.itemType) },
          { key: 'organizationName', label: 'Organization' },
          { key: 'severity', label: 'Severity', render: (row) => <Badge value={row.severity} /> },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
          { key: 'action', label: '', render: (row) => (
            <span className="row-actions">
              <button className="btn-ghost" onClick={() => api.patch(`/api/admin/moderation/${row.id}`, { status: 'actioned' }).then(reload)}>Restrict</button>
              <button className="btn-ghost" onClick={() => api.patch(`/api/admin/moderation/${row.id}`, { status: 'dismissed' }).then(reload)}>Dismiss</button>
            </span>
          ) }
        ]} rows={(data?.items || []).filter((row) => !match[section] || match[section](row))} />
      </State>
    </Page>
  );
}

export function PlatformAnalytics() {
  const [section, setSection] = useSection(ANALYTICS);
  return (
    <Gate path="/api/admin/analytics" eyebrow="Platform" title="Platform analytics" lede="Users, organizations, usage, revenue signals, engagement, retention, and performance of the product.">
      {(data) => (
        <>
        <Subnav items={ANALYTICS} value={section} onChange={setSection} />
        <div className="metric-strip">
          {(section === 'Overview' || section === 'User Analytics' || section === 'Engagement' ? [{ label: 'Client users', value: data.counts.clientUsers }, { label: 'Platform users', value: data.counts.platformUsers }] : []).map((item) => <div className="metric" key={item.label}><span>{item.label}</span><strong>{num(item.value)}</strong></div>)}
          {(section === 'Overview' || section === 'Organization Analytics' || section === 'Retention' ? [{ label: 'Organizations', value: data.counts.organizations }, { label: 'Active', value: data.counts.activeOrganizations }] : []).map((item) => <div className="metric" key={item.label}><span>{item.label}</span><strong>{num(item.value)}</strong></div>)}
          {(section === 'Overview' || section === 'Usage Analytics' || section === 'Feature Usage' || section === 'Performance' ? [{ label: 'Open tickets', value: data.counts.openTickets }, { label: 'Unhealthy connections', value: data.counts.unhealthyConnections }] : []).map((item) => <div className="metric" key={item.label}><span>{item.label}</span><strong>{num(item.value)}</strong></div>)}
          {(section === 'Overview' || section === 'Revenue Analytics' ? [{ label: 'Failed payments', value: data.counts.failedPayments }] : []).map((item) => <div className="metric" key={item.label}><span>{item.label}</span><strong>{num(item.value)}</strong></div>)}
        </div>
        {section === 'Organization Analytics' || section === 'Retention' ? (
          <Table columns={[
            { key: 'name', label: 'Organization' },
            { key: 'leads', label: 'Leads', render: (row) => num(row.leads) },
            { key: 'healthScore', label: 'Health', render: (row) => num(row.healthScore) },
            { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> }
          ]} rows={data.organizations} />
        ) : null}
        </>
      )}
    </Gate>
  );
}

function integrationHealth(data) {
  const failed = data.jobs.filter((job) => job.status === 'failed' || job.status === 'error').length;
  const providerErrors = data.providers.reduce((sum, row) => sum + Number(row.errors || 0), 0);
  const attention = failed + providerErrors;
  const rows = [
    { name: 'API Services', status: 'Operational', detail: `${data.apiKeys.length} keys on record`, tone: 'good' },
    { name: 'OAuth Services', status: data.oauthClients.length ? 'Operational' : 'Attention', detail: `${data.oauthClients.length} apps`, tone: data.oauthClients.length ? 'good' : 'warn' },
    { name: 'Webhook Services', status: data.webhooks.length ? 'Operational' : 'Attention', detail: `${data.webhooks.length} endpoints`, tone: data.webhooks.length ? 'good' : 'warn' },
    { name: 'Sync Workers', status: attention ? 'Attention' : 'Operational', detail: attention ? `${attention} need attention` : 'On schedule', tone: attention ? 'warn' : 'good' },
    { name: 'Data Pipelines', status: 'Operational', detail: `${data.jobs.length} recent jobs`, tone: 'good' },
    { name: 'Log Processing', status: 'Operational', detail: data.jobs.length ? 'Healthy' : 'Quiet', tone: 'good' }
  ];
  return { rows, attention };
}

export function PlatformIntegrations() {
  const { data, loading, error, reload } = useResource('/api/admin/integrations');
  const [name, setName] = useState('Ops key');
  const [secret, setSecret] = useState('');
  const [section, setSection] = useSection(TECH);
  return (
    <Page
      eyebrow="Platform"
      title="Integrations and technical"
      lede="Manage all platform integrations, APIs, webhooks, OAuth, sync jobs, pipelines and system configuration."
      actions={(
        <aside className="tech-quote" aria-label="Integration promise">
          <p>Reliable integrations.<br />Unified data.<br />Smarter real-estate intelligence.</p>
        </aside>
      )}
    >
      <Subnav items={TECH} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="tech-layout">
          <div className="stack">
            {section === 'Integration Registry' || section === 'Integration Health' ? (
              <Table columns={[
                { key: 'name', label: 'Provider' },
                { key: 'category', label: 'Category', render: (row) => label(row.category) },
                { key: 'connections', label: 'Connections' },
                { key: 'errors', label: 'Errors' }
              ]} rows={section === 'Integration Health' ? [...data.providers].sort((a, b) => Number(b.errors || 0) - Number(a.errors || 0)) : data.providers} />
            ) : null}
            {section === 'Sync Jobs' || section === 'Data Pipelines' || section === 'Logs' ? (
              <section className="panel">
                <header><h2>{section}</h2></header>
                <ul className="alert-list">{data.jobs.map((job, index) => <li key={index}><strong>{job.providerName}</strong><span>{job.organizationName} · {job.status} · {job.summary}</span></li>)}</ul>
              </section>
            ) : null}
            {section === 'API Configuration' || section === 'API Keys' || section === 'Developer Tools' ? (
              <section className="panel">
                <header><h2>API keys</h2></header>
                {data.apiKeys.map((key) => <p key={key.id}>{key.name} · {key.keyPrefix}…</p>)}
                <form className="filters" onSubmit={async (event) => {
                  event.preventDefault();
                  const created = await api.post('/api/admin/integrations/api-keys', { name });
                  setSecret(created.secret);
                  reload();
                }}>
                  <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Key name" />
                  <button className="btn" type="submit">Create key</button>
                </form>
                {secret ? <p>Copy this secret now. It will not be shown again: {secret}</p> : null}
              </section>
            ) : null}
            {section === 'Webhooks' || section === 'OAuth' || section === 'System Configuration' ? (
              <section className="panel">
                <header><h2>{section}</h2></header>
                {(section === 'Webhooks' || section === 'System Configuration') ? data.webhooks.map((hook) => <p key={hook.id}>{hook.name} · {hook.eventName} · {hook.status}</p>) : null}
                {(section === 'OAuth' || section === 'System Configuration') ? data.oauthClients.map((client) => <p key={client.clientId}>{client.name} · {client.clientId}</p>) : null}
              </section>
            ) : null}
          </div>
          <IntegrationRail data={data} onOpen={setSection} />
          </div>
        ) : null}
      </State>
    </Page>
  );
}

function IntegrationRail({ data, onOpen }) {
  const health = integrationHealth(data);
  const actions = [
    ['API Keys', 'Generate API Key', 'Create a platform key'],
    ['Webhooks', 'Configure Webhooks', 'See delivery endpoints'],
    ['OAuth', 'Manage OAuth Apps', 'View registered clients'],
    ['Sync Jobs', 'View Sync Jobs', 'Open the latest jobs']
  ];
  return (
    <aside className="tech-rail">
      <section className="panel health-card">
        <header>
          <h2>System Health</h2>
          <span className={`badge ${health.attention ? 'warn' : 'good'}`}>{health.attention ? 'Needs attention' : 'Mostly healthy'}</span>
        </header>
        <ul className="health-list">
          {health.rows.map((row) => (
            <li key={row.name}>
              <span className={`health-dot ${row.tone}`} />
              <span>
                <strong>{row.name}</strong>
                <em>{row.detail}</em>
              </span>
              <span className={`badge ${row.tone}`}>{row.status}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <header><h2>Quick Actions</h2></header>
        <div className="quick-list">
          {actions.map(([section, title, detail]) => (
            <button key={section} type="button" onClick={() => onOpen(section)}>
              <span>
                <strong>{title}</strong>
                <em>{detail}</em>
              </span>
              <b aria-hidden="true">›</b>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function ModelConnect({ data, reload }) {
  const connections = data.models || [];
  const purposes = data.purposes || [];
  const [purpose, setPurpose] = useState('');
  const [provider, setProvider] = useState(connections[0]?.provider || 'openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState([]);
  const [picked, setPicked] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const savedForProvider = connections.find((row) => row.provider === provider);
  const taken = connections.find((row) => row.purpose === purpose);

  useEffect(() => {
    if (!data.canManage) return undefined;
    const key = apiKey.trim();
    const usingSaved = Boolean(savedForProvider && !key);
    if (!usingSaved && key.length < 20) {
      if (!savedForProvider) setModels([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      api.post('/api/admin/ai/models', {
        provider,
        apiKey: usingSaved ? '' : key,
        baseUrl: provider === 'openai' ? (baseUrl.trim() || (usingSaved ? savedForProvider.baseUrl || '' : '')) : ''
      }).then((result) => {
        if (live) setModels(result?.models || []);
      }).catch((err) => {
        if (!live) return;
        setModels([]);
        setError(err.message);
      }).finally(() => { if (live) setBusy(false); });
    }, usingSaved ? 0 : 400);
    return () => { live = false; clearTimeout(timer); };
  }, [data.canManage, provider, apiKey, baseUrl, savedForProvider]);

  function changeProvider(next) {
    setProvider(next);
    setModels([]);
    setPicked('');
  }

  async function connect(event) {
    event.preventDefault();
    if (!purpose) {
      setError('Choose a purpose.');
      return;
    }
    if (!picked) {
      setError('Choose a model from the list.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post('/api/admin/ai/connect', { purpose, provider, model: picked, apiKey, baseUrl });
      const name = purposes.find((row) => row.key === purpose)?.label || purpose;
      setApiKey('');
      setPicked('');
      setPurpose('');
      setNotice(`${name} is connected.`);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(id) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post('/api/admin/ai/disconnect', { id });
      setNotice('That model is disconnected.');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const list = connections.length ? (
    <ul className="model-rows">
      {connections.map((row) => (
        <li key={row.id}>
          <div>
            <strong>{row.purposeLabel}</strong>
            <span>{row.providerName} · {row.model} · key {row.keyPreview}</span>
          </div>
          {data.canManage ? <button className="btn" type="button" disabled={busy} onClick={() => disconnect(row.id)}>Disconnect</button> : null}
        </li>
      ))}
    </ul>
  ) : <p>No model is connected.</p>;

  if (!data.canManage) return list;
  return (
    <>
      {list}
      <form className="form-grid" onSubmit={connect}>
        <p className="quiet">Add a model for each purpose. Nothing is selected until you choose it. The same provider key can be reused. Connecting a purpose again replaces only that purpose.</p>
        <label className="stack-field">Purpose
          <select value={purpose} onChange={(event) => setPurpose(event.target.value)}>
            <option value="">Choose a purpose</option>
            {purposes.map((row) => {
              const current = connections.find((item) => item.purpose === row.key);
              return <option key={row.key} value={row.key}>{row.label}{current ? ' · replace connected model' : ''}</option>;
            })}
          </select>
        </label>
        {taken ? <p className="quiet">This purpose already uses {taken.providerName} · {taken.model}. Connecting again replaces it.</p> : null}
        <label className="stack-field">Provider
          <select value={provider} onChange={(event) => changeProvider(event.target.value)}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </label>
        <label className="stack-field">API key
          <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required={!savedForProvider} placeholder={savedForProvider ? 'Leave blank to reuse the saved key' : ''} />
        </label>
        {provider === 'openai' ? (
          <label className="stack-field">Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Leave blank for https://api.openai.com" />
          </label>
        ) : null}
        <label className="stack-field">Model
          <select value={picked} onChange={(event) => setPicked(event.target.value)}>
            <option value="">{models.length ? `Choose one of ${models.length} models` : (busy ? 'Loading models…' : 'Models appear here after the key is checked')}</option>
            {models.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <button className="btn-primary" type="submit" disabled={busy || !purpose || !picked}>{busy ? 'Checking with the provider…' : 'Connect model'}</button>
        {notice ? <p>{notice}</p> : null}
        {error ? <p className="delta-down">{error}</p> : null}
      </form>
    </>
  );
}

export function PlatformAi() {
  const [section, setSection] = useSection(PAI);
  return (
    <Gate path="/api/admin/ai" eyebrow="Platform" title="Platform AI" lede="Talk to the platform assistant, or connect a model for each purpose.">
      {(data, reload) => (
        <>
        <Subnav items={PAI} value={section} onChange={setSection} />
        <section className="panel">
          <h2>{section}</h2>
          {section === 'Assistant' ? <AssistantChat manageModels={data.canManage} onOpenModels={() => setSection('AI Models')} /> : null}
          {section === 'AI Policies' || section === 'AI Configuration' || section === 'AI Overview' ? <p>{data.policy}</p> : null}
          {section === 'AI Models' || section === 'AI Configuration' ? <ModelConnect data={data} reload={reload} /> : null}
          {section === 'AI Costs' ? <p>{data.models?.length ? 'Connected models have no spend figure from the provider yet.' : 'No model is connected, so there is no model bill.'}</p> : null}
          {section !== 'Assistant' && section !== 'AI Models' && section !== 'AI Costs' && section !== 'AI Policies' && section !== 'AI Configuration' ? (
            data.usage.length ? data.usage.map((row) => <p key={row.surface}>{label(row.surface)}: {num(row.total)} logged answers</p>) : <p className="quiet">No AI usage is logged yet.</p>
          ) : null}
        </section>
        </>
      )}
    </Gate>
  );
}

export function PlatformSecurity() {
  const [section, setSection] = useSection(SECURITY);
  const show = (name) => section === name;
  return (
    <Gate path="/api/admin/security" eyebrow="Platform" title="Security and audit" lede="Audit logs, security events, login activity, access logs, API activity, admin actions, and system events.">
      {(data) => (
        <div className="stack">
          <Subnav items={SECURITY} value={section} onChange={setSection} />
          {show('Security Events') || show('System Events') ? <section className="panel"><header><h2>{section}</h2></header><ul className="alert-list">{data.events.filter((event) => show('System Events') || event.severity).map((event, index) => <li key={index}><strong>{event.eventType}</strong><span>{event.message} · {event.ip || '—'} · {when(event.createdAt)}</span></li>)}</ul></section> : null}
          {show('Login Activity') || show('Access Logs') ? <section className="panel"><header><h2>{section}</h2></header><ul className="alert-list">{(data.sessions || []).map((event, index) => <li key={index}><strong>{event.fullName}</strong><span>{label(event.realm)} · {event.ip || '—'} · {when(event.startedAt)}</span></li>)}{(data.sessions || []).length === 0 ? <li className="quiet">No sessions on record.</li> : null}</ul></section> : null}
          {show('Audit Logs') || show('Admin Actions') ? <section className="panel"><header><h2>{section}</h2></header><ul className="alert-list">{data.audit.map((event, index) => <li key={index}><strong>{event.action}</strong><span>{event.actorName || 'System'} · {event.resourceName} · {when(event.createdAt)}</span></li>)}</ul></section> : null}
          {show('API Activity') ? <section className="panel"><header><h2>API activity</h2></header><ul className="alert-list">{data.audit.filter((event) => /api|key|webhook|oauth/i.test(event.action || '')).map((event, index) => <li key={index}><strong>{event.action}</strong><span>{event.actorName || 'System'} · {when(event.createdAt)}</span></li>)}{data.audit.some((event) => /api|key|webhook|oauth/i.test(event.action || '')) ? null : <li>No API actions on record.</li>}</ul></section> : null}
        </div>
      )}
    </Gate>
  );
}

export function PlatformSettings() {
  const { data, loading, error, reload } = useResource('/api/admin/settings');
  const [section, setSection] = useSection(SETTINGS);
  const [email, setEmail] = useState('');
  const keyFor = { General: 'general', 'Platform Configuration': 'general', Notifications: 'notifications', Email: 'email', Security: 'security', 'Feature Flags': 'featureFlags', Localization: 'localization', 'System Preferences': 'general' };
  return (
    <Page eyebrow="Platform" title="Platform settings" lede="General, configuration, notifications, email, security, feature flags, localization, and preferences.">
      <Subnav items={SETTINGS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <form className="form-grid panel" onSubmit={async (event) => {
            event.preventDefault();
            await api.patch('/api/admin/settings', { key: 'general', value: { ...(data.values.general || {}), supportEmail: email } });
            reload();
          }}>
            <h2>{section}</h2>
            <pre>{JSON.stringify(data.values[keyFor[section]] || {}, null, 2)}</pre>
            {section === 'General' || section === 'Email' ? (
              <>
                <p>Support email: {data.values.general?.supportEmail}</p>
                <input value={email} placeholder="Update support email" onChange={(event) => setEmail(event.target.value)} />
                <button className="btn" type="submit">Save general</button>
              </>
            ) : null}
          </form>
        ) : null}
      </State>
    </Page>
  );
}
